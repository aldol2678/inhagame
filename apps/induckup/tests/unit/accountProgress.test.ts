import { describe, expect, it } from 'vitest';
import {
  emptyInduckUpProgress,
  mergeInduckUpProgress,
  normalizeInduckUpProgress,
  recordInduckUpRun,
} from '../../src/account/accountProgress';

describe('InduckUp account progress', () => {
  it('records run summaries without weakening best values', () => {
    const first = recordInduckUpRun(emptyInduckUpProgress(), {
      result: 'CLEAR', wave: 2, level: 3, evolutions: 2, evolvedKind: 'bomb',
      finishedAt: '2026-09-25T00:00:00.000Z',
    });
    const second = recordInduckUpRun(first, {
      result: 'LOST', wave: 1, level: 1, evolutions: 0, evolvedKind: null,
      finishedAt: '2026-09-25T00:10:00.000Z',
    });
    expect(second).toMatchObject({
      runsRecorded: 2, clears: 1, losses: 1, bestWave: 2, bestLevel: 3,
      maxEvolutions: 2, lastEvolutionKind: 'bomb',
    });
  });

  it('merges local and cloud summaries conservatively', () => {
    const merged = mergeInduckUpProgress(
      { version: 1, runsRecorded: 3, clears: 2, losses: 1, bestWave: 2, bestLevel: 2,
        maxEvolutions: 1, lastEvolutionKind: 'elastic', updatedAt: '2026-09-25T00:00:00.000Z' },
      { version: 1, runsRecorded: 2, clears: 1, losses: 1, bestWave: 2, bestLevel: 3,
        maxEvolutions: 2, lastEvolutionKind: 'clone', updatedAt: '2026-09-25T01:00:00.000Z' },
    );
    expect(merged).toMatchObject({
      runsRecorded: 3, clears: 2, losses: 1, bestWave: 2, bestLevel: 3,
      maxEvolutions: 2, lastEvolutionKind: 'clone',
    });
  });

  it('normalizes malformed values safely', () => {
    expect(normalizeInduckUpProgress({ runsRecorded: -9, bestWave: 99, bestLevel: 0, maxEvolutions: 12 }))
      .toMatchObject({ runsRecorded: 0, bestWave: 2, bestLevel: 1, maxEvolutions: 2 });
  });
});
