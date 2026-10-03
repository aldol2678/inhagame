import { MAIN2_QUEST_ID } from '../../npc-factory/main2-quest-contract.mjs';

export const TML_MAIN2_SHADOW_MODE = 'SHADOW_P9';

export const TML_MAIN2_SHADOW_TRANSITIONS = Object.freeze([
  Object.freeze({ from: 0, to: 1, event: 'start', transitionId: 'transition.inha-world.campus_navigation_intro_v1.0_to_1' }),
  Object.freeze({ from: 1, to: 2, event: 'set_building5_destination', transitionId: 'transition.inha-world.campus_navigation_intro_v1.1_to_2' }),
  Object.freeze({ from: 2, to: 3, event: 'start_auto_building5', transitionId: 'transition.inha-world.campus_navigation_intro_v1.2_to_3' }),
  Object.freeze({ from: 3, to: 4, event: 'pause_auto_building5', transitionId: 'transition.inha-world.campus_navigation_intro_v1.3_to_4' }),
  Object.freeze({ from: 4, to: 5, event: 'resume_auto_building5', transitionId: 'transition.inha-world.campus_navigation_intro_v1.4_to_5' }),
  Object.freeze({ from: 5, to: 6, event: 'visit_building5', transitionId: 'transition.inha-world.campus_navigation_intro_v1.5_to_6' }),
  Object.freeze({ from: 6, to: 7, event: 'set_back_gate_destination', transitionId: 'transition.inha-world.campus_navigation_intro_v1.6_to_7' }),
  Object.freeze({ from: 7, to: 8, event: 'start_auto_back_gate', transitionId: 'transition.inha-world.campus_navigation_intro_v1.7_to_8' }),
  Object.freeze({ from: 8, to: 9, event: 'visit_back_gate', transitionId: 'transition.inha-world.campus_navigation_intro_v1.8_to_9' })
]);

export const TML_MAIN2_SHADOW_REWARD = Object.freeze({
  specId: 'reward-spec.inha-world.main2-navigation.v1',
  rewardId: 'reward.quest.navigation_intro',
  rewardVersion: 1,
  grants: Object.freeze([
    Object.freeze({ grantType: 'CURRENCY', targetId: 'currency.induck_coin', amount: 180 }),
    Object.freeze({ grantType: 'EXP', targetId: 'exp.campus', amount: 100 })
  ])
});

export function tmlMain2ShadowTransition(fromStage) {
  return TML_MAIN2_SHADOW_TRANSITIONS.find((item) => item.from === fromStage) ?? null;
}

export function isTmlMain2ShadowResult(result) {
  return Boolean(result) &&
    result.quest_id === MAIN2_QUEST_ID &&
    Number.isInteger(result.stage) &&
    result.stage >= 0 &&
    result.stage <= 9 &&
    typeof result.available === 'boolean';
}
