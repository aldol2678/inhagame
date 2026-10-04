import * as pc from "playcanvas";
import { buildCampusFacilities } from "../facility-blockout.js";
import { buildCampusLandmarks } from "../campus-landmark-candidate-selector.js";
import { buildCampusTrees } from "../campus-grounds.js";
import { buildBackStreetDetails } from "../campus-road-blockout.js";
import { RenderChunkRegistry } from "../render-chunk-registry.js";

const finitePoint = value => value && Number.isFinite(value.x) && Number.isFinite(value.z);

function countEntities(root) {
  return 1 + root.children.reduce((sum, child) => sum + countEntities(child), 0);
}

export class PlaceScenePreview {
  constructor(canvas, report = () => {}) {
    if (!canvas) throw new TypeError("PlaceScenePreview canvas is required");
    this.canvas = canvas;
    this.report = report;
    this.app = null;
    this.camera = null;
    this.sun = null;
    this.campusRoot = null;
    this.placeRoot = null;
    this.groundMaterial = null;
    this.registry = null;
    this.place = null;
    this.renderedChunks = [];
    this.entitiesCreated = 0;
    this.closed = false;
  }

  async start() {
    if (this.app) return true;
    let timeout;
    const device = await Promise.race([
      pc.createGraphicsDevice(this.canvas, {
        deviceTypes: [pc.DEVICETYPE_WEBGPU, pc.DEVICETYPE_WEBGL2],
        powerPreference: "high-performance"
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("R_PLACE_PREVIEW_GRAPHICS_TIMEOUT")), 10000);
      })
    ]).finally(() => clearTimeout(timeout));

    if (this.closed) {
      device.destroy();
      return false;
    }

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

    const campusRoot = new pc.Entity("PlacePreviewCampusCoordinateFrame");
    campusRoot.setLocalScale(1, 1, -1);
    app.root.addChild(campusRoot);

    const sun = new pc.Entity("Place preview sun");
    sun.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 0.95, 0.84),
      intensity: 1.25,
      castShadows: true
    });
    sun.setEulerAngles(48, 35, 0);
    app.root.addChild(sun);

    const camera = new pc.Entity("Place preview camera");
    camera.addComponent("camera", {
      clearColor: new pc.Color(0.08, 0.13, 0.18),
      fov: 58,
      nearClip: 0.1,
      farClip: 700
    });
    app.root.addChild(camera);

    const groundMaterial = new pc.StandardMaterial();
    groundMaterial.diffuse = new pc.Color(0.13, 0.2, 0.19);
    groundMaterial.update();

    this.app = app;
    this.camera = camera;
    this.sun = sun;
    this.campusRoot = campusRoot;
    this.groundMaterial = groundMaterial;
    this.registry = new RenderChunkRegistry();

    app.start();
    this.resize();
    return true;
  }

  resize() {
    if (!this.app) return false;
    const viewport = this.canvas.parentElement;
    this.app.resizeCanvas(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight));
    return true;
  }

  clearPlace() {
    this.placeRoot?.destroy();
    this.placeRoot = null;
    this.place = null;
    this.renderedChunks = [];
    this.entitiesCreated = 0;
  }

  openPlace(place) {
    if (!this.app || !this.registry || !this.camera || !this.campusRoot) throw new Error("R_PLACE_PREVIEW_NOT_STARTED");
    if (!place?.id || !finitePoint(place.position)) throw new Error("R_PLACE_PREVIEW_TARGET_INVALID");

    this.clearPlace();
    this.place = place;

    const root = new pc.Entity(`PlacePreview:${place.id}`);
    this.campusRoot.addChild(root);
    this.placeRoot = root;

    const radius = Math.max(0, Number(place.previewRadius ?? 8));
    let chunks = this.registry.chunks.filter(chunk => this.registry.distance(place.position, chunk) <= radius);
    if (!chunks.length) {
      chunks = this.registry.chunks
        .slice()
        .sort((a, b) => this.registry.distance(place.position, a) - this.registry.distance(place.position, b))
        .slice(0, 1);
    }
    this.renderedChunks = chunks.map(chunk => chunk.id);

    const ground = new pc.Entity("Place preview ground");
    ground.addComponent("render", { type: "box" });
    ground.render.material = this.groundMaterial;
    ground.setLocalPosition(place.position.x, -0.14, place.position.z);
    ground.setLocalScale(72, 0.2, 72);
    root.addChild(ground);

    for (const chunk of chunks) {
      for (const tier of ["BASE", "NEAR", "DETAIL"]) {
        buildCampusFacilities(root, chunk.facilities, tier);
        buildCampusLandmarks(root, chunk.buildings, tier);
        buildBackStreetDetails(root, chunk.streetscape, tier);
      }
      buildCampusTrees(root, chunk.trees);
    }

    this.entitiesCreated = countEntities(root);

    const targetY = Number(place.previewCamera?.targetY ?? 7);
    const offset = Array.isArray(place.previewCamera?.offset) && place.previewCamera.offset.length === 3
      ? place.previewCamera.offset
      : [18, 16, 22];
    const [dx, dy, dz] = offset;
    this.camera.setPosition(
      place.position.x + Number(dx || 0),
      targetY + Number(dy || 0),
      -(place.position.z + Number(dz || 0))
    );
    this.camera.lookAt(place.position.x, targetY, -place.position.z);

    const zone = place.placeZoneId ? ` · ${place.placeZoneId}` : "";
    this.report(`${place.label || place.id} · ${place.id}${zone}`);
    return this.status();
  }

  status() {
    return Object.freeze({
      state: this.app ? "ready" : this.closed ? "closed" : "idle",
      placeId: this.place?.id ?? null,
      label: this.place?.label ?? null,
      placeZoneId: this.place?.placeZoneId ?? null,
      residentChunks: this.renderedChunks.length,
      entitiesCreated: this.entitiesCreated
    });
  }

  async dispose() {
    if (this.closed) return;
    this.closed = true;
    this.clearPlace();
    this.groundMaterial?.destroy();
    this.campusRoot?.destroy();
    this.sun?.destroy();
    this.camera?.destroy();
    this.app?.destroy();
    this.app = null;
    this.camera = null;
    this.sun = null;
    this.campusRoot = null;
    this.groundMaterial = null;
    this.registry = null;
  }
}
