-- Shadow tiers stay on restaurant_popularity_shadow.
-- They do not set restaurants.popularity_tier and are not publicly readable.
-- Hosted apply stays unauthorized. This migration does not cascade.

ALTER TABLE public.restaurant_popularity_shadow
    ADD COLUMN IF NOT EXISTS popularity_tier text
    CHECK (popularity_tier IS NULL OR popularity_tier IN ('fire', 'rainbow', 'standard'));
