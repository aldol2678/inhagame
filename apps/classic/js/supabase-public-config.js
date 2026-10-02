/* P1-C A5 classic bootstrap — load before other classic scripts. */
(function (g) {
  if (g.__INHAGAME_PUBLIC_SUPABASE__ && g.__INHAGAME_PUBLIC_SUPABASE__.url) return;
  g.__INHAGAME_PUBLIC_SUPABASE__ = {
    url: "http://127.0.0.1:54321",
    publishableKey: "sb_publishable_PUBLIC_PLACEHOLDER"
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
