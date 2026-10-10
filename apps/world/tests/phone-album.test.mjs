import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneAlbum } from '../src/phone/phone-album.js';
test('capture generation invalidates thumbnail work before any old-account database write', async () => {
  let done, opens=0;const store=createPhoneAlbum({indexedDB:{open(){opens++;throw Error('must not write');}},thumbnail:()=>new Promise(r=>done=r)});
  store.setScope('a');const saving=store.save({blob:new Blob(['original'])},{scope:store.scope});
  store.setScope('b');done(new Blob(['thumbnail']));assert.equal(await saving,null);assert.equal(opens,0);assert.equal(store.scope,'member:b');
});
test('unavailable storage cannot claim Album persistence and leaves a visible failure instead of false success', async () => {
  const errors=[],store=createPhoneAlbum({indexedDB:null,thumbnail:async()=>new Blob(['thumb']),onError:e=>errors.push(e)});
  assert.equal(await store.save({blob:new Blob(['PNG'])}),null);assert.match(store.error,/저장소/);assert.equal(errors.length,1);
  assert.equal(await store.remove('missing'),false);
});
