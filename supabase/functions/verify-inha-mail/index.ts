import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, string | boolean>) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
  try {
    const primaryToken = request.headers.get("Authorization")?.replace(/^Bearer /i, "");
    const { school_access_token: schoolToken } = await request.json();
    if (!primaryToken || typeof schoolToken !== "string" || schoolToken.length > 8192) {
      return reply(400, { error: "MISSING_TOKENS" });
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const [primaryResult, schoolResult] = await Promise.all([
      admin.auth.getUser(primaryToken), admin.auth.getUser(schoolToken),
    ]);
    const primary = primaryResult.data.user;
    const school = schoolResult.data.user;
    if (primaryResult.error || schoolResult.error || !primary || !school) {
      return reply(401, { error: "INVALID_SESSION" });
    }
    if (primary.is_anonymous || !primary.email_confirmed_at || primary.id === school.id) {
      return reply(403, { error: "PRIMARY_ACCOUNT_REQUIRED" });
    }
    if (school.is_anonymous || !school.email_confirmed_at ||
      !/^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/i.test(school.email ?? "")) {
      return reply(403, { error: "SCHOOL_EMAIL_REQUIRED" });
    }
    const { error } = await admin.rpc("claim_inha_mail_badge", {
      p_primary_id: primary.id, p_school_id: school.id,
    });
    if (error) {
      console.error("inha mail badge claim failed", error.code);
      return reply(error.code === "23505" ? 409 : 500, {
        error: error.code === "23505" ? "EMAIL_ALREADY_LINKED" : "CLAIM_FAILED",
      });
    }
    return reply(200, { verified: true });
  } catch (error) {
    console.error("inha mail badge error", error);
    return reply(400, { error: "BAD_REQUEST" });
  }
});
