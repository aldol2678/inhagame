// Read-only PlayCanvas bridge to the existing Firebase Auth / Tier 4 / Neon stack.
// This QA candidate deliberately NEVER sends guestSessionId or calls /link:
// deployed Tier 4 currently has the v1 guest ownership contract. The v2
// proof-of-ownership migration (inhaworld PR #8) is not in production.
const SESSION_KEY = 'inhaworld-firebase-session-v1';
const PROFILE_KEY = 'inhaworld-profile-user-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_ROUTES = Object.freeze({
  profile: '/api/world-profile',
  wallet: '/api/world-wallet',
  progression: '/api/world-progression',
  inventory: '/api/world-inventory',
});
export class NeonAuthBridgeError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'NeonAuthBridgeError';
    this.code = code;
    this.status = status;
  }
}
export function createNeonAuthReadBridge({fetchImpl = globalThis.fetch, storage, baseUrl} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch required');
  if (!storage?.getItem || !storage?.setItem || !storage?.removeItem) throw new TypeError('storage required');
  if (!baseUrl) throw new TypeError('baseUrl required');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new TypeError('HTTPS_REQUIRED');
  const sameOrigin = base.origin;
  let epoch = 0;
  function getSessionId() {
    const value = storage.getItem(SESSION_KEY);
    return typeof value === 'string' && UUID.test(value) ? value : null;
  }
  function forgetSession() {
    epoch++;
    storage.removeItem(SESSION_KEY);
    storage.removeItem(PROFILE_KEY);
  }
  async function request(path, {method = 'GET', session = null, body} = {}) {
    // Hardcoded same-origin path allowlist. Never accept arbitrary URL or a caller-supplied ID.
    if (![...Object.values(READ_ROUTES), '/api/auth/firebase/login',
      '/api/auth/firebase/me', '/api/auth/firebase/logout', '/api/auth/firebase/config'
    ].includes(path)) throw new NeonAuthBridgeError('PATH_DENIED', 400);
    const headers = {'Accept':'application/json'};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (session) headers['X-Session-Id'] = session;
    let response;
    try {
      response = await fetchImpl(new URL(path, sameOrigin).href, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', redirect: 'error',
      });
    } catch {
      throw new NeonAuthBridgeError('NETWORK_UNAVAILABLE');
    }
    let data;
    try { data = await response.json(); }
    catch { throw new NeonAuthBridgeError('NON_JSON_RESPONSE', response.status); }
    if (!response.ok) throw new NeonAuthBridgeError(
      typeof data?.error === 'string' ? data.error : 'REQUEST_FAILED', response.status);
    return data;
  }
  async function config() { return request('/api/auth/firebase/config'); }
  async function me() {
    const sid = getSessionId();
    if (!sid) throw new NeonAuthBridgeError('AUTH_REQUIRED', 401);
    try {
      const result = await request('/api/auth/firebase/me', {session:sid});
      if (typeof result?.profileUserId === 'string' && UUID.test(result.profileUserId)) {
        storage.setItem(PROFILE_KEY, result.profileUserId);
      } else {
        storage.removeItem(PROFILE_KEY);
      }
      return result;
    } catch (error) {
      if (error?.status === 401) forgetSession();
      throw error;
    }
  }
  async function login(idToken, {expectedUid} = {}) {
    if (typeof idToken !== 'string' || idToken.length < 80 || idToken.length > 12000) {
      throw new NeonAuthBridgeError('INVALID_FIREBASE_TOKEN', 400);
    }
    if (typeof expectedUid !== 'string' || !expectedUid) {
      throw new NeonAuthBridgeError('FIREBASE_UID_REQUIRED', 400);
    }
    // This bridge intentionally omits guestSessionId: live v1 cannot safely prove
    // that a client supplied profile UUID belongs to the Firebase caller.
    const current = ++epoch;
    storage.removeItem(SESSION_KEY);
    storage.removeItem(PROFILE_KEY);
    const result = await request('/api/auth/firebase/login', {method:'POST',body:{idToken}});
    if (current !== epoch) throw new NeonAuthBridgeError('STALE_LOGIN');
    if (!UUID.test(result?.deviceSessionId ?? '')) throw new NeonAuthBridgeError('INVALID_SESSION_RESPONSE');
    storage.setItem(SESSION_KEY,result.deviceSessionId);
    try {
      const identity = await me();
      if (identity?.firebaseUid !== expectedUid) {
        forgetSession();
        throw new NeonAuthBridgeError('FIREBASE_UID_MISMATCH');
      }
      return {identity, deviceSessionId: result.deviceSessionId, linked:identity.guest === false};
    } catch (error) {
      // Never display a signed-in account on incomplete identity readback.
      if (current === epoch || getSessionId()) forgetSession();
      throw error;
    }
  }
  async function readSnapshot() {
    // Server identity readback comes first. No write methods in this bridge.
    const identity = await me();
    const session = getSessionId();
    if (!session) throw new NeonAuthBridgeError('AUTH_REQUIRED',401);
    const rows = {};
    for (const [key,path] of Object.entries(READ_ROUTES)) {
      try { rows[key] = {ok:true,data:await request(path,{session})}; }
      catch (error) {
        rows[key] = {ok:false,status:error.status||0,error:error.code||'READ_FAILED'};
        if (error.status === 401) { forgetSession(); break; }
      }
    }
    return {linked:identity?.guest === false, identity, resources:rows};
  }
  async function logout() {
    const session=getSessionId();
    if (!session) { forgetSession(); return {ok:true}; }
    try {
      const data=await request('/api/auth/firebase/logout',{method:'POST',session,body:{}});
      forgetSession();return data;
    } catch (e) {
      forgetSession();
      if(e.status===401)return {ok:true};
      throw new NeonAuthBridgeError('REMOTE_LOGOUT_UNCONFIRMED',e.status);
    }
  }
  return Object.freeze({
    SESSION_KEY,PROFILE_KEY,getSessionId,forgetSession,config,me,login,readSnapshot,logout
  });
}
