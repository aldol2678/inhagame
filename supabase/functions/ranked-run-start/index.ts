
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DEFAULT_RULESET_VERSION = "secret-2.1-r1";
const NEXT_RULESET_VERSION = "secret-2.2-r1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

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
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const userId = userData.user.id;

    // Opportunistic lifecycle cleanup. Silent closes become expired after expires_at.
    // PostgREST builders are PromiseLike but do not provide Promise.catch().
    // Cleanup is best-effort and must never block starting a ranked session.
    try {
      const { error: expireError } = await admin.rpc("expire_ranked_sessions_v1");
      if (expireError) console.warn("ranked lifecycle cleanup failed", expireError.message);
    } catch (cleanupError) {
      console.warn("ranked lifecycle cleanup failed", cleanupError);
    }

    const body = await req.json().catch(() => ({}));
    const clientVersion = String(body?.clientVersion ?? "").slice(0, 40);
    const requestedRuleset = String(body?.rulesetVersion ?? "");
    const rulesetVersion = requestedRuleset === NEXT_RULESET_VERSION ? NEXT_RULESET_VERSION : DEFAULT_RULESET_VERSION;
    const runType = body?.runType === "qa" ? "qa" : "ranked";

    const { data: profile } = await admin
      .from("profiles")
      .select("user_id,is_banned")
      .eq("user_id", userId)
      .maybeSingle();

    if (runType === "ranked" && !profile) {
      return new Response(JSON.stringify({ error: "PROFILE_REQUIRED" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (profile?.is_banned) {
      return new Response(JSON.stringify({ error: "RANKING_BLOCKED" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("ranked_sessions")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("started_at", tenMinutesAgo);

    if ((count ?? 0) >= 30) {
      return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session, error: insertError } = await admin
      .from("ranked_sessions")
      .insert({
        user_id: userId,
        stage_key: "secret",
        client_version: clientVersion || null,
        run_type: runType,
        ruleset_version: rulesetVersion,
      })
      .select("run_id,nonce,started_at,expires_at,run_type,ruleset_version")
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      runId: session.run_id,
      nonce: session.nonce,
      startedAt: session.started_at,
      expiresAt: session.expires_at,
      runType: session.run_type,
      rulesetVersion: session.ruleset_version,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "START_FAILED", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
