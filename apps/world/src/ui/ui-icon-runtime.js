// UI-ICON-RUNTIME-01. Presentation only: no new handlers, RPCs or game authority.
export const UI_ICON_NAMES=Object.freeze([
 'album','attendance','camera','chat','collection','friends','help','inventory',
 'lock','map','mobility','notification','profile','quest','quiz','settings','shop','student-id','wardrobe'
]);
const ALIASES=Object.freeze({
 album:['🖼️','🖼'],attendance:['📅'],camera:['📷'],chat:['💬','✉️','✉'],
 collection:['📖'],friends:['👥'],help:['⌨️','⌨'],inventory:['🎒'],lock:['🔒'],
 map:['🗺️','🗺'],mobility:['🛞'],notification:['🔔'],profile:['🦆'],quest:['📜'],
 quiz:['📚'],settings:['⚙️','⚙'],shop:['🛍️','🛍'],'student-id':['🎓'],wardrobe:['👕']
});
// Approved UI icons are attached only to controls that already exist. Draft #357's
// future Messages Home slot is intentionally supported without modifying its source.
export const UI_ICON_TARGETS=Object.freeze([
 ['.smartphone-app[data-app-id="student-id"] .smartphone-app-icon','student-id','glyph'],
 ['.smartphone-app[data-app-id="maps"] .smartphone-app-icon','map','glyph'],
 ['.smartphone-app[data-app-id="camera"] .smartphone-app-icon','camera','glyph'],
 ['.smartphone-app[data-app-id="album"] .smartphone-app-icon','album','glyph'],
 ['.smartphone-app[data-app-id="settings"] .smartphone-app-icon','settings','glyph'],
 ['.smartphone-app[data-app-id="daily-quiz"] .smartphone-app-icon','quiz','glyph'],
 ['.smartphone-app[data-app-id="attendance"] .smartphone-app-icon','attendance','glyph'],
 ['.smartphone-app[data-app-id="messages"] .smartphone-app-icon','chat','glyph'],
 ['.smartphone-app[data-app-id="notifications"] .smartphone-app-icon','notification','glyph'],
 ['.smartphone-message:not(:empty)','notification','label'],
 ['#hud-menu #open-profile','profile','label'],
 ['#hud-menu #open-quest-journal','quest','label'],
 ['#hud-menu #open-shop','shop','label'],
 ['#hud-menu #open-inventory','inventory','label'],
 ['#hud-menu #open-mobility-book','mobility','label'],
 ['#hud-menu #open-wardrobe','wardrobe','label'],
 ['#hud-menu #open-daily-quiz','quiz','label'],
 ['#hud-menu #open-attendance','attendance','label'],
 ['#hud-menu #open-friends','friends','label'],
 ['#hud-menu #open-keyboard-help','help','label'],
 ['#hud-menu #open-settings','settings','label'],
 ['#nearby-toggle','friends','label'],
 ['#chat-toggle','chat','label'],
 ['#lobby-open-profile','profile','label'],
 ['#lobby-open-settings','settings','label'],
 ['#lobby-daily-attendance .world-lobby-daily-row-label','attendance','label'],
 ['#lobby-daily-quiz .world-lobby-daily-row-label','quiz','label'],
 ['#back-gate-locked .world-lobby-lock-icon','lock','glyph'],
 ['#back-gate-lock-dialog .world-lobby-lock-dialog-icon','lock','glyph'],
 ['#quest-hud .tour-flag','quest','glyph'],
 ['#keyboard-shortcuts-title','help','label'],
 ['#profile-title','profile','label'],
 ['#shop-world-label [data-shop-marker-icon]','shop','glyph'],
 ['#inventory-panel h2','collection','label','수집도감'],
 ['#inventory-panel h2','inventory','label','인벤토리']
].map(item=>Object.freeze(item)));

export function uiIconSource(name){
 if(!UI_ICON_NAMES.includes(name))return null;
 return new URL('../../assets/ui-icons/p0-v1/svg/'+name+'.svg',import.meta.url).href;
}
function visual(doc,name,fallback,mode){
 const root=doc.createElement('span');root.className='world-ui-icon';
 root.dataset.icon=name;root.dataset.mode=mode;root.dataset.state='loading';
 root.setAttribute('aria-hidden','true');
 const emoji=doc.createElement('span');emoji.className='world-ui-icon-fallback';emoji.textContent=fallback||ALIASES[name][0];
 const img=doc.createElement('img');img.className='world-ui-icon-image';img.alt='';img.width=24;img.height=24;img.decoding='async';img.hidden=true;img.draggable=false;
 img.addEventListener('load',()=>{img.hidden=false;emoji.hidden=true;root.dataset.state='ready';});
 img.addEventListener('error',()=>{img.hidden=true;emoji.hidden=false;root.dataset.state='fallback';});
 root.append(emoji,img);img.src=uiIconSource(name);return root;
}
function decorate(node,name,mode){
 // Dynamic controllers can replace textContent. Re-apply only after the visual is gone.
 if(node.querySelector(':scope > .world-ui-icon'))return;
 if(mode==='glyph'){
   const fallback=node.textContent.trim()||ALIASES[name][0];
   node.replaceChildren(visual(node.ownerDocument,name,fallback,mode));return;
 }
 let fallback=ALIASES[name][0];
 const first=Array.from(node.childNodes).find(child=>child.nodeType===3&&child.nodeValue.trim());
 if(first){
   const original=first.nodeValue;
   const token=ALIASES[name].find(alias=>original.trimStart().startsWith(alias));
   if(token){
     fallback=token;
     const spaces=original.length-original.trimStart().length;
     first.nodeValue=original.slice(0,spaces)+original.trimStart().slice(token.length).trimStart();
   }
 }
 node.prepend(visual(node.ownerDocument,name,fallback,mode));
}
export function refreshUiIcons(root){
 if(!root||(!root.querySelectorAll&&!root.matches))return;
 for(const [selector,name,mode,requiredText] of UI_ICON_TARGETS){
   const targets=[];
   if(root.nodeType===1&&root.matches(selector))targets.push(root);
   if(root.querySelectorAll)targets.push(...root.querySelectorAll(selector));
   for(const node of targets){
     if(requiredText&&!node.textContent.includes(requiredText))continue;
     if(name==='notification'&&!node.textContent.trim())continue;
     decorate(node,name,mode);
   }
 }
}
export function installUiIcons(doc=globalThis.document){
 if(!doc?.body||!doc.defaultView?.MutationObserver)return ()=>{};
 refreshUiIcons(doc);
 const observer=new doc.defaultView.MutationObserver(records=>{
   const changed=new Set();
   for(const record of records){
     if(record.target.nodeType===1)changed.add(record.target);
     for(const added of record.addedNodes)if(added.nodeType===1)changed.add(added);
   }
   for(const node of changed)if(node.isConnected)refreshUiIcons(node);
 });
 observer.observe(doc.body,{childList:true,subtree:true});
 return ()=>observer.disconnect();
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>installUiIcons(document),{once:true});
 else installUiIcons(document);
}
