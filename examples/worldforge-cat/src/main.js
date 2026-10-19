import { validateWorldManifest } from '../../../packages/worldforge-schema/dist/index.js';
import { createEngine } from '../../../packages/worldforge-runtime-core/src/index.js';
import { createPlayCanvasRenderer } from '../../../packages/worldforge-renderer-playcanvas/src/index.js';
import manifest from './world.manifest.json';
import { createInput } from './input.js';

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const input = createInput();
const renderer = createPlayCanvasRenderer(canvas, { followEntity: 'cat' });
const movement = {
  fixedUpdate(ctx, dt) {
    const x = ctx.getAction('move.x');
    const z = ctx.getAction('move.y');
    if (!x && !z) return;
    const length = Math.hypot(x, z);
    const speed = ctx.getAction('run.toggle') ? 4.5 : 2.3;
    const dx = x / length; const dz = z / length;
    const entity = ctx.getEntity('cat');
    const position = [...entity.transform.position];
    position[0] = Math.max(-15, Math.min(15, position[0] + dx * speed * dt));
    position[2] = Math.max(-15, Math.min(15, position[2] + dz * speed * dt));
    const theta = Math.atan2(dx, dz);
    ctx.setTransform('cat', { ...entity.transform, position, rotation: [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)] });
  }
};
const engine = createEngine({ renderer, validateManifest: validateWorldManifest, systems: [movement] });
engine.setActionProvider(name => input.get(name));
const resize = () => renderer.resize();
window.addEventListener('resize', resize);
(async () => {
  const loaded = await engine.load(manifest);
  if (!loaded.ok) {
    status.textContent = '로드 실패: ' + loaded.diagnostics.map(d => d.code).join(', ');
    return;
  }
  engine.start();
  status.textContent = `엔진 실행 중 · ${renderer.backend} · ${manifest.entities.length} entities`;
  if (loaded.diagnostics.length) status.textContent += ` · 경고 ${loaded.diagnostics.length}`;
})().catch(error => { status.textContent = '실행 오류: ' + String(error); });
window.addEventListener('pagehide', () => {
  input.dispose(); window.removeEventListener('resize', resize); void engine.dispose();
}, { once: true });
