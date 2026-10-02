const url = process.env.SUPABASE_URL;
if (url && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) {
  throw new Error('Local integration requires a loopback Supabase endpoint');
}
if (url) globalThis.__INHAGAME_PUBLIC_SUPABASE__ = Object.freeze({
  url, key: process.env.ANON_KEY, publishableKey: process.env.ANON_KEY
});
