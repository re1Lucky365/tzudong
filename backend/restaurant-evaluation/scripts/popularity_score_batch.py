import math
import re

THESIS_LAMBDA = 0.0015
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
PROPOSED_FLOOR = 0.5
PROPOSED_HALF_LIFE_DAYS = 460.0
COEFFICIENTS_LOCKED = False


def decay(days, floor, half_change_days):
    values = (days, floor, half_change_days)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("non_finite")
    if days < 0 or floor < 0 or floor >= 1 or half_change_days <= 0:
        raise ValueError("invalid_decay_parameters")
    return floor + (1 - floor) / (1 + days / half_change_days)


def hyperbolic_decay(days, lambda_value=THESIS_LAMBDA):
    if not math.isfinite(days) or not math.isfinite(lambda_value):
        raise ValueError("non_finite")
    if days < 0 or lambda_value <= 0:
        raise ValueError("invalid_decay_parameters")
    return 1 / (1 + lambda_value * days)


def hyperbolic_half_life_days(lambda_value=THESIS_LAMBDA):
    if not math.isfinite(lambda_value) or lambda_value <= 0:
        raise ValueError("invalid_decay_parameters")
    return 1 / lambda_value


def visits_multiplier(video_ids, gamma):
    if not math.isfinite(gamma) or gamma < 0:
        raise ValueError("invalid_gamma")
    unique = []
    for video_id in video_ids:
        if not isinstance(video_id, str) or _VIDEO_ID.fullmatch(video_id) is None:
            raise ValueError("invalid_video_id")
        if video_id not in unique:
            unique.append(video_id)
    return 1 + gamma * math.log1p(max(0, len(unique) - 1))


def build_popularity_row(*, canonical_key, video_ids, days_since_publish, review_count, scoring_version, cohort_version, computed_at, gamma, source_revision):
    if COEFFICIENTS_LOCKED:
        raise ValueError("coefficients_must_stay_unlocked")
    if review_count is not None and review_count < 0:
        raise ValueError("invalid_review_count")
    if isinstance(source_revision, bool) or not isinstance(source_revision, int) or source_revision < 0:
        raise ValueError("invalid_source_revision")
    decay(days_since_publish, PROPOSED_FLOOR, PROPOSED_HALF_LIFE_DAYS)
    visits_multiplier(video_ids, gamma)
    return {
        "canonical_key": canonical_key,
        "source_revision": source_revision,
        "scoring_version": scoring_version,
        "cohort_version": cohort_version,
        "popularity_score": None,
        "popularity_tier": None,
        "computed_at": computed_at,
        "writes_hosted_database": False,
        "mutates_restaurant_updated_at": False,
    }
