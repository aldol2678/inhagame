// Node module hooks for running Deno Edge Functions offline: the Supabase client import is
// served by fake-supabase.mjs and the edge-runtime type import is an empty module.
const FAKE_CLIENT = new URL('./fake-supabase.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('npm:@supabase/supabase-js')) {
    return { url: FAKE_CLIENT, shortCircuit: true };
  }
  if (specifier.startsWith('jsr:@supabase/functions-js')) {
    return { url: 'data:text/javascript,export {}', shortCircuit: true };
  }
  if (specifier.startsWith('npm:') || specifier.startsWith('jsr:') || /^https?:/.test(specifier)) {
    throw new Error(`edge harness: no offline stand-in for import ${specifier}`);
  }
  return nextResolve(specifier, context);
}
