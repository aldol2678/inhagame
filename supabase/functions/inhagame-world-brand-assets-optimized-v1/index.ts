import { WebIO } from "https://esm.sh/@gltf-transform/core@4.5.1?target=deno";
import { ALL_EXTENSIONS } from "https://esm.sh/@gltf-transform/extensions@4.5.1?target=deno";
import { dedup, prune } from "https://esm.sh/@gltf-transform/functions@4.5.1?target=deno&exports=dedup,prune";

const SOURCE_FUNCTION = "inhagame-world-brand-assets-v1";
const ALLOWED = new Set([
  "induck-v3.glb",
  "annyongi-flight-v1.glb",
  "induck-cap-v1.glb",
  "induck-backpack-v1.glb",
  "induck-hoodie-v1.glb"
]);

const REQUIRED_NODES = Object.freeze({
  "induck-v3.glb": ["DuckWing_L", "DuckWing_R", "DuckLeg_L", "DuckLeg_R"],
  "annyongi-flight-v1.glb": ["DragonWing_L", "DragonWing_R"]
});

const cache = new Map<string, Promise<{
  bytes: Uint8Array;
  sourceBytes: number;
  outputBytes: number;
  status: "OPTIMIZED" | "PASSTHROUGH";
}>>();

function expectedPublishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return typeof keys.default === "string" ? keys.default : "";
  } catch {
    return "";
  }
}

async function buildOptimized(asset: string, apikey: string) {
  const projectUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(projectUrl)) {
    throw new Error("E_BRAND_OPTIMIZER_PROJECT_URL");
  }

  const upstream = await fetch(
    projectUrl + "/functions/v1/" + SOURCE_FUNCTION + "?asset=" + encodeURIComponent(asset),
    { headers: { apikey }, signal: AbortSignal.timeout(7000) }
  );
  if (!upstream.ok) throw new Error("E_BRAND_OPTIMIZER_SOURCE_" + upstream.status);

  const source = new Uint8Array(await upstream.arrayBuffer());
  if (source.byteLength < 1024 ||
      String.fromCharCode(...source.subarray(0, 4)) !== "glTF") {
    throw new Error("E_BRAND_OPTIMIZER_SOURCE_GLTF");
  }

  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.readBinary(source);
  await document.transform(dedup(), prune({ keepLeaves: true }));

  const required = REQUIRED_NODES[asset] || [];
  const names = new Set(document.getRoot().listNodes().map(node => node.getName()));
  for (const name of required) {
    if (!names.has(name)) throw new Error("E_BRAND_OPTIMIZER_SEMANTIC_NODE:" + name);
  }

  const output = await io.writeBinary(document);
  const optimized = output.byteLength < source.byteLength;
  return Object.freeze({
    bytes: optimized ? output : source,
    sourceBytes: source.byteLength,
    outputBytes: optimized ? output.byteLength : source.byteLength,
    status: optimized ? "OPTIMIZED" : "PASSTHROUGH"
  });
}

function optimizedAsset(asset: string, apikey: string) {
  if (!cache.has(asset)) {
    cache.set(asset, buildOptimized(asset, apikey).catch(error => {
      cache.delete(asset);
      throw error;
    }));
  }
  return cache.get(asset)!;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { "Allow": "GET, HEAD" } });
  }

  const expected = expectedPublishableKey();
  const apikey = req.headers.get("apikey") || "";
  if (!expected || apikey !== expected) return new Response(null, { status: 401 });

  const asset = new URL(req.url).searchParams.get("asset") || "";
  if (!ALLOWED.has(asset)) return new Response(null, { status: 404 });

  try {
    const result = await optimizedAsset(asset, apikey);
    const headers = new Headers({
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
      "X-INHAGAME-Brand-Asset": asset,
      "X-INHAGAME-Brand-Variant": "optimized",
      "X-INHAGAME-Optimization": result.status,
      "X-INHAGAME-Source-Bytes": String(result.sourceBytes),
      "X-INHAGAME-Output-Bytes": String(result.outputBytes)
    });
    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(result.bytes, { status: 200, headers });
  } catch (error) {
    console.error("world brand asset optimization failed", asset, String(error?.message ?? error));
    return new Response(null, { status: 503 });
  }
});
