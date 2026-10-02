import { expect, it } from 'vitest';
import { clampTargetX } from '../../src/game/input/InputController';

it('clamps pointer target inside the logical board', () => {
  expect(clampTargetX(-200)).toBe(20);
  expect(clampTargetX(180)).toBe(180);
  expect(clampTargetX(900)).toBe(340);
});
