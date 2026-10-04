import type * as z from "zod";
import { ChangeSetSchema, WorldManifestSchema } from "./schema.js";

export interface Diagnostic {
  severity: "ERROR" | "WARNING";
  code: string;
  path: string;
  detail?: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

const duplicateDiagnostics = (collection: string, values: Array<{ id: string }>): Diagnostic[] => {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      diagnostics.push({ severity: "ERROR", code: "E_DUPLICATE_ID", path: `${collection}[${index}].id`, detail: value.id });
    }
    seen.add(value.id);
  });
  return diagnostics;
};

const zodDiagnostics = (error: z.ZodError): Diagnostic[] => error.issues.map(issue => ({
  severity: "ERROR",
  code: "E_SCHEMA",
  path: issue.path.length ? issue.path.join(".") : "$",
  detail: issue.message
}));

export function validateWorldManifest(input: unknown): ValidationResult<z.infer<typeof WorldManifestSchema>> {
  const parsed = WorldManifestSchema.safeParse(input);
  if (!parsed.success) {
    const diagnostics = zodDiagnostics(parsed.error);
    return { valid: false, diagnostics, errors: diagnostics, warnings: [] };
  }

  const world = parsed.data;
  const diagnostics: Diagnostic[] = [];
  const collections = [
    ["assets", world.assets], ["zones", world.zones], ["places", world.places],
    ["paths", world.paths], ["entities", world.entities], ["npcs", world.npcs],
    ["quests", world.quests], ["events", world.events], ["rules", world.rules]
  ] as const;
  for (const [name, values] of collections) diagnostics.push(...duplicateDiagnostics(name, values));

  const assetIds = new Set(world.assets.map(value => value.id));
  const zoneIds = new Set(world.zones.map(value => value.id));
  const placeIds = new Set(world.places.map(value => value.id));
  const entityIds = new Set(world.entities.map(value => value.id));

  world.places.forEach((place, index) => {
    if (place.zoneId && !zoneIds.has(place.zoneId)) diagnostics.push({ severity: "ERROR", code: "E_ZONE_REF_NOT_FOUND", path: `places[${index}].zoneId`, detail: place.zoneId });
  });

  world.paths.forEach((path, index) => {
    if (path.from && !placeIds.has(path.from)) diagnostics.push({ severity: "ERROR", code: "E_PLACE_REF_NOT_FOUND", path: `paths[${index}].from`, detail: path.from });
    if (path.to && !placeIds.has(path.to)) diagnostics.push({ severity: "ERROR", code: "E_PLACE_REF_NOT_FOUND", path: `paths[${index}].to`, detail: path.to });
  });

  world.entities.forEach((entity, index) => {
    if (entity.parentId && !entityIds.has(entity.parentId)) diagnostics.push({ severity: "ERROR", code: "E_ENTITY_PARENT_NOT_FOUND", path: `entities[${index}].parentId`, detail: entity.parentId });
    if (entity.assetId && !assetIds.has(entity.assetId)) diagnostics.push({ severity: "ERROR", code: "E_ASSET_REF_NOT_FOUND", path: `entities[${index}].assetId`, detail: entity.assetId });
  });

  const entityById = new Map(world.entities.map(entity => [entity.id, entity]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      diagnostics.push({ severity: "ERROR", code: "E_ENTITY_PARENT_CYCLE", path: "entities", detail: id });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parentId = entityById.get(id)?.parentId;
    if (parentId && entityById.has(parentId)) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of entityById.keys()) visit(id);

  world.npcs.forEach((npc, index) => {
    if (npc.entityId && !entityIds.has(npc.entityId)) diagnostics.push({ severity: "ERROR", code: "E_NPC_ENTITY_REF_NOT_FOUND", path: `npcs[${index}].entityId`, detail: npc.entityId });
    if (npc.homePlaceId && !placeIds.has(npc.homePlaceId)) diagnostics.push({ severity: "ERROR", code: "E_NPC_HOME_REF_NOT_FOUND", path: `npcs[${index}].homePlaceId`, detail: npc.homePlaceId });
  });

  world.quests.forEach((quest, questIndex) => {
    diagnostics.push(...duplicateDiagnostics(`quests[${questIndex}].nodes`, quest.nodes));
    const nodeIds = new Set(quest.nodes.map(node => node.id));
    quest.edges.forEach((edge, edgeIndex) => {
      if (!nodeIds.has(edge.from)) diagnostics.push({ severity: "ERROR", code: "E_QUEST_NODE_REF_NOT_FOUND", path: `quests[${questIndex}].edges[${edgeIndex}].from`, detail: edge.from });
      if (!nodeIds.has(edge.to)) diagnostics.push({ severity: "ERROR", code: "E_QUEST_NODE_REF_NOT_FOUND", path: `quests[${questIndex}].edges[${edgeIndex}].to`, detail: edge.to });
    });
  });

  world.events.forEach((event, index) => {
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt);
    if (!Number.isFinite(start)) diagnostics.push({ severity: "ERROR", code: "E_EVENT_TIME_INVALID", path: `events[${index}].startsAt` });
    if (!Number.isFinite(end)) diagnostics.push({ severity: "ERROR", code: "E_EVENT_TIME_INVALID", path: `events[${index}].endsAt` });
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) diagnostics.push({ severity: "ERROR", code: "E_EVENT_WINDOW_INVALID", path: `events[${index}]` });
  });

  const errors = diagnostics.filter(item => item.severity === "ERROR");
  const warnings = diagnostics.filter(item => item.severity === "WARNING");
  return { valid: errors.length === 0, value: world, diagnostics, errors, warnings };
}

export function validateChangeSet(input: unknown): ValidationResult<z.infer<typeof ChangeSetSchema>> {
  const parsed = ChangeSetSchema.safeParse(input);
  if (!parsed.success) {
    const diagnostics = zodDiagnostics(parsed.error);
    return { valid: false, diagnostics, errors: diagnostics, warnings: [] };
  }
  const diagnostics: Diagnostic[] = [];
  parsed.data.operations.forEach((operation, index) => {
    if (operation.op === "delete" && operation.value !== undefined) diagnostics.push({ severity: "ERROR", code: "E_CHANGESET_DELETE_VALUE", path: `operations[${index}].value` });
    if (operation.op !== "delete" && operation.value === undefined) diagnostics.push({ severity: "ERROR", code: "E_CHANGESET_VALUE_REQUIRED", path: `operations[${index}].value` });
  });
  const errors = diagnostics.filter(item => item.severity === "ERROR");
  return { valid: errors.length === 0, value: parsed.data, diagnostics, errors, warnings: [] };
}
