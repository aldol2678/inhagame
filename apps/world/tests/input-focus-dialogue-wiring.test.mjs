import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const main = read("../src/main.js");
const npcRuntime = read("../npc-factory/dev-runtime.mjs");
const main2Guide = read("../npc-factory/main2-guide-runtime.mjs");
const mcmRuntime = read("../src/events/zombie-university-2026/event-runtime.js");

test("main owns NPC and MCM dialogue input with BLOCKING_UI claims", () => {
  for (const owner of ["npc-dialogue", "mcm-dialogue"]) {
    assert.match(main, new RegExp(`ownerId: "${owner}".*policy: INPUT_FOCUS_POLICY\\.BLOCKING_UI`, "s"));
  }
  assert.match(main, /onConversationOpen:\s*\(\)\s*=>\s*\{\s*npcDialogueInput\.acquire\(\)/s);
  assert.match(main, /onConversationClose:\s*\(\)\s*=>\s*\{ npcDialogueInput\.release\(\); \}/);
  assert.match(main, /onDialogueChange:\s*\(open\)\s*=>\s*\{[\s\S]*mcmDialogueInput\.acquire\(\)[\s\S]*mcmDialogueInput\.release\(\)/s);
});

test("NPC runtime emits one unified lifecycle across normal and Main 2 guide conversations", () => {
  assert.match(npcRuntime, /onConversationOpen = \(\) => \{\},\s*onConversationClose = \(\) => \{\}/s);
  assert.match(npcRuntime, /function syncConversationLifecycle\(\)[\s\S]*activeConversation[\s\S]*main2Guide\?\.isDialogueOpen/s);
  assert.match(npcRuntime, /if \(next\) \{ stopObservedConversation\(\); onConversationOpen\(\); \}\s*else onConversationClose\(\);/s);
  assert.match(npcRuntime, /onConversationOpen: syncConversationLifecycle,\s*onConversationClose: syncConversationLifecycle/s);
  assert.match(npcRuntime, /closeConversation\(false, \{ sync: false \}\)/);
  assert.match(npcRuntime, /activeConversation = \{ id: actor\.id,[^}]*memoryBefore: before,[^}]*newEncounter \};/s);
  assert.match(npcRuntime, /dialogueSession = createNpcDialogueSession\(\{ npcId: actor\.id \}\);\s*syncConversationLifecycle\(\);/s);
});

test("Main 2 guide changes state before notifying open and close lifecycle", () => {
  assert.match(main2Guide, /onConversationOpen = \(\) => \{\},\s*onConversationClose = \(\) => \{\}/s);
  const openBlock = main2Guide.match(/function openDialogue\(\)[\s\S]*?return true;\s*\}/)?.[0] ?? "";
  const closeBlock = main2Guide.match(/function closeDialogue\(\)[\s\S]*?return true;\s*\}/)?.[0] ?? "";
  assert.ok(openBlock.indexOf("dialogueOpen = true") < openBlock.indexOf("onConversationOpen()"));
  assert.ok(closeBlock.indexOf("dialogueOpen = false") < closeBlock.indexOf("onConversationClose()"));
});

test("MCM dialogue lifecycle notifies only real open/close transitions", () => {
  assert.match(mcmRuntime, /onDialogueChange=\(\)=>\{\}/);
  assert.match(mcmRuntime, /const closeDialogue=\(\)=>\{\s*if\(!activeId\)return false;[\s\S]*onDialogueChange\(false\)/s);
  assert.match(mcmRuntime, /const wasOpen=Boolean\(activeId\);[\s\S]*if\(!wasOpen\)onDialogueChange\(true\);/s);
  assert.match(mcmRuntime, /destroy\(\)\{closeDialogue\(\);/);
});
