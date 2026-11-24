import * as pc from 'playcanvas';

/** Renderer port for WorldForge v0.1, deliberately independent of apps/world. */
export function createPlayCanvasRenderer(canvas, { followEntity = null } = {}) {
  if (!canvas) throw new TypeError('E_CANVAS_REQUIRED');
  let app = null;
  let device = null;
  let camera = null;
  let root = null;
  let backend = null;
  const nodes = new Map();
  const materials = new Map();
  const materialFor = hex => {
    const key = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#e5a85c';
    if (materials.has(key)) return materials.get(key);
    const rgb = key.slice(1);
    const color = new pc.Color(parseInt(rgb.slice(0, 2), 16) / 255, parseInt(rgb.slice(2, 4), 16) / 255, parseInt(rgb.slice(4, 6), 16) / 255);
    const material = new pc.StandardMaterial();
    material.diffuse = color;
    material.update();
    materials.set(key, material);
    return material;
  };
  return {
    get backend() { return backend; },
    async mount(manifest, { diagnose = () => {} } = {}) {
      if (app) throw new Error('E_RENDERER_ALREADY_MOUNTED');
      try {
        try {
          device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2], powerPreference: 'high-performance' });
          backend = device.isWebGPU ? 'webgpu' : 'webgl2';
        } catch (err) {
          diagnose('WARNING', 'W_WEBGPU_WEBGL_AUTO_FAILED', String(err));
          device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2] });
          backend = 'webgl2';
        }
        const options = new pc.AppOptions();
        options.graphicsDevice = device;
        options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
        options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
        app = new pc.AppBase(canvas);
        app.init(options);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);
        app.setCanvasFillMode(pc.FILLMODE_NONE, Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
        app.scene.ambientLight = new pc.Color(0.65, 0.68, 0.75);
        app.start();
        root = new pc.Entity('WorldForge Root');
        app.root.addChild(root);
        const light = new pc.Entity('Sun');
        light.addComponent('light', { type: 'directional', color: new pc.Color(1, 0.95, 0.85), intensity: 1.35, castShadows: false });
        light.setEulerAngles(45, 20, 0);
        root.addChild(light);
        camera = new pc.Entity('Camera');
        camera.addComponent('camera', { fov: 58, nearClip: 0.1, farClip: 400, clearColor: new pc.Color(0.55, 0.78, 0.91) });
        camera.setPosition(3.5, 3, 8);
        camera.lookAt(0, 0.6, 0);
        root.addChild(camera);
        for (const entity of manifest.entities) {
          const node = new pc.Entity(entity.name);
          node.enabled = entity.enabled !== false;
          node.setLocalPosition(...entity.transform.position);
          node.setLocalRotation(new pc.Quat(...entity.transform.rotation));
          node.setLocalScale(...entity.transform.scale);
          nodes.set(entity.id, node);
        }
        for (const entity of manifest.entities) {
          const node = nodes.get(entity.id);
          (nodes.get(entity.parentId) ?? root).addChild(node);
          if (entity.components?.['core.primitive']) {
            const primitive = entity.components['core.primitive'];
            if (!['box', 'sphere', 'cone', 'cylinder', 'capsule'].includes(primitive?.shape)) {
              diagnose('WARNING', 'W_PRIMITIVE_INVALID', entity.id);
            } else {
              const visual = new pc.Entity(`Primitive:${entity.id}`);
              visual.addComponent('render', { type: primitive.shape });
              visual.render.material = materialFor(primitive.color);
              node.addChild(visual);
            }
          }
          if (entity.components?.['core.renderable']) {
            diagnose('WARNING', 'W_ASSET_RENDER_PENDING', entity.id);
          }
        }
      } catch (err) {
        await this.dispose();
        throw err;
      }
    },
    setTransform(id, transform) {
      const node = nodes.get(id);
      if (!node) throw new Error(`E_RENDER_ENTITY_MISSING:${id}`);
      node.setLocalPosition(...transform.position);
      node.setLocalRotation(new pc.Quat(...transform.rotation));
      node.setLocalScale(...transform.scale);
    },
    frame(dt) {
      if (!camera || !followEntity) return;
      const target = nodes.get(followEntity);
      if (!target) return;
      const position = target.getPosition();
      const desired = new pc.Vec3(position.x + 3.2, position.y + 2.5, position.z + 6.5);
      const alpha = 1 - Math.exp(-4 * dt);
      camera.setPosition(camera.getPosition().clone().lerp(camera.getPosition(), desired, alpha));
      camera.lookAt(position.x, position.y + 0.25, position.z);
    },
    resize() {
      if (!app) return;
      app.resizeCanvas(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight));
    },
    async dispose() {
      nodes.clear();
      if (app) { app.destroy(); app = null; }
      else if (device) { device.destroy(); }
      device = null; root = null; camera = null; backend = null;
      for (const material of materials.values()) material.destroy();
      materials.clear();
    }
  };
}
