"use client";

export default function Badge3DViewer({
  tier,
  onClose,
}: {
  tier: "fire" | "rainbow";
  onClose: () => void;
}) {
  return (
    <div data-badge-3d={tier} style={{ perspective: "400px" }}>
      <div style={{ transform: "rotateY(12deg)" }}>{tier}</div>
      <button type="button" onClick={onClose}>닫기</button>
    </div>
  );
}
