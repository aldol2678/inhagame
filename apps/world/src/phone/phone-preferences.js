import { PHONE_SYSTEM_APP_IDS, PHONE_INSTALLABLE_APP_IDS } from './phone-app-catalog.js';

export const PHONE_PAGE_SLOTS = 12;
export const PHONE_DOCK_SLOTS = 4;
export const PHONE_WALLPAPERS = Object.freeze(['campus', 'night', 'mint']);
// Optional learning joins empty slots only once its controller is ready. Saved slots survive gating.
export const PHONE_APP_IDS = Object.freeze(PHONE_SYSTEM_APP_IDS.filter(id=>id!=='learning'));
export function defaultPhonePreferences() {
  const page = Array(PHONE_PAGE_SLOTS).fill(null); ['student-id','album','settings'].forEach((id,i)=>{page[i]=id;});
  return { version:1, pages:[page], dock:['maps','camera',null,null], hiddenApps:[], installedApps:[], widgets:['clock'], wallpaper:{type:'default',id:'campus'} };
}
export function normalizePhonePreferences(value, appIds = PHONE_APP_IDS) {
  if (!value || value.version !== 1) value = defaultPhonePreferences();
  // v1 layouts remain readable. Only explicitly installed external shortcuts join the grid.
  const installedApps = [...new Set((Array.isArray(value.installedApps) ? value.installedApps : [])
    .filter(id=>PHONE_INSTALLABLE_APP_IDS.includes(id)))];
  const activeIds = [...new Set([...appIds,...installedApps])];
  const seen = new Set(), valid = new Set([...activeIds,'learning']), take = id => { if (!valid.has(id) || seen.has(id)) return null; seen.add(id); return id; };
  const slots = (items,count) => Array.from({length:count},(_,i)=>take(items?.[i]));
  const dock = slots(value.dock,PHONE_DOCK_SLOTS);
  const pages = (Array.isArray(value.pages) && value.pages.length ? value.pages : [[]]).map(page=>slots(page,PHONE_PAGE_SLOTS));
  const hiddenApps = [...new Set(Array.isArray(value.hiddenApps) ? value.hiddenApps.filter(id=>valid.has(id)&&!seen.has(id)) : [])];
  for (const id of activeIds) {
    if (seen.has(id)||hiddenApps.includes(id)) continue;
    let page = pages.find(x=>x.includes(null)); if (!page) { page=Array(PHONE_PAGE_SLOTS).fill(null); pages.push(page); }
    page[page.indexOf(null)] = id;
  }
  const wallpaper = value.wallpaper?.type === 'photo' && typeof value.wallpaper.id === 'string' ? {type:'photo',id:value.wallpaper.id}
    : {type:'default',id:PHONE_WALLPAPERS.includes(value.wallpaper?.id) ? value.wallpaper.id : 'campus'};
  return {version:1,pages,dock,hiddenApps,installedApps,widgets:value.widgets?.includes('clock') ? ['clock'] : [],wallpaper,
    studentIdFace:value.studentIdFace === 'back' ? 'back' : 'front'};
}
export function movePhoneApp(preferences, id, target, appIds = PHONE_APP_IDS) {
  const next = normalizePhonePreferences(preferences,appIds);
  if (![...appIds,...next.installedApps,...next.pages.flat(),...next.dock,...next.hiddenApps].includes(id)) return next;
  const destination = target.area === 'dock' ? next.dock : next.pages[target.page];
  if (!destination || !Number.isInteger(target.slot) || target.slot < 0 || target.slot >= destination.length) return next;
  const all = [...next.pages,next.dock];
  const source = all.find(list=>list.includes(id)), index = source?.indexOf(id), replaced = destination[target.slot];
  if (source === destination && index === target.slot) return next;
  if (source) source[index] = replaced;
  destination[target.slot] = id; next.hiddenApps = next.hiddenApps.filter(x=>x!==id);
  return normalizePhonePreferences(next,appIds);
}
export function createPhonePreferences({ getStorage, getScope, getAppIds = () => PHONE_APP_IDS, onError = () => {} }) {
  const normalize=value=>normalizePhonePreferences(value,getAppIds());
  const move=(value,id,target)=>movePhoneApp(value,id,target,getAppIds());
  let value = defaultPhonePreferences(), dirty = false;
  const key = () => `inha-world-phone-home-v1:${getScope()}`;
  function load() {
    dirty=false;
    try { value = normalize(JSON.parse(getStorage()?.getItem(key()) || 'null')); }
    catch { value=defaultPhonePreferences(); onError('홈 배치를 불러오지 못했어요. 기본 배치를 표시해요.'); }
    return value;
  }
  function save() {
    if (!dirty) return true;
    try {
      const storage=getStorage(),serialized=JSON.stringify(value); if (!storage) throw Error('storage');
      storage.setItem(key(),serialized); if (storage.getItem(key())!==serialized) throw Error('readback'); dirty=false; return true;
    } catch { onError('홈 배치를 저장하지 못했어요. 현재 화면에만 적용했어요.'); return false; }
  }
  load();
  function commit(change) {
    const previous = JSON.parse(JSON.stringify(value)), wasDirty = dirty;
    if (!change()) return false;
    if (save()) return true;
    value = previous; dirty = wasDirty;
    // A storage implementation may write but fail readback. Restore best-effort.
    try { getStorage()?.setItem(key(), JSON.stringify(previous)); } catch {}
    return false;
  }
  return Object.freeze({load,save,commit,
    unpin(id) {
      if (!value.dock.includes(id)) return false;
      let page = value.pages.findIndex(slots=>slots.includes(null));
      if (page < 0) { page=value.pages.length; value.pages.push(Array(PHONE_PAGE_SLOTS).fill(null)); }
      value=move(value,id,{area:'home',page,slot:value.pages[page].indexOf(null)});dirty=true;return true;
    },snapshot:()=>normalize(value),
    move(id,target) {value=move(value,id,target);dirty=true;},
    wallpaper(wallpaper) {value=normalize({...value,wallpaper});dirty=true;},
    reset() {value=defaultPhonePreferences();dirty=true;},
    clock(show) {value.widgets=show ? ['clock'] : [];dirty=true;},
    face(side) {value.studentIdFace=side==='back'?'back':'front';dirty=true;},
    install(id) {
      if(!PHONE_INSTALLABLE_APP_IDS.includes(id))return false;
      if(value.installedApps.includes(id))return true;
      value=normalize({...value,installedApps:[...value.installedApps,id]});dirty=true;return true;
    },
    uninstall(id) {
      if(!PHONE_INSTALLABLE_APP_IDS.includes(id)||!value.installedApps.includes(id))return false;
      value=normalize({...value,
        installedApps:value.installedApps.filter(x=>x!==id),
        hiddenApps:value.hiddenApps.filter(x=>x!==id),
        dock:value.dock.map(x=>x===id?null:x),
        pages:value.pages.map(page=>page.map(x=>x===id?null:x))
      });dirty=true;return true;
    },
    hide(id) {
      if(id==='induck-store'||![...PHONE_SYSTEM_APP_IDS,...value.installedApps].includes(id)||value.hiddenApps.includes(id))return false;
      value=normalize({...value,hiddenApps:[...value.hiddenApps,id],
        dock:value.dock.map(x=>x===id?null:x),
        pages:value.pages.map(page=>page.map(x=>x===id?null:x))
      });dirty=true;return true;
    },
    show(id) {
      if(!value.hiddenApps.includes(id))return false;
      value=normalize({...value,hiddenApps:value.hiddenApps.filter(x=>x!==id)});
      dirty=true;return true;
    }
  });
}
