_EXACT = (
    (1, "origin_name_plus_road_address"),
    (2, "origin_name_plus_jibun_address"),
    (3, "sigungu_plus_origin_name"),
)
_BROAD = (
    (4, "sigungu_plus_keyword_plus_category"),
    (5, "historical_name_plus_admin_dong"),
)


def _join(*parts):
    return " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())


def build_naver_query_plan(
    *,
    origin_name,
    road_address="",
    jibun_address="",
    sigungu="",
    keyword="",
    category="",
    historical_name="",
    admin_dong="",
):
    texts = {
        1: _join(origin_name, road_address),
        2: _join(origin_name, jibun_address),
        3: _join(sigungu, origin_name),
        4: _join(sigungu, keyword, category),
        5: _join(historical_name, admin_dong),
    }
    stages = []
    for stage, template in (*_EXACT, *_BROAD):
        if stage < 1 or stage > 5:
            raise ValueError("invalid_query_stage")
        kind = "exact" if stage <= 3 else "broad"
        text = texts[stage]
        stages.append(
            {
                "stage": stage,
                "kind": kind,
                "template": template,
                "text": text,
                "auto_confirm": kind == "exact",
                "execute": kind == "exact" and bool(text),
            }
        )
    return stages


def executable_exact_queries(plan):
    queries = []
    for stage in plan:
        if stage["stage"] > 5:
            raise ValueError("unspecified_query_stage")
        if stage["execute"] and stage["text"] not in queries:
            queries.append(stage["text"])
    return queries[:3]
