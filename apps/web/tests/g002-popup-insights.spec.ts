import { expect, test, type Page } from '@playwright/test';

const SUPABASE_PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const SUPABASE_AUTH_COOKIE_NAME = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

type InsightTreemapResponse = {
    asOf: string;
    period: string;
    totalVideos: number;
    videos: Array<{
        id: string;
        title: string;
        category: string;
        viewCount: number;
        likeCount: number;
        commentCount: number;
        duration: number;
        previousViewCount: number;
        previousLikeCount: number;
        previousCommentCount: number;
        previousDuration: number;
        publishedAt: string;
    }>;
};

const TREEMAP_MOCK: InsightTreemapResponse = {
    asOf: '2026-02-27T00:00:00.000Z',
    period: 'ALL',
    totalVideos: 2,
    videos: [
        {
            id: 'g002-v1',
            title: 'G002 샘플 한식',
            category: '한식',
            viewCount: 120_000,
            likeCount: 3_000,
            commentCount: 250,
            duration: 720,
            previousViewCount: 100_000,
            previousLikeCount: 2_400,
            previousCommentCount: 200,
            previousDuration: 700,
            publishedAt: '2026-01-01T00:00:00.000Z',
        },
        {
            id: 'g002-v2',
            title: 'G002 샘플 중식',
            category: '중식',
            viewCount: 86_000,
            likeCount: 2_400,
            commentCount: 120,
            duration: 540,
            previousViewCount: 60_000,
            previousLikeCount: 1_200,
            previousCommentCount: 80,
            previousDuration: 510,
            publishedAt: '2026-01-02T00:00:00.000Z',
        },
    ],
};

async function installFakeInsightsSession(page: Page) {
    const fakeUser = {
        id: '00000000-0000-4000-8000-000000000002',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'g002@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { nickname: 'G002' },
    };
    const fakeSession = {
        access_token: 'g002-fake-access-token',
        refresh_token: 'g002-fake-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
        user: fakeUser,
    };
    const encodedSession = Buffer.from(JSON.stringify(fakeSession), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    await page.context().addCookies([{
        name: SUPABASE_AUTH_COOKIE_NAME,
        value: `base64-${encodedSession}`,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
    }]);

    await page.route('**/auth/v1/user', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fakeUser),
        });
    });
    await page.route('**/rest/v1/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/rest/v1/user_roles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ role: 'user' }),
            });
            return;
        }
        if (url.pathname.endsWith('/rest/v1/profiles')) {
            await route.abort('blockedbyclient');
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });
}

test.describe('G002 popup and insights hardening', () => {
    test('direct /mypage load does not mount popup overlays', async ({ page }) => {
        await page.goto('/mypage/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(/마이페이지는 로그인한 뒤 사용할 수 있습니다|쯔동여지도 마이페이지/).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-mypage-no-popup.png', fullPage: true });
    });

    test('direct /insights load keeps treemap guidance keyboard accessible without popup helpers', async ({ page }) => {
        await installFakeInsightsSession(page);
        let releaseTreemap!: () => void;
        const responseGate = new Promise<void>((resolve) => { releaseTreemap = resolve; });
        let treemapRequests = 0;
        await page.route('**/api/insights/treemap*', async (route) => {
            treemapRequests += 1;
            await responseGate;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TREEMAP_MOCK),
            });
        });

        await page.goto('/insights', { waitUntil: 'domcontentloaded' });

        const chart = page.getByRole('img', { name: /트리맵 기준: 조회수 · 전체 기간 · 2개 영상 · 비율 · 개별 영상/ });
        try {
            await expect.poll(() => treemapRequests).toBeGreaterThan(0);
            await expect(chart).toHaveCount(0);
        } finally {
            releaseTreemap();
        }
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        await expect(chart).toHaveAttribute('aria-describedby', 'insights-treemap-legend insights-treemap-small-cell-guidance');
        for (const width of [360, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect.poll(() => chart.evaluate((element) => {
                const area = element.closest('[data-slot="card-content"]');
                const card = element.closest('[data-slot="card"]');
                if (!area || !card) return Number.POSITIVE_INFINITY;
                const chartRect = element.getBoundingClientRect();
                return Math.max(
                    Math.abs(chartRect.height - area.getBoundingClientRect().height),
                    Math.abs(card.getBoundingClientRect().bottom - chartRect.bottom),
                );
            }), { timeout: 10000 }).toBeLessThanOrEqual(2);
        }
        await expect(page.locator('[data-insights-treemap-context="true"]')).toHaveCount(0);
        const helpButton = page.getByRole('button', { name: '트리맵 읽는 법' });
        await helpButton.focus();
        await helpButton.press('Enter');
        const helpDialog = page.getByRole('dialog', { name: '트리맵 읽는 법' });
        await expect(helpDialog).toBeVisible();
        await expect(helpButton).toHaveAttribute('aria-expanded', 'true');
        const helpDialogId = await helpDialog.getAttribute('id');
        expect(helpDialogId).toBeTruthy();
        await expect(helpButton).toHaveAttribute('aria-controls', helpDialogId!);
        await expect(helpButton).toBeFocused();
        await expect(helpDialog).toContainText('전체 조회수 비중');
        await helpButton.press('Escape');
        await page.getByRole('button', { name: '증감률' }).click();
        await page.getByRole('button', { name: '좋아요' }).click();
        await helpButton.click();
        await expect(page.getByRole('dialog', { name: '트리맵 읽는 법' })).toContainText('좋아요 증감률');
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-insights-context.png', fullPage: true });
    });
});

test.describe('insights treemap tile detail access', () => {
    test.use({ hasTouch: true });

    test('mouse, keyboard and touch reach the same tile details without a tab stop per tile', async ({ page }) => {
        await installFakeInsightsSession(page);
        await page.route('**/api/insights/treemap*', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREEMAP_MOCK) });
        });
        await page.goto('/insights', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });

        const tiles = page.locator('[data-insights-treemap-tile-index]');
        await expect(tiles).toHaveCount(2);
        await expect(page.locator('[data-insights-treemap-tile-index][tabindex="0"]')).toHaveCount(0);

        await tiles.nth(1).hover();
        await expect(page.getByText('G002 샘플 중식')).toBeVisible();
        await page.mouse.move(0, 0);

        const navigator = page.getByRole('button', { name: '영상 탐색' });
        await navigator.focus();
        await navigator.press('ArrowRight');
        await expect(page.getByRole('status').filter({ hasText: '2 / 2: G002 샘플 중식' })).toContainText('2 / 2: G002 샘플 중식');
        await navigator.press('Enter');
        const keyboardDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 중식' });
        await expect(keyboardDetail).toContainText('카테고리: 중식');
        await expect(keyboardDetail).toContainText('조회수: 86,000개');
        await expect(keyboardDetail).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(navigator).toBeFocused();

        await tiles.nth(0).tap();
        const touchDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 한식' });
        await expect(touchDetail).toContainText('카테고리: 한식');
        await expect(touchDetail).toContainText('조회수: 120,000개');
        await expect(touchDetail).toBeFocused();
        await touchDetail.getByRole('button', { name: '다음' }).tap();
        const nextDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 중식' });
        await expect(nextDetail).toContainText('조회수: 86,000개');
        await nextDetail.getByRole('button', { name: '닫기' }).tap();
        await expect(navigator).toBeFocused();
    });

});
