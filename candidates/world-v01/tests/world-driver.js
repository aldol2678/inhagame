// Browser-harness clock. UI, event handlers, physics and WebGL rendering all run.
// Ordinary RAF consumers (Playwright, screenshots) always use the wall clock.
(() => {
  const native = window.requestAnimationFrame.bind(window);
  let held = false,
    next = null,
    clock = 0;
  const samples = [];
  window.requestAnimationFrame = function (cb) {
    if (cb.name !== 'tick') return native(cb);
    if (held) {
      next = cb;
      return 0;
    }
    return native((ts) => {
      if (held) {
        next = cb;
        return;
      }
      clock = ts;
      samples.push(ts);
      cb(ts);
    });
  };
  window.worldTest = {
    hold() {
      held = true;
    },
    ready() {
      return !!next;
    },
    advance(count, seconds) {
      if (!next) throw Error('Game frame not pending');
      for (let i = 0; i < count; i++) {
        const cb = next;
        next = null;
        clock += seconds * 1000;
        cb(clock);
      }
    },
    times() {
      return [...samples];
    },
  };
})();
