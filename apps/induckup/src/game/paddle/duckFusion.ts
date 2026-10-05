import type { DuckKind } from './duckTypes';

/** Only a basic slot next to an evolved duck of the same kind can complete a pair. */
export function adjacentFusionSource(kinds: readonly DuckKind[], selected: number,
  kind: Exclude<DuckKind, 'basic'>): number | null {
  if (!Number.isInteger(selected) || selected < 0 || selected >= kinds.length
    || kinds[selected] !== 'basic') return null;
  for (const neighbor of [selected - 1, selected + 1]) {
    if (kinds[neighbor] === kind) return neighbor;
  }
  return null;
}
