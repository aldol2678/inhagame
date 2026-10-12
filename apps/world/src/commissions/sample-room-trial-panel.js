import { createSampleRoomTrial, SAMPLE_ROOM_ITEMS } from './sample-room-trial.js';
import { FURNITURE_BY_ID, FURNITURE_ERRORS, furnitureBox } from '../rooms/furniture-layout.js';
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC } from '../rooms/personal-room-layout.js';

export function createSampleRoomTrialPanel({ doc = document, getAccountId = () => null,
  onOpenChange = () => {}, isAvailable = () => false,
  loadPreview = () => import('./sample-room-trial-preview.js') } = {}) {
  const trial = createSampleRoomTrial();
  const panel = doc.createElement('section'); panel.id='sample-room-trial'; panel.className='furniture-editor';
  panel.hidden=true; panel.tabIndex=-1; panel.setAttribute('role','dialog'); panel.setAttribute('aria-modal','true'); panel.setAttribute('aria-label','책 펼칠 자리 · 샘플방 체험');
  const backdrop=doc.createElement('div'); backdrop.className='furniture-editor-backdrop'; backdrop.hidden=true;
  const intro=doc.createElement('div'), content=doc.createElement('div'), previewHost=doc.createElement('div');
  previewHost.setAttribute('aria-label','샘플방 3D 미리보기');
  panel.append(intro,previewHost,content); doc.body.append(backdrop,panel);
  let disposed=false, selected=null, previousFocus=null, preview=null, previewEpoch=0, notice='';
  const current=()=>!disposed&&!panel.hidden&&isAvailable()&&getAccountId()===trial.state().accountId;
  const node=(tag,text)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  const button=(label,action,disabled=false,key=label)=>{const el=node('button',label);el.type='button';el.disabled=disabled;el.dataset.focus=key;
    const generation=trial.state().generation;
    el.addEventListener('click',()=>{if(!current()||trial.state().generation!==generation)return;action();});return el;};
  function stopPreview() { previewEpoch++; preview?.destroy(); preview=null; previewHost.replaceChildren(); }
  async function startPreview() {
    stopPreview(); const epoch=previewEpoch;
    const canvas=node('div'); canvas.style.cssText='width:100%;height:220px;display:block;border-radius:12px;';
    canvas.setAttribute('aria-label','실제 방과 가구 렌더러로 보는 샘플 배치'); previewHost.append(canvas);
    const alive=()=>current()&&epoch===previewEpoch;
    try {
      const module=await loadPreview(); if(!alive())return;
      const created=await module.createSampleRoomPreview(canvas,{isCurrent:alive});
      if(!alive()){created?.destroy();return;}
      preview=created;preview?.setObjects(trial.state().objects);
    } catch { if(alive()){previewHost.replaceChildren(node('p','3D 미리보기를 불러오지 못했어요. 평면도에서 계속 체험할 수 있어요.'));} }
  }
  function close({restoreFocus=true}={}) {
    const wasOpen=!panel.hidden; panel.hidden=true;backdrop.hidden=true;trial.close();selected=null;notice='';stopPreview();intro.replaceChildren();content.replaceChildren();
    if(wasOpen)onOpenChange(false);
    if(wasOpen&&restoreFocus&&previousFocus?.isConnected)previousFocus.focus?.({preventScroll:true}); previousFocus=null;
  }
  const perform=action=>{if(!current()){close({restoreFocus:false});return;}const state=trial.state();action(state);notice='';render();};
  function move(dx,dz,rotation=0) {perform(s=>{const row=s.objects.find(o=>o.id===selected);if(row)trial.move(row.id,{x:row.x+dx,z:row.z+dz,yaw:row.yaw+rotation},s.accountId,s.generation);});}
  function render() {
    if(!current())return;
    const state=trial.state(), result=state.result, object=state.objects.find(row=>row.id===selected);
    const focus=panel.contains(doc.activeElement)?doc.activeElement?.dataset?.focus:null;
    intro.replaceChildren();content.replaceChildren();
    const header=node('header');header.append(node('h2','책 펼칠 자리'),button('닫기',()=>close()));intro.append(header);
    intro.append(node('p','물건이 많아 책상에 앉기 어려운 학생의 샘플방이에요. 가구를 옮기고 책을 정리해 주세요.'));
    intro.append(node('p','1단계 무보상 체험 · 개인 방과 별개예요. 제공 가구는 체험용이며, 닫으면 배치가 사라져요. 코인·경험치·스킬 포인트는 지급되지 않아요.'));
    const checks=node('ul');checks.setAttribute('aria-label','필수 조건');
    for(const [key,label]of [['route','문에서 책상 의자까지 걸어갈 동선'],['seat','책상 의자 옆에 앉고 일어날 여유'],['storage','책상 가까이(거리 3 이내) 둔 책장에 책 정리']])checks.append(node('li',`${result[key]?'✓':'○'} ${label}`));
    intro.append(checks);content.append(node('p','가구를 선택한 뒤 평면도를 누르거나 이동 버튼·방향키로 옮겨요. R 회전 · Delete 회수. 기본 책상과 침대는 고정이에요.'));
    const svg=(tag,attrs={})=>{const el=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
    const W=PERSONAL_ROOM_BASIC.halfWidth,D=PERSONAL_ROOM_BASIC.halfDepth;
    const map=svg('svg',{viewBox:`${-W} ${-D} ${W*2} ${D*2}`,role:'img','aria-label':'샘플방 가구 평면도'});map.style.cssText='width:100%;display:block;max-height:260px;aspect-ratio:1.7;background:#f5efe2;border:1px solid #9b8c72;';
    map.append(svg('rect',{x:-.9,y:2.25,width:1.8,height:1.95,fill:'#edc9a5'}));
    for(const item of PERSONAL_ROOM_BASIC_FURNITURE){map.append(svg('rect',{x:item.at[0]-item.size[0]/2,y:-item.at[2]-item.size[2]/2,width:item.size[0],height:item.size[2],fill:item.id==='chair'?'#e7bb60':'#b7a589',stroke:'#817059','stroke-width':.03}));}
    for(const row of state.objects){const b=furnitureBox(row);const rect=svg('rect',{x:b.minX,y:-b.maxZ,width:b.maxX-b.minX,height:b.maxZ-b.minZ,fill:row.id===selected?'#3679ba':'#559e78',stroke:row.id===selected?'#102a43':'#294a36','stroke-width':.06,'data-object-id':row.id});const title=svg('title');title.textContent=FURNITURE_BY_ID.get(row.itemId).name;rect.append(title);map.append(rect);}
    for(const[x,z,text]of [[0,-3.6,'문'],[2.95,1.7,'책상']]){const el=svg('text',{x,y:-z,'font-size':.3,'text-anchor':'middle','pointer-events':'none'});el.textContent=text;map.append(el);}
    map.addEventListener('click',event=>{
      if(!current()||trial.state().generation!==state.generation)return;
      const hit=event.target.closest?.('[data-object-id]');if(hit){selected=hit.dataset.objectId;render();return;}
      if(!object)return;const p=map.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const matrix=map.getScreenCTM();if(!matrix)return;const local=p.matrixTransform(matrix.inverse());
      perform(s=>trial.move(object.id,{x:local.x,z:-local.y},s.accountId,s.generation));
    });content.append(map);
    const label=node('label','배치한 가구 '),select=node('select');select.dataset.focus='selection';select.append(node('option','가구 선택'));select.firstChild.value='';
    for(const row of state.objects){const option=node('option',FURNITURE_BY_ID.get(row.itemId).name);option.value=row.id;select.append(option);}select.value=selected??'';
    select.addEventListener('change',()=>{if(current()&&trial.state().generation===state.generation){selected=select.value||null;render();}});label.append(select);content.append(label);
    const controls=node('div');controls.className='furniture-controls';
    for(const[text,dx,dz]of [['←',-.25,0],['↑',0,.25],['↓',0,-.25],['→',.25,0]]){const el=button(text,()=>move(dx,dz),!object);el.setAttribute('aria-label',`가구 이동 ${text}`);controls.append(el);}
    controls.append(button(`회전 ${object?.yaw??0}°`,()=>move(0,0,45),!object,'rotate'),button('회수',()=>perform(s=>{trial.edit(s.objects.filter(row=>row.id!==selected),s.accountId,s.generation);selected=null;}),!object));content.append(controls);
    const supply=node('div');supply.className='furniture-owned';
    for(const item of SAMPLE_ROOM_ITEMS)supply.append(button(`${FURNITURE_BY_ID.get(item.itemId).name} 추가`,()=>perform(s=>trial.add(item.itemId,s.accountId,s.generation)),state.objects.some(row=>row.id===item.id),`add-${item.itemId}`));
    content.append(supply,button('책장에 책 정리',()=>perform(s=>trial.storeBooks(s.accountId,s.generation)),!state.objects.some(row=>row.itemId==='furniture.dorm_bookshelf_slim')||state.booksStored));
    const status=node('p',result.error?FURNITURE_ERRORS[result.error]:notice||(state.checked?(result.complete?'체험 완료! 책을 펼칠 자리가 생겼어요. 보상은 없어요. 계속 수정해도 좋아요.':'아직 남은 조건이 있어요. 표시된 동선·의자·책장을 확인해 주세요.'):'한 가지 정답은 없어요. 조건을 보며 자유롭게 바꿔 보세요.'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');content.append(status);
    const footer=node('footer');footer.append(button('배치 확인',()=>perform(s=>trial.check(s.accountId,s.generation))),button('처음부터',()=>perform(s=>{trial.reset(s.accountId,s.generation);selected=null;startPreview();})));content.append(footer);
    preview?.setObjects(state.objects);
    if(focus){([...panel.querySelectorAll('[data-focus]')].find(el=>el.dataset.focus===focus&&!el.disabled)||panel.querySelector('button')).focus({preventScroll:true});}
  }
  const keydown=event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Tab'){const list=[...panel.querySelectorAll('button:not(:disabled),select:not(:disabled)')];if(!panel.contains(doc.activeElement)||doc.activeElement===panel||doc.activeElement===(event.shiftKey?list[0]:list.at(-1))){event.preventDefault();(event.shiftKey?list.at(-1):list[0])?.focus();}return;}
    if(['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName)||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
    const delta={ArrowLeft:[-.25,0],ArrowRight:[.25,0],ArrowUp:[0,.25],ArrowDown:[0,-.25]}[event.key];
    if(delta){event.preventDefault();move(...delta);}else if(event.key?.toLowerCase()==='r'){event.preventDefault();move(0,0,45);}else if(event.key==='Delete'){event.preventDefault();perform(s=>{trial.edit(s.objects.filter(row=>row.id!==selected),s.accountId,s.generation);selected=null;});}
  };
  panel.addEventListener('keydown',keydown);
  const stopPointer = event => event.stopPropagation();
  panel.addEventListener('pointerdown',stopPointer);
  backdrop.addEventListener('pointerdown',stopPointer);
  backdrop.addEventListener('click',event=>{event.stopPropagation();close();});
  const leave=()=>close({restoreFocus:false});doc.defaultView?.addEventListener('pagehide',leave);doc.defaultView?.addEventListener('popstate',leave);
  return {
    open({accountId=getAccountId()}={}) { if(disposed||!isAvailable()||accountId!==getAccountId())return false;if(!panel.hidden&&current())return true;
      if(!panel.hidden)close({restoreFocus:false});if(!trial.open(accountId))return false;previousFocus=doc.activeElement;panel.hidden=false;backdrop.hidden=false;onOpenChange(true);render();panel.querySelector('button')?.focus();void startPreview();return true; },
    close,
    update() { if(!panel.hidden&&!current())close({restoreFocus:false}); },
    destroy() { if(disposed)return;close({restoreFocus:false});disposed=true;doc.defaultView?.removeEventListener('pagehide',leave);doc.defaultView?.removeEventListener('popstate',leave);panel.remove();backdrop.remove(); },
    state:()=>({...trial.state(),open:!panel.hidden,preview:preview?.status?.()??null})
  };
}
