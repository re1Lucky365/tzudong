import re
from datetime import datetime

_FAMILIES = {
    "lexical_name_match",
    "exact_parcel_coordinate_match",
    "bounded_spatial_proximity",
    "telecom_identifier_match",
    "mois_public_license_closed",
}
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PHONE = re.compile(r"\d{2,4}-\d{3,4}-\d{4}")


def _unique(families):
    seen = []
    for family in families:
        if family not in _FAMILIES:
            raise ValueError("unknown_evidence_family")
        if family not in seen:
            seen.append(family)
    return seen


def _bounded_text(value):
    if not isinstance(value, str):
        raise ValueError("invalid_closure_record")
    text = value.strip()
    if not text or len(text) > 200 or "@" in text or _PHONE.search(text):
        raise ValueError("invalid_closure_record")
    if any(ord(char) < 32 or ord(char) == 127 for char in text):
        raise ValueError("invalid_closure_record")
    return text


def _calendar_date(value):
    if not isinstance(value, str) or _DATE.fullmatch(value) is None:
        raise ValueError("invalid_calendar_date")
    year, month, day = (int(part) for part in value.split("-"))
    try:
        parsed = datetime(year, month, day)
    except ValueError as error:
        raise ValueError("invalid_calendar_date") from error
    if (parsed.year, parsed.month, parsed.day) != (year, month, day):
        raise ValueError("invalid_calendar_date")
    return value


def _require_closure(record):
    if record is None:
        return False
    if not isinstance(record, dict):
        raise ValueError("invalid_closure_record")
    _bounded_text(record.get("ledgerId"))
    _bounded_text(record.get("businessAddress"))
    _calendar_date(record.get("effectiveOn"))
    _bounded_text(record.get("branchDistinction"))
    _calendar_date(record.get("sourceUpdatedOn"))
    return True


def resolve_automatic_identity(
    *,
    query_stage,
    search_miss=False,
    evidence_families=(),
    evidence_conflicts=False,
    closure_record=None,
):
    if query_stage is not None and (
        isinstance(query_stage, bool)
        or not isinstance(query_stage, int)
        or query_stage < 1
        or query_stage > 10
    ):
        raise ValueError("invalid_query_stage")
    families = _unique(evidence_families)
    exact = query_stage is not None and query_stage <= 3
    supported = exact and not search_miss and len(families) >= 2
    closure = _require_closure(closure_record)
    if evidence_conflicts or (closure and supported):
        state = "conflict"
    elif closure:
        state = "closure_candidate"
    elif supported:
        state = "supported"
    else:
        state = "needs_review"
    return {"state": state, "auto_closed_store": False, "auto_relocated": False}
