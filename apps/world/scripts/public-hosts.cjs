'use strict';
// Public host policy shared by the build-time generator (scripts/build-public-config.mjs) and the
// runtime CORS allow-list (api/hub-entry.js). One input, read from the same environment variables:
//   INHAGAME_PUBLIC_HOST_CAMPUS / _CLASSIC / _INDUCKUP / _SURVIVAL / _GROW   (bare host names)
// Nothing here is a secret. Hosts are never derived from a request, so no arbitrary origin is allowed.

const GAMES = Object.freeze({
  campus: { env: 'INHAGAME_PUBLIC_HOST_CAMPUS', template: 'inhagame.example', target: 'campus' },
  classic: { env: 'INHAGAME_PUBLIC_HOST_CLASSIC', template: 'duck.inhagame.example', target: 'classic' },
  induckup: { env: 'INHAGAME_PUBLIC_HOST_INDUCKUP', template: 'induckup.inhagame.example', target: 'induckup' },
  survival: { env: 'INHAGAME_PUBLIC_HOST_SURVIVAL', template: 'survival.inhagame.example', target: 'survival' },
  grow: { env: 'INHAGAME_PUBLIC_HOST_GROW', template: 'grow.inhagame.example', target: 'induck-grow' }
});
const KEYS = Object.freeze(Object.keys(GAMES));
const MODES = Object.freeze(['local', 'preview', 'production']);

const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const RESERVED_TLDS = new Set(['example', 'test', 'invalid', 'localhost', 'local', 'internal']);

class ConfigError extends Error {}

// The mode variable must be present in both build and function runtime environments.
const VERCEL_ENVS = new Set(['production', 'preview', 'development']);

function resolveMode({ explicit, env = process.env } = {}) {
  const configured = env.INHAGAME_BUILD_MODE || undefined;
  for (const value of [explicit, configured]) {
    if (value !== undefined && !MODES.includes(value)) throw new ConfigError(`unknown build mode "${value}"`);
  }
  if (explicit !== undefined && configured !== undefined && explicit !== configured) {
    throw new ConfigError(`mode "${explicit}" conflicts with INHAGAME_BUILD_MODE=${configured}`);
  }
  const requested = explicit ?? configured;
  const vercelEnv = env.VERCEL_ENV || undefined;
  if (vercelEnv !== undefined && !VERCEL_ENVS.has(vercelEnv)) throw new ConfigError(`unrecognised VERCEL_ENV "${vercelEnv}"`);
  const onVercel = Boolean(env.VERCEL) || vercelEnv !== undefined;
  const derived = vercelEnv === 'production' ? 'production' : vercelEnv === 'preview' ? 'preview' : undefined;
  const mode = requested ?? derived;
  if (!mode) {
    throw new ConfigError('cannot tell whether this is a preview or production build: set INHAGAME_BUILD_MODE ' +
      '(preview | production) for this environment' +
      (vercelEnv !== undefined ? ` (VERCEL_ENV=${vercelEnv} does not select a deploy mode)` : onVercel ? ' (VERCEL_ENV is not available to this build)' : '') +
      '; INHAGAME_BUILD_MODE=local only for an explicit local build outside Vercel');
  }
  // A Preview build must never carry Production settings (and vice versa); a placeholder build must never
  // ship from Vercel.
  if (vercelEnv !== undefined && mode !== 'local' && vercelEnv !== mode) {
    throw new ConfigError(`mode "${mode}" conflicts with VERCEL_ENV=${vercelEnv}`);
  }
  if (mode === 'local' && onVercel && vercelEnv !== 'development') {
    throw new ConfigError('local mode is not allowed on Vercel (it would publish placeholder values)');
  }
  return mode;
}


function readHostInput(env = process.env) {
  const hosts = {};
  for (const key of KEYS) {
    const raw = env[GAMES[key].env];
    if (raw !== undefined && String(raw).trim() !== '') hosts[key] = String(raw).trim();
  }
  return hosts;
}

// Returns a frozen { campus, classic, induckup, survival, grow } map of lower-case host names, or throws.
function validateHosts(input, { mode }) {
  if (!MODES.includes(mode)) throw new ConfigError(`unknown mode "${mode}"`);
  const missing = KEYS.filter(key => !input[key]);
  if (missing.length) throw new ConfigError(`missing host(s): ${missing.map(key => GAMES[key].env).join(', ')}`);
  const hosts = {};
  const seen = new Set();
  for (const key of KEYS) {
    const value = String(input[key]);
    if (value !== value.toLowerCase()) throw new ConfigError(`${GAMES[key].env} must be lower-case`);
    if (!HOST.test(value)) throw new ConfigError(`${GAMES[key].env} is not a bare DNS host name`);
    const tld = value.slice(value.lastIndexOf('.') + 1);
    if (RESERVED_TLDS.has(tld)) throw new ConfigError(`${GAMES[key].env} uses a reserved or placeholder domain`);
    if (mode === 'production' && value.endsWith('.vercel.app')) {
      throw new ConfigError(`${GAMES[key].env} must be a custom domain in production`);
    }
    if (seen.has(value)) throw new ConfigError(`${GAMES[key].env} duplicates another game host`);
    seen.add(value);
    hosts[key] = value;
  }
  return Object.freeze(hosts);
}

// hostname -> game target, with the www alias of the campus host (the template lists both).
function hostnameTargets(hosts) {
  const map = {};
  for (const key of KEYS) map[hosts[key]] = GAMES[key].target;
  map[`www.${hosts.campus}`] = GAMES.campus.target;
  return map;
}

// https origin -> game target, as used by CORS. The www alias is not a CORS origin (as in the template).
function originTargets(hosts) {
  const map = {};
  for (const key of KEYS) map[`https://${hosts[key]}`] = GAMES[key].target;
  return map;
}

function templateHosts() {
  const hosts = {};
  for (const key of KEYS) hosts[key] = GAMES[key].template;
  return Object.freeze(hosts);
}

// A function that runs on Vercel (or any Lambda-style host) is "hosted". The inert template hosts are a
// local/test convenience only and must never be applied silently to a deployment, whatever VERCEL_ENV says
// (VERCEL_ENV may not be exposed to the function at all).
const HOSTED_SIGNALS = Object.freeze(['VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_REGION',
  'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT', 'AWS_EXECUTION_ENV']);
function isHostedRuntime(env = process.env) {
  return HOSTED_SIGNALS.some(name => env[name] !== undefined && String(env[name]) !== '');
}

// Runtime allow-list for api/hub-entry.js. Deployment mode and host validation are shared with
// the build; an invalid, conflicting or missing hosted mode fails closed. Only unconfigured local
// fixtures implicitly choose local mode and may fall back to the inert template hosts.
function runtimeOriginTargets(env = process.env) {
  const hosted = isHostedRuntime(env);
  const input = readHostInput(env);
  try {
    const localFixture = !hosted && !env.INHAGAME_BUILD_MODE && !env.VERCEL_ENV;
    const mode = resolveMode({ explicit: localFixture ? 'local' : undefined, env });
    if (Object.keys(input).length === 0) {
      return !hosted && mode === 'local' ? originTargets(templateHosts()) : {};
    }
    return originTargets(validateHosts(input, { mode }));
  } catch {
    return {};
  }
}

module.exports = {
  GAMES, KEYS, MODES, ConfigError, resolveMode,
  readHostInput, validateHosts, hostnameTargets, originTargets, templateHosts, isHostedRuntime, runtimeOriginTargets
};
