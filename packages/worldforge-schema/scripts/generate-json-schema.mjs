import { mkdir, writeFile } from "node:fs/promises";
import * as z from "zod";
import { ChangeSetSchema, WorldManifestSchema } from "../dist/index.js";

await mkdir(new URL("../schema/", import.meta.url), { recursive: true });

const emit = async (schema, filename, id, title) => {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", reused: "ref" });
  json.$schema = "https://json-schema.org/draft/2020-12/schema";
  json.$id = id;
  json.title = title;
  await writeFile(new URL(`../schema/${filename}`, import.meta.url), `${JSON.stringify(json)}\n`);
};

await emit(
  WorldManifestSchema,
  "world-manifest.schema.json",
  "https://worldforge.dev/schema/0.1/world-manifest.schema.json",
  "WorldForge World Manifest v0.1"
);
await emit(
  ChangeSetSchema,
  "changeset.schema.json",
  "https://worldforge.dev/schema/0.1/changeset.schema.json",
  "WorldForge ChangeSet v0.1"
);
