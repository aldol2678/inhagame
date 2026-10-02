import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcSocialNg1Model } from './npc-social-ng1.mjs';
import { runtimePresence } from './npc-presence.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('./npc-social-ng1.mjs', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('./dev-runtime.mjs', import.meta.url), 'utf8');

assert.doesNotMatch(source, /\bfetch\s*\(/, 'NG1 preview model must not perform network writes/reads');
assert.doesNotMatch(source, /localStorage|sessionStorage|supabase/i, 'NG1 preview state stays in memory only');
assert.match(mainSource, /const npcSocialPreviewLevel = previewHost \? startupParams\.get\('npcSocial'\) : null;/,
  'NG1 preview reads the explicit npcSocial query only on preview hosts');
assert.match(mainSource, /const npcSocialPreviewMode = npcSocialPreviewLevel === 'ng1' \|\| npcSocialBehaviorPreviewMode;/,
  'NG1 keeps explicit ng1 preview while ng15 inherits the observer');
assert.match(mainSource, /const npcSocialProductionMode = npcProductionMode;/,
  'NG1 is enabled on the official production host');
assert.match(mainSource, /const npcObservedConversationPreview = previewHost && startupParams\.get\('npcConversation'\) === 'p0';/,
  'observational conversations remain restricted to explicit Preview opt-in');
assert.match(mainSource, /const npcSocialMode = npcSocialProductionMode \|\| npcSocialPreviewMode \|\| npcObservedConversationPreview;/,
  'NG1 production and preview activation share one runtime switch');
assert.match(mainSource, /const npcSocialBehaviorPreviewMode = npcSocialPreviewLevel === 'ng15';/,
  'NG1.5 behavior is an explicit preview-only level');
assert.doesNotMatch(mainSource, /npcSocialBehaviorProductionMode/,
  'NG1.5 behavior must not have a production activation switch yet');
assert.match(mainSource, /socialEnabled: npcSocialMode,[\s\S]*socialPreview: npcSocialPreviewMode,[\s\S]*socialBehaviorPreview: npcSocialBehaviorPreviewMode,/,
  'runtime separates NG1 production, observer preview and NG1.5 behavior preview controls');
assert.match(runtimeSource, /socialEnabled = false, socialPreview = false/,
  'NG1 runtime has separate production and preview flags');
assert.match(runtimeSource, /if \(socialEnabled\) \{[\s\S]*createNpcSocialNg1Model/,
  'NG1 model mounts when the production runtime is enabled');
assert.match(runtimeSource, /if \(socialPreview\) socialNg1Panel = mountNpcSocialNg1Panel/,
  'NG1 observer panel mounts only in preview, never in production');
assert.match(runtimeSource, /if \(socialPreview\) \{[\s\S]*const socialPreviewApi/,
  'NG1 observer controls stay preview-only');
assert.match(runtimeSource, /if \(!socialBehaviorPreview && !worldClock\) socialPreviewApi\.advanceTicks/,
  'NG1-only preview may fast-forward the isolated social model');
assert.match(runtimeSource, /if \(socialBehaviorPreview\) window\.__NPC_SOCIAL_NG15__[\s\S]*advanceSeconds:[\s\S]*update\(dt\)/,
  'NG1.5 preview advances the shared NPC runtime clock instead of NG1 alone');
assert.match(runtimeSource, /advanceSeconds:[\s\S]*render = true, includeSocial = true[\s\S]*if \(render\) socialNg1Panel\?\.render\(\)/,
  'NG1.5 preview can suppress observer rendering during deterministic batch stepping');
assert.match(runtimeSource, /social_ng1: socialNg1\?\.status\(\) \?\? null/,
  'runtime debug status exposes read-only NG1 state');
assert.match(runtimeSource, /NPC 모임 관찰|mountNpcSocialNg1Panel/,
  'runtime mounts the observable NG1 group UI');

const model = createNpcSocialNg1Model(batch, {
  seed: 'ng1-runtime-regression',
  secondsPerSocialTick: .25,
  observationProvider: ({ npc, period }) => {
    const slot = runtimePresence(npc, period).slot;
    return { location: slot.location, activity: slot.activity, socialMode: slot.social_mode };
  }
});

for (let i = 0; i < 240; i++) model.update(.25);
const state = model.status();
console.log('NPC social NG1 runtime-overlay summary', JSON.stringify({
  tick: state.tick,
  liveGroups: state.liveGroups,
  activeGroups: state.activeGroups,
  groups: state.groups.map(group => ({
    groupId: group.groupId,
    label: group.label,
    leaderNpcId: group.leaderNpcId,
    members: group.memberNpcIds.length
  }))
}));

assert.equal(state.tick, 240);
assert.equal(state.liveGroups, 3, 'NG1 runtime schedule input should expose three stable preview groups');
assert.equal(state.activeGroups, 3);
assert.ok(state.groups.every(group => group.memberNpcIds.length >= 3));

const memberId = state.groups[0].memberNpcIds[0];
const profile = model.setSelectedNpc(memberId);
assert.equal(profile.npcId, memberId);
assert.ok(profile.group, 'selected NPC profile must expose its live group');
assert.match(model.profileLine(memberId), /모임 · (리더|회원) · 활동 중/);

const outsider = batch.npcs.find(npc => !state.groups.some(group => group.memberNpcIds.includes(npc.npc_id)));
if (outsider) {
  model.setSelectedNpc(outsider.npc_id);
  assert.equal(model.profile(outsider.npc_id).group, null);
  assert.match(model.profileLine(outsider.npc_id), /소속된 NPC 모임이 없습니다/);
}

assert.throws(() => model.setSelectedNpc('UNKNOWN-NPC'), /Unknown NG1 NPC/);
assert.throws(() => model.update(-1), /non-negative/);

const fastForward = createNpcSocialNg1Model(batch, {
  seed: 'inkyung-ng1-preview',
  observationProvider: ({ npc, period }) => {
    const slot = runtimePresence(npc, period).slot;
    return { location: slot.location, activity: slot.activity, socialMode: slot.social_mode };
  }
});
const advanced = fastForward.advanceTicks(40);
assert.equal(advanced.tick, 40, 'preview fast-forward advances exact social ticks');
assert.ok(advanced.liveGroups >= 1, 'preview fast-forward exposes at least one group');
assert.throws(() => fastForward.advanceTicks(-1), /non-negative integer/);

console.log('NPC Social NG1: runtime read-only model, production activation and preview controls PASS');
