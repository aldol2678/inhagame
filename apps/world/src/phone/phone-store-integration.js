// INHA OS: finite, reviewed bridge between the Store catalog and the Phone Shell.
// Phone preferences are the sole authority for native availability and installed shortcuts.
import { PHONE_SYSTEM_APP_IDS, PHONE_INSTALLABLE_APP_IDS } from './phone-app-catalog.js';

export const STORE_PHONE_IDS=Object.freeze({
  store:'induck-store',map:'maps',camera:'camera',album:'album',
  'student-id':'student-id',settings:'settings',
  'daily-quiz':'daily-quiz',attendance:'attendance',learning:'learning',
  messages:'messages',notifications:'notifications',
  'induck-classic':'induck-classic',induckup:'induckup',
  'induck-survival':'induck-survival','induck-grow':'induck-grow'
});
const reverse=new Map(Object.entries(STORE_PHONE_IDS).map(([store,phone])=>[phone,store]));
const external=new Set(PHONE_INSTALLABLE_APP_IDS);
const native=new Set(PHONE_SYSTEM_APP_IDS);
export function phoneIdForStore(id){return Object.hasOwn(STORE_PHONE_IDS,id)?STORE_PHONE_IDS[id]:null;}
export function storeIdForPhone(id){return reverse.get(id)??null;}
export function phoneStoreSnapshot(preferences,registry) {
  const p=preferences.snapshot();
  const available=registry.filter(a=>a.available()).map(a=>storeIdForPhone(a.id)).filter(Boolean);
  const system=Object.entries(STORE_PHONE_IDS).filter(([,id])=>native.has(id)).map(([id])=>id);
  const installed=p.installedApps.map(id=>storeIdForPhone(id)).filter(Boolean);
  const hidden=p.hiddenApps.map(id=>storeIdForPhone(id)).filter(Boolean);
  const home=p.pages.flat().map(id=>storeIdForPhone(id)).filter(Boolean);
  const dock=p.dock.map(id=>storeIdForPhone(id)).filter(Boolean);
  return {systemIds:system,installedApps:installed,hiddenApps:hidden,
    availableIds:available,homeIds:home,dockIds:dock};
}
export function phoneStoreMutate(preferences,action,id) {
  const phoneId=phoneIdForStore(id);
  if(!phoneId)return false;
  if(action==='install')return external.has(phoneId)&&preferences.install(phoneId);
  if(action==='uninstall')return external.has(phoneId)&&preferences.uninstall(phoneId);
  if(action==='pin') {
    if(phoneId==='induck-store')return false;
    const state=preferences.snapshot();
    if(!native.has(phoneId)&&!state.installedApps.includes(phoneId))return false;
    return state.hiddenApps.includes(phoneId)?preferences.show(phoneId):preferences.hide(phoneId);
  }
  return false;
}
export function phoneStoreCanOpen(registry,preferences,id) {
  const appId=phoneIdForStore(id);
  if(!appId)return false;
  const app=registry.find(a=>a.id===appId);
  return !!app?.available() && (native.has(appId)||preferences.snapshot().installedApps.includes(appId));
}
