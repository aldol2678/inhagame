import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MAIN2_QUEST_EVENTS,
  MAIN2_QUEST_ID,
  nextMain2QuestStage,
} from '../npc-factory/main2-quest-contract.mjs';

const schema = JSON.parse(
  readFileSync(new URL('../tml/schema/tml-ir-v0.1.schema.json', import.meta.url), 'utf8')
);
const fixture = JSON.parse(
  readFileSync(new URL('../tml/fixtures/campus-navigation-intro-v1.module.json', import.meta.url), 'utf8')
);

test('TML IR v0.1 schema keeps Module/Profile/Trace as the public contract roots', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.title, 'TML IR v0.1');
  assert.equal(schema.oneOf.length, 3);
  assert.equal(schema.$defs.module.properties.schema.const, 'tml.module');
  assert.equal(schema.$defs.profile.properties.schema.const, 'tml.profile');
  assert.equal(schema.$defs.trace.properties.schema.const, 'tml.trace');
  assert.equal(schema.$defs.module.additionalProperties, false);
  assert.equal(schema.$defs.profile.additionalProperties, false);
  assert.equal(schema.$defs.trace.additionalProperties, false);
});

test('INHA WORLD Main 2 TML fixture matches the executable quest contract', () => {
  assert.equal(fixture.schema, 'tml.module');
  assert.equal(fixture.version, '0.1');
  assert.equal(fixture.profile, 'inha.world@0.1');
  assert.equal(fixture.extensions.source_contract.quest_id, MAIN2_QUEST_ID);
  assert.equal(fixture.extensions.source_contract.completion_stage, 9);
  assert.equal(fixture.extensions.source_contract.completion_event, 'visit_back_gate');
  assert.equal(fixture.extensions.source_contract.server_rpc, 'advance_world_navigation_quest_v1');
  assert.equal(fixture.transitions.length, 9);

  const expectedEvents = MAIN2_QUEST_EVENTS.filter((event) => event !== 'status');
  assert.deepEqual(
    fixture.transitions.map((transition) => transition.actions[0].args.event.value),
    expectedEvents
  );

  fixture.transitions.forEach((transition, index) => {
    const event = expectedEvents[index];
    const fromStage = index;
    const toStage = index + 1;
    const available = event === 'start';

    assert.equal(transition.subject, `quest.${MAIN2_QUEST_ID}`);
    assert.equal(transition.trigger.event, 'world.quest.event');
    assert.equal(transition.trigger.where.quest.value, `quest.${MAIN2_QUEST_ID}`);
    assert.equal(transition.trigger.where.name.value, event);
    assert.equal(transition.actions[0].capability, 'world.quest.advance');
    assert.equal(transition.actions[0].args.quest.value, `quest.${MAIN2_QUEST_ID}`);
    assert.equal(transition.postcondition.predicate, 'quest.stage');
    assert.equal(transition.postcondition.value.value, toStage);

    assert.equal(
      nextMain2QuestStage(fromStage, event, { available }),
      toStage,
      `${event} should advance stage ${fromStage} -> ${toStage}`
    );
  });
});
