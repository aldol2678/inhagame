import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  CREATURE_ACTIVITY_BRIDGE_REGISTRY,
  CREATURE_EVOLUTION_RULE_REGISTRY,
  CREATURE_FORM_REGISTRY,
  CREATURE_SPECIES_REGISTRY,
  creatureEvolutionRuleAuthorityRow,
  creatureFormAuthorityRow,
  creatureSpeciesAuthorityRow
} from '../../../apps/world/src/creature/creature-core-contract.js';

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

test('Creature species DB mirror equals code Registry', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('species_id',species_id,'status',status,'definition_version',definition_version) order by species_id), '[]') from private.world_creature_species_catalog"
  ));
  const code = CREATURE_SPECIES_REGISTRY.list().map(creatureSpeciesAuthorityRow)
    .sort((a,b) => a.species_id.localeCompare(b.species_id));
  assert.deepEqual(db, code);
});

test('Creature P0 keeps forms and evolution empty while forward bridge extensions remain allowed', () => {
  const forms = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('form_id',form_id,'species_id',species_id,'status',status,'definition_version',definition_version) order by form_id), '[]') from private.world_creature_form_catalog"
  ));
  const rules = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('rule_id',rule_id,'species_id',species_id,'from_form_id',from_form_id,'to_form_id',to_form_id,'required_memory_tag',required_memory_tag,'required_memory_count',required_memory_count,'context_ref',context_ref,'status',status,'definition_version',definition_version) order by rule_id), '[]') from private.world_creature_evolution_rule_catalog"
  ));
  assert.deepEqual(forms, CREATURE_FORM_REGISTRY.list().map(creatureFormAuthorityRow));
  assert.equal(CREATURE_ACTIVITY_BRIDGE_REGISTRY.size, 0);
  assert.deepEqual(rules, CREATURE_EVOLUTION_RULE_REGISTRY.list().map(creatureEvolutionRuleAuthorityRow));
});

test('Creature Core P0 service authority functions are installed', () => {
  const installed = query(
    "select concat_ws(',', to_regprocedure('public.world_creature_observe_v1(uuid,text,text,text,text,text)') is not null, to_regprocedure('public.world_creature_grant_v1(uuid,text,text,text,text)') is not null, to_regprocedure('public.world_creature_party_set_v1(uuid,uuid,uuid,uuid,bigint,text)') is not null, to_regprocedure('public.world_creature_core_snapshot_v1(uuid)') is not null, to_regprocedure('public.world_creature_activity_accept_v1(uuid,text,text,text,text,bigint,timestamp with time zone)') is not null, to_regprocedure('public.world_creature_evolution_candidate_v1(uuid,uuid,text,text)') is not null, to_regprocedure('public.world_creature_evolution_context_gate_v1(uuid,uuid,text,text)') is not null, to_regprocedure('public.world_creature_evolution_commit_v1(uuid,uuid,text)') is not null)"
  );
  assert.equal(installed, 't,t,t,t,t,t,t,t');
});

test('Creature Core P0 creates no player-owned state before activation', () => {
  assert.equal(query("select count(*) from private.world_player_creatures"), '0');
  assert.equal(query("select count(*) from private.world_creature_party_state"), '0');
  assert.equal(query("select count(*) from private.world_creature_activity_events"), '0');
  assert.equal(query("select count(*) from private.world_creature_memory_tags"), '0');
  assert.equal(query("select count(*) from private.world_creature_evolution_events"), '0');
});