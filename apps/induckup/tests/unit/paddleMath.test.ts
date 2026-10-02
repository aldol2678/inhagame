import { expect, it } from 'vitest';
import { computeFlexPx } from '../../src/game/paddle/paddleMath';

it('reports zero for a straight paddle and positive flex for an arc', () => {
  expect(computeFlexPx([{x:0,y:0},{x:10,y:0},{x:20,y:0}])).toBeCloseTo(0);
  expect(computeFlexPx([{x:0,y:0},{x:10,y:8},{x:20,y:0}])).toBeCloseTo(8);
});
