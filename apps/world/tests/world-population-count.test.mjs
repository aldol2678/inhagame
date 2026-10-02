import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorldPopulationSnapshot,
  startWorldPopulationCount,
  WORLD_POPULATION_REFRESH_MS
} from "../src/online/world-population-heartbeat.js";

test("world population aggregate includes signed-in and guest sessions", () => {
  assert.deepEqual(parseWorldPopulationSnapshot({
    online: 9,
    signedIn: 4,
    guests: 5,
    lobby: 2,
    campus: 6,
    clubRoom: 1,
    asOf: "2026-09-29T09:00:00Z"
  }), {
    online: 9,
    signedIn: 4,
    guests: 5,
    lobby: 2,
    campus: 6,
    clubRoom: 1,
    asOf: "2026-09-29T09:00:00Z"
  });
});

test("world population reader polls the public aggregate", async () => {
  const calls = [];
  let interval = null;
  const client = {
    rpc(name) {
      calls.push(name);
      return Promise.resolve({
        data: {
          online: 7,
          signedIn: 3,
          guests: 4,
          lobby: 1,
          campus: 5,
          clubRoom: 1,
          asOf: "2026-09-29T09:00:00Z"
        },
        error: null
      });
    }
  };
  const scheduler = {
    setInterval(fn, ms) {
      interval = { fn, ms };
      return 1;
    },
    clearInterval() {
      interval = null;
    }
  };
  const reader = startWorldPopulationCount({ client, scheduler });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(WORLD_POPULATION_REFRESH_MS, 20000);
  assert.equal(calls[0], "get_world_online_count_v1");
  assert.equal(reader.status().state, "READY");
  assert.equal(reader.status().snapshot.online, 7);
  assert.equal(reader.status().snapshot.guests, 4);
  assert.equal(interval.ms, 20000);

  reader.stop();
  assert.equal(interval, null);
});
