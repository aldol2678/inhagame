export const BIRYONG_NPC_NAMEPLATE_MAX_DISTANCE = 22;
export const BIRYONG_NPC_NAMEPLATE_INSET = 8;
const GAP = 4;

// Coordinates are CSS viewport pixels. x/y remain the center/bottom anchor used
// by translate(-50%, -100%); dimensions include the nameplate's padding/border.
export function layoutBiryongNpcNameplates(candidates, { left = 0, top = 0, width, height }) {
  const inset = BIRYONG_NPC_NAMEPLATE_INSET;
  if (![left, top, width, height].every(Number.isFinite) || width <= inset * 2 || height <= inset * 2) return [];
  const right = left + width;
  const bottom = top + height;
  const ordered = candidates.filter(candidate => {
    const { x, y, depth, distance, width: w, height: h } = candidate;
    return [x, y, depth, distance, w, h].every(Number.isFinite) &&
      depth > 0 && distance >= 0 && distance <= BIRYONG_NPC_NAMEPLATE_MAX_DISTANCE &&
      x >= left && x <= right && y >= top && y <= bottom &&
      w > 0 && h > 0 && w <= width - inset * 2 && h <= height - inset * 2;
  }).sort((a, b) => a.distance - b.distance || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = [];
  for (const candidate of ordered) {
    const x = Math.max(left + inset + candidate.width / 2,
      Math.min(right - inset - candidate.width / 2, candidate.x));
    const y = Math.max(top + inset + candidate.height, Math.min(bottom - inset, candidate.y));
    if (placed.some(other =>
      x - candidate.width / 2 < other.x + other.width / 2 + GAP &&
      x + candidate.width / 2 > other.x - other.width / 2 - GAP &&
      y - candidate.height < other.y + GAP && y > other.y - other.height - GAP)) continue;
    placed.push({ id: candidate.id, x, y, width: candidate.width, height: candidate.height });
  }
  return placed;
}
