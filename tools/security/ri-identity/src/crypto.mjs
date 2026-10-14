// RI v2 isolated reference: browser-compatible P-256 signatures, no secrets or npm deps.
// The signatures bind every frame to server-issued identity, epoch, kind and actual topic.
const c = globalThis.crypto;
if (!c?.subtle) throw new Error('WebCrypto required');
const te = new TextEncoder();
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const CAMPUS = /^world:campus:AREA_[A-Z0-9_]{1,60}$/;
export const ROOM = /^world:room:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isTopic(x) { return typeof x === 'string' && (CAMPUS.test(x) || ROOM.test(x)); }
export function trustedTopic(topic) {
  if (!isTopic(topic)) throw new Error('BAD_TOPIC');
  return topic.replace(/^world:/, 'world:trusted:');
}
export function canonical(value, depth = 0) {
  if (depth > 8) throw new Error('TOO_DEEP');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) && Math.abs(value) > 1e9) throw new Error('INVALID_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > 80) throw new Error('ARRAY_TOO_LARGE');
    return '[' + value.map(v => canonical(v, depth+1)).join(',') + ']';
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('NON_JSON');
  const keys = Object.keys(value).sort();
  if (keys.length > 40 || keys.some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('INVALID_FIELDS');
  return '{' + keys.map(k => `${JSON.stringify(k)}:${canonical(value[k], depth+1)}`).join(',') + '}';
}
// Native btoa/atob keep this module compatible with browsers (no Node Buffer).
const b64url = data => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
const parseB64 = text => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(text)) throw new Error('BAD_SIGNATURE');
  const s=text.replace(/-/g,'+').replace(/_/g,'/');
  if (s.length%4===1) throw new Error('BAD_SIGNATURE');
  return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length/4)*4,'=')),ch=>ch.charCodeAt(0));
};
export function validatePublicJwk(jwk) {
  if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.d !== undefined) throw new Error('INVALID_PUBLIC_KEY');
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string' || !/^[\w-]{43}$/.test(jwk.x) || !/^[\w-]{43}$/.test(jwk.y)) throw new Error('INVALID_PUBLIC_KEY');
  return Object.freeze({kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y});
}
export async function importVerifyKey(jwk) { return c.subtle.importKey('jwk', validatePublicJwk(jwk), {name:'ECDSA',namedCurve:'P-256'}, false, ['verify']); }
export async function fingerprint(jwk) { return b64url(await c.subtle.digest('SHA-256', te.encode(canonical(validatePublicJwk(jwk))))); }
export async function makeKeyPair() { return c.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, false, ['sign','verify']); }
export async function exportPublicKey(pair) { return validatePublicJwk(await c.subtle.exportKey('jwk', pair.publicKey)); }
export function proofText(challenge) {
  // These exact fields are delivered over authenticated HTTPS. Auth identity remains server-owned.
  return 'INHA_WORLD_RI_CHALLENGE_V1\n' + canonical({id:challenge.id,nonce:challenge.nonce,kind:challenge.kind,topic:challenge.topic,sid:challenge.sid ?? null,keyHash:challenge.keyHash});
}
export async function signProof(privateKey, challenge) {
  return b64url(await c.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,te.encode(proofText(challenge))));
}
export async function verifyProof(jwk, challenge, signature) {
  const raw = parseB64(signature);
  if (raw.length !== 64) return false;
  return c.subtle.verify({name:'ECDSA',hash:'SHA-256'},await importVerifyKey(jwk),raw,te.encode(proofText(challenge)));
}
export function frameParts(frame) { return {v:frame.v,sid:frame.sid,epoch:frame.epoch,topic:frame.topic,kind:frame.kind,seq:frame.seq,payload:frame.payload}; }
export function frameText(frame) { return 'INHA_WORLD_RI_FRAME_V2\n' + canonical(frameParts(frame)); }
export async function signFrame(privateKey, entry, kind, payload, seq) {
  const frame = {v:2,sid:entry.sid,epoch:entry.epoch,topic:entry.topic,kind,seq,payload};
  return {...frame,sig:b64url(await c.subtle.sign({name:'ECDSA',hash:'SHA-256'},privateKey,te.encode(frameText(frame))))};
}
export async function verifyFrame(publicJwk, frame) {
  const sig=parseB64(frame.sig);
  if(sig.length!==64) return false;
  return c.subtle.verify({name:'ECDSA',hash:'SHA-256'},await importVerifyKey(publicJwk),sig,te.encode(frameText(frame)));
}
