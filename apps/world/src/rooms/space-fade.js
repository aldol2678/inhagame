// Shared campus-space fade. Await the switch (including recovery) and always remove the overlay.
// A generation prevents stale timers/animation frames from covering a newer or completed switch.
export function createSpaceFade({
  overlay, reducedMotion = { matches: false },
  requestFrame = callback => requestAnimationFrame(callback),
  setTimer = (callback, ms) => setTimeout(callback, ms)
}) {
  let generation = 0;
  return run => {
    const current = ++generation;
    if (!overlay || reducedMotion.matches) {
      if (overlay) { overlay.classList.remove("on"); overlay.hidden = true; }
      return run();
    }
    let active = true;
    overlay.hidden = false;
    const wait = ms => new Promise(resolve => setTimer(resolve, ms));
    try {
      requestFrame(() => { if (active && current === generation) overlay.classList.add("on"); });
    } catch (error) {
      active = false;
      overlay.classList.remove("on");
      overlay.hidden = true;
      throw error;
    }
    return wait(160).then(run).finally(() => {
      active = false;
      if (current !== generation) return;
      overlay.classList.remove("on");
      return wait(180).finally(() => { if (current === generation) overlay.hidden = true; });
    });
  };
}
