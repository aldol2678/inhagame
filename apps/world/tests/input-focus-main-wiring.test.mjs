import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const inputRuntime = readFileSync(new URL("../src/input/world-input-runtime.js", import.meta.url), "utf8");
const orbit = readFileSync(new URL("../src/orbit-camera-controller.js", import.meta.url), "utf8");
const pointerLock = readFileSync(new URL("../src/input/pointer-lock-runtime.js", import.meta.url), "utf8");
const pointerLockHint = readFileSync(new URL("../src/input/pointer-lock-hint.js", import.meta.url), "utf8");
const cameraSettings = readFileSync(new URL("../src/input/camera-input-settings.js", import.meta.url), "utf8");

test("main creates one input focus manager and binds movement/camera adapters", () => {
  assert.match(inputRuntime, /createInputFocusManager\(\)/);
  assert.match(main, /bindInputFocusRuntime\(\{\s*manager:\s*inputFocus,\s*controller,\s*orbit\s*\}\)/s);
  assert.match(main, /inputFocus:\s*\{[\s\S]*\.\.\.inputFocus\.snapshot\(\)[\s\S]*owners:/s);
});

test("P1-A binds desktop Pointer Lock to the shared pointerLockDesired contract", () => {
  assert.match(main, /bindPointerLockRuntime\(\{[\s\S]*manager:\s*inputFocus,[\s\S]*canvas,[\s\S]*orbit,[\s\S]*onStatusChange:/s);
  assert.match(main, /pointerLock:\s*pointerLock\.status\(\)/);
  assert.match(pointerLock, /state\.pointerLockDesired === true/);
  assert.match(pointerLock, /pointerType !== "mouse" \|\| event\.button !== 0/);
  assert.match(pointerLock, /documentLike\.pointerLockElement === canvas/);
  assert.match(pointerLock, /orbit\.pointerLook\(Number\(event\.movementX/);
  assert.match(pointerLock, /matchMedia\?\.\("\(pointer: fine\)"\)/);
});

test("P1-C wires Pointer Lock guidance to runtime status changes", () => {
  assert.match(main, /bindPointerLockHint\(document\.getElementById\("pointer-lock-hint"\)\)/);
  assert.match(main, /bindPointerLockRuntime\(\{[\s\S]*onStatusChange:\s*status\s*=>\s*pointerLockHint\.update\(status\)/s);
  assert.match(main, /pointerLockHint:\s*pointerLockHint\.status\(\)/);
  assert.match(pointerLock, /onStatusChange = \(\) => \{\}/);
  assert.match(pointerLockHint, /state: "READY"/);
  assert.match(pointerLockHint, /state: "FALLBACK"/);
});

test("P1-B binds persistent desktop camera settings to OrbitCameraController", () => {
  assert.match(main, /bindCameraInputSettings\(\{[\s\S]*orbit,[\s\S]*mouse-sensitivity[\s\S]*invert-mouse-y[\s\S]*view-settings-status/s);
  assert.match(main, /cameraInput:\s*cameraInputSettings\.current/);
  assert.match(cameraSettings, /CAMERA_INPUT_STORAGE_KEY = "inha-world-camera-input-v1"/);
  assert.match(cameraSettings, /orbit\.setMouseLookSettings\(current\)/);
  assert.match(cameraSettings, /sensitivity:\s*Number\(sensitivitySelect\.value\)/);
});

test("F/M/E/V gameplay gates consume the shared input focus snapshot", () => {
  assert.match(main, /shouldIgnoreShortcut:\s*\(\)\s*=>\s*!inputFocus\.can\("GAMEPLAY_SHORTCUT"\)/s);
  assert.match(main, /const worldActionsSuspended = \(\) =>\s*!inputFocus\.can\("WORLD_ACTION"\)/s);
  assert.match(main, /if \(!inputFocus\.can\("WORLD_ACTION"\)\) return false;/);
  assert.match(main, /canUseGameplayShortcut:\s*\(\)\s*=>\s*inputFocus\.can\("GAMEPLAY_SHORTCUT"\)/s);
  assert.match(orbit, /if \(!this\.inputEnabled \|\| !this\.canUseGameplayShortcut\(\)\) return;/);
});

test("chat open state owns one CHAT claim and releases the same token", () => {
  assert.match(main, /let chatFocusClaim = null;/);
  assert.match(main, /inputFocus\.claim\("chat", INPUT_FOCUS_POLICY\.CHAT\)/);
  assert.match(main, /inputFocus\.release\(chatFocusClaim\)/);
  assert.match(main, /shouldIgnoreShortcut:\s*\(\)\s*=>\s*!inputFocus\.can\("WORLD_ACTION"\),/);
  assert.doesNotMatch(main, /shouldIgnoreShortcut:[^\n]*fullMap|shouldIgnoreShortcut:[\s\S]{0,180}keyboardHelp/);
});

test("HUD menu, keyboard help and Full Map use reusable BLOCKING_UI owners", () => {
  for (const owner of ["hud-menu", "keyboard-help", "full-map"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.BLOCKING_UI`));
  }
  assert.match(main, /onOpen:\s*\(\)\s*=>\s*\{\s*hudMenuInput\.acquire\(\)/s);
  assert.match(main, /onClose:\s*\(\)\s*=>\s*\{ hudMenuInput\.release\(\); \}/);
  assert.match(main, /onOpen:\s*\(\)\s*=>\s*\{\s*keyboardHelpInput\.acquire\(\)/s);
  assert.match(main, /onClose:\s*\(\)\s*=>\s*\{ keyboardHelpInput\.release\(\); \}/);
  assert.match(main, /onOpen:\s*\(\)\s*=>\s*\{\s*fullMapInput\.acquire\(\)/s);
  assert.match(main, /onClose:\s*\(\)\s*=>\s*\{ fullMapInput\.release\(\); \}/);
  assert.doesNotMatch(
    main,
    /fullMap = createFullMapController\([\s\S]*?controller\.setInputEnabled\(false\); orbit\.setInputEnabled\(false\)[\s\S]*?documentLike:/s,
    "Full Map no longer owns movement/camera through direct toggles"
  );
});

test("Shop, Inventory and Wardrobe use BLOCKING_UI owners before closing sibling panels", () => {
  for (const owner of ["shop", "inventory", "wardrobe"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.BLOCKING_UI`));
  }

  const inventory = main.match(/const inventoryPanel = createInventoryPanel\(\{[\s\S]*?inventoryButton\?\.addEventListener/)?.[0] ?? "";
  const shop = main.match(/const shopPanel = createShopPanel\(\{[\s\S]*?shopButton\?\.addEventListener/)?.[0] ?? "";
  const wardrobe = main.match(/const wardrobePanel = createWardrobePanel\(\{[\s\S]*?wardrobeButton\?\.addEventListener/)?.[0] ?? "";

  assert.ok(inventory.indexOf("inventoryInput.acquire()") < inventory.indexOf("shopPanel.setOpen(false)"));
  assert.ok(shop.indexOf("shopInput.acquire()") < shop.indexOf("inventoryPanel.setOpen(false)"));
  assert.ok(wardrobe.indexOf("wardrobeInput.acquire()") < wardrobe.indexOf("shopPanel.setOpen(false)"));

  assert.match(inventory, /inventoryInput\.release\(\)/);
  assert.match(shop, /shopInput\.release\(\)/);
  assert.match(wardrobe, /wardrobeInput\.release\(\)/);

  for (const block of [inventory, shop, wardrobe]) {
    assert.doesNotMatch(block, /controller\.setInputEnabled\(/);
    assert.doesNotMatch(block, /orbit\.setInputEnabled\(/);
  }
});

test("Lobby and lobby transition use SYSTEM_LOCK owners", () => {
  for (const owner of ["lobby-world", "lobby-transition"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.SYSTEM_LOCK`));
  }
  assert.match(main, /createLobbyWorldMode\(\{[\s\S]*onActiveChange:\s*\(active\)\s*=>\s*\{[\s\S]*lobbyWorldInput\.acquire\(\)[\s\S]*lobbyWorldInput\.release\(\)/s);
  assert.match(main, /createLobbyTransition\(\{[\s\S]*onActiveChange:\s*\(active\)\s*=>\s*\{[\s\S]*lobbyTransitionInput\.acquire\(\)[\s\S]*lobbyTransitionInput\.release\(\)/s);
  assert.match(main, /lobbyWorld:\s*lobbyWorldInput\.active/);
  assert.match(main, /lobbyTransition:\s*lobbyTransitionInput\.active/);
});

test("Profile and View Settings use BLOCKING_UI owners", () => {
  for (const owner of ["profile", "view-settings"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.BLOCKING_UI`));
  }
  assert.match(main, /createCampusProfile\(player, camera, canvas, \{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*profileInput\.acquire\(\)[\s\S]*profileInput\.release\(\)/s);
  assert.match(main, /createViewDistanceSettings\(streaming,camera,graphics,\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*viewSettingsInput\.acquire\(\)[\s\S]*viewSettingsInput\.release\(\)/s);
  assert.match(main, /profile:\s*profileInput\.active/);
  assert.match(main, /viewSettings:\s*viewSettingsInput\.active/);
});

test("Social and Guestbook surfaces use BLOCKING_UI owners with safe handoffs", () => {
  for (const owner of ["friend-panel", "nearby-panel", "player-card", "guestbook"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.BLOCKING_UI`));
  }
  assert.match(main, /createPlayerCard\(\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*playerCardInput\.acquire\(\)[\s\S]*playerCardInput\.release\(\)/s);
  assert.match(main, /createNearbyPanel\(\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*nearbyPanelInput\.acquire\(\)[\s\S]*nearbyPanelInput\.release\(\)/s);
  assert.match(main, /createFriendPanel\(\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*friendPanelInput\.acquire\(\)[\s\S]*friendPanelInput\.release\(\)/s);
  assert.match(main, /createGuestbookPanel\(\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*guestbookInput\.acquire\(\)[\s\S]*guestbookInput\.release\(\)/s);
  assert.match(main, /const opening = playerCard\.openUser\([\s\S]*await guestbookPanel\.setOpen\(false\)/s,
    "guestbook → player card acquires destination before releasing guestbook");
  assert.match(main, /document\.getElementById\("open-profile"\)\?\.click\(\);\s*await guestbookPanel\.setOpen\(false\)/s,
    "guestbook → own profile acquires profile before releasing guestbook");
  assert.match(main, /const opening = guestbookPanel\.setOpen\(true\);[\s\S]*playerCard\.close\(\);[\s\S]*return opening;/s,
    "world guestbook entry acquires guestbook before closing player card");
  assert.doesNotMatch(main, /onOpen:\s*\(\)\s*=>\s*\{ controller\.keys\.clear\(\); playerCard\.close\(\)/);
});

test("Room transition and Back Gate arrival use SYSTEM_LOCK owners", () => {
  for (const owner of ["room-transition", "back-gate-arrival"]) {
    assert.match(inputRuntime, new RegExp(`"${owner}", INPUT_FOCUS_POLICY\\.SYSTEM_LOCK`));
  }
  assert.match(main, /createRoomTransition\(\{[\s\S]*onBusyChange:\s*\(busy\)[\s\S]*roomTransitionInput\.acquire\(\)[\s\S]*roomTransitionInput\.release\(\)/s);
  assert.match(main, /createBackGateArrivalEvent\(\{[\s\S]*onInputLockChange:\s*\(locked\)[\s\S]*backGateArrivalInput\.acquire\(\)[\s\S]*backGateArrivalInput\.release\(\)/s);
  assert.match(main, /roomTransition:\s*roomTransitionInput\.active/);
  assert.match(main, /backGateArrival:\s*backGateArrivalInput\.active/);
});

test("MCM info modal is the last BLOCKING_UI owner and legacy world-action list is gone", () => {
  assert.match(inputRuntime, /"mcm-event-info", INPUT_FOCUS_POLICY\.BLOCKING_UI/);
  assert.match(main, /createMcm2026EventUi\(\{[\s\S]*onOpenChange:\s*\(open\)[\s\S]*mcmEventInfoInput\.acquire\(\)[\s\S]*mcmEventInfoInput\.release\(\)/s);
  assert.match(main, /const worldActionsSuspended = \(\) => !inputFocus\.can\("WORLD_ACTION"\);/);
  const worldGate = main.match(/const worldActionsSuspended = \(\) =>[^;]+;/)?.[0] ?? "";
  assert.equal(worldGate, 'const worldActionsSuspended = () => !inputFocus.can("WORLD_ACTION");');
  assert.doesNotMatch(worldGate, /mcmEventUi|hudMenu|Panel|openState/);
  assert.match(main, /mcmEventInfo:\s*mcmEventInfoInput\.active/);
});

test("dialogue F-close behavior remains ahead of the new world-action gate", () => {
  const mcmClose = main.indexOf("mcmEventRuntime.isDialogueOpen() === true");
  const npcClose = main.indexOf("npcTest?.isConversationOpen?.() === true", mcmClose);
  const focusGate = main.indexOf('if (!inputFocus.can("WORLD_ACTION")) return false;', npcClose);

  assert.ok(mcmClose >= 0);
  assert.ok(npcClose > mcmClose);
  assert.ok(focusGate > npcClose);
});
