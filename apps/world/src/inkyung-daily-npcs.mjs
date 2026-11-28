import { NPC_MODELS_GENERATED } from '../npc-factory/npc-model-refresh.mjs';
import { createDialogueIcon } from '../npc-factory/campus-dialogue-icons.mjs';
import * as pc from 'playcanvas';
import { roadviewGroundHeight } from './roadview-layout.js';
import { createInkyungDailyLayout } from './inkyung-daily-layout.mjs';
import { createScene, POSES } from './inkyung-daily-state.mjs';

const NAMES = { phone: '휴대폰을 보는 학생', call: '통화 중인 학생', bench: '벤치에서 쉬는 학생' };
const LINES = {
  phone: '앗, 미안해요. 지도 보느라 못 봤네요. 인경호 한 바퀴 도는 길 찾으세요?',
  call: '잠깐만, 다시 전화할게. 네, 무슨 일이세요?',
  bench: '여기 바람이 좋네요. 한 바퀴 돌고 잠깐 쉬기 좋아요.'
};
const SHORT_NAMES = { phone: '휴대폰', call: '통화', bench: '벤치' };
const FILES = { phone: 'phone-walk.glb', call: 'phone-call.glb', bench: 'bench-sit.glb' };
const ROLES = { phone: POSES.walk, call: POSES.call, bench: POSES.bench };
const MODEL_NAMES = { phone: 'INKYUNG-DAILY-PHONE', call: 'INKYUNG-DAILY-CALL', bench: 'INKYUNG-DAILY-BENCH' };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.z);

// Uses the host's one application, player and input authority. This layer has no
// storage, quest/account endpoints, keyboard movement listener or camera.
export function createInkyungDailyNpcs({
  app, root, getPlayerPosition, canInteract = () => true,
  onConversationChange = () => {}, document: doc = globalThis.document,
  loadAsset = url => new Promise((resolve, reject) => app.assets.loadFromUrl(url, 'container', (err, asset) => err ? reject(err) : resolve(asset)))
} = {}) {
  const layout = createInkyungDailyLayout();
  const simulation = createScene({ ...layout, walkSpeed: .27 });
  let dead = false, visible = false, blocked = false, loading = false, ready = false, failed = false;
  let layer = null, views = {}, panel = null, title = null, line = null, close = null, style = null;
  let talking = false, returnFocus = null, restorePending = null;
  const assets = new Set();
  const eligible = () => !dead && ready && visible && !blocked && canInteract() && finite(getPlayerPosition());
  const releaseAsset = asset => { if (!asset) return; try { asset.unload(); app.assets.remove(asset); } catch {} assets.delete(asset); };
  const restoreHostFocus = () => {
    if (!restorePending || talking) return;
    if (blocked || !visible || !restorePending.isConnected) { restorePending = null; return; }
    // The host unhides its contextual button during its next HUD refresh.
    if (!restorePending.hidden) { restorePending.focus?.({ preventScroll: true }); restorePending = null; }
  };
  const syncTalk = ({ restoreFocus = true } = {}) => {
    const who = simulation.activeTalk ?? simulation.pendingTalk;
    const next = Boolean(who);
    // Accessible text must exist before focus and must not be re-announced every frame.
    if (who && title) {
      const text = simulation.activeTalk ? LINES[who] : who === 'bench' ? '일어설 때까지 잠시 기다려 주세요.' : '잠시 멈추는 중이에요.';
      if (title.textContent !== NAMES[who]) title.textContent = NAMES[who];
      if (line.textContent !== text) line.textContent = text;
    }
    if (next !== talking) {
      talking = next;
      if (next) { returnFocus = doc?.activeElement; restorePending = null; }
      onConversationChange(next);
      if (panel) panel.hidden = !next;
      if (next) close?.focus();
      else restorePending = restoreFocus ? returnFocus : null;
    }
    restoreHostFocus();
  };
  function closeConversation({ restoreFocus = true } = {}) {
    const wasOpen = talking;
    if (!restoreFocus) restorePending = null;
    simulation.dismiss(); syncTalk({ restoreFocus });
    return wasOpen;
  }
  const onKey = event => {
    if (event.key === 'Escape' && talking) { event.preventDefault(); closeConversation(); }
  };
  function createPanel() {
    if (!doc) return;
    style = doc.createElement('style');
    style.textContent = `#inkyung-daily-overlay{position:fixed;inset:0;z-index:110;display:grid;place-items:center;box-sizing:border-box;padding:max(16px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left));background:#09252c33;touch-action:manipulation}#inkyung-daily-overlay[hidden]{display:none}#inkyung-daily-dialogue{box-sizing:border-box;width:min(420px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;overflow:hidden;padding:16px;background:#102c32f5;color:#f4faf9;border:1px solid #7db5b2;border-radius:14px;box-shadow:0 8px 28px #0007;font:16px/1.55 system-ui,sans-serif}#inkyung-daily-dialogue h2{flex:none;font-size:17px;margin:0 0 8px}#inkyung-daily-dialogue p{min-height:0;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;margin:0 0 12px;overflow-wrap:anywhere}#inkyung-daily-close{flex:none;align-self:flex-start;font:inherit;min-height:44px;padding:8px 16px;border:1px solid #9dd1c9;border-radius:8px;background:#24514f;color:inherit;white-space:nowrap;cursor:pointer}#inkyung-daily-close:focus-visible{outline:3px solid #f7dd85;outline-offset:2px}`;
    doc.head.appendChild(style);
    panel = doc.createElement('div'); panel.id = 'inkyung-daily-overlay'; panel.hidden = true;
    const dialog = doc.createElement('section'); dialog.id = 'inkyung-daily-dialogue';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'inkyung-daily-speaker'); dialog.setAttribute('aria-describedby', 'inkyung-daily-line');
    title = doc.createElement('h2'); title.id = 'inkyung-daily-speaker';
    line = doc.createElement('p'); line.id = 'inkyung-daily-line'; line.setAttribute('aria-live', 'polite');
    close = doc.createElement('button'); close.id = 'inkyung-daily-close'; close.type = 'button'; close.append(createDialogueIcon(doc, 'exit'), doc.createTextNode('대화 끝내기')); close.addEventListener('click', closeConversation);
    const head = doc.createElement('header');
    head.className = 'campus-dialogue-daily-heading';
    const stamp = doc.createElement('span'); stamp.className = 'campus-dialogue-kicker'; stamp.textContent = '인경호 · 캠퍼스 대화';
    head.append(stamp, title);
    const bubble = doc.createElement('div'); bubble.id = 'inkyung-daily-bubble'; bubble.appendChild(line);
    dialog.append(head, bubble, close); panel.appendChild(dialog);
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    panel.addEventListener('keydown', event => { if (event.key === 'Tab') { event.preventDefault(); close.focus(); } });
    doc.body.appendChild(panel); doc.addEventListener('keydown', onKey);
  }
  function makeView(id, asset) {
    const resource = asset.resource, entity = resource.instantiateRenderEntity();
    entity.name = MODEL_NAMES[id]; layer.addChild(entity); entity.setLocalScale(.5, .5, .5);
    const actor = simulation.actors[id];
    entity.setLocalPosition(actor.x, roadviewGroundHeight(actor.x, actor.z), actor.z); entity.setLocalEulerAngles(0, actor.yaw, 0);
    entity.addComponent('anim', { activate: true });
    const role = ROLES[id], tracks = [POSES.idle, role];
    entity.anim.loadStateGraph(new pc.AnimStateGraph({ layers: [{ name: 'Base', states: [{ name: 'START' }, ...tracks.map(name => ({ name, speed: 1, loop: name !== POSES.bench }))], transitions: [{ from: 'START', to: POSES.idle }] }], parameters: {} }));
    for (const name of tracks) {
      const track = resource.animations.find(a => a.resource?.name === name)?.resource;
      if (!track) throw new Error('Missing daily NPC animation: ' + name);
      entity.anim.assignAnimation(name, track, 'Base', 1, name !== POSES.bench);
    }
    if (id === 'bench') {
      const fixed = new pc.Entity('INKYUNG-DAILY-FIXED-BENCH'); layer.addChild(fixed);
      for (const name of ['Bench_Wood', 'Bench_Metal']) {
        const node = entity.findByName(name);
        if (!node) throw new Error('Missing daily NPC bench mesh');
        // Remove the host reflection before decomposing; world quaternion/scale
        // decomposition would mirror or shift the detached bench a second time.
        const relative = new pc.Mat4().mul2(new pc.Mat4().copy(layer.getWorldTransform()).invert(), node.getWorldTransform());
        const position = relative.getTranslation(), scale = relative.getScale();
        const rotation = new pc.Quat().setFromMat4(relative);
        node.reparent(fixed); node.setLocalPosition(position); node.setLocalRotation(rotation); node.setLocalScale(scale);
      }
    }
    return { entity, clip: null, phone: entity.findByName('slot_hand_prop_phone') };
  }
  function syncVisuals() {
    for (const [id, view] of Object.entries(views)) {
      const a = simulation.actors[id], e = view.entity, base = e.anim.baseLayer;
      e.setLocalPosition(a.x, roadviewGroundHeight(a.x, a.z), a.z); e.setLocalEulerAngles(0, a.yaw, 0);
      if (view.clip !== a.clip) {
        if (!view.clip || a.clip === POSES.bench) { base.play(a.clip); base.activeStateCurrentTime = 0; }
        else base.transition(a.clip, .23);
        view.clip = a.clip;
      }
      if (view.phone && (a.state !== 'dialogue' || !base.transitioning)) view.phone.enabled = a.state !== 'dialogue';
      e.anim.speed = id === 'phone' && a.clip === POSES.walk ? Math.max(.25, a.speed / .27) : 1;
    }
  }
  async function load() {
    if (dead || loading || ready || failed) return;
    loading = true;
    try {
      const loaded = await Promise.all(Object.entries(FILES).map(async ([id, file]) => {
        const original = new URL('../assets/npcs/inkyung-daily-v031/' + file, import.meta.url).href;
        let asset;
        if (NPC_MODELS_GENERATED) {
          const generated = new URL('../assets/npcs/refresh-72/' + file, import.meta.url).href;
          asset = await loadAsset(generated).catch(() => loadAsset(original));
        } else asset = await loadAsset(original);
        if (dead || failed) { releaseAsset(asset); return [id, null]; }
        assets.add(asset); return [id, asset];
      }));
      if (dead || failed) return;
      layer = new pc.Entity('INKYUNG-DAILY-AMBIENT'); root.addChild(layer);
      for (const [id, asset] of loaded) views[id] = makeView(id, asset);
      createPanel(); ready = true; layer.enabled = visible; syncVisuals();
    } catch {
      failed = true; ready = false; closeConversation(); layer?.destroy(); layer = null; views = {};
      for (const asset of [...assets]) releaseAsset(asset);
    } finally { loading = false; }
  }
  function destroy() {
    if (dead) return;
    dead = true; visible = false; closeConversation({ restoreFocus: false });
    app.off('destroy', destroy); doc?.removeEventListener('keydown', onKey);
    panel?.remove(); style?.remove(); layer?.destroy(); layer = null; views = {}; ready = false;
    for (const asset of [...assets]) releaseAsset(asset);
  }
  app.on('destroy', destroy);
  return Object.freeze({
    update(dt, { visible: allowed = true, blocked: inputBlocked = false } = {}) {
      if (dead) return;
      const p = getPlayerPosition();
      visible = Boolean(allowed && finite(p) && dist(p, layout.call) <= 45);
      blocked = Boolean(inputBlocked);
      if (!visible || blocked) { restorePending = null; if (talking) closeConversation({ restoreFocus: false }); }
      if (!ready) { if (visible && dist(p, layout.call) <= 32) void load(); return; }
      layer.enabled = visible;
      if (!visible) return;
      simulation.update(dt, p); syncVisuals(); syncTalk();
    },
    getContextAction() {
      if (!eligible() || talking) return null;
      const p = getPlayerPosition();
      const id = Object.keys(simulation.actors).sort((a, b) => dist(simulation.actors[a], p) - dist(simulation.actors[b], p))[0];
      const distance = dist(simulation.actors[id], p);
      if (distance > simulation.range) return null;
      return { id: 'inkyung-daily-' + id, icon: '💬', label: NAMES[id] + '에게 말 걸기', compactLabel: SHORT_NAMES[id] + ' · 대화', shortcut: 'F', priority: 250, distance,
        trigger() {
          // Captured id: an old button must never silently talk to a different NPC.
          if (!eligible() || talking || !simulation.interact(id, getPlayerPosition())) return false;
          syncTalk(); return true;
        }
      };
    },
    dialogueCameraSubject() {
      const id=simulation.activeTalk, view=views[id];
      if (!talking || !view) return null;
      const p=view.entity.getLocalPosition();
      return {id:'daily-'+id,x:p.x,y:p.y+.80,z:p.z};
    },
    closeConversation,
    isConversationOpen: () => talking,
    status: () => ({ ready, loading, failed, visible, activeTalk: simulation.activeTalk, pendingTalk: simulation.pendingTalk,
      actors: Object.fromEntries(Object.entries(simulation.actors).map(([id, a]) => [id, { ...a }])) }),
    destroy
  });
}
