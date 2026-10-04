// Full Map presentation only. These symbols and label positions never resolve
// coordinates, discovery, access or navigation; those stay with the map owners.
export const MAP_POI_ICON_PATHS = Object.freeze({
  gate: 'M4 21V5h4v16M16 21V5h4v16M4 8h16M8 12h8M2 21h20',
  'main-hall': 'M3 9l9-6 9 6H3M5 10v9M10 10v9M14 10v9M19 10v9M3 21h18',
  water: 'M3 7c3-4 6 4 9 0s6 4 9 0M3 12c3-4 6 4 9 0s6 4 9 0M3 17c3-4 6 4 9 0s6 4 9 0',
  'student-center': 'M9 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 10a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 21v-3a5 5 0 0 1 10 0v3M2 20v-3a3 3 0 0 1 3-3M22 20v-3a3 3 0 0 0-3-3',
  library: 'M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2c3-3 6-3 10-2V4c-3-1-7-1-10 2v15M5 8h3M16 8h3M5 12h3M16 12h3',
  housing: 'M2 11l10-8 10 8M5 10v11h14V10M10 21v-7h4v7',
  'building-5': 'M5 21V3h14v18M2 21h20M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3',
  exit: 'M10 3H4v18h6M9 12h13M17 7l5 5-5 5',
  // The existing dragon key identifies 비룡탑: a tower silhouette, not a platform emoji.
  dragon: 'M8 21l2-13h4l2 13M7 8h10M9 5h6M12 2v3M5 21h14M10 15h4',
  echo: 'M8 17c0-5 8-5 8 0v3H8v-3M5 15a8 8 0 0 1 14 0M2 12a12 12 0 0 1 20 0',
  landmark: 'M12 22s-8-8-8-13a8 8 0 1 1 16 0c0 5-8 13-8 13M9 9a3 3 0 1 0 6 0a3 3 0 1 0-6 0'
});

export const MAP_POI_STATES = Object.freeze({
  NORMAL: Object.freeze({ label: '이동 가능', path: null }),
  LOCKED: Object.freeze({ label: '잠김', path: 'M5 10h14v11H5V10M8 10V7a4 4 0 0 1 8 0v3M12 14v3' }),
  COMING_SOON: Object.freeze({ label: '준비 중', path: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 6v6l4 2' }),
  DISABLED: Object.freeze({ label: '이용 불가', path: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M6 18L18 6' }),
  UNKNOWN: Object.freeze({ label: '상태 확인 중', path: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M7 12h.1M12 12h.1M17 12h.1' }),
  UNDISCOVERED: Object.freeze({ label: '미발견', path: 'M8 8a4 4 0 1 1 6 3.5c-2 1-2 2-2 3M12 19h.1' })
});

export const MAP_POI_KIND_LABELS = Object.freeze({
  BUILDING: '건물', GATE: '출입구', WATER: '수변', HOUSING: '생활관',
  LANDMARK: '명소', EXIT: '출구'
});

const intersects = (a, b, gap = 4) => a.left < b.left + b.width + gap &&
  a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;

// Screen-pixel layout: markers remain at their authoritative position. Only their
// labels can move or disappear. The deterministic priority order prevents flicker.
export function layoutFullMapLabels(candidates, { width, height, obstacles = [] } = {}) {
  if (!(width > 0 && height > 0)) return [];
  const visible = candidates.filter(item => [item.x, item.y, item.width, item.height].every(Number.isFinite) &&
    item.width > 0 && item.height > 0 && item.x >= 0 && item.y >= 0 && item.x <= width && item.y <= height);
  const markers = visible.map(item => ({ left: item.x - 17, top: item.y - 17, width: 34, height: 34 }));
  const accepted = [];
  for (const item of visible.slice().sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))) {
    if (item.eligible === false) continue;
    const positions = [
      { left: item.x - item.width / 2, top: item.y + 24 },
      { left: item.x - item.width / 2, top: item.y - 24 - item.height },
      { left: item.x + 24, top: item.y - item.height / 2 },
      { left: item.x - 24 - item.width, top: item.y - item.height / 2 }
    ];
    for (const position of positions) {
      const box = { ...position, width: item.width, height: item.height };
      if (box.left < 4 || box.top < 4 || box.left + box.width > width - 4 || box.top + box.height > height - 4) continue;
      if ([...markers, ...obstacles, ...accepted].some(other => intersects(box, other))) continue;
      accepted.push({ id: item.id, ...box });
      break;
    }
  }
  return accepted;
}
