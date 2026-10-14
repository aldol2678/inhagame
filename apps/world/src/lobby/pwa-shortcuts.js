// PWA-SHORTCUT-01: parse only same-campus, allowlisted manifest shortcut intents.
// The installed PWA must pass through the normal loading, lobby and InputFocus gates.
export const CAMPUS_SHORTCUT_APPS=Object.freeze({
  notifications:'notifications',
  'daily-quiz':'daily-quiz',
  album:'album'
});

export function resolveCampusShortcut(search='') {
  const params=new URLSearchParams(typeof search==='string'?search:'');
  if(params.get('lobby')!=='1')return null;
  const requested=params.getAll('shortcut');
  if(requested.length!==1)return null;
  return Object.hasOwn(CAMPUS_SHORTCUT_APPS,requested[0])?CAMPUS_SHORTCUT_APPS[requested[0]]:null;
}

// One-shot intent. If the player stays in the lobby, nothing opens and no account state is changed.
export function createCampusShortcutDispatcher({
  search='',isReady=()=>false,openApp=()=>false,onConsumed=()=>{},
  now=()=>Date.now(),expiresAfterMs=10*60*1000
}={}) {
  let pending=resolveCampusShortcut(search);
  const startedAt=now();
  function tryOpen() {
    if(!pending)return false;
    if(now()-startedAt>expiresAfterMs){pending=null;return false;}
    if(!isReady())return false;
    let success=false;
    try {success=openApp(pending)===true;} catch { /* never break World boot on a shortcut */ }
    if(!success)return false;
    pending=null;
    try {onConsumed();} catch { /* URL cleanup is optional */ }
    return true;
  }
  return Object.freeze({tryOpen,get pending(){return pending;}});
}
