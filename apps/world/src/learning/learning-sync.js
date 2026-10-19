import {emptyProgress,sanitizeProgress} from './learning-progress.js';
const copy=v=>JSON.parse(JSON.stringify(v));
// Stable key ordering makes JSONB readback comparable to local JSON.
export const stableProgress=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>stableProgress(a)===stableProgress(b);
const clean=v=>v?.version===1&&same(v,sanitizeProgress(v));
const revision=n=>Number.isSafeInteger(n)&&n>=0;
export function createLearningSync({progress,transport,getStorage=()=>globalThis.localStorage,win=globalThis.window,
  uuid=()=>globalThis.crypto.randomUUID(),onStatus=()=>{},onRestore=()=>{},isBusy=()=>false,timeoutMs=15000,retryMs=1000}) {
  let account=null,epoch=0,abort=null,job=null,timer=null,retries=0,disposed=false,suppress=false;
  let meta={version:1,base:null,pending:null},metaRaw=null,remote=null,status='local';
  const key=()=>`inha-world-learning-sync-v1:user:${encodeURIComponent(account)}`;
  function notify(value){status=value;onStatus(snapshot());}
  function snapshot(){return {status,revision:meta.base?.revision??0,pending:!!meta.pending,remoteRevision:remote?.revision??null,localCompleted:Object.keys(progress.state.completed).length,remoteCompleted:Object.keys(remote?.progress?.completed??{}).length};}
  function persist(){const store=getStorage(),raw=JSON.stringify(meta);if(!store||store.getItem(key())!==metaRaw)throw Error('LOCAL_CONFLICT');store.setItem(key(),raw);if(store.getItem(key())!==raw)throw Error('LOCAL_STORAGE_FAILED');metaRaw=raw;}
  function archive(reason,cloud=null){
    const store=getStorage(),k=`${key()}:recovery:${uuid()}`,raw=JSON.stringify({format:'induck.learning.recovery',version:1,reason,local:sanitizeProgress(progress.state),cloud,metadata:meta});
    if(!store)throw Error('LOCAL_STORAGE_FAILED');store.setItem(k,raw);if(store.getItem(k)!==raw)throw Error('LOCAL_STORAGE_FAILED');
  }
  function validate(row){if(row?.owner!==account||!revision(row.revision)||(row.revision===0?row.progress!==null:!clean(row.progress)))throw Error('INVALID_PROGRESS');return row;}
  function replace(value){if(isBusy()){notify('deferred');return false;}archive('before-cloud-restore',remote);suppress=true;try{if(!progress.replace(value))throw Error('LOCAL_CONFLICT');}finally{suppress=false;}onRestore();return true;}
  function later(){if(disposed||!account||!transport?.enabled||timer!==null||retries>=5)return;timer=setTimeout(()=>{timer=null;void sync();},retryMs*2**retries++);timer.unref?.();}
  async function perform(at,signal,choice){
    const check=()=>{if(disposed||at!==epoch||signal.aborted)throw Error('CANCELLED');};
    const read=async()=>{const value=await transport.read(account,signal);check();return validate(value);};
    check();if(!progress.writable)throw Error('LOCAL_STORAGE_FAILED');
    if(choice){
      const expected=remote?.revision,latest=await read();
      if(expected===undefined||latest.revision!==expected){remote=latest;notify('conflict');return;}
      remote=latest;archive('explicit-conflict-resolution',remote);
      if(choice==='cloud'&&!replace(remote.progress??emptyProgress()))return;
      meta={version:1,base:{revision:remote.revision,progress:remote.progress??emptyProgress()},pending:null};persist();
    }
    // An uncertain request is immutable and retried with the same ID, even after reload.
    if(meta.pending){
      notify('saving');const pending=copy(meta.pending);
      const ack=await transport.write(account,pending,signal);check();
      if(ack?.owner!==account||ack.requestId!==pending.id||ack.revision!==pending.revision+1)throw Error('INVALID_PROGRESS');
      notify('acknowledged'); // Accepted response is NOT a verified cloud save.
      remote=await read();
      if(remote.revision!==ack.revision||!same(remote.progress,pending.progress)){notify('conflict');return;}
      meta.base={revision:remote.revision,progress:remote.progress};meta.pending=null;persist();retries=0;
      if(same(sanitizeProgress(progress.state),remote.progress)){notify('synced');return;}
    }
    remote=await read();const local=sanitizeProgress(progress.state),base=meta.base;
    if(same(local,remote.progress??emptyProgress())){
      meta.base={revision:remote.revision,progress:local};persist();notify('synced');retries=0;return;
    }
    if(remote.revision!==(base?.revision??0)){
      if(same(local,base?.progress??emptyProgress())){
        if(!replace(remote.progress))return;
        meta.base={revision:remote.revision,progress:remote.progress};persist();notify('synced');retries=0;return;
      }
      notify('conflict');return;
    }
    // Also require exact base content: revision alone cannot authorize a malformed response.
    if(base&&remote.revision>0&&!same(base.progress,remote.progress))throw Error('INVALID_PROGRESS');
    // Flush/check local bytes before creating a durable outbox; never upload stale-tab state.
    suppress=true;try{if(!progress.save())throw Error('LOCAL_CONFLICT');}finally{suppress=false;}
    meta.pending={id:uuid(),revision:remote.revision,progress:local};persist();
    await perform(at,signal);
  }
  function sync(choice){
    if(disposed||!account||!transport?.enabled)return Promise.resolve(false);
    if(job)return job;
    if(status==='blocked'||(status==='conflict'&&!choice))return Promise.resolve(false);
    if(win?.navigator?.onLine===false){notify('offline');return Promise.resolve(false);}
    const at=epoch,controller=new AbortController();abort=controller;
    const deadline=setTimeout(()=>controller.abort(),timeoutMs);deadline.unref?.();
    const work=async()=>{
      if(at!==epoch||disposed){clearTimeout(deadline);return false;}
      try{notify('checking');await perform(at,controller.signal,choice);return true;}
      catch(error){
        if(at!==epoch||disposed)return false;
        if(error.message==='CONFLICT'){
          try{const latest=await transport.read(account,controller.signal);if(at!==epoch||controller.signal.aborted)return false;remote=validate(latest);notify('conflict');}catch{if(at===epoch){notify('retry');later();}}
        }else if(['LOCAL_CONFLICT','LOCAL_STORAGE_FAILED','INVALID_PROGRESS'].includes(error.message))notify('blocked');
        else{notify('retry');later();}
        return false;
      }finally{clearTimeout(deadline);if(at===epoch){job=null;abort=null;}}
    };
    // Web Locks serialize cloud/local metadata work between tabs where supported.
    const locks=win?.navigator?.locks;
    job=Promise.resolve().then(()=>locks?locks.request(key(),{signal:controller.signal},work):work()).catch(()=>{if(at===epoch){job=null;abort=null;notify('retry');later();}clearTimeout(deadline);return false;});
    return job;
  }
  function stop(){epoch++;abort?.abort();abort=null;job=null;clearTimeout(timer);timer=null;retries=0;remote=null;}
  function setAccount(id){
    stop();account=typeof id==='string'&&id?id:null;meta={version:1,base:null,pending:null};metaRaw=null;
    if(!account||!transport?.enabled){notify('local');return;}
    try{
      metaRaw=getStorage()?.getItem(key())??null;
      if(metaRaw){const parsed=JSON.parse(metaRaw);
        if(parsed?.version!==1||parsed.base&&(!revision(parsed.base.revision)||!clean(parsed.base.progress))||parsed.pending&&(!/^[0-9a-f-]{36}$/i.test(parsed.pending.id)||!revision(parsed.pending.revision)||!clean(parsed.pending.progress)))throw Error();
        meta=parsed;
      }
      notify('checking');void sync();
    }catch{notify('blocked');}
  }
  const unsubscribe=progress.subscribe(()=>{if(suppress||!account||!transport?.enabled)return;if(status!=='conflict'&&status!=='blocked'){notify('pending');retries=0;later();}});
  const online=()=>{retries=0;void sync();},offline=()=>{abort?.abort();if(account&&transport?.enabled)notify('offline');};
  win?.addEventListener?.('online',online);win?.addEventListener?.('offline',offline);
  return {snapshot,sync,setAccount,resolve:choice=>['local','cloud'].includes(choice)?sync(choice):Promise.resolve(false),
    exportRecovery(){const store=getStorage(),rows=[];if(account&&store)for(let i=0;i<store.length;i++){const k=store.key(i);if(k?.startsWith(`${key()}:recovery:`))rows.push(JSON.parse(store.getItem(k)));}return JSON.stringify({format:'induck.learning.recovery.bundle',version:1,records:rows},null,2);},
    dispose(){disposed=true;stop();account=null;meta={version:1,base:null,pending:null};unsubscribe();win?.removeEventListener?.('online',online);win?.removeEventListener?.('offline',offline);}
  };
}
