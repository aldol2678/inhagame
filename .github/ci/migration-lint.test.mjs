import test from 'node:test';
import assert from 'node:assert/strict';
import { lint, BASELINE_NAME } from './migration-lint.mjs';

const f = (name, sql = 'select 1;') => ({ name, sql });
const baseline = f(BASELINE_NAME);
const ok = [baseline, f('20261002090000_fix_a.sql'), f('20261002120000_fix_b.sql')];

test('accepts the baseline plus ordered forward migrations', () => {
  assert.deepEqual(lint(ok), []);
  assert.deepEqual(lint(ok, ok.slice(0, 2)), []);
});
test('rejects malformed names and duplicate versions', () => {
  assert.match(lint([...ok, f('bad name.sql')]).join('\n'), /expected <14-digit version>/);
  assert.match(lint([...ok, f('20261002090000_other.sql')]).join('\n'), /duplicate version 20261002090000/);
});
test('requires the baseline first and a version floor', () => {
  assert.match(lint([f('20261002090000_fix_a.sql')]).join('\n'), /first migration must be/);
  assert.match(lint([baseline, f('20260101000000_old.sql')]).join('\n'), /first migration must be|greater than the baseline/);
  assert.match(lint([baseline, f('20261001213131_before.sql')]).join('\n'), /greater than the baseline|first migration must be/);
});
test('rejects ops objects', () => {
  assert.match(lint([...ok, f('20261003000000_x.sql', 'create table private.mixpanel_outbox();')]).join('\n'), /Production-only object/);
  assert.match(lint([...ok, f('20261003000000_y.sql', 'select get_inha_duck_observer_runtime_v1(1);')]).join('\n'), /Production-only object/);
});
test('retained game function is not an ops object', () => {
  assert.deepEqual(lint([...ok, f('20261003000000_z.sql', 'select public.get_inha_duck_stage3_sample_gate_v1();')]), []);
  assert.match(lint([...ok, f('20261003000000_w.sql', 'create function notify_inha_duck_stage3_sample_gate_v2();')]).join('\n'), /Production-only object/);
});
test('append-only against base', () => {
  assert.match(lint([baseline, f('20261002090000_fix_a.sql', 'select 2;')], ok.slice(0, 2)).join('\n'), /edited/);
  assert.match(lint([baseline], ok.slice(0, 2)).join('\n'), /removed or renamed/);
  assert.match(lint([...ok, f('20261002100000_late.sql')], ok).join('\n'), /older than the newest/);
});
