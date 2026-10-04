import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  CREATURE_FORM_REGISTRY,
  CREATURE_SPECIES_REGISTRY,
  creatureFormAuthorityRow,
  creatureSpeciesAuthorityRow
} from '../../../apps/world/src/creature/creature-core-contract.js';
import {
  duckCompanionRuleAuthorityRow
} from '../../../apps/world/src/creature/duck-companion.js';

const DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);

function query(sql) {
  const args = ['-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  try {
    return execFileSync('psql', [DB_URL, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const fallback = process.env.PSQL_FALLBACK_CONTAINER;
    if (error.code !== 'ENOENT' || !fallback) throw error;
    return execFileSync('docker', [
      'exec', fallback, 'psql', '-U', 'postgres', '-d', 'postgres', ...args
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  }
}

test('Duck Companion P1 activates duck species and duck.base DB mirrors', () => {
  const species = JSON.parse(query(
    "select row_to_json(x) from (select species_id,status,definition_version from private.world_creature_species_catalog where species_id='creature.species.duck') x"
  ));
  const form = JSON.parse(query(
    "select row_to_json(x) from (select form_id,species_id,status,definition_version from private.world_creature_form_catalog where form_id='creature.form.duck.base') x"
  ));
  assert.deepEqual(species, creatureSpeciesAuthorityRow(CREATURE_SPECIES_REGISTRY.get('creature.species.duck')));
  assert.deepEqual(form, creatureFormAuthorityRow(CREATURE_FORM_REGISTRY.get('creature.form.duck.base')));
});

test('Duck Companion P1 acquisition rule DB mirror equals code authority', () => {
  const db = JSON.parse(query(
    "select row_to_json(x) from (select rule_id,species_id,form_id,source_ref,required_observation_count,auto_activate_if_party_empty,status,definition_version from private.world_creature_acquisition_rule_catalog where rule_id='creature.acquisition.duck.inkyung_bond') x"
  ));
  assert.deepEqual(db, duckCompanionRuleAuthorityRow());
});

test('Duck Companion P1 exposes four ordinary Inkyung subjects and excludes mechanical duck', () => {
  const subjects = JSON.parse(query(
    "select coalesce(json_agg(duck_id order by duck_id),'[]') from private.world_inkyung_duck_observation_subjects where status='ACTIVE'"
  ));
  assert.deepEqual(subjects, [
    'inkyung_duck_mallard_01',
    'inkyung_duck_white_01',
    'inkyung_duck_white_02',
    'inkyung_duck_white_03'
  ]);
  assert.equal(subjects.includes('inkyung_duck_mechanical_01'), false);
});

test('Duck Companion P1 RPC surface keeps observation server-only and bond self-scoped', () => {
  const installed = query(
    "select concat_ws(',', to_regprocedure('public.world_inkyung_duck_observe_v1(uuid,text,text,text)') is not null, to_regprocedure('public.get_my_duck_companion_v1()') is not null, to_regprocedure('public.bond_my_duck_companion_v1(text)') is not null)"
  );
  assert.equal(installed, 't,t,t');

  const privileges = query(
    "select concat_ws(',', has_function_privilege('authenticated','public.world_inkyung_duck_observe_v1(uuid,text,text,text)','execute'), has_function_privilege('authenticated','public.get_my_duck_companion_v1()','execute'), has_function_privilege('authenticated','public.bond_my_duck_companion_v1(text)','execute'))"
  );
  assert.equal(privileges, 'f,t,t');
});

test('Duck Companion P1 creates no owned Creature before a successful bond', () => {
  assert.equal(query("select count(*) from private.world_creature_acquisition_claims"), '0');
});