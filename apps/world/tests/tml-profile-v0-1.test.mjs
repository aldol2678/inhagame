import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const profile = JSON.parse(
  readFileSync(new URL('../tml/profiles/inha-world-v0.1.profile.json', import.meta.url), 'utf8')
);
const fixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

function expressionPredicates(expr, into = new Set()) {
  if (!expr) return into;
  if (typeof expr.predicate === 'string') into.add(expr.predicate);
  if (Array.isArray(expr.args)) expr.args.forEach((arg) => expressionPredicates(arg, into));
  if (expr.arg) expressionPredicates(expr.arg, into);
  return into;
}

function valueMatchesParameter(value, parameter) {
  if (!value || !parameter) return false;
  if (parameter.type === 'ref') return value.type === 'ref';
  if (parameter.type === 'list') {
    return value.type === 'list' && value.value.every((item) => valueMatchesParameter(item, parameter.items));
  }
  if (parameter.type === 'object') return value.type === 'object';
  return value.type === parameter.type;
}

test('INHA WORLD TML profile identity matches the Main 2 fixture', () => {
  assert.equal(profile.schema, 'tml.profile');
  assert.equal(profile.version, '0.1');
  assert.equal(profile.id, 'inha.world@0.1');
  assert.equal(fixture.profile, profile.id);
});

test('Main 2 fixture uses only vocabulary declared by inha.world@0.1', () => {
  const predicates = new Set(profile.predicates);
  const events = new Set(profile.events);
  const capabilities = new Map(profile.capabilities.map((capability) => [capability.id, capability]));

  for (const transition of fixture.transitions) {
    const usedPredicates = new Set([
      ...expressionPredicates(transition.precondition),
      ...expressionPredicates(transition.postcondition),
    ]);

    for (const predicate of usedPredicates) {
      assert.ok(predicates.has(predicate), `undeclared predicate: ${predicate}`);
    }

    assert.ok(events.has(transition.trigger.event), `undeclared event: ${transition.trigger.event}`);

    for (const action of transition.actions) {
      const capability = capabilities.get(action.capability);
      assert.ok(capability, `undeclared capability: ${action.capability}`);

      assert.deepEqual(
        Object.keys(action.args).sort(),
        Object.keys(capability.parameters).sort(),
        `argument set mismatch for ${action.capability}`
      );

      for (const [name, parameter] of Object.entries(capability.parameters)) {
        assert.ok(
          valueMatchesParameter(action.args[name], parameter),
          `argument type mismatch for ${action.capability}.${name}`
        );
      }
    }
  }
});

test('every mutating fixture capability has authoritative postcondition readback', () => {
  const capabilities = new Map(profile.capabilities.map((capability) => [capability.id, capability]));
  const authority = new Map(profile.authority.map((rule) => [rule.predicate, rule]));

  for (const transition of fixture.transitions) {
    const postconditionPredicates = expressionPredicates(transition.postcondition);

    for (const action of transition.actions) {
      const capability = capabilities.get(action.capability);
      if (!capability?.mutates) continue;

      assert.ok(capability.verification, `mutating capability lacks verification: ${action.capability}`);
      assert.ok(
        postconditionPredicates.has(capability.verification.predicate),
        `postcondition does not verify ${capability.verification.predicate}`
      );

      const rule = authority.get(capability.verification.predicate);
      assert.ok(rule, `missing authority rule for ${capability.verification.predicate}`);
      assert.equal(
        rule.authority,
        capability.verification.authority,
        `authority mismatch for ${capability.verification.predicate}`
      );
    }
  }
});

test('quest authority is server-first and client fallback is non-authoritative', () => {
  const authority = new Map(profile.authority.map((rule) => [rule.predicate, rule]));

  assert.equal(authority.get('quest.stage')?.authority, 'server.quest');
  assert.deepEqual(authority.get('quest.stage')?.fallback, ['world.client']);
  assert.equal(authority.get('quest.available')?.authority, 'server.quest');
  assert.deepEqual(authority.get('quest.available')?.fallback, ['world.client']);
});
