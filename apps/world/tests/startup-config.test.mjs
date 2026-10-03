import test from "node:test";
import assert from "node:assert/strict";
import { resolveWorldStartupConfig } from "../src/startup/startup-config.js";

const loc = (search = "", { hostname = "localhost", hash = "" } = {}) => ({ search, hostname, hash });

test("production enables normal NPC runtime without preview selectors", () => {
  const config = resolveWorldStartupConfig(loc("", { hostname: "inhagame.app" }));
  assert.equal(config.previewHost, false);
  assert.equal(config.npcProductionMode, true);
  assert.equal(config.npcSharedScheduleMode, true);
  assert.equal(config.npcEnabled, true);
  assert.equal(config.lobbyPreview, false);
});

test("preview start modes remain mutually compatible with lobby selection", () => {
  assert.equal(resolveWorldStartupConfig(loc("?start=club-room&lobby=1")).roomPreviewStart, true);
  assert.equal(resolveWorldStartupConfig(loc("?start=club-room&lobby=1")).lobbyPreview, false);
  assert.equal(resolveWorldStartupConfig(loc("?start=dorm-lobby&lobby=1")).dormLobbyPreviewStart, true);
  assert.equal(resolveWorldStartupConfig(loc("?start=personal-room&lobby=1")).personalRoomPreviewStart, true);
});

test("local NPC pilot and social selectors preserve existing gates", () => {
  const config = resolveWorldStartupConfig(loc("?npcTest=a-r1&npcAiPilot=1&npcSocial=ng15&npcConversation=p0"));
  assert.equal(config.npcTestMode, true);
  assert.equal(config.npcAiPilotMode, true);
  assert.equal(config.npcSocialBehaviorPreviewMode, true);
  assert.equal(config.npcObservedConversationPreview, true);
  assert.equal(config.npcEnabled, true);
});

test("editor and campus-life preview flags stay explicit", () => {
  const config = resolveWorldStartupConfig(loc("?editorWorld=1&campusLife=p0a"));
  assert.equal(config.editorWorldRequested, true);
  assert.equal(config.campusLifePreview, true);
});
