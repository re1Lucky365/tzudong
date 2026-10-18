-- Shadow comparison rows stay off restaurant_popularity_metrics.
-- They do not change restaurants.updated_at and are not publicly readable.
-- Hosted apply stays unauthorized. Delete behavior is undecided, so this
-- migration does not cascade.

CREATE TABLE IF NOT EXISTS public.restaurant_popularity_shadow (
    canonical_key text NOT NULL,
    cohort_version text NOT NULL,
    scoring_version text NOT NULL,
    operational_score double precision,
    candidate_freshness double precision NOT NULL,
    candidate_visit_multiplier double precision NOT NULL,
    differs boolean NOT NULL,
    compared_at timestamptz NOT NULL,
    PRIMARY KEY (canonical_key, cohort_version, scoring_version),
    CHECK (operational_score IS NULL OR operational_score = operational_score),
    CHECK (candidate_freshness = candidate_freshness),
    CHECK (candidate_visit_multiplier = candidate_visit_multiplier)
);

ALTER TABLE public.restaurant_popularity_shadow ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_popularity_shadow FROM PUBLIC;
