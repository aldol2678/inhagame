export interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

export function getPublicSupabaseConfig(): PublicSupabaseConfig;
export const SUPABASE_URL: string;
export const SUPABASE_PUBLISHABLE_KEY: string;
