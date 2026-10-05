import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

test("main update holds all local gameplay consumers while only rendering the transitional camera", () => {
  const start = main.indexOf('app.on("update", (dt) => {');
  const end = main.indexOf('  if (rooms.currentSpace === "ROOM_PERSONAL_BASIC")', start);
  const prefix = main.slice(start + 'app.on("update", (dt) => {'.length, end);
  let busy = true;
  const calls = [];
  const frame = vm.runInNewContext(`dt => { ${prefix} calls.push("remaining-gameplay"); }`, {
    syncAudio: () => calls.push("audio"), rooms: { status: () => ({ busy }) },
    roomSession: { update: () => calls.push("room-pose") },
    orbit: { apply: () => calls.push("camera") },
    player: { getLocalPosition: () => ({ x: 0, y: 1.15, z: 0 }) },
    character: { eyeHeight: 1.6 }, calls
  });
  frame(.016);
  assert.deepEqual(calls, ["audio", "camera"], "no source-room pose, campus place update, auto movement or furniture refresh");
  busy = false; calls.length = 0; frame(.016);
  assert.deepEqual(calls, ["audio", "room-pose", "remaining-gameplay"]);
});

test("late furniture readback cannot teleport an intermediate lobby pose using personal-room colliders", () => {
  const source = main.match(/const moveOutOfFurniture = \(\) => \{[\s\S]*?^\};/m)[0];
  let busy = true;
  let moves = 0;
  const move = vm.runInNewContext(`${source}\nmoveOutOfFurniture`, {
    rooms: { currentSpace: "ROOM_PERSONAL_BASIC", status: () => ({ busy }) },
    player: { getLocalPosition: () => ({ x: 4.3, z: 3.93 }), setLocalPosition: () => { moves += 1; } },
    personalRoomScene: { ownedFurniture: { obstacles: [{ id: "chair_1", minX: 4, maxX: 4.5, minZ: 3.5, maxZ: 4 }] } },
    PERSONAL_ROOM_BASIC_SPAWN: { position: { x: 0, y: 1.15, z: 0 } }, controller: { velocityY: 0 }
  });
  move(); assert.equal(moves, 0);
  busy = false; move(); assert.equal(moves, 1, "normal personal-room collision correction remains");
});

test("main reports transition errors and snapshots the actual location label", () => {
  assert.match(main, /onError:[\s\S]*recovered[\s\S]*다시 시도[\s\S]*새로고침/);
  assert.match(main, /getLocationLabel: \(\) => zoneEl.textContent/);
  assert.match(main, /if \(!rooms.status\(\).busy && rooms.currentSpace === "ROOM_PERSONAL_BASIC"\)/,
    "pending furniture readback does not replace the transitional map");
});
