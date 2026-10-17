_COLLECTION_FIELDS = ("origin_name", "video_id", "frame_id", "content_sha256", "storage_object_key")


def merge_collection_row(existing, incoming):
    if not isinstance(existing, dict) or not isinstance(incoming, dict):
        raise ValueError("invalid_review_row")
    if "moderation_status" in incoming and incoming.get("moderation_status") != existing.get("moderation_status"):
        if existing.get("moderation_status") in {"approved", "rejected", "pending"}:
            raise ValueError("review_status_not_writable_by_collection")
    merged = dict(existing)
    for field in _COLLECTION_FIELDS:
        if field in incoming and field != "moderation_status":
            merged[field] = incoming[field]
    merged["moderation_status"] = existing.get("moderation_status", "pending")
    return merged
