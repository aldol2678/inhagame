import * as z from "zod";

const ACTIVITY_ID_PATTERN = /^activity\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;
const SOURCE_REF_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,5}$/;
const CLIENT_ATTEMPT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const EvidenceSchema = z
  .custom(
    value => value !== null && typeof value === "object" && !Array.isArray(value),
    "Evidence must be an object"
  )
  .superRefine((value, ctx) => {
    try {
      if (JSON.stringify(value).length > 2048) {
        ctx.addIssue({ code: "custom", message: "Evidence is too large" });
      }
    } catch {
      ctx.addIssue({ code: "custom", message: "Evidence must be JSON serializable" });
    }
  });

export const ActivityStartRequestSchema = z
  .strictObject({
    activityId: z.string().regex(ACTIVITY_ID_PATTERN).max(120),
    sourceRef: z.string().regex(SOURCE_REF_PATTERN).max(160),
    clientAttemptKey: z.string().regex(CLIENT_ATTEMPT_KEY_PATTERN),
    evidence: EvidenceSchema.nullish()
  })
  .transform(value => ({
    activityId: value.activityId,
    sourceRef: value.sourceRef,
    clientAttemptKey: value.clientAttemptKey.toLowerCase(),
    evidence: value.evidence ?? null
  }));

export function parseActivityStartRequestZod(raw) {
  const value = ActivityStartRequestSchema.parse(raw);
  return Object.freeze({
    ...value,
    evidence: value.evidence === null ? null : Object.freeze({ ...value.evidence })
  });
}
