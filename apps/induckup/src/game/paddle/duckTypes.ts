export type DuckKind = 'basic' | 'elastic' | 'pierce' | 'bomb' | 'clone';
export type FlockLayout = 'A' | 'B' | 'off';

const LAYOUTS: Record<FlockLayout, readonly DuckKind[]> = {
  A: ['elastic', 'basic', 'basic', 'basic', 'bomb'],
  B: ['basic', 'elastic', 'basic', 'bomb', 'basic'],
  off: ['basic', 'basic', 'basic', 'basic', 'basic'],
};

export function duckKinds(layout: FlockLayout, cloneEnabled = false): readonly DuckKind[] {
  if (!cloneEnabled || layout === 'off') return LAYOUTS[layout];
  const kinds = [...LAYOUTS[layout]];
  kinds[layout === 'A' ? 1 : 4] = 'clone';
  return kinds;
}
