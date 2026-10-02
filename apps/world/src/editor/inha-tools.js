import { validateSplineControls } from "./path-spline.js";

const TOOLS = new Set(["select", "building", "structure", "path", "spawn", "trigger"]);
const identity = () => ({ rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const finitePoint = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

export function projectGround(point) {
  return { left: 50 + (point[0] - point[2] * 0.35) * 1.4, top: 50 - point[2] * 0.75 * 1.4 };
}

export function groundFromViewport(clientX, clientY, bounds) {
  const screenX = ((clientX - bounds.left) / bounds.width * 100 - 50) / 1.4;
  const screenY = ((clientY - bounds.top) / bounds.height * 100 - 50) / 1.4;
  const z = -screenY / 0.75;
  return [Number((screenX + z * 0.35).toFixed(3)), 0, Number(z.toFixed(3))];
}

function positive(value, code) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(code);
  return number;
}

function nonempty(value, code) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(code);
  return text;
}

export class InhaToolSession {
  constructor(getWorld, getCommands) {
    this.getWorld = getWorld;
    this.getCommands = getCommands;
    this.activeTool = "select";
    this.options = {
      assetId: "", areaId: "", structureSize: [2, 1, 2], structureColor: "#b8b8ad",
      pathType: "walkway", widthMeters: 2, pathInterpolation: "linear",
      spawnType: "player", spawnRefId: "", spawnRadiusMeters: 1,
      triggerType: "quest", triggerRefId: "", triggerShape: "box",
      triggerSize: [2, 2, 2], triggerRadius: 2
    };
    this.points = [];
    this.hoverPoint = null;
    this.diagnostics = [];
  }

  activate(tool) {
    if (!TOOLS.has(tool)) throw new Error(`E_INHA_TOOL_UNKNOWN:${tool}`);
    this.cancel();
    this.activeTool = tool;
  }

  setOption(key, value) {
    if (!(key in this.options)) throw new Error(`E_INHA_OPTION_UNKNOWN:${key}`);
    this.options[key] = value;
    this.diagnostics = [];
  }

  hover(point) {
    this.hoverPoint = finitePoint(point) ? [...point] : null;
  }

  cancel() {
    this.points = [];
    this.hoverPoint = null;
    this.diagnostics = [];
  }

  backspace() {
    if (this.activeTool !== "path" || !this.points.length) return false;
    this.points.pop();
    this.diagnostics = [];
    return true;
  }

  get draft() {
    return { points: this.points.map(point => [...point]), hoverPoint: this.hoverPoint && [...this.hoverPoint] };
  }

  get valid() {
    if (this.activeTool === "path") return this.points.length >= (this.options.pathInterpolation === "catmull-rom" ? 3 : 2);
    return this.activeTool !== "select" && Boolean(this.hoverPoint);
  }

  place(point) {
    if (!finitePoint(point)) throw new Error("E_TOOL_GROUND_POINT_INVALID");
    if (this.activeTool === "select") return null;
    if (this.activeTool === "path") {
      const previous = this.points.at(-1);
      if (!previous || previous[0] !== point[0] || previous[2] !== point[2]) this.points.push([...point]);
      this.diagnostics = [];
      return null;
    }
    return this._commit(point);
  }

  commitPath() {
    if (this.activeTool !== "path") return null;
    if (this.points.length < 2) {
      this.diagnostics = ["E_PATH_POINTS_INVALID"];
      throw new Error("E_PATH_POINTS_INVALID");
    }
    if (this.options.pathInterpolation === "catmull-rom") validateSplineControls(this.points);
    else if (this.options.pathInterpolation !== "linear") throw new Error("E_PATH_INTERPOLATION_INVALID");
    const first = this.points[0];
    const points = this.points.map(point => [
      Number((point[0] - first[0]).toFixed(3)),
      Number((point[1] - first[1]).toFixed(3)),
      Number((point[2] - first[2]).toFixed(3))
    ]);
    const entity = this._commit(first, { "world.path": {
      pathType: this.options.pathType,
      points,
      widthMeters: positive(this.options.widthMeters, "E_PATH_WIDTH_INVALID"),
      closed: false,
      ...(this.options.pathInterpolation === "catmull-rom" ? { interpolation: "catmull-rom" } : {})
    } });
    this.points = [];
    return entity;
  }

  _commit(point, pathComponents = null) {
    const tool = this.activeTool;
    const world = this.getWorld();
    const area = String(this.options.areaId || "editor").trim().replace(/[^A-Za-z0-9_-]/g, "-") || "editor";
    const kind = tool === "path" ? "path" : tool;
    const prefix = `entity.${area}.${kind}-`;
    let number = 1;
    while (world.hasEntity(prefix + String(number).padStart(3, "0"))) number += 1;
    const id = prefix + String(number).padStart(3, "0");
    const names = new Set(world.listEntities().map(entity => entity.name));
    let displayNumber = 1;
    while (names.has(`${kind[0].toUpperCase()}${kind.slice(1)} ${displayNumber}`)) displayNumber += 1;
    let components;
    if (tool === "building") {
      const assetId = nonempty(this.options.assetId, "E_BUILDING_ASSET_REQUIRED");
      if (!world.snapshot().assets.some(asset => asset.id === assetId && asset.type === "model")) throw new Error("E_BUILDING_MODEL_ASSET_NOT_FOUND");
      components = { "core.renderable": { assetId, visible: true }, "world.building": {} };
      if (String(this.options.areaId).trim()) components["inha.location"] = { areaId: String(this.options.areaId).trim() };
    } else if (tool === "structure") {
      const sizeMeters = this.options.structureSize.map(size => positive(size, "E_STRUCTURE_SIZE_INVALID"));
      const color = nonempty(this.options.structureColor, "E_STRUCTURE_COLOR_INVALID");
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("E_STRUCTURE_COLOR_INVALID");
      components = { "world.structure": { shape: "box", sizeMeters, color } };
    } else if (tool === "path") {
      components = pathComponents;
    } else if (tool === "spawn") {
      components = { "game.spawn": {
        spawnType: this.options.spawnType,
        refId: nonempty(this.options.spawnRefId, "E_SPAWN_REF_REQUIRED"),
        radiusMeters: positive(this.options.spawnRadiusMeters, "E_SPAWN_RADIUS_INVALID")
      } };
    } else if (tool === "trigger") {
      const shape = this.options.triggerShape === "sphere"
        ? { type: "sphere", radius: positive(this.options.triggerRadius, "E_TRIGGER_SHAPE_INVALID") }
        : { type: "box", size: this.options.triggerSize.map(size => positive(size, "E_TRIGGER_SHAPE_INVALID")) };
      components = { "game.trigger": {
        triggerType: this.options.triggerType,
        refId: nonempty(this.options.triggerRefId, "E_TRIGGER_REF_REQUIRED"),
        shape
      } };
    } else throw new Error("E_INHA_TOOL_INACTIVE");
    const candidate = {
      id, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${displayNumber}`, kind,
      transform: { position: [...point], ...identity() },
      tags: ["inha-editor"], components
    };
    try {
      const entity = this.getCommands().addEntity(candidate);
      this.diagnostics = [];
      return entity;
    } catch (error) {
      this.diagnostics = [error.message];
      throw error;
    }
  }
}
