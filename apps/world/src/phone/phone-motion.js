// Visual-only transitions: never retain an outgoing app, iframe, or input owner.
export function phoneGesture({ state, handle, dx, dy }) {
  if (state === 'HOME' && !handle && Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.4) return dx < 0 ? 'next' : 'previous';
  if (state === 'HOME' && handle === 'open' && dy >= 44 && dy > Math.abs(dx) * 1.4) return 'notifications';
  if (state === 'APP' && handle === 'close' && dy <= -44 && -dy > Math.abs(dx) * 1.4) return 'dismiss';
  return null;
}
export function createPhoneMotion({ win }) {
  const active = new Set(), media = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  function cancel() { for (const animation of active) animation.cancel(); active.clear(); }
  function play(node, frames, duration = 230) {
    if (media?.matches || !node?.animate) return Promise.resolve();
    const animation = node.animate(frames, { duration, easing:'cubic-bezier(.2,.8,.2,1)' });
    active.add(animation);
    return animation.finished.catch(()=>{}).finally(()=>active.delete(animation));
  }
  media?.addEventListener?.('change',cancel);
  return { play, cancel, destroy() { cancel(); media?.removeEventListener?.('change',cancel); } };
}
