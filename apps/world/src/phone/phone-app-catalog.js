// INHA OS P0: trusted phone catalog. Entries are presentation/launch metadata only.
// An external shortcut is not a native install, shared login, reward, or remote code embed.
export const PHONE_SYSTEM_APPS = Object.freeze([
  {id:'student-id',name:'학생증',icon:'🎓',category:'campus'},
  {id:'maps',name:'지도',icon:'🗺️',category:'campus'},
  {id:'camera',name:'카메라',icon:'📷',category:'media'},
  {id:'album',name:'앨범',icon:'🖼️',category:'media'},
  {id:'settings',name:'설정',icon:'⚙️',category:'system'},
  {id:'daily-quiz',name:'오늘의 퀴즈',icon:'📚',category:'campus'},
  {id:'attendance',name:'출석부',icon:'📅',category:'campus'},
  {id:'messages',name:'메시지',icon:'💬',category:'social'},
  {id:'notifications',name:'알림센터',icon:'🔔',category:'system'},
  {id:'learning',name:'인덕캠퍼스',icon:'🦆',category:'campus'},
  {id:'induck-store',name:'인덕스토어',icon:'🛍️',category:'system'}
].map(app=>Object.freeze({...app,kind:'native',system:true,installable:false})));

export const PHONE_EXTERNAL_APPS = Object.freeze([
  {id:'induck-classic',name:'인하오리 Classic',icon:'🦆',category:'game',url:'https://duck.inhagame.app/'},
  {id:'induckup',name:'인덕업',icon:'📈',category:'game',url:'https://induckup.inhagame.app/'},
  {id:'induck-survival',name:'인덕 서바이벌',icon:'🛡️',category:'game',url:'https://survival.inhagame.app/'},
  {id:'induck-grow',name:'인덕이 키우기',icon:'🐣',category:'game',url:'https://grow.inhagame.app/'}
].map(app=>Object.freeze({...app,kind:'external',system:false,installable:true})));

export const PHONE_SYSTEM_APP_IDS = Object.freeze(PHONE_SYSTEM_APPS.map(app=>app.id));
export const PHONE_INSTALLABLE_APP_IDS = Object.freeze(PHONE_EXTERNAL_APPS.map(app=>app.id));
const externalById = new Map(PHONE_EXTERNAL_APPS.map(app=>[app.id,app]));
export function phoneExternalApp(id) { return externalById.get(id) ?? null; }

// No dynamic/remote catalog or URL is accepted. All routes are literals from the reviewed source.
export function createPhoneAppRegistry(nativeApps, installedApps = () => []) {
  const native = new Map(nativeApps.map(app=>[app.id,app]));
  return Object.freeze([
    ...PHONE_SYSTEM_APPS.map(meta=>Object.freeze({
      ...meta,...(native.get(meta.id)||{}),
      available:native.get(meta.id)?.available || (()=>meta.id!=='learning'),
      open:native.get(meta.id)?.open || (()=>{}),
      close:native.get(meta.id)?.close || (()=>{})
    })),
    ...PHONE_EXTERNAL_APPS.map(meta=>Object.freeze({
      ...meta,
      available:()=>installedApps().includes(meta.id),
      open(){},close(){}
    }))
  ]);
}
