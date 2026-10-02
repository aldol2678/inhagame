
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const int = (v: unknown, fallback = -1) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = userData.user.id;
    const body = await req.json();

    const runId = String(body?.runId ?? "");
    const nonce = String(body?.nonce ?? "");
    const score = int(body?.score);
    const maxCombo = int(body?.maxCombo);
    const annyongiHits = int(body?.annyongiHits);
    const indeokiHits = int(body?.indeokiHits);
    const goldHits = int(body?.goldHits);
    const totalHits = int(body?.totalHits);
    const durationMs = int(body?.durationMs);
    const clientVersion = String(body?.clientVersion ?? "").slice(0, 40);

    const hasHitBreakdown = body?.normalHits !== undefined && body?.speedyHits !== undefined;
    const normalHits = int(body?.normalHits, 0);
    const speedyHits = int(body?.speedyHits, 0);
    const dragonCalls = int(body?.dragonCalls, body?.dragonBursts !== undefined ? int(body?.dragonBursts, 0) : 0);
    const moonBonusHits = int(body?.moonBonusHits, 0);
    const hasFlightHits = body?.flightHits !== undefined;
    const flightHits = int(body?.flightHits, 0);
    const completedCalls = int(body?.completedCalls, body?.completedCalls === undefined ? Math.min(dragonCalls, flightHits > 0 ? 1 : 0) : 0);

    const comboBonus = int(body?.comboBonus, -1);
    const flightBasePoints = int(body?.flightBasePoints, -1);
    const tier1Hits = int(body?.tier1Hits, -1);
    const tier2Hits = int(body?.tier2Hits, -1);
    const tier1GroundAward = int(body?.tier1GroundAward, -1);
    const tier2GroundAward = int(body?.tier2GroundAward, -1);
    const ascensionBonus = int(body?.ascensionBonus, -1);

    const inputCount = int(body?.inputCount, 0);
    const reactionSampleCount = int(body?.reactionSampleCount, 0);
    const ultraFastReactionCount = int(body?.ultraFastReactionCount, 0);

    const { data: session, error: sessionError } = await admin
      .from("ranked_sessions")
      .select("run_id,user_id,nonce,started_at,expires_at,status,run_type,ruleset_version")
      .eq("run_id", runId)
      .eq("user_id", userId)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!session) {
      return new Response(JSON.stringify({ error: "RUN_NOT_FOUND" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.status !== "started") {
      return new Response(JSON.stringify({ error: "RUN_ALREADY_PROCESSED", status: session.status }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = Date.now();
    const started = Date.parse(session.started_at);
    const expires = Date.parse(session.expires_at);
    const actualElapsed = now - started;

    if (now > expires || actualElapsed > 6 * 60 * 1000) {
      await admin.from("ranked_sessions")
        .update({
          status: "expired",
          expired_at: session.expires_at,
          finished_at: session.expires_at,
        })
        .eq("run_id", runId).eq("user_id", userId).eq("status", "started");
      return new Response(JSON.stringify({ error: "RUN_EXPIRED" }), {
        status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Payload has arrived. Validation resolves submitted -> accepted/rejected.
    const submittedAt = new Date().toISOString();
    const { data: submittedSession, error: submitStateError } = await admin
      .from("ranked_sessions")
      .update({ status: "submitted", submitted_at: submittedAt })
      .eq("run_id", runId)
      .eq("user_id", userId)
      .eq("status", "started")
      .select("run_id")
      .maybeSingle();

    if (submitStateError) throw submitStateError;
    if (!submittedSession) {
      return new Response(JSON.stringify({ error: "RUN_ALREADY_PROCESSED" }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reject = async (reason: string, status = 422) => {
      await admin.from("ranked_sessions")
        .update({ status: "rejected", finished_at: new Date().toISOString() })
        .eq("run_id", runId).eq("user_id", userId).eq("status", "submitted");

      await admin.from("ranked_runs").insert({
        run_id: runId,
        user_id: userId,
        stage_key: "secret",
        score: Math.max(0, score),
        max_combo: Math.max(0, maxCombo),
        annyongi_hits: Math.max(0, annyongiHits),
        indeoki_hits: Math.max(0, indeokiHits),
        gold_hits: Math.max(0, goldHits),
        normal_hits: Math.max(0, normalHits),
        speedy_hits: Math.max(0, speedyHits),
        total_hits: Math.max(0, totalHits),
        dragon_bursts: 0,
        dragon_calls: Math.max(0, Math.min(2, dragonCalls)),
        completed_calls: Math.max(0, Math.min(2, completedCalls)),
        moon_bonus_hits: Math.max(0, moonBonusHits),
        flight_hits: Math.max(0, flightHits),
        duration_ms: Math.max(0, durationMs),
        client_version: clientVersion || null,
        validation_status: "rejected",
        reject_reason: reason,
        run_type: session.run_type,
        ruleset_version: session.ruleset_version,
        input_count: Math.max(0, inputCount),
        reaction_sample_count: Math.max(0, reactionSampleCount),
        ultra_fast_reaction_count: Math.max(0, Math.min(reactionSampleCount, ultraFastReactionCount)),
        suspicious_flag: false,
        suspicion_reasons: [],
        combo_bonus: Math.max(0, comboBonus),
        flight_base_points: Math.max(0, flightBasePoints),
        tier1_hits: Math.max(0, tier1Hits),
        tier2_hits: Math.max(0, tier2Hits),
        tier1_ground_award: Math.max(0, tier1GroundAward),
        tier2_ground_award: Math.max(0, tier2GroundAward),
        ascension_bonus: Math.max(0, ascensionBonus),
      });

      return new Response(JSON.stringify({ error: "RUN_REJECTED", reason }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    if (nonce !== session.nonce) return await reject("NONCE_MISMATCH", 403);
    if (body?.runType !== undefined && String(body.runType) !== session.run_type) return await reject("RUN_TYPE_MISMATCH");
    if (body?.rulesetVersion !== undefined && String(body.rulesetVersion) !== session.ruleset_version) return await reject("RULESET_MISMATCH");

    const coreNumbers = [score,maxCombo,annyongiHits,indeokiHits,goldHits,totalHits,durationMs];
    const detailedNumbers = [normalHits,speedyHits,dragonCalls,completedCalls,moonBonusHits,flightHits,inputCount,reactionSampleCount,ultraFastReactionCount];
    if (coreNumbers.some(v => v < 0) || detailedNumbers.some(v => v < 0)) return await reject("INVALID_NUMERIC");

    if (durationMs < 7000 || durationMs > 65000) return await reject("DURATION_OUT_OF_RANGE");
    if (Math.abs(actualElapsed - durationMs) > 12000) return await reject("CLOCK_MISMATCH");
    if (totalHits > 180) return await reject("TOO_MANY_HITS");
    if (dragonCalls > 2) return await reject("DRAGON_CALLS_INVALID");
    if (completedCalls > dragonCalls) return await reject("COMPLETED_CALLS_INVALID");
    if (ultraFastReactionCount > reactionSampleCount) return await reject("TELEMETRY_INVALID");

    let goodHits = totalHits - annyongiHits;
    if (hasHitBreakdown) {
      goodHits = normalHits + speedyHits + goldHits + indeokiHits;
      if (totalHits !== goodHits + annyongiHits) return await reject("HIT_COUNTS_INVALID");
    } else {
      if (annyongiHits > totalHits || indeokiHits > goodHits || goldHits > goodHits) return await reject("HIT_COUNTS_INVALID");
    }

    if (maxCombo > goodHits) return await reject("COMBO_IMPOSSIBLE");
    if (moonBonusHits > goodHits || flightHits > goodHits || moonBonusHits + flightHits > goodHits) return await reject("PHASE_HITS_INVALID");
    if (dragonCalls === 0 && (moonBonusHits > 0 || flightHits > 0)) return await reject("PHASE_WITHOUT_CALL");

    if (session.ruleset_version === "secret-2.2-r1") {
      const ledger = [comboBonus,flightBasePoints,tier1Hits,tier2Hits,tier1GroundAward,tier2GroundAward,ascensionBonus];
      if (!hasHitBreakdown || !hasFlightHits || ledger.some(v => v < 0)) return await reject("LEDGER_REQUIRED");

      const basePoints = normalHits + speedyHits * 2 + goldHits * 3 + indeokiHits * 5;
      const groundHits = goodHits - moonBonusHits - flightHits;
      if (groundHits < 0) return await reject("GROUND_HITS_INVALID");

      if (flightHits === 0 && flightBasePoints !== 0) return await reject("FLIGHT_LEDGER_INVALID");
      if (flightHits > 0 && (flightBasePoints < flightHits || flightBasePoints > flightHits * 5)) return await reject("FLIGHT_LEDGER_INVALID");

      const rawBeforeCombo = basePoints + moonBonusHits * 2 + flightBasePoints;
      if (comboBonus > rawBeforeCombo) return await reject("COMBO_LEDGER_INVALID");

      if (tier1Hits + tier2Hits > groundHits) return await reject("ASCENSION_HITS_INVALID");
      if (completedCalls < 1 && (tier1Hits || tier1GroundAward)) return await reject("TIER1_BEFORE_ASCENSION");
      if (completedCalls < 2 && (tier2Hits || tier2GroundAward)) return await reject("TIER2_BEFORE_ASCENSION");

      if ((tier1Hits === 0 && tier1GroundAward !== 0) || (tier1Hits > 0 && (tier1GroundAward < tier1Hits || tier1GroundAward > tier1Hits * 10))) {
        return await reject("TIER1_LEDGER_INVALID");
      }
      if ((tier2Hits === 0 && tier2GroundAward !== 0) || (tier2Hits > 0 && (tier2GroundAward < tier2Hits || tier2GroundAward > tier2Hits * 10))) {
        return await reject("TIER2_LEDGER_INVALID");
      }
      if (tier1GroundAward + tier2GroundAward > basePoints + comboBonus) return await reject("ASCENSION_AWARD_INVALID");

      const expectedAscensionBonus = Math.floor(tier1GroundAward * 0.2) + Math.floor(tier2GroundAward * 0.5);
      if (ascensionBonus !== expectedAscensionBonus) return await reject("ASCENSION_BONUS_INVALID");

      const expectedScore = rawBeforeCombo + comboBonus + ascensionBonus;
      if (score !== expectedScore) return await reject("SCORE_LEDGER_MISMATCH");
      if (score > 4000) return await reject("SCORE_ABOVE_CAP");
    } else {
      if (hasHitBreakdown && hasFlightHits) {
        const basePoints = normalHits + speedyHits * 2 + goldHits * 3 + indeokiHits * 5;
        const minimumScore = basePoints + moonBonusHits * 2 + flightHits;
        const maximumScore = 2 * (basePoints + moonBonusHits * 2 + flightHits * 5);
        if (score < minimumScore) return await reject("SCORE_BELOW_THEORETICAL_MIN");
        if (score > maximumScore) return await reject("SCORE_ABOVE_THEORETICAL_MAX");
      } else {
        if (score > 1800) return await reject("SCORE_ABOVE_CAP");
        if (score > Math.max(0, goodHits) * 15) return await reject("SCORE_HIT_MISMATCH");
      }
    }

    const suspicionReasons: string[] = [];
    const durationSeconds = Math.max(0.001, durationMs / 1000);
    const inputRate = inputCount / durationSeconds;
    if (inputCount >= 60 && inputRate > 10) suspicionReasons.push("HIGH_INPUT_RATE");
    if (reactionSampleCount >= 8 && ultraFastReactionCount / reactionSampleCount >= 0.65) suspicionReasons.push("ULTRA_FAST_REACTION_RATIO");
    const suspiciousFlag = suspicionReasons.length > 0;

    let acceptedRunId: string | null = null;
    if (session.ruleset_version === "secret-2.2-r1") {
      const { data, error } = await admin.rpc("record_ranked_result_v5", {
        p_run_id: runId,p_user_id: userId,p_score: score,p_max_combo: maxCombo,
        p_annyongi_hits: annyongiHits,p_indeoki_hits: indeokiHits,p_gold_hits: goldHits,
        p_normal_hits: normalHits,p_speedy_hits: speedyHits,p_total_hits: totalHits,
        p_dragon_calls: dragonCalls,p_completed_calls: completedCalls,p_moon_bonus_hits: moonBonusHits,
        p_flight_hits: flightHits,p_duration_ms: durationMs,p_client_version: clientVersion || null,
        p_combo_bonus: comboBonus,p_flight_base_points: flightBasePoints,p_tier1_hits: tier1Hits,p_tier2_hits: tier2Hits,
        p_tier1_ground_award: tier1GroundAward,p_tier2_ground_award: tier2GroundAward,p_ascension_bonus: ascensionBonus,
        p_input_count: inputCount,p_reaction_sample_count: reactionSampleCount,p_ultra_fast_reaction_count: ultraFastReactionCount,
        p_suspicious_flag: suspiciousFlag,p_suspicion_reasons: suspicionReasons,
      });
      if (error) throw error;
      acceptedRunId = data;
    } else {
      const { data, error } = await admin.rpc("record_ranked_result_v4", {
        p_run_id: runId,p_user_id: userId,p_score: score,p_max_combo: maxCombo,
        p_annyongi_hits: annyongiHits,p_indeoki_hits: indeokiHits,p_gold_hits: goldHits,
        p_normal_hits: normalHits,p_speedy_hits: speedyHits,p_total_hits: totalHits,
        p_dragon_calls: dragonCalls,p_completed_calls: completedCalls,p_moon_bonus_hits: moonBonusHits,
        p_flight_hits: flightHits,p_duration_ms: durationMs,p_client_version: clientVersion || null,
        p_input_count: inputCount,p_reaction_sample_count: reactionSampleCount,p_ultra_fast_reaction_count: ultraFastReactionCount,
        p_suspicious_flag: suspiciousFlag,p_suspicion_reasons: suspicionReasons,
      });
      if (error) throw error;
      acceptedRunId = data;
    }

    const { data: myRank } = session.run_type === "ranked" ? await userClient.rpc("get_my_rank_v3") : { data: null };
    const rank = Array.isArray(myRank) ? myRank[0] : null;

    return new Response(JSON.stringify({
      accepted: true,
      runId,
      recordId: acceptedRunId,
      runType: session.run_type,
      rulesetVersion: session.ruleset_version,
      rankEligible: session.run_type === "ranked",
      shadowSuspicious: suspiciousFlag,
      suspicionReasons,
      bestScore: session.run_type === "ranked" ? (rank?.best_score ?? score) : null,
      overallRank: session.run_type === "ranked" ? (rank?.overall_rank ?? null) : null,
      departmentRank: session.run_type === "ranked" ? (rank?.department_rank ?? null) : null,
      rankedGrade: session.run_type === "ranked" ? (rank?.ranked_grade ?? null) : null,
      generalBadge: session.run_type === "ranked" ? (rank?.general_badge ?? null) : null,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "FINISH_FAILED", detail: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
