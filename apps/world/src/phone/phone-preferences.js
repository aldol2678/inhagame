export const PHONE_PAGE_SLOTS = 12;
export const PHONE_DOCK_SLOTS = 4;
export const PHONE_WALLPAPERS = Object.freeze(['campus', 'night', 'mint']);
export const PHONE_APP_IDS = Object.freeze(['student-id','maps','camera','album','settings']);
export function defaultPhonePreferences() {
  const page = Array(PHONE_PAGE_SLOTS).fill(null); ['student-id','album','settings'].forEach((id,i)=>{page[i]=id;});
  return { version:1, pages:[page], dock:['maps','camera',null,null], hiddenApps:[], widgets:['clock'], wallpaper:{type:'default',id:'campus'} };
}
export function normalizePhonePreferences(value, appIds = PHONE_APP_IDS) {
  if (!value || value.version !== 1) value = defaultPhonePreferences();
  const seen = new Set(), valid = new Set(appIds), take = id => { if (!valid.has(id) || seen.has(id)) return null; seen.add(id); return id; };
  const slots = (items,count) => Array.from({length:count},(_,i)=>take(items?.[i]));
  const dock = slots(value.dock,PHONE_DOCK_SLOTS);
  const pages = (Array.isArray(value.pages) && value.pages.length ? value.pages : [[]]).map(page=>slots(page,PHONE_PAGE_SLOTS));
  const hiddenApps = [...new Set(Array.isArray(value.hiddenApps) ? value.hiddenApps.filter(id=>valid.has(id)&&!seen.has(id)) : [])];
  for (const id of appIds) {
    if (seen.has(id)||hiddenApps.includes(id)) continue;
    let page = pages.find(x=>x.includes(null)); if (!page) { page=Array(PHONE_PAGE_SLOTS).fill(null); pages.push(page); }
    page[page.indexOf(null)] = id;
  }
  const wallpaper = value.wallpaper?.type === 'photo' && typeof value.wallpaper.id === 'string' ? {type:'photo',id:value.wallpaper.id}
    : {type:'default',id:PHONE_WALLPAPERS.includes(value.wallpaper?.id) ? value.wallpaper.id : 'campus'};
  return {version:1,pages,dock,hiddenApps,widgets:value.widgets?.includes('clock') ? ['clock'] : [],wallpaper};
}
export function movePhoneApp(preferences, id, target, appIds = PHONE_APP_IDS) {
  const next = normalizePhonePreferences(preferences,appIds);
  if (!appIds.includes(id)) return next;
  const destination = target.area === 'dock' ? next.dock : next.pages[target.page];
  if (!destination || !Number.isInteger(target.slot) || target.slot < 0 || target.slot >= destination.length) return next;
  const all = [...next.pages,next.dock];
  const source = all.find(list=>list.includes(id)), index = source?.indexOf(id), replaced = destination[target.slot];
  if (source === destination && index === target.slot) return next;
  if (source) source[index] = replaced;
  destination[target.slot] = id; next.hiddenApps = next.hiddenApps.filter(x=>x!==id);
  return normalizePhonePreferences(next,appIds);
}
export function createPhonePreferences({ getStorage, getScope, onError = () => {} }) {
  let value = defaultPhonePreferences();
  const key = () => `inha-world-phone-home-v1:${getScope()}`;
  function load() {
    try { value = normalizePhonePreferences(JSON.parse(getStorage()?.getItem(key()) || 'null')); }
    catch { value=defaultPhonePreferences(); onError('홈 배치를 불러오지 못했어요. 기본 배치를 표시해요.'); }
    return value;
  }
  function save() {
    try {
      const storage=getStorage(),serialized=JSON.stringify(value); if (!storage) throw Error('storage');
      storage.setItem(key(),serialized); if (storage.getItem(key())!==serialized) throw Error('readback'); return true;
    } catch { onError('홈 배치를 저장하지 못했어요. 현재 화면에만 적용했어요.'); return false; }
  }
  load();
  return Object.freeze({load,save,snapshot:()=>normalizePhonePreferences(value),
    move(id,target) {value=movePhoneApp(value,id,target);},
    wallpaper(wallpaper) {value=normalizePhonePreferences({...value,wallpaper});},
    reset() {value=defaultPhonePreferences();},
    clock(show) {value.widgets=show ? ['clock'] : [];}
  });
}
