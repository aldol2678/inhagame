import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = require('../api/hub-event.js');
function response() {
  return { code:0, headers:{}, setHeader(k,v){this.headers[k]=v;},
    status(code){this.code=code;return this;},end(){return this;} };
}
test('profile events use the existing hub RPC and keep attribution IDs', async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return {ok:true,json:async()=>true};
  };
  try {
    for (const [event_type,target] of [['profile_view',null],['profile_game_click','classic']]) {
      const event_id=randomUUID(),res=response();
      await handler({method:'POST',headers:{origin:'https://inhagame.example',host:'inhagame.example'},
        body:{event_id,session_id:randomUUID(),visitor_id:randomUUID(),event_type,surface:'profile',target}},res);
      assert.equal(res.code,204);
      assert.equal(requests.at(-1).p_event_id,event_id);
      assert.equal(requests.at(-1).p_target,target);
    }
  } finally { globalThis.fetch=previous; }
});
test('cross-origin and arbitrary profile event names are rejected', async () => {
  const foreign=response();
  await handler({method:'POST',headers:{origin:'https://other.example',host:'inhagame.example'},
    body:{}},foreign);
  assert.equal(foreign.code,403);
  const invalid=response();
  await handler({method:'POST',headers:{host:'inhagame.example'},body:{
    event_id:randomUUID(),session_id:randomUUID(),visitor_id:randomUUID(),
    event_type:'profile_steal',surface:'profile',target:null
  }},invalid);
  assert.equal(invalid.code,400);
});
