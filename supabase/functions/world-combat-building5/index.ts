import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION = Object.freeze({
  basic: "BASIC",
  active_1: "ACTIVE_1",
  active_2: "ACTIVE_2",
  active_3: "ACTIVE_3",
  dodge: "DODGE",
  ultimate: "ULTIMATE",
  sync: "SYNC",
  cancel: "CANCEL",
});
const ALLOWED_KEYS = Object.freeze({
  start: new Set(["op", "clientEncounterKey"]),
  action: new Set(["op", "encounterId", "action", "actionKey"]),
  snapshot: new Set(["op", "encounterId"]),
  cancel: new Set(["op", "encounterId", "actionKey"]),
});

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function validShape(body: Record<string, unknown>, op: keyof typeof ALLOWED_KEYS) {
  const allowed = ALLOWED_KEYS[op];
  return Object.keys(body).every((key) => allowed.has(key));
}

function errorStatus(code: string) {
  if (code === "22023" || code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "23505" || code === "40001" || code === "P0001") return 409;
  return 500;
}

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

    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return reply(400, { error: "INVALID_BODY" });
    }
    const body = raw as Record<string, unknown>;
    const op = String(body.op ?? "");

    if (!(op in ALLOWED_KEYS)) return reply(400, { error: "INVALID_OPERATION" });
    if (!validShape(body, op as keyof typeof ALLOWED_KEYS)) {
      return reply(400, { error: "UNRECOGNIZED_FIELD" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let rpc: string;
    let args: Record<string, unknown>;

    if (op === "start") {
      const clientEncounterKey = String(body.clientEncounterKey ?? "");
      if (!UUID.test(clientEncounterKey)) return reply(400, { error: "INVALID_CLIENT_ENCOUNTER_KEY" });
      rpc = "world_combat_building5_start_v1";
      args = { p_user: user.id, p_client_encounter_key: clientEncounterKey.toLowerCase() };
    } else if (op === "snapshot") {
      const encounterId = String(body.encounterId ?? "");
      if (!UUID.test(encounterId)) return reply(400, { error: "INVALID_ENCOUNTER_ID" });
      rpc = "world_combat_building5_snapshot_v1";
      args = { p_user: user.id, p_encounter_id: encounterId.toLowerCase() };
    } else {
      const encounterId = String(body.encounterId ?? "");
      const actionKey = String(body.actionKey ?? "");
      if (!UUID.test(encounterId)) return reply(400, { error: "INVALID_ENCOUNTER_ID" });
      if (!UUID.test(actionKey)) return reply(400, { error: "INVALID_ACTION_KEY" });

      const action = op === "cancel" ? "CANCEL" : ACTION[String(body.action ?? "") as keyof typeof ACTION];
      if (!action) return reply(400, { error: "INVALID_ACTION" });

      rpc = "world_combat_building5_action_v1";
      args = {
        p_user: user.id,
        p_encounter_id: encounterId.toLowerCase(),
        p_action: action,
        p_action_key: actionKey.toLowerCase(),
      };
    }

    const { data, error } = await admin.rpc(rpc, args);
    if (error) {
      const code = String(error.code ?? "");
      const safe = String(error.message ?? "COMBAT_REQUEST_FAILED").split("\n")[0].slice(0, 120);
      console.error("world combat building5 failed", op, code, safe);
      return reply(errorStatus(code), { error: safe || "COMBAT_REQUEST_FAILED", code });
    }

    return reply(200, data ?? { status: "SUCCESS" });
  } catch (error) {
    console.error("world combat building5 edge error", error);
    return reply(500, { error: "COMBAT_REQUEST_FAILED" });
  }
});
