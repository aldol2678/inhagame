import * as pc from 'playcanvas';
import { createPersonalRoomScene } from '../rooms/personal-room-renderer.js';

// A separate render-only room. Never mounted in the player's room transition or save client.
async function createFramePreview(canvas) {
  const isCurrent = () => !leaving;
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: false });
  if (!isCurrent()) { device.destroy(); return null; }
  let app, room, observer, disposed = false, frames = 0;
  try {
    app = new pc.Application(canvas, { graphicsDevice: device });
    room = createPersonalRoomScene(app); room.root.enabled = true;
    // A cutaway of this isolated preview only; gameplay shell and collision remain untouched.
    for (const name of ['ceiling','wall_south','wall_east']) {
      const shell = room.root.findByName(name); if (shell) shell.enabled = false;
    }
    app.scene.ambientLight = room.ambient;
    const camera = new pc.Entity('SampleRoomCamera');
    camera.addComponent('camera', { projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: 6.1, nearClip: .05, farClip: 100, clearColor: room.clearColor });
    app.root.addChild(camera); camera.setPosition(5.5,11,13); camera.lookAt(0,0,0);
    const resize = () => {
      if (disposed) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width)), height = Math.max(1, Math.round(rect.height));
      device.resizeCanvas(width,height); camera.camera.orthoHeight = Math.max(5.2, 8.2*height/width); app.renderNextFrame=true;
    };
    observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    app.on('postrender',()=>{frames++;}); app.start();
    return {
      setObjects(objects) { if (!disposed) room.ownedFurniture.setObjects(objects); },
      status: () => ({ disposed, frames, visuals: room.ownedFurniture.visualStatus(), vram: {...device._vram} }),
      destroy() { if (disposed) return; disposed=true; observer.disconnect(); room.onDeactivate(); room.root.destroy(); app.destroy(); }
    };
  } catch (error) {
    observer?.disconnect(); if (app) app.destroy(); else device.destroy(); throw error;
  }
}

let leaving = false, runtime = null;
window.addEventListener('pagehide', () => { leaving = true; runtime?.destroy(); runtime = null; });
createFramePreview(document.querySelector('canvas')).then(value => {
  if (leaving) { value?.destroy(); return null; }
  runtime = value; return value;
}).then(window.__SAMPLE_ROOM_PREVIEW_RESOLVE__, window.__SAMPLE_ROOM_PREVIEW_REJECT__);
