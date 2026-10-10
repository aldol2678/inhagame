// Server ONLY. The broadcaster's secret must never be shipped with the browser bundle.
// Supabase Realtime REST API contract: `/realtime/v1/api/broadcast/<topic>/events/<event>?private=true`.
// Delivery ACK is not proof that every connected client received the event; clients resnapshot.
import {trustedTopic,isTopic} from './crypto.mjs';
const PROD='oosshdsthgpqabjmbkjo';
export function createSupabaseTrustedPublisher({projectUrl,projectRef,secretKey,fetcher=fetch,authorizationToken=null}){
 if(projectRef===PROD || !/^[a-z]{20}$/.test(projectRef??''))throw Error('ISOLATED_PROJECT_REF_REQUIRED');
 const base=new URL(projectUrl);
 if(base.protocol!=='https:'||base.hostname!==`${projectRef}.supabase.co`)throw Error('PROJECT_URL_REF_MISMATCH');
 if(!secretKey || secretKey.length<30)throw Error('SERVER_SECRET_REQUIRED');
 return {async publish(event){
  if(!isTopic(event?.topic) || !['JOIN','UPDATE','REVOKE'].includes(event?.type)||!Number.isSafeInteger(event?.revision))throw Error('BAD_TRUSTED_EVENT');
  // All topic derivation is server-side and allowlisted. Never proxy client-provided trusted names.
  const topic=trustedTopic(event.topic);
  const endpoint=new URL(`/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/ri.registry?private=true`,base);
  const headers={'content-type':'application/json',apikey:secretKey};
  if(authorizationToken)headers.authorization=`Bearer ${authorizationToken}`;
  const resp=await fetcher(endpoint.href,{method:'POST',headers,body:JSON.stringify(event),signal:AbortSignal.timeout(5000)});
  if(!resp.ok)throw Error('TRUSTED_PUBLISH_REJECTED');
  return {accepted:true,deliveredToAllClients:false};
 }};
}
