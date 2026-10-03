// Serves Survival and its third-party scripts from the checkout. Anything else is aborted and recorded.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
const THREE='https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js';
const SUPABASE='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2';
const ENTRY_SCRIPT='https://inhagame.example/game-entry.js';
const ENTRY_API='https://inhagame.example/api/hub-entry';
const SITES=new Set(['http://localhost:4173','https://survival.inhagame.example']);

async function offline(context){
  // replies: optional status codes for the next hub-entry POSTs (default 204).
  const log={entries:[],blocked:[],replies:[]};
  const file=(route,full)=>route.fulfill({status:200,contentType:types[path.extname(full)]||'application/octet-stream',body:fs.readFileSync(full)});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(SITES.has(url.origin)){
      const rel=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
      const full=path.join(root,rel);
      if(!full.startsWith(root+path.sep)||rel.includes('node_modules')||!fs.existsSync(full)||fs.statSync(full).isDirectory())
        return route.fulfill({status:404,body:''});
      return file(route,full);
    }
    if(request.url()===THREE)return file(route,path.join(root,'node_modules','three','build','three.min.js'));
    // Without supabase-js the account layer reports "unavailable" and guest play continues.
    if(request.url()===SUPABASE)return route.fulfill({status:200,contentType:types['.js'],body:'/* supabase-js is not loaded in CI */'});
    // The real hub integration script from this repository, not the deployed copy.
    if(request.url()===ENTRY_SCRIPT)return file(route,path.join(root,'..','world','game-entry.js'));
    if(request.url()===ENTRY_API){
      const cors={'access-control-allow-origin':request.headers().origin||'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type'};
      if(request.method()!=='POST')return route.fulfill({status:204,headers:cors});
      log.entries.push({body:JSON.parse(request.postData()||'null'),origin:request.headers().origin});
      return route.fulfill({status:log.replies.shift()??204,headers:cors});
    }
    log.blocked.push(`${request.method()} ${request.url()}`);
    return route.abort('blockedbyclient');
  });
  return log;
}
module.exports={offline};
