import * as z from "zod";
import { WORLD_MANIFEST_SCHEMA_VERSION, type WorldManifest } from "./schema.js";
import { validateWorldManifest } from "./validate.js";

const LegacyVec3 = z.tuple([z.number(), z.number(), z.number()]);
const LegacyQuat = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const LegacyJsonObject = z.record(z.string(), z.json());

export const InhaWorldDocumentV010Schema = z.object({
  schemaVersion: z.literal("0.1.0"),
  worldId: z.string().min(1),
  name: z.string().min(1),
  coordinateSystem: z.object({
    handedness: z.literal("right"),
    upAxis: z.literal("Y"),
    unit: z.literal("meter")
  }),
  assets: z.array(z.looseObject({
    id: z.string().min(1),
    type: z.enum(["model", "texture", "audio", "other"]),
    uri: z.string().min(1),
    metadata: LegacyJsonObject.optional()
  })),
  entities: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    enabled: z.boolean(),
    transform: z.object({ position: LegacyVec3, rotation: LegacyQuat, scale: LegacyVec3 }),
    tags: z.array(z.string()),
    components: z.record(z.string(), z.json()),
    metadata: LegacyJsonObject.optional()
  })),
  metadata: LegacyJsonObject.optional()
});

export type InhaWorldDocumentV010 = z.infer<typeof InhaWorldDocumentV010Schema>;

const normalizeType = (kind: string): string => {
  const safe = kind.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `inha.${safe || "entity"}`;
};

export function fromInhaWorldDocumentV010(input: unknown): WorldManifest {
  const source = InhaWorldDocumentV010Schema.parse(input);
  const paths = source.entities.flatMap(entity => {
    const component = entity.components["world.path"];
    if (!component || typeof component !== "object" || Array.isArray(component)) return [];
    const candidate = component as Record<string, unknown>;
    const points = Array.isArray(candidate.points) ? candidate.points : [];
    if (!points.every(point => Array.isArray(point) && point.length === 3 && point.every(value => typeof value === "number" && Number.isFinite(value)))) return [];
    const pathType = typeof candidate.pathType === "string" ? candidate.pathType : "custom";
    const widthMeters = typeof candidate.widthMeters === "number" && candidate.widthMeters > 0 ? candidate.widthMeters : undefined;
    return [{
      id: `legacy-path:${entity.id}`,
      name: entity.name,
      type: pathType === "walkway" ? "core.walkway" : pathType === "road" ? "core.road" : "core.path",
      points: points as [number, number, number][],
      modes: ["walk", "npc"] as ("walk" | "npc")[],
      oneWay: false,
      enabled: entity.enabled,
      ...(widthMeters === undefined ? {} : { widthMeters }),
      tags: entity.tags,
      metadata: { sourceEntityId: entity.id, legacyPathType: pathType }
    }];
  });

  const manifest: WorldManifest = {
    schemaVersion: WORLD_MANIFEST_SCHEMA_VERSION,
    project: {
      id: "inha-world",
      name: source.name,
      template: "campus",
      extensions: ["inhagame.worlddocument/0.1.0"]
    },
    world: {
      id: source.worldId,
      name: source.name,
      units: "meter",
      upAxis: "Y",
      handedness: "right"
    },
    assets: source.assets.map(asset => ({
      id: asset.id,
      type: asset.type,
      uri: asset.uri,
      ...(asset.metadata === undefined ? {} : { metadata: asset.metadata })
    })),
    zones: [],
    places: [],
    paths,
    entities: source.entities.map(entity => {
      const renderable = entity.components["core.renderable"];
      const assetId = renderable && typeof renderable === "object" && !Array.isArray(renderable) && typeof (renderable as Record<string, unknown>).assetId === "string"
        ? (renderable as Record<string, unknown>).assetId as string
        : undefined;
      return {
        id: entity.id,
        name: entity.name,
        type: normalizeType(entity.kind),
        parentId: entity.parentId,
        enabled: entity.enabled,
        transform: entity.transform,
        ...(assetId === undefined ? {} : { assetId }),
        tags: entity.tags,
        components: entity.components,
        metadata: {
          ...(entity.metadata ?? {}),
          legacyKind: entity.kind
        }
      };
    }),
    npcs: [],
    quests: [],
    events: [],
    rules: [],
    metadata: {
      legacySource: "INHA WORLD WorldDocument",
      legacySchemaVersion: source.schemaVersion
    }
  };

  const result = validateWorldManifest(manifest);
  if (!result.valid) throw new Error(`E_INHA_ADAPTER_OUTPUT_INVALID:${JSON.stringify(result.errors)}`);
  return manifest;
}
