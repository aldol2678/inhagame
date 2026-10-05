// P1-C A5 — CJS for classic API routes (Vercel root apps/classic)
module.exports = {
  url: "http://127.0.0.1:54321",
  publishableKey: "sb_publishable_PUBLIC_PLACEHOLDER",
  get() {
    const env = process.env || {};
    const u = env.SUPABASE_URL || '';
    const k = env.SUPABASE_PUBLISHABLE_KEY || '';
    if (u && k) return { url: u, publishableKey: k };
    return { url: this.url, publishableKey: this.publishableKey };
  }
};
