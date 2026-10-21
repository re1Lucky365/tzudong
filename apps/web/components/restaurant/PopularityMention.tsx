import { popularityFlameCount } from "@/lib/evidence-engineering/popularity-marker";

export function PopularityMention({
  tier,
}: {
  tier: "fire" | "rainbow" | "standard";
}) {
  const count = popularityFlameCount(tier);
  if (count === 0) return null;
  return (
    <p
      className="truncate px-0.5 text-xs leading-4 text-muted-foreground"
      data-popularity-mention={String(count)}
    >
      {count === 3 ? "불꽃 3개 · 제일 맛있는 맛집" : "불꽃 2개 · 맛있는 맛집"}
    </p>
  );
}
