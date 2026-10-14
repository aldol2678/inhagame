// Candidate handler: same-origin, bearer-authenticated, no CORS allowance.
import {RIError} from './identity-service.mjs';
export const API_BASE='/api/world-online-identity';
function send(res,status,payload){
 res.statusCode=status;
 res.setHeader('Content-Type','application/json; charset=utf-8');
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.end(JSON.stringify(payload));
}
async function body(req) {
 if(!(req.headers['content-type']??'').startsWith('application/json'))throw new RIError('JSON_REQUIRED',415);
 let total=0;const chunks=[];
 for await(const chunk of req) {total+=chunk.length;if(total>4096)throw new RIError('BODY_TOO_LARGE',413);chunks.push(chunk);}
 let data;
 try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RIError('BAD_JSON',400);}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new RIError('BAD_JSON',400);
 return data;
}
function exactFields(data,allowed){
 const keys=Object.keys(data);
 if(keys.some(k=>!allowed.includes(k)))throw new RIError('UNKNOWN_FIELD',400);
}
export function createIdentityHttpHandler(service) {
 return async(req,res)=>{
  try{
   const url=new URL(req.url,'http://local.invalid');
   const auth=req.headers.authorization;
   if(req.headers.origin){
    // Enforce exact origin if the server is configured with its public URL.
    // The host application must also enforce CSRF/session policy around other routes.
    const expected=process.env.RI_ALLOWED_ORIGIN;
    if(!expected||req.headers.origin!==expected)throw new RIError('ORIGIN_DENIED',403);
   }
   if(req.method==='POST'&&url.pathname===`${API_BASE}/challenge`){
    const b=await body(req);exactFields(b,['kind','topic','publicJwk','sid']);
    return send(res,200,await service.challenge(auth,b));
   }
   if(req.method==='POST'&&url.pathname===`${API_BASE}/finish`){
    const b=await body(req);exactFields(b,['challengeId','signature']);
    return send(res,200,await service.finish(auth,b));
   }
   if(req.method==='GET'&&url.pathname===`${API_BASE}/roster`){
    if([...url.searchParams.keys()].some(k=>k!=='topic'))throw new RIError('BAD_QUERY',400);
    return send(res,200,await service.roster(auth,url.searchParams.get('topic')));
   }
   return send(res,404,{error:'ROUTE_NOT_FOUND'});
  }catch(error){
   // Never echo thrown errors containing access tokens, private keys, or internal SQL.
   if(error instanceof RIError)return send(res,error.status,{error:error.code});
   return send(res,503,{error:'TEMPORARILY_UNAVAILABLE'});
  }
 };
}
