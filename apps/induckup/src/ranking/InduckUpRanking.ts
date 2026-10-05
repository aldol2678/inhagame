import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config/supabase-public-config.js';

interface SupabaseClientLike {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error?: unknown }>;
}

export interface InduckUpRankRow {
  rank: number;
  nickname: string;
  bestWave: number;
  bestScore: number;
  bestDurationMs: number;
  achievedAt: string | null;
  isMe: boolean;
}

export interface MyInduckUpRank {
  rank: number;
  bestWave: number;
  bestScore: number;
  bestDurationMs: number;
}

function client(): SupabaseClientLike | null {
  const factory = (window as unknown as {
    supabase?: { createClient(url: string, key: string, options?: Record<string, unknown>): SupabaseClientLike }
  }).supabase;
  return factory?.createClient
    ? factory.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
    : null;
}

export async function fetchInduckUpLeaderboard(limit = 20): Promise<InduckUpRankRow[]> {
  const db = client();
  if (!db) return [];
  const { data, error } = await db.rpc('get_induckup_ranked_leaderboard_v1', {
    p_limit: Math.max(1, Math.min(100, Math.trunc(limit))),
  });
  if (error || !Array.isArray(data)) return [];
  return data.map((row: any) => ({
    rank: Number(row.rank) || 0,
    nickname: String(row.nickname || '인덕 플레이어'),
    bestWave: Number(row.best_wave) || 0,
    bestScore: Number(row.best_score) || 0,
    bestDurationMs: Number(row.best_duration_ms) || 0,
    achievedAt: typeof row.achieved_at === 'string' ? row.achieved_at : null,
    isMe: row.is_me === true,
  }));
}

export async function fetchMyInduckUpRank(): Promise<MyInduckUpRank | null> {
  const db = client();
  if (!db) return null;
  const { data, error } = await db.rpc('get_my_induckup_rank_v1', {});
  if (error || !Array.isArray(data) || !data[0]) return null;
  const row: any = data[0];
  return {
    rank: Number(row.rank) || 0,
    bestWave: Number(row.best_wave) || 0,
    bestScore: Number(row.best_score) || 0,
    bestDurationMs: Number(row.best_duration_ms) || 0,
  };
}

export function formatRankDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
