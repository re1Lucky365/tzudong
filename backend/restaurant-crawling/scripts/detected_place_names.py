import re

_PHONE_RE = re.compile(r"\d{2,4}-\d{3,4}-\d{4}")
_FORBIDDEN_KEYS = {
    "raw_ocr",
    "ocr_text",
    "phone",
    "phone_number",
    "email",
    "device_lat",
    "device_lng",
    "precise_location",
    "request_body",
    "provider_diagnostic",
}


def _clean_name(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("invalid_detected_name")
    text = value.strip()
    if not text:
        return None
    if any(char < " " or char == "\x7f" for char in text):
        raise ValueError("invalid_detected_name")
    if len(text) > 80 or "@" in text or _PHONE_RE.search(text):
        raise ValueError("invalid_detected_name")
    return text


def project_detected_place_names(record):
    if not isinstance(record, dict):
        raise ValueError("invalid_caption_record")
    projected = {key: value for key, value in record.items() if key not in _FORBIDDEN_KEYS}
    regions = projected.pop("ocr_regions", None)
    shop = projected.get("detected_shop_name")
    branch = projected.get("detected_branch_name")
    if isinstance(regions, list):
        for region in regions:
            if not isinstance(region, dict):
                continue
            zone = region.get("zone")
            text = _clean_name(region.get("text"))
            if zone in {"storefront_sign", "publisher_location_caption"} and shop is None:
                shop = text
            elif zone == "branch" and branch is None:
                branch = text
    projected["detected_shop_name"] = _clean_name(shop)
    projected["detected_branch_name"] = _clean_name(branch)
    if "raw_ocr" in projected or "ocr_text" in projected:
        raise ValueError("raw_ocr_forbidden")
    return projected
