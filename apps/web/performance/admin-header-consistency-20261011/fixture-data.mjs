export const stamp = '2026-10-03T00:00:00.000Z'

export const storyboardProjects = ['gemini-api', 'manual'].map((provider, index) => {
    const id = `00000000-0000-4000-b100-${String(index + 1).padStart(12, '0')}`
    const textModel = provider === 'gemini-api' ? 'gemini-3.8-flash' : 'manual'
    const imageModel = provider === 'gemini-api' ? 'gemini-3.1-flash-image' : 'manual'
    return {
        id,
        revision: 0,
        status: 'partial',
        createdAt: stamp,
        updatedAt: stamp,
        request: {
            workflow: 'storyboard-mlx-v1',
            requestId: id,
            prompt: '합성 검증용 맛집 촬영안',
            sceneCount: 5,
            providers: {
                externalAI: provider === 'gemini-api',
                text: { id: provider, model: textModel },
                image: { id: provider, model: imageModel },
            },
            retrieval: 'none',
            sources: [],
            imageWidth: 1024,
            imageHeight: 576,
        },
        document: {
            schema: 'storyboard-mlx-v1',
            projectId: id,
            revision: 0,
            generatedAt: stamp,
            title: provider === 'gemini-api' ? 'Gemini 합성 프로젝트' : '수동 합성 프로젝트',
            logline: '실제 모델 호출 없이 입력 경로를 검증합니다.',
            textProvenance: {
                providerId: provider,
                model: textModel,
                verification: 'user-import',
                generatedAt: stamp,
                requestId: id,
                responseId: null,
                responseModel: null,
                modelEvidence: 'unverified',
            },
            scenes: Array.from({ length: 5 }, (_, scene) => ({
                sceneNo: scene + 1,
                title: `검증 장면 ${scene + 1}`,
                durationSec: 10,
                description: '합성 식당 장면',
                visualDirection: '정면 촬영',
                narration: '',
                caption: '',
                productionNotes: ['합성 검증용'],
                imagePrompt: '합성 식당',
                sourceIds: [],
                revision: 0,
                image: null,
                imageError: null,
            })),
        },
    }
})

export const videos = Array.from({ length: 25 }, (_, index) => ({
    id: `fixture-video-${index + 1}`,
    title: `가을 맛집 탐방 ${index + 1}`,
    category: ['한식', '중식', '일식'][index % 3],
    viewCount: 500_000 + index * 31_000,
    likeCount: 3_000 + index * 260,
    commentCount: 200 + index * 17,
    duration: 900,
    previousViewCount: 450_000 + index * 27_000,
    previousLikeCount: 2_800 + index * 230,
    previousCommentCount: 170 + index * 15,
    previousDuration: 900,
    publishedAt: `2026-09-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
}))

export const restaurants = Array.from({ length: 25 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    name: `검증 맛집 ${index + 1}`,
    approved_name: `검증 맛집 ${index + 1}`,
    road_address: `서울특별시 중구 검증로 ${index + 1}`,
    jibun_address: null,
    categories: ['한식'],
    lat: 37.55 + index * 0.001,
    lng: 126.98 + index * 0.001,
    status: 'approved',
    review_count: 3,
    verified_review_count: 3,
    youtube_link: '',
    created_at: stamp,
    updated_at: stamp,
}))

export const fixtureProfiles = Array.from({ length: 3 }, (_, index) => ({
    user_id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
    nickname: `검증 사용자 ${index + 1}`,
    avatar_url: null,
}))

export const fixtureUser = {
    id: fixtureProfiles[0].user_id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'fixture@example.test',
    created_at: stamp,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { nickname: fixtureProfiles[0].nickname },
    identities: [],
}

export function fixtureSession() {
    const now = Math.floor(Date.now() / 1_000)
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
    return {
        access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: fixtureUser.id, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 86_400 })}.synthetic-loopback-only`,
        refresh_token: 'synthetic-loopback-only',
        token_type: 'bearer',
        expires_in: 86_400,
        expires_at: now + 86_400,
        user: fixtureUser,
    }
}

export const managedUsers = fixtureProfiles.map((profile, index) => ({
    id: profile.user_id,
    email: `fixture${index + 1}@example.test`,
    username: `fixture${index + 1}`,
    nickname: profile.nickname,
    avatarUrl: null,
    profileRole: 'user',
    isAdmin: index === 0,
    isDisabled: index === 2,
    bannedUntil: null,
    createdAt: stamp,
    lastSignInAt: stamp,
    emailConfirmedAt: stamp,
    statusLabel: index === 2 ? '비활성' : '활성',
    roleLabel: index === 0 ? '관리자' : '사용자',
}))

export const fixtureBanners = [
    {
        id: '00000000-0000-4000-b000-000000000001',
        title: '검증용 맛집 안내',
        description: '합성 배너입니다.',
        image_url: null,
        video_url: null,
        media_type: 'none',
        link_url: null,
        is_active: true,
        priority: 1,
        display_target: ['sidebar'],
        created_at: stamp,
        updated_at: stamp,
        created_by: fixtureUser.id,
    },
]

export const fixtureSubmissions = [
    {
        id: '00000000-0000-4000-a100-000000000001',
        user_id: fixtureUser.id,
        submission_type: 'new',
        status: 'pending',
        restaurant_name: '검증 제보 맛집',
        restaurant_address: '서울특별시 중구 검증로 1',
        restaurant_phone: null,
        restaurant_categories: ['한식'],
        admin_notes: null,
        rejection_reason: null,
        resolved_by_admin_id: null,
        reviewed_at: null,
        created_at: stamp,
        updated_at: stamp,
    },
]

export const fixtureSubmissionItems = [
    {
        id: '00000000-0000-4000-a200-000000000001',
        submission_id: fixtureSubmissions[0].id,
        youtube_link: '',
        tzuyang_review: '검증용 제보 근거',
        target_restaurant_id: null,
        item_status: 'pending',
        rejection_reason: null,
        created_at: stamp,
    },
]

export const fixtureReviews = restaurants.flatMap((restaurant, restaurantIndex) =>
    fixtureProfiles.map((profile, profileIndex) => ({
        id: `00000000-0000-4000-a000-${String(restaurantIndex * 3 + profileIndex + 1).padStart(12, '0')}`,
        restaurant_id: restaurant.id,
        user_id: profile.user_id,
        title: `검증 리뷰 ${profileIndex + 1}`,
        content: `검증용 리뷰 ${profileIndex + 1}. 음식과 공간의 분위기를 확인하는 합성 데이터입니다.`,
        visited_at: stamp,
        created_at: stamp,
        verification_photo: '',
        updated_at: stamp,
        is_duplicate: false,
        receipt_data: null,
        ocr_processed_at: null,
        food_photos: [],
        categories: ['한식'],
        is_verified: true,
        is_pinned: false,
        is_edited_by_admin: false,
        admin_note: null,
        like_count: profileIndex + 1,
    })),
)

export const pendingReviews = fixtureReviews.slice(0, 3).map((row, index) => ({
    ...row,
    id: `00000000-0000-4000-a400-${String(index + 1).padStart(12, '0')}`,
    is_verified: false,
}))

export const evaluations = restaurants.map((restaurant, index) => ({
    ...restaurant,
    trace_id: `fixture-trace-${index + 1}`,
    source_type: 'crawl',
    status: 'pending',
    restaurant_name: restaurant.name,
    video_id: videos[index].id,
    youtube_link: '',
    evaluation_results: {},
    address: restaurant.road_address,
}))

export const refreshCandidates = restaurants.slice(0, 3).map((row, index) => ({
    id: `00000000-0000-4000-a700-${String(index + 1).padStart(12, '0')}`,
    restaurant_id: row.id,
    restaurant_name: row.name,
    restaurant_address: row.road_address,
    current_phone: null,
    candidate_status: 'needs_review',
    detected_change_types: [['phone', 'name', 'closure'][index]],
    previous_snapshot: {
        name: row.name,
        approved_name: row.name,
        phone: null,
        road_address: row.road_address,
        jibun_address: null,
    },
    candidate_snapshot: {
        name: index === 1 ? `${row.name} 변경 후보` : row.name,
        approved_name: index === 1 ? `${row.name} 변경 후보` : row.name,
        phone: index === 0 ? '02-0000-0000' : null,
        road_address: row.road_address,
        jibun_address: null,
    },
    evidence: { source: 'synthetic-fixture' },
    created_at: stamp,
    decided_at: null,
    applied_at: null,
    readback_state: { status: 'not_required', checked_at: null, run_id: null, notes: null },
}))

export const pending = {
    submissions: 6,
    recommendationRequests: 2,
    reviews: 3,
    total: 9,
    asOf: stamp,
    recommendationRequestsLifecycleReady: true,
    domains: {
        restaurant_submissions: {
            id: 'restaurant_submissions',
            count: 4,
            ready: true,
            status: 'ready',
        },
        restaurant_recommendation_requests: {
            id: 'restaurant_recommendation_requests',
            count: 2,
            ready: true,
            status: 'ready',
        },
        reviews: { id: 'reviews', count: 3, ready: true, status: 'ready' },
    },
    readiness: {
        status: 'ready',
        recommendationRequestsLifecycleReady: true,
        reasons: [],
    },
    diagnostics: {},
}

export const summary = {
    asOf: stamp,
    totals: { restaurants: 25, videos: 25, categories: 3, withCoordinates: 25 },
    topCategories: [{ name: '한식', count: 25 }],
    videos: videos.map((video) => ({
        videoId: video.id,
        youtubeLink: null,
        title: video.title,
        publishedAt: video.publishedAt,
        restaurantCount: 1,
        notSelectedCount: 0,
        geocodingFailedCount: 0,
        updatedAt: stamp,
    })),
}

export const fixtureAutomation = {
    policy: { version: 1, enabled: false, batch_size: 50, daily_limit: 50, last_run_at: null },
    runs: [],
    items: [],
    queue: { queued: 0, running: 0, failed: 0 },
    policyEvents: [],
}
