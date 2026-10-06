import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const previewHostDeclaration = main.match(/^const previewHost = .*;$/m)?.[0];
const modes = main.slice(main.indexOf('const npcTestMode ='), main.indexOf('const campusLifePreview ='));
assert.ok(previewHostDeclaration && modes.startsWith('const npcTestMode ='), 'exercise the actual boot declarations');

function startup(url) {
  const location = new URL(url);
  return runInNewContext(`
    const startupParams = new URLSearchParams(location.search);
    ${previewHostDeclaration}
    ${modes}
    ({ enabled: npcEnabled, production: npcProductionMode, shared: npcSharedScheduleMode,
       social: npcSocialProductionMode, test: npcTestMode, aiPilot: npcAiPilotMode,
       authorityPreview: npcSharedAuthorityPreviewMode });
  `, { location, URLSearchParams });
}

test('ordinary custom-domain entry starts NPCs with shared schedules without query flags', () => {
  for (const host of ['campus.example.org', 'www.campus.example.org', 'alternate.example.net']) {
    const mode = startup(`https://${host}/campus/`);
    assert.equal(mode.enabled, true, host);
    assert.equal(mode.production, true, host);
    assert.equal(mode.shared, true, host);
    assert.equal(mode.social, true, host);
    assert.equal(mode.aiPilot, false, host);
  }
});

test('custom-domain entry cannot be switched into a local AI pilot by preview parameters', () => {
  const mode = startup('https://campus.example.org/campus/?npcTest=a-r1&npcAiPilot=1&npcSocial=ng15');
  assert.equal(mode.enabled, true);
  assert.equal(mode.shared, true);
  assert.equal(mode.test, false);
  assert.equal(mode.aiPilot, false);
});

test('ordinary local and Vercel preview entry keeps NPCs opt-in', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://campus-preview.vercel.app']) {
    const mode = startup(`${origin}/campus/`);
    assert.equal(mode.enabled, false, origin);
    assert.equal(mode.production, false, origin);
    assert.equal(mode.shared, false, origin);
    assert.equal(mode.social, false, origin);
  }
});

test('existing preview selectors still start NPCs without enabling production defaults', () => {
  for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://campus-preview.vercel.app']) {
    for (const query of ['npcTest=a-r1', 'campusLife=roster', 'npcSocial=ng1', 'npcSocial=ng15', 'npcConversation=p0']) {
      const mode = startup(`${origin}/campus/?${query}`);
      assert.equal(mode.enabled, true, `${origin} ${query}`);
      assert.equal(mode.production, false);
      assert.equal(mode.shared, false);
    }
  }
});

test('shared schedule preview keeps using the explicit server-synchronized mode', () => {
  for (const origin of ['http://localhost:3000', 'https://campus-preview.vercel.app']) {
    const mode = startup(`${origin}/campus/?npcSync=ng2`);
    assert.equal(mode.enabled, true);
    assert.equal(mode.shared, true);
    assert.equal(mode.production, false);
  }
});

test('AI pilot remains local-only', () => {
  assert.equal(startup('http://localhost:3000/campus/?npcTest=a-r1&npcAiPilot=1').aiPilot, true);
  assert.equal(startup('https://campus-preview.vercel.app/campus/?npcTest=a-r1&npcAiPilot=1').aiPilot, false);
});

test('shared NPC authority preview stays local and explicit', () => {
  assert.equal(startup('http://localhost:3000/campus/?npcTest=a-r1&npcAuthority=p0').authorityPreview, true);
  assert.equal(startup('http://localhost:3000/campus/?npcAuthority=p0').authorityPreview, false);
  assert.equal(startup('https://campus-preview.vercel.app/campus/?npcTest=a-r1&npcAuthority=p0').authorityPreview, false);
  assert.equal(startup('https://campus.example.org/campus/?npcTest=a-r1&npcAuthority=p0').authorityPreview, false);
});
