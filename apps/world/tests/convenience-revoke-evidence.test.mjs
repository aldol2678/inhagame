import test from 'node:test';
import assert from 'node:assert/strict';
import {isConfirmedRevokeRace} from './browser/convenience-revoke-evidence.mjs';
const evidence=()=>({request:{op:'move',connectionId:'connection-a',authoritySessionId:'session-a',fence:2,command:{sequence:148}},status:409,error:'CONVENIENCE_SESSION_EXPIRED',startedAt:10,receivedAt:30,revoke:{request:{op:'revoke',connectionId:'connection-a',authoritySessionId:'session-a',fence:2},status:200,active:false,sequence:147,startedAt:20,receivedAt:25}});
test('acknowledged same-scope revoke followed by one in-flight next move refusal is expected',()=>assert.equal(isConfirmedRevokeRace(evidence()),true));
for(const [name,change] of [
 ['active play',x=>{x.revoke=null;}],['unconfirmed revoke',x=>{x.revoke.status=409;}],['still active',x=>{x.revoke.active=true;}],
 ['other session',x=>{x.request.authoritySessionId='session-b';}],['other connection',x=>{x.request.connectionId='connection-b';}],['other fence',x=>{x.request.fence=3;}],
 ['other error',x=>{x.error='CONVENIENCE_PRESENCE_REQUIRED';}],['other status',x=>{x.status=401;}],['other operation',x=>{x.request.op='complete';}],
 ['before revoke acknowledgement',x=>{x.receivedAt=24;}],['new move after revoke requested',x=>{x.startedAt=21;}],['wrong sequence',x=>{x.request.command.sequence=149;}],['missing timing',x=>{delete x.startedAt;}]
]) test(`fails closed for ${name}`,()=>{const x=evidence();change(x);assert.equal(isConfirmedRevokeRace(x),false);});

test('only bounded exact browser diagnostics belonging to proven refusals are classified', async()=>{
 const {unexpectedBrowserProblems}=await import('./browser/convenience-revoke-evidence.mjs');
 const url='http://127.0.0.1:8000/api/world-convenience-authority';
 const http=`HTTP 409: ${url}`, diagnostic=`console.error: Failed to load resource: the server responded with a status of 409 (Conflict) (${url})`;
 assert.deepEqual(unexpectedBrowserProblems([http,diagnostic],url,0),[http,diagnostic]);
 assert.deepEqual(unexpectedBrowserProblems([http,diagnostic],url,1),[]);
 assert.deepEqual(unexpectedBrowserProblems([http,http,diagnostic,diagnostic,'HTTP 500: '+url,'pageerror: failure'],url,1),[http,diagnostic,'HTTP 500: '+url,'pageerror: failure']);
 assert.deepEqual(unexpectedBrowserProblems(['HTTP 409: http://other.invalid'],url,1),['HTTP 409: http://other.invalid']);
});
