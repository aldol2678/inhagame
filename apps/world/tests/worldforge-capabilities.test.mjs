import test from "node:test";
import assert from "node:assert/strict";

const api = await import("../src/runtime-adapter/worldforge-capabilities.mjs").catch(error => {
  if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});

const validate = api.validateInhagameWorldForgeCandidate;
const EXTENSIONS = [
  "inhagame.audio",
  "inhagame.attribution",
  "inhagame.authority",
  "inhagame.building-mass",
  "inhagame.campus-object",
  "inhagame.claim-source",
  "inhagame.coordinates",
  "inhagame.db",
  "inhagame.delivery",
  "inhagame.event-registry",
  "inhagame.geometry",
  "inhagame.nav-edge",
  "inhagame.nav-node",
  "inhagame.navigation",
  "inhagame.navigation-junction",
  "inhagame.navigation-source",
  "inhagame.navigation-sync",
  "inhagame.objective",
  "inhagame.optimization",
  "inhagame.population",
  "inhagame.position",
  "inhagame.presence",
  "inhagame.provenance",
  "inhagame.quest",
  "inhagame.references",
  "inhagame.runtime",
  "inhagame.source",
  "inhagame.unlocated-places",
  "inhagame.worldforge"
].sort();

const RULE_TYPES = [
  "inhagame.activity-rule",
  "inhagame.event-access",
  "inhagame.event-lifecycle",
  "inhagame.event-owner-trigger",
  "inhagame.event-presentation",
  "inhagame.event-progress",
  "inhagame.event-registry",
  "inhagame.event-reward",
  "inhagame.event-window-authority",
  "inhagame.gameplay-rule",
  "inhagame.presentation-rule"
].sort();

const point = (x, z) => ({ x, y: 0, z });
const geometry = () => ({
  coordinateSpace: "world-local-meter",
  heightMeters: 21,
  metersPerWorldUnit: 2,
  footprints: [{
    sourceId: "bldg_01",
    rings: [[point(0, 0), point(4, 0), point(4, 6), point(0, 6), point(0, 0)]]
  }]
});
const legacyMass = () => ({
  adapterRequired: true,
  geometrySpace: "world-local-meter",
  heightMeters: 21,
  sourceBuildingId: "bldg_01",
  footprint: [point(0, 0), point(4, 0), point(4, 6), point(0, 6)]
});

test("WorldForge INHAGAME capability validator exports the complete current capability surface", () => {
  assert.equal(typeof validate, "function", "capability validator implementation must exist");
  assert.deepEqual(Object.keys(api.INHAGAME_WORLDFORGE_EXTENSION_CAPABILITIES ?? {}).sort(), EXTENSIONS);
  assert.deepEqual(Object.keys(api.INHAGAME_WORLDFORGE_RULE_CAPABILITIES ?? {}).sort(), RULE_TYPES);
});

test("known geometry is preview-safe while gameplay and activity rules remain external authority", { skip: typeof validate !== "function" }, () => {
  const candidate = {
    operations: [
      {
        op: "create", collection: "entities",
        object: {
          id: "entity-bldg_01", type: "inhagame.building-mass",
          extensions: {
            "inhagame.geometry": geometry(),
            "inhagame.source": { repository: "aldol2678/inhagame", file: "apps/world/data/reality/campus-buildings.json" }
          }
        }
      },
      {
        op: "create", collection: "rules",
        object: {
          id: "rule.life.fishing.first-active-skill", type: "inhagame.gameplay-rule",
          parameters: { skillId: "life.fishing", status: "ACTIVE" }
        }
      },
      {
        op: "create", collection: "rules",
        object: {
          id: "rule.activity.fishing.inkyung.f2", type: "inhagame.activity-rule",
          parameters: { activityId: "activity.fishing.inkyung", serverAuthoritative: true }
        }
      }
    ]
  };
  const result = validate(candidate);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.capabilities.find(item => item.name === "inhagame.geometry")?.mode, "preview-safe");
  assert.equal(result.capabilities.find(item => item.name === "inhagame.source")?.mode, "metadata-only");
  assert.deepEqual(
    result.capabilities.filter(item => item.kind === "rule").map(item => [item.name, item.mode]),
    [
      ["inhagame.gameplay-rule", "external-authority"],
      ["inhagame.activity-rule", "external-authority"]
    ]
  );
});

test("current base-world extensions and nested objective capabilities are covered", { skip: typeof validate !== "function" }, () => {
  const result = validate({
    world: {
      extensions: {
        "inhagame.attribution": { license: "ODbL-1.0" },
        "inhagame.coordinates": { metersPerWorldUnit: 2 },
        "inhagame.navigation-source": { productionGraphParity: false },
        "inhagame.unlocated-places": { spatiallyIncluded: false }
      }
    },
    operations: [
      {
        op: "update", collection: "entities", target: "entity-bldg_01",
        changes: { extensions: { "inhagame.building-mass": legacyMass() } }
      },
      {
        op: "create", collection: "quests",
        object: {
          id: "quest.preview", type: "core.quest",
          nodes: [{
            id: "start", type: "action.interact",
            extensions: { "inhagame.objective": { id: "start", type: "INTERACT", text: "Preview only" } }
          }],
          edges: []
        }
      }
    ]
  });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  const byName = new Map(result.capabilities.map(item => [item.name, item.mode]));
  assert.equal(byName.get("inhagame.attribution"), "metadata-only");
  assert.equal(byName.get("inhagame.coordinates"), "metadata-only");
  assert.equal(byName.get("inhagame.building-mass"), "preview-safe");
  assert.equal(byName.get("inhagame.objective"), "external-authority");
});

test("unknown INHAGAME capability fails closed before preview", { skip: typeof validate !== "function" }, () => {
  const result = validate({
    operations: [{
      op: "create", collection: "places",
      object: { id: "p1", type: "core.poi", extensions: { "inhagame.unregistered-runtime-hook": { enabled: true } } }
    }]
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue =>
    issue.severity === "ERROR" &&
    issue.code === "WF_CAPABILITY_UNSUPPORTED" &&
    issue.path === "operations[0].object.extensions.inhagame.unregistered-runtime-hook"
  ));
});

test("malformed building geometry is rejected instead of reaching Runtime Preview", { skip: typeof validate !== "function" }, () => {
  const broken = geometry();
  broken.footprints[0].rings[0][1].x = Number.NaN;
  const result = validate({
    operations: [{
      op: "create", collection: "entities",
      object: {
        id: "entity-broken", type: "inhagame.building-mass",
        extensions: { "inhagame.geometry": broken }
      }
    }]
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some(issue => issue.code === "WF_GEOMETRY_INVALID"));

  const brokenLegacy = legacyMass();
  brokenLegacy.footprint = [point(0, 0), point(1, 0)];
  const legacy = validate({
    operations: [{
      op: "update", collection: "entities", target: "entity-bldg_01",
      changes: { extensions: { "inhagame.building-mass": brokenLegacy } }
    }]
  });
  assert.equal(legacy.valid, false);
  assert.ok(legacy.issues.some(issue => issue.code === "WF_GEOMETRY_INVALID"));
});

test("non-INHAGAME extension stays preserved but outside this validator's authority", { skip: typeof validate !== "function" }, () => {
  const result = validate({
    operations: [{
      op: "create", collection: "places",
      object: { id: "p1", type: "core.poi", extensions: { "vendor.future": { keep: true } } }
    }]
  });
  assert.equal(result.valid, true);
  assert.ok(result.issues.some(issue =>
    issue.severity === "WARNING" &&
    issue.code === "WF_CAPABILITY_UNCHECKED"
  ));
});
