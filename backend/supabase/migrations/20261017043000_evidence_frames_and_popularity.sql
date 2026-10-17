-- Evidence frames and popularity metrics stay off restaurants.evaluation_results
-- and do not change restaurants.updated_at. Delete behavior is undecided, so
-- this migration does not cascade. Hosted apply stays unauthorized.

CREATE TABLE IF NOT EXISTS public.restaurant_evidence_frames (
    frame_id text PRIMARY KEY CHECK (char_length(frame_id) BETWEEN 1 AND 128),
    content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants (id),
    video_id text NOT NULL,
    timestamp_ms bigint NOT NULL CHECK (timestamp_ms >= 0),
    storage_object_key text NOT NULL UNIQUE,
    youtube_seek_url text NOT NULL,
    frame_type text NOT NULL CHECK (frame_type IN ('storefront_sign', 'publisher_location_caption', 'on_site_scene', 'menu_receipt')),
    evidence_level text NOT NULL CHECK (evidence_level IN (
        'SOURCE_OBSERVED',
        'BOUNDARY_INTEGRATION_TESTED',
        'SYNTHETIC_MOCK_TESTED',
        'HOST_TESTED',
        'PROPOSED',
        'UNVERIFIED',
        'CONTRADICTED'
    )),
    confidence_level text NOT NULL CHECK (confidence_level IN ('certain', 'probable', 'uncertain')),
    moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    detected_shop_name text,
    detected_branch_name text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.restaurant_popularity_metrics (
    canonical_key text PRIMARY KEY,
    source_revision bigint NOT NULL CHECK (source_revision >= 0),
    scoring_version text NOT NULL,
    cohort_version text NOT NULL,
    popularity_score double precision CHECK (popularity_score IS NULL OR popularity_score = popularity_score),
    popularity_tier text CHECK (popularity_tier IS NULL OR popularity_tier IN ('fire', 'rainbow', 'standard')),
    computed_at timestamptz NOT NULL
);

ALTER TABLE public.restaurant_evidence_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_popularity_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY restaurant_evidence_frames_approved_read
    ON public.restaurant_evidence_frames
    FOR SELECT
    USING (moderation_status = 'approved');

REVOKE ALL ON public.restaurant_popularity_metrics FROM PUBLIC;
REVOKE ALL ON public.restaurant_evidence_frames FROM PUBLIC;
GRANT SELECT ON public.restaurant_evidence_frames TO anon, authenticated;
