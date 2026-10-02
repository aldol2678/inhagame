import * as pc from "playcanvas";
import { loadWorldDocument } from "../runtime-adapter/load-world.js";
import { createPlayCanvasRuntimeContext, createSceneRegistries } from "../runtime-adapter/playcanvas-context.js";

function addWireSegment(parent, material, a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (length < 1e-6) return;
  const edge = new pc.Entity("Trigger wire");
  edge.addComponent("render", { type: "box" });
  edge.render.material = material;
  edge.setLocalPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  edge.setLocalScale(0.035, length, 0.035);
  const dx = (b[0] - a[0]) / length;
  const dy = (b[1] - a[1]) / length;
  const dz = (b[2] - a[2]) / length;
  const rotation = dy < -0.999999 ? new pc.Quat(1, 0, 0, 0) : new pc.Quat(dz, 0, -dx, 1 + dy).normalize();
  edge.setLocalRotation(rotation);
  parent.addChild(edge);
}

function addTriggerWire(parent, material, shape) {
  if (shape?.type === "sphere") {
    const radius = shape.radius;
    for (const plane of ["xy", "xz", "yz"]) {
      for (let index = 0; index < 24; index += 1) {
        const point = step => {
          const angle = step * Math.PI * 2 / 24;
          const a = Math.cos(angle) * radius;
          const b = Math.sin(angle) * radius;
          return plane === "xy" ? [a, b, 0] : plane === "xz" ? [a, 0, b] : [0, a, b];
        };
        addWireSegment(parent, material, point(index), point(index + 1));
      }
    }
    return;
  }
  const [x, y, z] = shape?.size?.map(value => value / 2) || [1, 1, 1];
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) addWireSegment(parent, material, [-x, sy * y, sz * z], [x, sy * y, sz * z]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addWireSegment(parent, material, [sx * x, -y, sz * z], [sx * x, y, sz * z]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) addWireSegment(parent, material, [sx * x, sy * y, -z], [sx * x, sy * y, z]);
}

export class EditorRuntimePreview {
  constructor(canvas, report, { resolveAssetUri = null, disposeAssetUris = null } = {}) {
    this.canvas = canvas;
    this.report = report;
    this.resolveAssetUri = resolveAssetUri;
    this.disposeAssetUris = disposeAssetUris;
    this.app = null;
    this.context = null;
    this.runtime = null;
    this.registries = createSceneRegistries();
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async start() {
    let timeout;
    const device = await Promise.race([
      pc.createGraphicsDevice(this.canvas, {
        deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
        powerPreference: "high-performance"
      }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("R_PREVIEW_GRAPHICS_TIMEOUT")), 10000); })
    ]).finally(() => clearTimeout(timeout));
    if (this.closed) { device.destroy(); return; }
    const options = new pc.AppOptions();
    options.graphicsDevice = device;
    options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
    options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
    const app = new pc.AppBase(this.canvas);
    app.init(options);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.setCanvasFillMode(pc.FILLMODE_NONE, this.canvas.parentElement.clientWidth, this.canvas.parentElement.clientHeight);
    app.scene.ambientLight = new pc.Color(0.48, 0.54, 0.61);
    app.scene.exposure = 1.05;
    app.start();
    this.app = app;

    const sun = new pc.Entity("Preview sun");
    sun.addComponent("light", { type: "directional", color: new pc.Color(1, 0.95, 0.84), intensity: 1.25, castShadows: true });
    sun.setEulerAngles(48, 35, 0);
    app.root.addChild(sun);
    const camera = new pc.Entity("Preview camera");
    camera.addComponent("camera", { clearColor: new pc.Color(0.08, 0.13, 0.18), fov: 62, nearClip: 0.1, farClip: 500 });
    camera.setPosition(0, 20, 28);
    camera.lookAt(0, 0, 0);
    app.root.addChild(camera);
    this.camera = camera;

    const frame = new pc.Entity("CampusCoordinateFrame");
    frame.setLocalScale(1, 1, -1);
    app.root.addChild(frame);
    const ground = new pc.Entity("Preview ground");
    ground.addComponent("render", { type: "box" });
    ground.setLocalPosition(0, -0.13, 0);
    ground.setLocalScale(80, 0.2, 80);
    const surface = new pc.StandardMaterial();
    surface.diffuse = new pc.Color(0.12, 0.2, 0.24);
    surface.update();
    ground.render.material = surface;
    app.root.addChild(ground);
    this.groundMaterial = surface;
    this.markerMaterials = {
      prop: new pc.StandardMaterial(),
      spawn: new pc.StandardMaterial(),
      trigger: new pc.StandardMaterial()
    };
    for (const [kind, color] of Object.entries({ prop: [0.55, 0.78, 0.96], spawn: [0.45, 0.92, 0.57], trigger: [0.96, 0.67, 0.3] })) {
      this.markerMaterials[kind].diffuse = new pc.Color(...color);
      this.markerMaterials[kind].update();
    }
    this.context = createPlayCanvasRuntimeContext({
      app, parent: frame, registries: this.registries, resolveAssetUri: this.resolveAssetUri
    });
    this.resize();
  }

  resize() {
    if (!this.app) return;
    const viewport = this.canvas.parentElement;
    this.app.resizeCanvas(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight));
  }

  refresh(document) {
    const snapshot = document.snapshot();
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (this.closed || !this.context) return;
      await this.runtime?.dispose();
      this.runtime = await loadWorldDocument(snapshot, this.context);
      for (const binding of this.runtime.bindings.values()) {
        if (!binding.source.enabled || binding.components.has("core.renderable") || binding.components.has("world.path") || binding.components.get("world.building")?.visual) continue;
        const kind = binding.components.has("game.spawn") ? "spawn" : binding.components.has("game.trigger") ? "trigger" : "prop";
        if (kind === "trigger") {
          addTriggerWire(binding.runtimeObject, this.markerMaterials.trigger, binding.source.components["game.trigger"].shape);
          continue;
        }
        const marker = new pc.Entity(`Editor marker:${binding.entityId}`);
        marker.addComponent("render", { type: kind === "spawn" ? "sphere" : "box" });
        marker.render.material = this.markerMaterials[kind];
        marker.setLocalScale(kind === "trigger" ? 1.2 : 0.8, kind === "trigger" ? 1.2 : 0.8, kind === "trigger" ? 1.2 : 0.8);
        marker.setLocalPosition(0, 0.5, 0);
        binding.runtimeObject.addChild(marker);
      }
      if (this.runtime.bindings.size) {
        const points = [...this.runtime.bindings.values()].map(binding => binding.runtimeObject.getPosition());
        const center = points.reduce((sum, point) => [sum[0] + point.x, sum[1] + point.y, sum[2] + point.z], [0, 0, 0]).map(value => value / points.length);
        const radius = Math.max(0, ...points.map(point => Math.hypot(point.x - center[0], point.z - center[2])));
        const masses = [...this.runtime.bindings.values()].map(binding => binding.source.components["world.building"]).filter(data => data?.footprint);
        const massRadius = Math.max(0, ...masses.flatMap(data => data.footprint.map(([x, z]) => Math.hypot(x, z) / 2)));
        const massHeight = Math.max(0, ...masses.map(data => data.heightMeters / 2));
        const distance = Math.max(9, radius * 2 + 5, Math.max(massRadius, massHeight) * 2 + 5);
        const targetY = center[1] + massHeight * 0.5;
        this.camera.setPosition(center[0] + distance * 0.5, targetY + distance * 0.8, center[2] + distance);
        this.camera.lookAt(center[0], targetY, center[2]);
      }
      const warnings = this.runtime.diagnostics.length;
      this.report(`${this.runtime.state} · ${this.runtime.bindings.size} entities · 진단 ${warnings}개`, this.runtime.diagnostics);
    });
    return this.queue;
  }

  async dispose() {
    this.closed = true;
    await this.queue.catch(() => {});
    await this.runtime?.dispose();
    this.context?.dispose();
    this.disposeAssetUris?.();
    this.groundMaterial?.destroy();
    for (const material of Object.values(this.markerMaterials ?? {})) material.destroy();
    this.app?.destroy();
    this.runtime = null;
    this.context = null;
    this.app = null;
    this.camera = null;
  }
}
