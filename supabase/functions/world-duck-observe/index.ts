import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const ALLOWED_DUCK_IDS = new Set([
  "inkyung_duck_white_01",
  "inkyung_duck_white_02",
  "inkyung_duck_white_03",
  "inkyung_duck_mallard_01",
]);

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return reply(401, { error: "UNAUTHENTICATED" });
    if (user.is_anonymous) return reply(403, { error: "PERMANENT_ACCOUNT_REQUIRED" });

    const body = await req.json().catch(() => ({}));
    const duckId = String(body?.duckId ?? "");
    if (!ALLOWED_DUCK_IDS.has(duckId)) {
      return reply(400, { error: "INVALID_DUCK_ID" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Provenance is derived server-side. The browser never controls user id, result ref,
    // idempotency key, Creature id, observation count, or party state.
    const resultRef = `duck-observation:${user.id}:${duckId}`;
    const idempotencyKey = `duck-observe:${user.id}:${duckId}`;

    const { data, error } = await admin.rpc("world_inkyung_duck_observe_v1", {
      p_user: user.id,
      p_duck_id: duckId,
      p_result_ref: resultRef,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      const code = String(error.code ?? "");
      if (code === "22023") return reply(403, { error: "ACCOUNT_UNAVAILABLE" });
      if (code === "P0001") return reply(409, { error: "OBSERVATION_REJECTED" });
      console.error("world duck observation failed", code, error.message);
      return reply(500, { error: "OBSERVATION_FAILED" });
    }

    return reply(200, data ?? { status: "SUCCESS", duckId });
  } catch (error) {
    console.error("world duck observation edge error", error);
    return reply(500, { error: "OBSERVATION_FAILED" });
  }
});
