import { bindResumeEntry } from "./lobby-resume.js";
import { WORLD_RESUME_SCOPE_GUEST } from "./world-resume.js";

export function attachWorldResumeAccountScope(world = globalThis.window?.__INHAGAME_P0__) {
  const store = world?.resumeStore;
  const online = world?.online;
  if (!store?.setScope || !online?.onIdentity) return false;
  if (store.__accountScopeAttached) return true;
  store.__accountScopeAttached = true;

  const refresh = () => {
    world.resumeEntry?.destroy?.();
    world.resumeEntry = bindResumeEntry({
      button: globalThis.document?.getElementById("resume-last-location"),
      locationElement: globalThis.document?.getElementById("resume-location"),
      ageElement: globalThis.document?.getElementById("resume-age"),
      resume: store.read(),
      player: world.player,
      orbit: world.orbit,
      lobbyWorld: world.lobbyWorld,
      transition: world.lobbyTransition
    });
  };

  online.onIdentity(identity => {
    // The notification is authoritative: stopSession clears identity before its session.
    const nextScope = identity?.userId ?? WORLD_RESUME_SCOPE_GUEST;
    if (store.setScope(nextScope).changed) refresh();
  });
  return true;
}

function watch() {
  if (attachWorldResumeAccountScope()) return;
  globalThis.requestAnimationFrame?.(watch);
}

if (globalThis.window && globalThis.document) watch();
