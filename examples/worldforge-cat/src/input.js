/** Input is bound only to the example, not to the headless engine core. */
export function createInput() {
  const keys = new Set(); const buttons = new Set();
  let run = false;
  const mapping = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  const textEditing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const handleKeyDown = ev => {
    if (textEditing()) return;
    if (ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') { if (!ev.repeat) toggleRun(); return; }
    if (mapping[ev.code]) { keys.add(mapping[ev.code]); ev.preventDefault(); }
  };
  const handleKeyUp = ev => { if (mapping[ev.code]) keys.delete(mapping[ev.code]); };
  const clear = () => { keys.clear(); buttons.clear(); };
  const runButton = document.querySelector('[data-key="run"]');
  const toggleRun = () => { run = !run; runButton?.classList.toggle('active', run); };
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', clear);
  const handlers = [];
  for (const button of document.querySelectorAll('#mobile button')) {
    const key = button.dataset.key;
    const down = ev => {
      ev.preventDefault();
      if (key === 'run') toggleRun();
      else { buttons.add(key); button.setPointerCapture(ev.pointerId); }
    };
    const up = () => buttons.delete(key);
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
    handlers.push(() => {
      button.removeEventListener('pointerdown', down);
      button.removeEventListener('pointerup', up);
      button.removeEventListener('pointercancel', up);
      button.removeEventListener('lostpointercapture', up);
    });
  }
  const pressed = key => keys.has(key) || buttons.has(key);
  return {
    get(name) {
      if (name === 'move.x') return Number(pressed('right')) - Number(pressed('left'));
      if (name === 'move.y') return Number(pressed('up')) - Number(pressed('down'));
      if (name === 'run.toggle') return run ? 1 : 0;
      return 0;
    },
    dispose() {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clear);
      handlers.forEach(fn => fn()); clear();
    }
  };
}
