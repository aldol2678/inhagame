// Reuses the World client and its permanent Auth session. No alternate keys or endpoint.
export const LEARNING_CLOUD_RELEASE = Object.freeze({enabled:false});
export function createLearningCloudTransport({getClient,enabled=LEARNING_CLOUD_RELEASE.enabled}) {
  async function call(name,args,account,signal) {
    if(!enabled||!account||signal?.aborted)throw Error('CLOUD_UNAVAILABLE');
    const client=getClient();if(!client)throw Error('CLOUD_UNAVAILABLE');
    const {data,error}=await client.auth.getSession();
    if(signal?.aborted||error||data?.session?.user?.id!==account||data.session.user.is_anonymous!==false)throw Error('ACCOUNT_CHANGED');
    // Pin the token used for this request. A shared Supabase client may change accounts
    // between getSession and fetch; an explicit Authorization header prevents relabelling.
    const query=client.rpc(name,args).setHeader('Authorization',`Bearer ${data.session.access_token}`).abortSignal(signal);
    const result=await query;if(signal?.aborted)throw Error('ACCOUNT_CHANGED');
    if(result.error)throw Error(result.error.code==='PT409'?'CONFLICT':result.error.code==='22023'?'INVALID_PROGRESS':'CLOUD_REQUEST_FAILED');
    if(result.data?.owner!==account)throw Error('ACCOUNT_CHANGED');
    return result.data;
  }
  return Object.freeze({enabled,
    read:(account,signal)=>call('world_learning_read_v1',{},account,signal),
    write:(account,pending,signal)=>call('world_learning_save_v1',{p_request_id:pending.id,p_expected_revision:pending.revision,p_progress:pending.progress},account,signal)
  });
}
