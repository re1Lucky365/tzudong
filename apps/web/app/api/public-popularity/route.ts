import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { publicPopularityPublication } from '@/lib/evidence-engineering/published-popularity';

export const dynamic = 'force-static';

export function GET() {
    const body = JSON.stringify(publicPopularityPublication);
    return new NextResponse(body, { headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=0, must-revalidate',
        etag: `"${createHash('sha256').update(body).digest('hex')}"`,
    } });
}
