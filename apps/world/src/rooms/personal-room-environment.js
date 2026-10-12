// Session-local controls. Consume the existing environment/world-time projection;
// never create a second clock, persistence record, or room broadcast.
import { PERSONAL_ROOM_BASIC } from './personal-room-layout.js';

export const PERSONAL_ROOM_CONTROLS = Object.freeze({
  light: Object.freeze({ x: .84, z: -PERSONAL_ROOM_BASIC.halfDepth + .30, radius: .72 }),
  curtain: Object.freeze({ x: .5, z: PERSONAL_ROOM_BASIC.halfDepth - .45, radius: 1.05 })
});
const clamp = (n, fallback = 0) => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
export function personalRoomLightingFrame({ artificialLightFactor = 0, clearColor = [.52,.71,.84] } = {}, { lightsOn = true, curtainOpen = 1 } = {}) {
  const daylight = 1 - clamp(artificialLightFactor);
  const transmission = .12 + .88 * clamp(curtainOpen);
  // Readable floor/exit at NIGHT, lights OFF, curtains CLOSED, including LOW.
  // This is ambient fill, not another light or shadow/render pass.
  const fill = .27 + .10 * daylight * transmission + (lightsOn ? .065 : 0);
  return {
    ambient: [fill * (1 + .04 * daylight), fill, fill * (1.06 - .1 * daylight)],
    intensity: lightsOn ? .7 : 0,
    diffuser: lightsOn ? .58 : 0,
    sky: [0,1,2].map(i => clamp(clearColor?.[i], [.52,.71,.84][i])),
    skyEmissive: .22 + .23 * daylight,
    hazeEmissive: .1 + .25 * daylight,
    daylight
  };
}

export function createPersonalRoomEnvironment({ getContext, applyFrame, setCurtainOpen, getOutdoor = () => ({}) } = {}) {
  let session = null, lightsOn = true, curtainsOpen = true, openness = 1, generation = 0;
  const status = () => Object.freeze({ active: session !== null, lightsOn, curtainsOpen, openness, generation });
  const current = () => getContext?.() ?? {};
  const key = c => c.active && c.sessionKey ? c.sessionKey : null;
  function reset() { session = null; lightsOn = true; curtainsOpen = true; openness = 1; generation++; setCurtainOpen?.(1); }
  function sync() {
    const next = key(current());
    if (session !== next) { reset(); session = next; }
    return session !== null;
  }
  function update(dt = 0) {
    if (!sync()) return false;
    const target = curtainsOpen ? 1 : 0;
    const c = current();
    const step = c.reducedMotion ? 1 : Math.max(0, Math.min(.1, Number(dt) || 0)) / .45;
    openness += Math.sign(target - openness) * Math.min(Math.abs(target - openness), step);
    setCurtainOpen?.(openness);
    applyFrame?.(personalRoomLightingFrame(getOutdoor(), { lightsOn, curtainOpen: openness }));
    return true;
  }
  function available(kind) {
    if (!sync()) return null;
    const c = current(), target = PERSONAL_ROOM_CONTROLS[kind];
    if (!target || c.blocked || c.grounded === false || c.mounted || c.seated || !c.position) return null;
    const distance = Math.hypot(c.position.x - target.x, c.position.z - target.z);
    return Number.isFinite(distance) && distance <= target.radius ? { c, distance } : null;
  }
  function contextAction() {
    for (const kind of ['light', 'curtain']) {
      const near = available(kind); if (!near) continue;
      const offeredGeneration = generation, offeredSession = session;
      return { id: `personal-room-${kind}`, icon: kind === 'light' ? '💡' : '🪟',
        label: kind === 'light' ? (lightsOn ? '천장 조명 끄기' : '천장 조명 켜기') : (curtainsOpen ? '커튼 닫기' : '커튼 열기'),
        // Equal to doors: nearest physical interaction wins, so exit remains accessible.
        priority: 150, distance: near.distance, pressed: kind === 'light' ? lightsOn : curtainsOpen,
        trigger() {
          if (!available(kind) || offeredGeneration !== generation || offeredSession !== session) return false;
          if (kind === 'light') lightsOn = !lightsOn; else curtainsOpen = !curtainsOpen;
          update(0); return true;
        }
      };
    }
    return null;
  }
  return Object.freeze({ update, contextAction, reset, status });
}
