export type OperationalCaution = "closure_candidate" | "closed_store" | "relocated";

export function operationalCaution(input: {
  automaticState?: string | null;
  reviewedStatus?: string | null;
  reviewed?: boolean;
}): OperationalCaution | null {
  if (input.automaticState === "closure_candidate") return "closure_candidate";
  if (!input.reviewed) return null;
  if (input.reviewedStatus === "closed_store" || input.reviewedStatus === "relocated") {
    return input.reviewedStatus;
  }
  return null;
}

export function naverPlaceSearchUrl(shopName: string): string | null {
  const name = shopName.trim();
  if (!name || name.includes("\n") || name.length > 80) return null;
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}

export function OperationalCautionNotice({
  caution,
  shopName,
}: {
  caution: OperationalCaution | null;
  shopName: string;
}) {
  if (!caution) return null;
  const href = naverPlaceSearchUrl(shopName);
  const label = caution === "relocated"
    ? "네이버 지도 교차 확인: 상호 변경"
    : "네이버 지도 교차 확인: 영업 중단 또는 상호 변경";
  return (
    <p className="px-4 text-sm text-amber-800">
      {label}
      {href ? (
        <>
          {" "}
          <a href={href} target="_blank" rel="noopener noreferrer">네이버 플레이스</a>
        </>
      ) : null}
    </p>
  );
}
