// No age-based deletion: an unexported snapshot may be the only surviving copy.
// Exhaustion stops writes. Cleanup requires an exported, explicitly acknowledged set.
export const RECOVERY_LIMIT=Object.freeze({count:8,bytes:2*1024*1024});
export const recoveryPrefixes=account=>[
  `inha-world-learning-v1:${account===null?'guest':`user:${encodeURIComponent(account)}`}:recovery:`,
  ...(account===null?[]:[`inha-world-learning-sync-v1:user:${encodeURIComponent(account)}:recovery:`])
];
export function recoveryEntries(store,account){
  if(!store)throw Error('LOCAL_STORAGE_FAILED');
  const prefixes=recoveryPrefixes(account),rows=[];
  for(let i=0;i<store.length;i++){const key=store.key(i);if(prefixes.some(p=>key?.startsWith(p)))rows.push({key,raw:store.getItem(key)});}
  return rows;
}
export function writeRecovery(store,account,key,raw,replace=null){
  if(store?.getItem(key)!==null)throw Error('RECOVERY_ID_REUSED');
  const entries=recoveryEntries(store,account).filter(x=>!(replace&&x.key===replace.key&&x.raw===replace.raw));entries.push({key,raw});
  if(entries.length>RECOVERY_LIMIT.count||entries.reduce((n,x)=>n+2*(x.key.length+x.raw.length),0)>RECOVERY_LIMIT.bytes)throw Error('RECOVERY_LIMIT');
  store.setItem(key,raw);if(store.getItem(key)!==raw)throw Error('LOCAL_STORAGE_FAILED');
}
export function cleanupRecovery(store,account,exported,{confirmed=false}={}){
  if(!confirmed)throw Error('BACKUP_CONFIRMATION_REQUIRED');
  const prefixes=recoveryPrefixes(account);let removed=0;
  for(const {key,raw} of exported){
    // New local snapshots and all cloud archives are immutable. Pre-remediation
    // rolling keys may still be written by an old tab: export, but never delete them.
    if((key.includes(':snapshot:')||key.startsWith('inha-world-learning-sync-v1:'))&&prefixes.some(p=>key.startsWith(p))&&store.getItem(key)===raw){store.removeItem(key);if(store.getItem(key)===null)removed++;}
  }
  return removed;
}
