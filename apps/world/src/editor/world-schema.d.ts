export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];

export interface Transform {
  position: Vec3;
  rotation: Quaternion;
  scale: Vec3;
}

export interface WorldAsset {
  id: string;
  type: "model" | "texture" | "audio" | "other";
  uri: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WorldEntity {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  enabled: boolean;
  transform: Transform;
  tags: string[];
  components: Record<string, Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

export interface WorldData {
  schemaVersion: "0.1.0";
  worldId: string;
  name: string;
  coordinateSystem: { handedness: "right"; upAxis: "Y"; unit: "meter" };
  assets: WorldAsset[];
  entities: WorldEntity[];
  metadata?: Record<string, unknown>;
}

export interface Diagnostic {
  severity: "ERROR" | "WARNING";
  code: string;
  path: string;
  detail?: string;
}

export interface ValidationResult {
  valid: boolean;
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export declare const WORLD_SCHEMA_VERSION: "0.1.0";
export declare const DEFAULT_COORDINATE_SYSTEM: Readonly<WorldData["coordinateSystem"]>;
export declare function validateTransformInput(transform: unknown, path?: string): Diagnostic[];
export declare function validateWorld(world: unknown): ValidationResult;
export declare function assertValidWorld(world: unknown): ValidationResult;
