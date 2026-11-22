import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerAdapter, FutureSyncAdapter } from '../src/api.js';

for (const Adapter of [ServerAdapter, FutureSyncAdapter]) {
  test(Adapter.name + ' attaches the writer session, including after a nickname change', async (t) => {
    const values = new Map();
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url.endsWith('/session')) {
        return Response.json({sessionId: 'fixture-' + JSON.parse(options.body).nickname});
      }
      const body = JSON.parse(options.body);
      assert.equal(options.headers['x-session-id'], 'fixture-' + body.nickname);
      assert.deepEqual(Object.keys(body).sort(), ['message', 'nickname', 'roomId']);
      return Response.json({entry: body});
    });
    globalThis.localStorage = {
      getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v),
    };
    try {
      const adapter = new Adapter();
      for (const name of ['first','first','second']) {
        const entry = await adapter.addGuestbook('main-building',name,'fixture');
        assert.equal(entry.nickname,name);
      }
      assert.equal(fetch.mock.calls.length,5);
    } finally { delete globalThis.localStorage; }
  });
}
