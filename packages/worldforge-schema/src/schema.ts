import * as z from "zod";

export const WORLD_MANIFEST_SCHEMA_VERSION = "worldforge/0.1" as const;
export const CHANGESET_SCHEMA_VERSION = "worldforge/changeset/0.1" as const;

export const IdSchema = z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
export const NamespacedTypeSchema = z.string().regex(/^[a-z][a-z0-9-]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$/);
export const Vec2Schema = z.tuple([z.number().finite(), z.number().finite()]);
export const Vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const QuatSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite()
]);
export const PositiveVec3Schema = z.tuple([
  z.number().finite().positive(),
  z.number().finite().positive(),
  z.number().finite().positive()
]);
export const JsonValueSchema = z.json();
export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const TransformSchema = z.object({
  position: Vec3Schema,
  rotation: QuatSchema,
  scale: PositiveVec3Schema
});

export const ProjectSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  template: z.string().min(1).optional(),
  extensions: z.array(z.string().min(1)).optional(),
  metadata: JsonObjectSchema.optional()
});

export const GeoAnchorSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  altitude: z.number().finite().optional()
});

export const WorldSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  units: z.literal("meter"),
  upAxis: z.literal("Y"),
  handedness: z.literal("right"),
  geoAnchor: GeoAnchorSchema.optional(),
  metadata: JsonObjectSchema.optional()
});

export const AssetSchema = z.object({
  id: IdSchema,
  type: z.enum(["model", "texture", "audio", "animation", "data", "other"]),
  uri: z.string().min(1),
  metadata: JsonObjectSchema.optional()
});

export const ZoneSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  type: NamespacedTypeSchema,
  geometry: z.object({
    type: z.literal("polygon"),
    space: z.literal("local"),
    points: z.array(Vec2Schema).min(3)
  }),
  tags: z.array(z.string()).optional(),
  metadata: JsonObjectSchema.optional()
});

export const PlaceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  type: NamespacedTypeSchema,
  zoneId: IdSchema.optional(),
  position: Vec3Schema,
  tags: z.array(z.string()).optional(),
  metadata: JsonObjectSchema.optional()
});

export const TravelModeSchema = z.enum(["walk", "vehicle", "wheelchair", "npc"]);
export const PathSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).optional(),
  type: NamespacedTypeSchema,
  from: IdSchema.optional(),
  to: IdSchema.optional(),
  points: z.array(Vec3Schema).min(2),
  modes: z.array(TravelModeSchema).min(1),
  oneWay: z.boolean(),
  enabled: z.boolean(),
  widthMeters: z.number().finite().positive().optional(),
  tags: z.array(z.string()).optional(),
  metadata: JsonObjectSchema.optional()
});

export const EntitySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  type: NamespacedTypeSchema,
  parentId: IdSchema.nullable(),
  enabled: z.boolean(),
  transform: TransformSchema,
  assetId: IdSchema.optional(),
  tags: z.array(z.string()),
  components: z.record(NamespacedTypeSchema, JsonValueSchema),
  metadata: JsonObjectSchema.optional()
});

export const ScheduleEntrySchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  action: z.string().min(1),
  target: IdSchema.optional(),
  params: JsonObjectSchema.optional()
});

export const NpcSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).optional(),
  entityId: IdSchema.optional(),
  profile: z.object({
    role: z.string().min(1).optional(),
    affiliation: z.string().min(1).optional(),
    attributes: JsonObjectSchema.optional()
  }),
  homePlaceId: IdSchema.optional(),
  schedule: z.array(ScheduleEntrySchema),
  behavior: z.object({
    movement: z.string().min(1).optional(),
    interaction: z.string().min(1).optional(),
    params: JsonObjectSchema.optional()
  }).optional(),
  metadata: JsonObjectSchema.optional()
});

export const QuestNodeSchema = z.object({
  id: IdSchema,
  type: NamespacedTypeSchema,
  params: JsonObjectSchema.optional()
});

export const QuestEdgeSchema = z.object({
  from: IdSchema,
  to: IdSchema,
  condition: JsonObjectSchema.optional()
});

export const QuestSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  type: NamespacedTypeSchema,
  nodes: z.array(QuestNodeSchema).min(1),
  edges: z.array(QuestEdgeSchema),
  metadata: JsonObjectSchema.optional()
});

export const EventOverrideSchema = z.object({
  operation: z.enum(["spawn", "update", "remove", "enable", "disable"]),
  targetType: NamespacedTypeSchema,
  targetId: IdSchema,
  payload: JsonValueSchema.optional()
});

export const EventSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  startsAt: z.string().min(1),
  endsAt: z.string().min(1),
  overrides: z.array(EventOverrideSchema),
  cleanup: z.object({
    mode: z.enum(["automatic", "manual"]),
    targets: z.array(IdSchema).optional()
  }),
  metadata: JsonObjectSchema.optional()
});

export const RuleSchema = z.object({
  id: IdSchema,
  type: NamespacedTypeSchema,
  enabled: z.boolean(),
  config: JsonObjectSchema,
  metadata: JsonObjectSchema.optional()
});

export const WorldManifestSchema = z.object({
  schemaVersion: z.literal(WORLD_MANIFEST_SCHEMA_VERSION),
  project: ProjectSchema,
  world: WorldSchema,
  assets: z.array(AssetSchema),
  zones: z.array(ZoneSchema),
  places: z.array(PlaceSchema),
  paths: z.array(PathSchema),
  entities: z.array(EntitySchema),
  npcs: z.array(NpcSchema),
  quests: z.array(QuestSchema),
  events: z.array(EventSchema),
  rules: z.array(RuleSchema),
  metadata: JsonObjectSchema.optional()
});

export const ChangeSetOperationSchema = z.object({
  op: z.enum(["create", "update", "delete"]),
  collection: z.enum(["assets", "zones", "places", "paths", "entities", "npcs", "quests", "events", "rules"]),
  targetId: IdSchema,
  value: JsonValueSchema.optional()
});

export const ChangeSetSchema = z.object({
  schemaVersion: z.literal(CHANGESET_SCHEMA_VERSION),
  id: IdSchema,
  worldId: IdSchema,
  baseRevision: z.string().min(1),
  status: z.enum(["draft", "validated", "previewed", "approved", "applied", "rejected"]),
  operations: z.array(ChangeSetOperationSchema).min(1),
  metadata: JsonObjectSchema.optional()
});

export type WorldManifest = z.infer<typeof WorldManifestSchema>;
export type ChangeSet = z.infer<typeof ChangeSetSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Path = z.infer<typeof PathSchema>;
export type Npc = z.infer<typeof NpcSchema>;
export type Quest = z.infer<typeof QuestSchema>;
export type WorldEvent = z.infer<typeof EventSchema>;
