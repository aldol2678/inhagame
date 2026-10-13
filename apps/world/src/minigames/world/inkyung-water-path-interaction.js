// PA-G2B-R1 · Inkyung promenade water-path World adapter.
// Publishes one Context Action at a fixed promenade Anchor and runs the merged T0 water-path panel as a
// BLOCKING_UI session. Local only: no coins, EXP, items, Quest, Collection, ranking, account storage,
// Activity SourceRef or server call. Every session ends through end(), which always releases InputFocus.
import { POND_RING, edgeFrame, pondPromenadeCells } from '../../roadview-layout.js';
import { FACILITY_COLLIDERS } from '../../campus-facilities.js';
import { BUILDINGS } from '../../basic-campus.js';
import { polygonOverlap } from '../../polygon-collision.js';
import { mountWaterPathPanel } from '../games/water-path-view.js';

export const INKYUNG_WATER_PATH_ACTION_ID = 'inkyung-water-path';
export const INKYUNG_WATER_PATH_OWNER_ID = 'inkyung-water-path';
// World-local ids only. The puzzle itself is the unchanged PA-G2 `puzzle.water_path` definition.
export const INKYUNG_WATER_PATH_PUZZLE_LOCAL_ID = 'puzzle.water_path.inkyung_promenade_01';
export const INKYUNG_WATER_PATH_SEED = 'inkyung.promenade.01';
export const INKYUNG_WATER_PATH_RADIUS = 1.25;
// Below ordinary duck observation (200) and fishing (220), so shore actions always win near the pond.
export const INKYUNG_WATER_PATH_PRIORITY = 180;
const ANCHOR_EDGE = 1, ANCHOR_U = 38, ANCHOR_OUT = 6.8;
const SESSION_DRIFT_RADIUS = INKYUNG_WATER_PATH_RADIUS * 2;
const COLLIDER_CLEARANCE = 0.6;

export const WATER_PATH_BLOCK = Object.freeze({
  DISABLED: 'DISABLED', NO_CONTEXT: 'NO_CONTEXT', OUTSIDE_CAMPUS: 'OUTSIDE_CAMPUS', MOUNTED: 'MOUNTED',
  NOT_GROUNDED: 'NOT_GROUNDED', SWIMMING: 'SWIMMING', SEATED: 'SEATED', COMBAT: 'COMBAT',
  PHOTO_MODE: 'PHOTO_MODE', ROOM_TRANSITION: 'ROOM_TRANSITION', CINEMATIC: 'CINEMATIC',
  INPUT_BLOCKED: 'INPUT_BLOCKED', SESSION_ACTIVE: 'SESSION_ACTIVE', TOO_FAR: 'TOO_FAR',
  ANCHOR_INVALID: 'ANCHOR_INVALID'
});

let anchorCache = null;
export function inkyungWaterPathAnchor() {
  if (!anchorCache) {
    const point = edgeFrame(POND_RING, ANCHOR_EDGE).at(ANCHOR_U, ANCHOR_OUT);
    anchorCache = Object.freeze({ x: point.x, z: point.z });
  }
  return anchorCache;
}

// The Anchor is published only on a real walkable promenade cell that no collider or the pond covers.
export function isInkyungWaterPathAnchorWalkable(point = inkyungWaterPathAnchor(), {
  colliders = FACILITY_COLLIDERS, buildings = BUILDINGS, cells = pondPromenadeCells(), ring = POND_RING
} = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
  if (polygonOverlap(point.x, point.z, ring, 0)) return false;
  if (colliders.some(c => polygonOverlap(point.x, point.z, c.polygon, COLLIDER_CLEARANCE))) return false;
  if (buildings.some(b => polygonOverlap(point.x, point.z, b.vertices, COLLIDER_CLEARANCE))) return false;
  return cells.some(cell => polygonOverlap(point.x, point.z, cell, 0));
}

const distanceTo = (anchor, position) => Math.hypot(anchor.x - position.x, anchor.z - position.z);

// One rule set for the action AND the trigger. `ctx` is read live by the caller each time.
export function waterPathBlockReason(ctx, { anchor, anchorValid = true, radius = INKYUNG_WATER_PATH_RADIUS,
  sessionActive = false, ignoreInput = false, ignoreSession = false } = {}) {
  const p = ctx?.position;
  if (!ctx || !p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return WATER_PATH_BLOCK.NO_CONTEXT;
  if (ctx.insideRoom || ctx.inBiryong || ctx.lobbyActive || ctx.lobbyTransition) return WATER_PATH_BLOCK.OUTSIDE_CAMPUS;
  if (ctx.mounted) return WATER_PATH_BLOCK.MOUNTED;
  if (ctx.seated) return WATER_PATH_BLOCK.SEATED;
  if (ctx.swimming) return WATER_PATH_BLOCK.SWIMMING;
  if (!ctx.grounded) return WATER_PATH_BLOCK.NOT_GROUNDED;
  if (ctx.combat) return WATER_PATH_BLOCK.COMBAT;
  if (ctx.photoMode) return WATER_PATH_BLOCK.PHOTO_MODE;
  if (ctx.roomTransition) return WATER_PATH_BLOCK.ROOM_TRANSITION;
  if (ctx.cinematic) return WATER_PATH_BLOCK.CINEMATIC;
  if (!anchorValid) return WATER_PATH_BLOCK.ANCHOR_INVALID;
  if (!ignoreInput && ctx.worldAction !== true) return WATER_PATH_BLOCK.INPUT_BLOCKED;
  if (!ignoreSession && sessionActive) return WATER_PATH_BLOCK.SESSION_ACTIVE;
  if (distanceTo(anchor, p) > radius) return WATER_PATH_BLOCK.TOO_FAR;
  return null;
}

const END_STATUS = Object.freeze({
  CLEARED: '물길이 연결됐어요!', CANCELLED: '물길 연습을 종료했어요.'
});

export function createInkyungWaterPathInteraction({
  doc = globalThis.document, win = globalThis.window ?? null,
  focus, subscribeFocus = null, getContext, pauseAutoMove = null, onStatus = null,
  mountPanel = mountWaterPathPanel, anchor = inkyungWaterPathAnchor(),
  isAnchorWalkable = isInkyungWaterPathAnchorWalkable, enabled = true,
  seed = INKYUNG_WATER_PATH_SEED, size = 3, sizes = [3, 4], playCue = null
} = {}) {
  if (!doc?.createElement) throw new TypeError('Water path interaction requires a document');
  if (!focus || typeof focus.acquire !== 'function' || typeof focus.release !== 'function') {
    throw new TypeError('Water path interaction requires an InputFocus owner');
  }
  if (typeof getContext !== 'function') throw new TypeError('Water path interaction requires getContext');

  let anchorValid = null;
  const walkable = () => (anchorValid ??= Boolean(isAnchorWalkable(anchor)));
  let session = null, opening = false, destroyed = false;
  let lastEnd = null, opened = 0;

  const read = () => {
    try { return getContext() ?? null; } catch { return null; }
  };
  const reasonFor = (ctx, extra = {}) => destroyed || !enabled ? WATER_PATH_BLOCK.DISABLED
    : waterPathBlockReason(ctx, { anchor, anchorValid: walkable(), sessionActive: session !== null || opening, ...extra });
  const say = message => { try { onStatus?.(message); } catch { /* HUD problems never keep a session open */ } };

  function buildShell() {
    const section = doc.createElement('section');
    section.id = 'water-path-panel';
    section.className = 'profile-panel shop-panel water-path-panel';
    section.setAttribute('role', 'dialog');
    section.setAttribute('aria-modal', 'true');
    section.setAttribute('aria-labelledby', 'water-path-title');
    const head = doc.createElement('div');
    head.className = 'shop-panel-head';
    const titles = doc.createElement('div');
    titles.className = 'shop-panel-titles';
    const title = doc.createElement('h2');
    title.id = 'water-path-title';
    title.textContent = '💧 인경호 물길 퍼즐';
    const note = doc.createElement('p');
    note.className = 'shop-panel-level';
    note.textContent = '연습 · 보상과 저장 없음 · Esc로 닫기';
    titles.append(title, note);
    head.append(titles);
    const body = doc.createElement('div');
    body.className = 'shop-panel-body water-path-body';
    section.append(head, body);
    // Pointer input stays inside the panel; the World camera never sees it.
    section.addEventListener('pointerdown', event => event.stopPropagation());
    return { section, body };
  }

  function onDocKeydown(event) {
    if (!session || event.code !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    end('ESC');
  }
  function onViewportChange() { session?.panel?.restoreFocus?.(); }
  // A click on the dimmed World or on dead space inside the dialog drops focus to <body>; the dialog is
  // modal, so keyboard focus returns to it (a no-op while a panel control still holds focus).
  function onPointerUp() { session?.panel?.restoreFocus?.(); }

  // Idempotent. InputFocus is released in `finally`, whatever the panel teardown does.
  function end(reason, detail = null) {
    const current = session;
    if (!current) return false;
    session = null;
    try {
      doc.removeEventListener?.('keydown', onDocKeydown);
      doc.removeEventListener?.('pointerup', onPointerUp);
      win?.removeEventListener?.('resize', onViewportChange);
      win?.removeEventListener?.('orientationchange', onViewportChange);
      try { current.panel?.destroy(); } catch { /* a broken panel still releases input below */ }
      try { current.shell?.section.remove(); } catch { /* detached shell */ }
    } finally {
      focus.release();
      lastEnd = Object.freeze({ reason, result: current.result ?? null, error: detail ? String(detail?.message ?? detail) : null });
    }
    if (['CLOSE', 'ESC', 'CANCEL'].includes(reason) && read()?.worldAction === true) {
      // The Context Action button stays hidden until the next World update. A hidden
      // opener cannot receive focus, so return keyboard control to the visible canvas.
      const target = current.opener?.isConnected && !current.opener.hidden
        ? current.opener : doc.getElementById?.('application');
      if (target?.isConnected && !target.hidden) target.focus?.();
    }
    if (current.result && END_STATUS[current.result] && reason !== 'ERROR') say(END_STATUS[current.result]);
    else if (reason === 'ERROR') say('물길 퍼즐을 열지 못했어요.');
    return true;
  }

  // Re-checks the same conditions as contextAction(), reading the live context again.
  function open() {
    const ctx = read();
    const reason = reasonFor(ctx);
    if (reason) return false;
    try { pauseAutoMove?.(); } catch { /* auto move is advisory */ }
    opening = true;
    let shell = null;
    try {
      if (!focus.acquire()) throw new Error('Input focus already owned');
      shell = buildShell();
      const current = { shell, panel: null, result: null, opener: doc.activeElement };
      session = current;
      current.panel = mountPanel(shell.body, {
        size, seed, sizes,
        onCue: name => { try { playCue?.(name); } catch { /* optional sound */ } },
        onExit: ({ reason: code }) => end(code),
        onResult: ({ status }) => { current.result = status; },
        onError: error => end('ERROR', error)
      });
      (doc.body ?? doc.documentElement).append(shell.section);
      doc.addEventListener?.('keydown', onDocKeydown);
      doc.addEventListener?.('pointerup', onPointerUp);
      win?.addEventListener?.('resize', onViewportChange);
      win?.addEventListener?.('orientationchange', onViewportChange);
      current.panel.restoreFocus?.();
      opened += 1;
      return true;
    } catch (error) {
      if (session) end('ERROR', error);
      else { try { shell?.section.remove(); } catch { /* not attached */ } focus.release(); lastEnd = Object.freeze({ reason: 'ERROR', result: null, error: String(error?.message ?? error) }); }
      say('물길 퍼즐을 열지 못했어요.');
      return false;
    } finally {
      opening = false;
    }
  }

  const unsubscribe = typeof subscribeFocus === 'function' ? subscribeFocus(snapshot => {
    if (!session || opening) return;
    const owners = snapshot?.topOwners ?? [];
    if (!owners.includes(INKYUNG_WATER_PATH_OWNER_ID) || owners.some(id => id !== INKYUNG_WATER_PATH_OWNER_ID)) {
      end('FOCUS_LOST');
    }
  }) : null;

  return {
    // The shared F slot / mobile Context button action, or null when any condition fails.
    contextAction(position = null) {
      const live = read();
      const ctx = live && position ? { ...live, position } : live;
      if (reasonFor(ctx)) return null;
      return {
        id: INKYUNG_WATER_PATH_ACTION_ID, icon: '💧', label: '물길 퍼즐 연습', compactLabel: '물길 퍼즐',
        shortcut: 'F', priority: INKYUNG_WATER_PATH_PRIORITY, distance: distanceTo(anchor, ctx.position),
        pressed: false, trigger: () => open()
      };
    },
    open,
    // Per frame while a session runs: leaving the safe state (zone change, modal, mount, drift) ends it.
    update() {
      if (!session) return;
      const ctx = read();
      const reason = reasonFor(ctx, { ignoreInput: true, ignoreSession: true, radius: SESSION_DRIFT_RADIUS });
      if (reason) end('INTERRUPTED:' + reason);
    },
    close(reason = 'CLOSE') { return end(reason); },
    // pagehide always discards the session (also for BFCache); pageshow never revives one.
    handlePageHide() { end('PAGEHIDE'); },
    handlePageShow({ persisted = false } = {}) {
      if (!persisted) return this.status();
      if (session) end('STALE');
      if (focus.active) focus.release();
      return this.status();
    },
    destroy() {
      if (destroyed) return;
      end('DESTROY');
      destroyed = true;
      unsubscribe?.();
    },
    get active() { return session !== null; },
    status() {
      const ctx = read();
      return Object.freeze({
        active: session !== null, focusActive: focus.active === true, opened,
        lastEnd, anchor, radius: INKYUNG_WATER_PATH_RADIUS, anchorWalkable: walkable(),
        blockedBy: ctx ? reasonFor(ctx) : WATER_PATH_BLOCK.NO_CONTEXT,
        panel: session?.panel ? { focusKey: session.panel.focusKey, status: session.panel.snapshot().status } : null
      });
    }
  };
}
