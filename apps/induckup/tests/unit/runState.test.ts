import { describe, expect, it } from 'vitest';
import { createRunState } from '../../src/game/core/runState';

describe('run state contract', () => {
  it('supports ready -> running -> lost -> ready', () => {
    const run = createRunState();
    expect(run.transition('RUNNING')).toBe('RUNNING');
    expect(run.transition('LOST')).toBe('LOST');
    expect(run.transition('READY')).toBe('READY');
  });

  it('rejects clear before running', () => {
    const run = createRunState();
    expect(() => run.transition('CLEAR')).toThrow(/Invalid run transition/);
  });

  it('pauses and resumes only an active run', () => {
    const run = createRunState();
    expect(() => run.transition('PAUSED')).toThrow(/Invalid run transition/);
    run.transition('RUNNING');
    expect(run.transition('PAUSED')).toBe('PAUSED');
    expect(() => run.transition('LOST')).toThrow(/Invalid run transition/);
    expect(run.transition('RUNNING')).toBe('RUNNING');
    expect(run.transition('LOST')).toBe('LOST');
  });
});
