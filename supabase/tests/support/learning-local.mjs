// Test-only Auth + PostgREST access. Hard loopback guard; never accepts a remote DB.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
export function localLearningBackend(){
 const {API_URL,ANON_KEY,DB_URL,PSQL_FALLBACK_CONTAINER}=process.env;
 assert.match(API_URL||'',/^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
 assert.match(DB_URL||'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
 assert.ok(ANON_KEY);
 const users=[];
 const sql=query=>{
  const args=['-v','ON_ERROR_STOP=1','-Atq','-c',query];
  try{return execFileSync('psql',[DB_URL,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
  catch(error){if(error.code!=='ENOENT'||!PSQL_FALLBACK_CONTAINER)throw error;return execFileSync('docker',['exec',PSQL_FALLBACK_CONTAINER,'psql','-U','postgres','-d','postgres',...args],{encoding:'utf8'}).trim();}
 };
 async function request(path,{token,body,method='POST'}={}){
  const res=await fetch(API_URL+path,{method,headers:{apikey:ANON_KEY,...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}return {status:res.status,data};
 }
 async function signup(){
  const email=`learning-${randomUUID()}@example.test`,password=`LocalOnly-${randomUUID()}!`;
  const result=await request('/auth/v1/signup',{body:{email,password}});assert.equal(result.status,200,JSON.stringify(result.data));
  assert.ok(result.data.user?.id);users.push(result.data.user.id);
  const login=await request('/auth/v1/token?grant_type=password',{body:{email,password}});assert.equal(login.status,200);assert.ok(login.data.access_token);assert.equal(login.data.user.is_anonymous,false);
  return login.data;
 }
 return {url:API_URL,key:ANON_KEY,signup,request,sql,
  rpc:(session,fn,body={})=>request(`/rest/v1/rpc/${fn}`,{token:session.access_token,body}),
  cleanup(){if(users.length)sql(`delete from auth.users where id in (${users.map(id=>`'${id}'::uuid`).join(',')})`);}
 };
}
