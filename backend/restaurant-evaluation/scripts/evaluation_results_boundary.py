_SATELLITE_KEYS = frozenset({
    "evidence_frames",
    "restaurant_evidence_frames",
    "popularity_score",
    "popularity_tier",
    "restaurant_popularity_metrics",
})


def omit_satellite_fields(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("invalid_evaluation_results")
    return {key: item for key, item in value.items() if key not in _SATELLITE_KEYS}
