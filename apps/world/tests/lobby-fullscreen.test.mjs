import test from "node:test";
import assert from "node:assert/strict";
import { lobbyFullscreenEligible, requestLobbyFullscreen } from "../src/lobby/lobby-fullscreen.js";
import { bindMainGateEntry } from "../src/lobby/lobby-main-gate.js";

const mobileWindow = {
  innerWidth: 844,
  innerHeight: 390,
  matchMedia(query) {
    return { matches: query === "(pointer: coarse)" };
  }
};

const portraitMobileWindow = {
  innerWidth: 390,
  innerHeight: 844,
  matchMedia(query) {
    return { matches: query === "(pointer: coarse)" };
  }
};

test("lobby fullscreen is eligible on coarse-pointer landscape browsers", () => {
  const documentLike = {
    documentElement: { requestFullscreen() {} },
    fullscreenElement: null
  };
  assert.equal(lobbyFullscreenEligible({ documentLike, windowLike: mobileWindow }), true);
});

test("lobby fullscreen is equally eligible in portrait mobile mode", () => {
  const documentLike = {
    documentElement: { requestFullscreen() {} },
    fullscreenElement: null
  };
  assert.equal(lobbyFullscreenEligible({ documentLike, windowLike: portraitMobileWindow }), true);
});

test("lobby fullscreen requests hidden browser navigation without blocking entry", () => {
  let options = null;
  const documentLike = {
    documentElement: {
      requestFullscreen(next) {
        options = next;
        return Promise.reject(new Error("simulated browser refusal"));
      }
    },
    fullscreenElement: null
  };
  assert.equal(requestLobbyFullscreen({ documentLike, windowLike: mobileWindow }), true);
  assert.deepEqual(options, { navigationUI: "hide" });
});

test("lobby fullscreen stays inert on ordinary desktop and when already fullscreen", () => {
  const desktopWindow = {
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia() { return { matches: false }; }
  };
  const root = { requestFullscreen() { throw new Error("must not run"); } };
  assert.equal(lobbyFullscreenEligible({
    documentLike: { documentElement: root, fullscreenElement: null },
    windowLike: desktopWindow
  }), false);
  assert.equal(lobbyFullscreenEligible({
    documentLike: { documentElement: root, fullscreenElement: root },
    windowLike: mobileWindow
  }), false);
});


test("fullscreen flow remains orientation-neutral and never requires an orientation lock", () => {
  let requested = 0;
  const documentLike = {
    documentElement: {
      requestFullscreen() {
        requested++;
        return Promise.resolve();
      }
    },
    fullscreenElement: null
  };
  assert.equal(requestLobbyFullscreen({ documentLike, windowLike: portraitMobileWindow }), true);
  assert.equal(requested, 1);
});

test("main gate click requests fullscreen before entry and preserves the cinematic callback", () => {
  const calls = [];
  const button = { addEventListener(_type, handler) { this.click = handler; }, removeEventListener() {} };
  const target = { x: 10, y: 1.15, z: 20, yaw: 0 };
  const documentLike = { body: { dataset: {} }, getElementById() { return null; } };
  let completion;
  const entry = bindMainGateEntry({
    button,
    player: { getLocalPosition() { return { x: 0, z: 0 }; } },
    lobbyWorld: { active: true },
    spawn: target,
    documentLike,
    requestFullscreen() { calls.push("fullscreen"); return false; },
    transition: { start({ onComplete }) { calls.push("transition"); completion = onComplete; return true; } },
    onEntered({ target: entered }) { calls.push("cinematic"); assert.deepEqual(entered, target); }
  });
  assert.equal(button.click(), true);
  assert.deepEqual(calls, ["fullscreen", "transition"]);
  completion();
  assert.deepEqual(calls, ["fullscreen", "transition", "cinematic"]);
  entry.destroy();
});
