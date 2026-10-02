import type { RunPhase } from './types';

const allowed: Record<RunPhase, RunPhase[]> = {
  READY: ['RUNNING'],
  RUNNING: ['PAUSED', 'CHOOSING', 'UPGRADING', 'CLEAR', 'LOST'],
  PAUSED: ['RUNNING'],
  CHOOSING: ['RUNNING'],
  UPGRADING: ['RUNNING'],
  CLEAR: ['READY'],
  LOST: ['READY'],
};

export function createRunState(initial: RunPhase = 'READY') {
  let phase = initial;

  return {
    get phase(): RunPhase {
      return phase;
    },
    transition(next: RunPhase): RunPhase {
      if (!allowed[phase].includes(next)) {
        throw new Error(`Invalid run transition: ${phase} -> ${next}`);
      }
      phase = next;
      return phase;
    },
  };
}
