const MODE = Object.freeze({
  PREVIEW_SAFE: "preview-safe",
  METADATA_ONLY: "metadata-only",
  EXTERNAL_AUTHORITY: "external-authority"
});

export const INHAGAME_WORLDFORGE_EXTENSION_CAPABILITIES = Object.freeze({
  "inhagame.audio": MODE.EXTERNAL_AUTHORITY,
  "inhagame.attribution": MODE.METADATA_ONLY,
  "inhagame.authority": MODE.METADATA_ONLY,
  "inhagame.building-mass": MODE.PREVIEW_SAFE,
  "inhagame.campus-object": MODE.METADATA_ONLY,
  "inhagame.claim-source": MODE.METADATA_ONLY,
  "inhagame.coordinates": MODE.METADATA_ONLY,
  "inhagame.db": MODE.EXTERNAL_AUTHORITY,
  "inhagame.delivery": MODE.METADATA_ONLY,
  "inhagame.event-registry": MODE.EXTERNAL_AUTHORITY,
  "inhagame.geometry": MODE.PREVIEW_SAFE,
  "inhagame.nav-edge": MODE.METADATA_ONLY,
  "inhagame.nav-node": MODE.METADATA_ONLY,
  "inhagame.navigation": MODE.METADATA_ONLY,
  "inhagame.navigation-junction": MODE.METADATA_ONLY,
  "inhagame.navigation-source": MODE.METADATA_ONLY,
  "inhagame.navigation-sync": MODE.METADATA_ONLY,
  "inhagame.objective": MODE.EXTERNAL_AUTHORITY,
  "inhagame.optimization": MODE.METADATA_ONLY,
  "inhagame.population": MODE.EXTERNAL_AUTHORITY,
  "inhagame.position": MODE.METADATA_ONLY,
  "inhagame.presence": MODE.EXTERNAL_AUTHORITY,
  "inhagame.provenance": MODE.METADATA_ONLY,
  "inhagame.quest": MODE.EXTERNAL_AUTHORITY,
  "inhagame.references": MODE.METADATA_ONLY,
  "inhagame.runtime": MODE.EXTERNAL_AUTHORITY,
  "inhagame.source": MODE.METADATA_ONLY,
  "inhagame.unlocated-places": MODE.METADATA_ONLY,
  "inhagame.worldforge": MODE.METADATA_ONLY
});

export const INHAGAME_WORLDFORGE_RULE_CAPABILITIES = Object.freeze({
  "inhagame.activity-rule": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-access": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-lifecycle": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-owner-trigger": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-presentation": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-progress": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-registry": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-reward": MODE.EXTERNAL_AUTHORITY,
  "inhagame.event-window-authority": MODE.EXTERNAL_AUTHORITY,
  "inhagame.gameplay-rule": MODE.EXTERNAL_AUTHORITY,
  "inhagame.presentation-rule": MODE.EXTERNAL_AUTHORITY
});

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);
const positive = value => finite(value) && value > 0;
const point = value => record(value) && finite(value.x) && finite(value.y) && finite(value.z);
const samePoint = (a, b) => point(a) && point(b) && a.x === b.x && a.y === b.y && a.z === b.z;

function ringIsValid(ring) {
  if (!Array.isArray(ring) || ring.length < 3 || !ring.every(point)) return false;
  const effective = ring.length > 3 && samePoint(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
  if (effective.length < 3) return false;
  return new Set(effective.map(item => `${item.x}:${item.y}:${item.z}`)).size >= 3;
}

function validateGeometry(value) {
  if (!record(value) || value.coordinateSpace !== "world-local-meter" ||
      !positive(value.heightMeters) || !positive(value.metersPerWorldUnit) ||
      !Array.isArray(value.footprints) || value.footprints.length === 0) return false;
  return value.footprints.every(footprint =>
    record(footprint) && Array.isArray(footprint.rings) && footprint.rings.length > 0 &&
    footprint.rings.every(ringIsValid)
  );
}

function validateLegacyBuildingMass(value) {
  return record(value) && value.geometrySpace === "world-local-meter" &&
    positive(value.heightMeters) && Array.isArray(value.footprint) && ringIsValid(value.footprint);
}

function validateExtensionPayload(name, value) {
  if (!record(value)) return false;
  if (name === "inhagame.geometry") return validateGeometry(value);
  if (name === "inhagame.building-mass") return validateLegacyBuildingMass(value);
  return true;
}

function diagnostic(issues, severity, code, path, detail) {
  issues.push(Object.freeze({ severity, code, path, ...(detail === undefined ? {} : { detail }) }));
}

function capability(capabilities, kind, name, mode, path) {
  capabilities.push(Object.freeze({ kind, name, mode, path }));
}

function inspectExtensions(value, path, issues, capabilities, active = new WeakSet()) {
  if (value === null || typeof value !== "object") return;
  if (active.has(value)) {
    diagnostic(issues, "ERROR", "WF_CAPABILITY_PAYLOAD_CYCLE", path);
    return;
  }
  active.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectExtensions(item, `${path}[${index}]`, issues, capabilities, active));
    active.delete(value);
    return;
  }

  if (record(value.extensions)) {
    for (const [name, payload] of Object.entries(value.extensions)) {
      const extensionPath = `${path}.extensions.${name}`;
      if (name.startsWith("inhagame.")) {
        const mode = INHAGAME_WORLDFORGE_EXTENSION_CAPABILITIES[name];
        if (!mode) {
          diagnostic(issues, "ERROR", "WF_CAPABILITY_UNSUPPORTED", extensionPath, name);
          continue;
        }
        capability(capabilities, "extension", name, mode, extensionPath);
        if (!validateExtensionPayload(name, payload)) {
          diagnostic(
            issues,
            "ERROR",
            name === "inhagame.geometry" || name === "inhagame.building-mass"
              ? "WF_GEOMETRY_INVALID"
              : "WF_CAPABILITY_PAYLOAD_INVALID",
            extensionPath,
            name
          );
        }
      } else {
        diagnostic(issues, "WARNING", "WF_CAPABILITY_UNCHECKED", extensionPath, name);
      }
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "extensions") continue;
    inspectExtensions(child, path === "$" ? key : `${path}.${key}`, issues, capabilities, active);
  }
  active.delete(value);
}

function inspectRule(collection, value, path, issues, capabilities) {
  if (collection !== "rules" || !record(value) || typeof value.type !== "string" || !value.type.startsWith("inhagame.")) return;
  const mode = INHAGAME_WORLDFORGE_RULE_CAPABILITIES[value.type];
  if (!mode) {
    diagnostic(issues, "ERROR", "WF_RULE_CAPABILITY_UNSUPPORTED", `${path}.type`, value.type);
    return;
  }
  capability(capabilities, "rule", value.type, mode, `${path}.type`);
}

export function validateInhagameWorldForgeCandidate(candidate) {
  const issues = [];
  const capabilities = [];
  if (!record(candidate)) {
    diagnostic(issues, "ERROR", "WF_CANDIDATE_INVALID", "$");
    return Object.freeze({ valid: false, issues: Object.freeze(issues), capabilities: Object.freeze(capabilities) });
  }

  inspectExtensions(candidate, "$", issues, capabilities);

  const operations = candidate.operations;
  if (operations !== undefined && !Array.isArray(operations)) {
    diagnostic(issues, "ERROR", "WF_OPERATIONS_INVALID", "operations");
  } else {
    for (const [index, operation] of (operations ?? []).entries()) {
      if (!record(operation) || operation.op === "delete") continue;
      const field = operation.op === "update" ? "changes" : "object";
      inspectRule(operation.collection, operation[field], `operations[${index}].${field}`, issues, capabilities);
    }
  }

  if (Array.isArray(candidate.rules)) {
    candidate.rules.forEach((rule, index) => inspectRule("rules", rule, `rules[${index}]`, issues, capabilities));
  }

  const valid = !issues.some(item => item.severity === "ERROR");
  return Object.freeze({
    valid,
    issues: Object.freeze(issues),
    capabilities: Object.freeze(capabilities)
  });
}
