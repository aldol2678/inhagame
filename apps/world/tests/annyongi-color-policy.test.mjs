import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAnnyongiColorSamples } from './browser/annyongi-color-policy.mjs';
const check = samples => assertAnnyongiColorSamples(samples, assert);
test('independent palette policy accepts readable blue skin and dark eyes in day and night', () => {
  for (const sample of [
    {body:[[178,211,233],[175,208,229]],eyes:[[34,26,22],[31,24,21]]},
    {body:[[82,102,124],[79,100,119]],eyes:[[20,17,15],[18,15,13]]}
  ]) assert.doesNotThrow(() => check(sample));
});
for (const [name, sample] of [
  ['both variants identically white', {body:[[220,220,220],[210,210,210]],eyes:[[190,190,190],[185,185,185]]}],
  ['whitewashed body even with dark eyes', {body:[[200,201,201],[198,199,200]],eyes:[[20,18,16],[21,18,16]]}],
  ['blue body but washed-out eyes', {body:[[170,205,235],[169,204,233]],eyes:[[180,180,180],[170,170,170]]}],
  ['one washed-out eye', {body:[[170,205,235],[169,204,233]],eyes:[[20,18,16],[170,170,170]]}],
  ['unreadably dark skin', {body:[[0,5,8],[0,6,9]],eyes:[[0,0,0],[0,0,0]]}],
  ['missing eye', {body:[[170,205,235],[169,204,233]],eyes:[[20,18,16]]}],
  ['invalid sample', {body:[[NaN,205,235],[169,204,233]],eyes:[[20,18,16],[21,18,16]]}]
]) test(`independent palette policy rejects ${name}`, () => assert.throws(() => check(sample)));
