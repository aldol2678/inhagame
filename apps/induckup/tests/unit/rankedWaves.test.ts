import { describe, expect, it } from 'vitest';
import { rankedWavePlan } from '../../src/p4/RankedWaves';

describe('ranked practice waves', () => {
  it('alternates ordinary waves with an elite every fifth and a boss every tenth', () => {
    expect(rankedWavePlan(1).type).toBe('normal');
    expect(rankedWavePlan(3).type).toBe('mixed');
    expect(rankedWavePlan(5).enemies).toContain('elite-giant');
    expect(rankedWavePlan(10).enemies).toEqual(['guard', 'guard', 'boss']);
    expect(rankedWavePlan(15).type).toBe('elite');
    expect(rankedWavePlan(20).type).toBe('boss');
  });

  it('increases difficulty without unbounded scaling after wave 31', () => {
    expect(rankedWavePlan(31).multiplier).toBeGreaterThan(rankedWavePlan(1).multiplier);
    expect(rankedWavePlan(31).multiplier).toBe(rankedWavePlan(1000).multiplier);
    expect(rankedWavePlan(31).spawnIntervalMs).toBe(rankedWavePlan(1000).spawnIntervalMs);
    expect(rankedWavePlan(0).enemies.length).toBeGreaterThan(0);
  });
});
