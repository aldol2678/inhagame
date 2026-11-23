// Cloudflare Pages preview-only same-origin bridge to the already deployed
// Tier 4 Worker. The bridge never forwards arbitrary destinations or grants
// permissions, and does not expose v1 guest linking/profile writes.
const UPSTREAM = 'https://inha-world-tier04.aldol-lab.workers.dev';
const PREVIEW_HOST = /(^|\.)inhagame-playcanvas-live\.pages\.dev$/i;
const GET_PATHS = new Set([
  '/api/auth/firebase/config', '/api/auth/firebase/me',
  '/api/world-profile', '/api/world-wallet',
  '/api/world-progression', '/api/world-inventory'
]);
const POST_PATHS = new Set([
  '/api/auth/firebase/login', '/api/auth/firebase/logout'
]);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function response(status, error) {
  return new Response(JSON.stringify({error}),{status,headers:{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
export async function onRequest({request}) {
  const url = new URL(request.url);
  if (!PREVIEW_HOST.test(url.hostname)) return response(404,'QA_NOT_AVAILABLE');
  if (url.search) return response(400,'QUERY_NOT_ALLOWED');
  if (!url.pathname.startsWith('/neon-qa/api/')) return response(404,'PATH_DENIED');
  const path=url.pathname.slice('/neon-qa'.length);
  const allowed=(request.method==='GET'&&GET_PATHS.has(path)) ||
    (request.method==='POST'&&POST_PATHS.has(path));
  if (!allowed) return response(405,'METHOD_OR_PATH_DENIED');
  // A same-origin browser action may include Origin. Never accept cross-site posts.
  const origin=request.headers.get('Origin');
  if (origin) {
    try {if(new URL(origin).origin!==url.origin)return response(403,'CROSS_ORIGIN_DENIED');}
    catch {return response(403,'CROSS_ORIGIN_DENIED');}
  }
  const sessionId=request.headers.get('X-Session-Id');
  if (sessionId && !SESSION_ID.test(sessionId)) return response(400,'INVALID_SESSION_ID');
  const headers=new Headers({'Accept':'application/json'});
  if(sessionId)headers.set('X-Session-Id',sessionId);
  let body;
  if(request.method==='POST'){
    const type=request.headers.get('Content-Type')??'';
    if (!/^application\/json(?:\s*;|$)/i.test(type))return response(415,'JSON_REQUIRED');
    body=await request.text();
    if(body.length>14000)return response(413,'BODY_TOO_LARGE');
    try{JSON.parse(body);}catch{return response(400,'INVALID_JSON');}
    headers.set('Content-Type','application/json');
  }
  try {
    const result=await fetch(UPSTREAM+path,{
      method:request.method,headers,body,redirect:'manual',
      cf:{cacheTtl:0,cacheEverything:false}
    });
    if(result.status>=300&&result.status<400)return response(502,'REDIRECT_DENIED');
    const contentType=result.headers.get('Content-Type')??'';
    if(!contentType.toLowerCase().includes('application/json'))return response(502,'UPSTREAM_NON_JSON');
    return new Response(result.body,{status:result.status,headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer'
    }});
  } catch {return response(503,'UPSTREAM_UNAVAILABLE');}
}
