#!/usr/bin/env node
// Builds the deployable static tree of INHA WORLD into an isolated output directory (default: dist/).
// The checked-in sources are never modified. In preview/production mode it
//   1. generates the two browser configs (classic supabase-public-config.js and the ESM
//      src/config/supabase-public-config.js) from one input, and
//   2. rewrites the placeholder game hosts (*.inhagame.example) in an explicit list of files.
//
// Inputs (all public values; server settings such as NPC_AI_CLOUD_RUN_URL are never read here):
//   INHAGAME_BUILD_MODE                       local | preview | production
//                                              (from VERCEL_ENV when available; otherwise required)
//   INHAGAME_PUBLIC_SUPABASE_URL              https URL of the Supabase project
//   INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY  sb_publishable_… (or a legacy "anon" JWT)
//   INHAGAME_PUBLIC_HOST_CAMPUS|CLASSIC|INDUCKUP|SURVIVAL|GROW   bare host names
// The mode is never guessed: without INHAGAME_BUILD_MODE or a recognised VERCEL_ENV the build fails, and
// "local" (placeholder output) must be requested explicitly and is refused on Vercel.
// Output is staged next to the target and swapped in only after every check passed, so a failed run never
// leaves a partial dist and never touches the previous one.
// Usage: node scripts/build-public-config.mjs [--mode <mode>] [--out <dir>]
import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ConfigError, KEYS, resolveMode, readHostInput, validateHosts, templateHosts } = require('./public-hosts.cjs');

// Every filesystem call goes through this table so tests can inject copy/write/rename failures.
const REAL_FS = Object.freeze({
  chmodSync: nodeFs.chmodSync, copyFileSync: nodeFs.copyFileSync, lstatSync: nodeFs.lstatSync,
  mkdirSync: nodeFs.mkdirSync, mkdtempSync: nodeFs.mkdtempSync, readdirSync: nodeFs.readdirSync,
  readFileSync: nodeFs.readFileSync, realpathSync: nodeFs.realpathSync, renameSync: nodeFs.renameSync,
  rmSync: nodeFs.rmSync, writeFileSync: nodeFs.writeFileSync
});

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '.inhagame-public-build';
const STAGING_MARKER = '.inhagame-public-build-staging';
const CLASSIC_CONFIG = 'supabase-public-config.js';
const ESM_CONFIG = 'src/config/supabase-public-config.js';

// Top-level entries that are CI/dev/server only and are not part of the static site.
const EXCLUDED_TOP = new Set(['.git', '.vercel', 'node_modules', 'dist', 'api', 'tests', 'scripts', 'Dockerfile',
  'dev-server.mjs', 'model-converter', 'vercel.json', 'vercel-ignore.sh', 'package.json', 'package-lock.json']);
const EXCLUDED_TOP_PATTERN = /^(?:qa|validate)(?:[-.].*)?\.mjs$/;
// Leftover staging/previous directories of an earlier run that sit next to (or inside) the source.
const LEFTOVER_PATTERN = /^\..+\.(?:staging|previous)-[0-9A-Za-z]+$/;

// The only places where a template host may appear, with the exact number of each token. A file that
// no longer matches fails the build instead of being silently skipped.
const HOST_FILES = Object.freeze({
  'src/main.js': { 'inhagame.example': 1, 'www.inhagame.example': 1 },
  'index.html': { 'duck.inhagame.example': 4, 'induckup.inhagame.example': 1, 'survival.inhagame.example': 1, 'grow.inhagame.example': 1 },
  'hub.js': { 'duck.inhagame.example': 2, 'induckup.inhagame.example': 2, 'survival.inhagame.example': 2, 'grow.inhagame.example': 2 },
  'data/game-catalog.json': { 'duck.inhagame.example': 1, 'induckup.inhagame.example': 1, 'survival.inhagame.example': 1, 'grow.inhagame.example': 1 },
  'profile/profile.js': { 'duck.inhagame.example': 1, 'induckup.inhagame.example': 1, 'survival.inhagame.example': 1, 'grow.inhagame.example': 1 },
  'game-entry.js': { 'inhagame.example': 2, 'duck.inhagame.example': 1, 'induckup.inhagame.example': 1, 'survival.inhagame.example': 1, 'grow.inhagame.example': 1 },
  'hub-account.js': { 'inhagame.example': 1, 'duck.inhagame.example': 1 },
  'src/events/zombie-university-2026/event-route.js': { 'inhagame.example': 1, 'www.inhagame.example': 1 }
});
const TEMPLATE_TOKEN = /(?<![A-Za-z0-9.-])((?:www|duck|induckup|survival|grow)\.)?inhagame\.example(?![A-Za-z0-9-])/g;
const TOKEN_GAME = { 'inhagame.example': 'campus', 'duck.inhagame.example': 'classic', 'induckup.inhagame.example': 'induckup',
  'survival.inhagame.example': 'survival', 'grow.inhagame.example': 'grow' };

// Public export retained for callers; build and runtime use exactly the same decision.
export { resolveMode };

const PLACEHOLDER = /placeholder|changeme|your[-_]|example|xxxx/i;
const BAD_HOSTNAME = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|10\.|192\.168\.)|\.(example|test|invalid|local|localhost)$/i;

export function validateSupabase({ url, publishableKey }) {
  if (!url) throw new ConfigError('missing INHAGAME_PUBLIC_SUPABASE_URL');
  if (!publishableKey) throw new ConfigError('missing INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  let parsed;
  try { parsed = new URL(url); } catch { throw new ConfigError('INHAGAME_PUBLIC_SUPABASE_URL is not a valid URL'); }
  if (parsed.protocol !== 'https:') throw new ConfigError('INHAGAME_PUBLIC_SUPABASE_URL must use https');
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new ConfigError('INHAGAME_PUBLIC_SUPABASE_URL must be a bare origin (no credentials, path, query or fragment)');
  }
  if (BAD_HOSTNAME.test(parsed.hostname) || PLACEHOLDER.test(parsed.hostname)) {
    throw new ConfigError('INHAGAME_PUBLIC_SUPABASE_URL points at localhost or a placeholder host');
  }
  if (/^sb_secret_/.test(publishableKey)) throw new ConfigError('the Supabase key is a secret key; only a publishable key may reach the browser');
  if (/^sb_publishable_/.test(publishableKey)) {
    if (PLACEHOLDER.test(publishableKey) || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(publishableKey)) {
      throw new ConfigError('the Supabase publishable key is a placeholder or malformed');
    }
  } else if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(publishableKey)) {
    let role;
    try { role = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString('utf8')).role; } catch { role = undefined; }
    if (role !== 'anon') throw new ConfigError(`the Supabase JWT key has role "${role ?? 'unknown'}"; only the anon role may reach the browser`);
  } else {
    throw new ConfigError('the Supabase key is not a publishable key type');
  }
  return Object.freeze({ url: parsed.origin, publishableKey });
}

function replaceOnce(source, pattern, replacement, what) {
  const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g')) ?? [];
  if (matches.length !== 1) throw new ConfigError(`${what}: expected exactly one match, found ${matches.length}; the template changed`);
  return source.replace(pattern, () => replacement);
}

export function generateClassicConfig(template, { url, publishableKey }, mode) {
  let out = replaceOnce(template, /url: "[^"\n]*"/, `url: ${JSON.stringify(url)}`, `${CLASSIC_CONFIG} url`);
  out = replaceOnce(out, /publishableKey: "[^"\n]*"/, `publishableKey: ${JSON.stringify(publishableKey)}`, `${CLASSIC_CONFIG} key`);
  return `/* Generated by scripts/build-public-config.mjs (mode: ${mode}). Public browser values only. */\n${out}`;
}

export function generateEsmConfig(template, { url, publishableKey }, mode) {
  const block = /const BAKED_PRIVATE_DEFAULT = \{[^}]*\};/;
  const baked = `const BAKED_PRIVATE_DEFAULT = {\n  url: ${JSON.stringify(url)},\n  publishableKey: ${JSON.stringify(publishableKey)},\n};`;
  return `/* Generated by scripts/build-public-config.mjs (mode: ${mode}). Public browser values only. */\n${replaceOnce(template, block, baked, `${ESM_CONFIG} defaults`)}`;
}

export function rewriteHosts(relativePath, source, hosts) {
  const expected = HOST_FILES[relativePath];
  const counts = {};
  const out = source.replace(TEMPLATE_TOKEN, (token, prefix) => {
    counts[token] = (counts[token] ?? 0) + 1;
    if (token === 'www.inhagame.example') return `www.${hosts.campus}`;
    return hosts[TOKEN_GAME[token]];
  });
  const same = Object.keys(expected).length === Object.keys(counts).length &&
    Object.entries(expected).every(([token, count]) => counts[token] === count);
  if (!same) throw new ConfigError(`${relativePath}: host references changed (expected ${JSON.stringify(expected)}, found ${JSON.stringify(counts)})`);
  if (/inhagame\.example/.test(out)) throw new ConfigError(`${relativePath}: a template host is still present after rewriting`);
  return out;
}

function listFiles(fs, root, relative = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(fs, root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

function isExcluded(fs, rel, excludedDirs, srcRoot) {
  const top = rel.split('/')[0];
  const parts = rel.split('/').length;
  if (parts === 1 && (EXCLUDED_TOP_PATTERN.test(top) || EXCLUDED_TOP.has(top))) return true;
  if (parts > 1 && EXCLUDED_TOP.has(top)) return true;
  if (LEFTOVER_PATTERN.test(top)) return true; // existing top-level reserved build names
  // A nested output may leave a backup or staging tree when cleanup fails. Exclude only
  // marker-owned directories at those levels, not arbitrary lookalike user asset folders.
  const segments = rel.split('/');
  for (let i = 1; i < segments.length - 1; i++) {
    if (!LEFTOVER_PATTERN.test(segments[i])) continue;
    const dir = path.join(srcRoot, ...segments.slice(0, i + 1));
    if (isRegularFile(fs, path.join(dir, MARKER)) || isRegularFile(fs, path.join(dir, STAGING_MARKER))) return true;
  }
  if (path.basename(rel).startsWith('.env')) return true;
  if (/^tests-.*\.mjs$/.test(path.basename(rel))) return true; // npc-factory CI tests, imported only by qa.mjs
  const abs = path.join(srcRoot, rel);
  return excludedDirs.some(dir => abs.startsWith(dir + path.sep));
}

const isRegularFile = (fs, file) => { try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; } };
const lstatOrNull = (fs, file) => { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const quietRemove = (fs, target) => { try { fs.rmSync(target, { recursive: true, force: true }); return true; } catch { return false; } };

function treeDigest(fs, root, files) {
  const hash = createHash('sha256');
  for (const rel of files) hash.update(rel + '\0').update(fs.readFileSync(path.join(root, rel))).update('\0');
  return hash.digest('hex');
}

// Resolves and checks the output location. Never follows a symlink and never accepts a directory that is not
// empty and not a previous build output, so a mistyped --out cannot delete user data.
function resolveOutput(fs, srcReal, outDir) {
  const requested = path.resolve(srcReal, outDir ?? 'dist');
  const base = path.basename(requested);
  if (!base || base === '.' || base === '..' || requested === path.parse(requested).root) {
    throw new ConfigError('refusing an output directory without a name of its own');
  }
  const parent = path.dirname(requested);
  fs.mkdirSync(parent, { recursive: true });
  const parentReal = fs.realpathSync(parent);
  const out = path.join(parentReal, base);
  if (out === srcReal || srcReal.startsWith(out + path.sep)) {
    throw new ConfigError('refusing to use the source tree (or one of its parents) as the output directory');
  }
  const stat = lstatOrNull(fs, out);
  if (stat) {
    if (stat.isSymbolicLink()) throw new ConfigError('refusing an output directory that is a symbolic link');
    if (!stat.isDirectory()) throw new ConfigError('the output path exists and is not a directory');
    if (fs.readdirSync(out).length && !isRegularFile(fs, path.join(out, MARKER))) {
      throw new ConfigError('refusing to overwrite a non-empty directory that is not a previous build output');
    }
  }
  return { out, parentReal, base, existed: Boolean(stat) };
}

// Removes staging directories left behind by an interrupted run. Only directories that carry our own staging
// marker are touched; a ".previous-*" backup is never removed automatically (it may be the only good copy).
function removeStaleStaging(fs, parent, base, log) {
  const prefix = `.${base}.staging-`;
  for (const name of fs.readdirSync(parent)) {
    if (!name.startsWith(prefix)) continue;
    const dir = path.join(parent, name);
    const stat = lstatOrNull(fs, dir);
    if (stat?.isDirectory() && !stat.isSymbolicLink() && isRegularFile(fs, path.join(dir, STAGING_MARKER))) {
      if (quietRemove(fs, dir)) log(`public build: removed stale staging directory ${name}`);
    }
  }
}

export function build({ srcRoot = SRC_ROOT, outDir, env = process.env, mode: explicitMode, log = () => {}, fs = REAL_FS } = {}) {
  // 1. Decide the mode and validate every input before touching the filesystem.
  const mode = resolveMode({ explicit: explicitMode, env });
  let hosts = null;
  let supabase = null;
  if (mode !== 'local') {
    supabase = validateSupabase({ url: env.INHAGAME_PUBLIC_SUPABASE_URL, publishableKey: env.INHAGAME_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
    hosts = validateHosts(readHostInput(env), { mode });
  }

  // 2. Resolve the output location (symlinks, parents, source protection) without changing anything.
  const srcReal = fs.realpathSync(srcRoot);
  const { out, parentReal, base, existed } = resolveOutput(fs, srcReal, outDir);
  removeStaleStaging(fs, parentReal, base, log);

  // 3. Build into a private staging directory next to the target (same filesystem, so the swap is a rename).
  const staging = fs.mkdtempSync(path.join(parentReal, `.${base}.staging-`));
  let backup = null;
  try {
    fs.chmodSync(staging, 0o755);
    fs.writeFileSync(path.join(staging, STAGING_MARKER), 'in progress\n');
    const sources = listFiles(fs, srcReal).filter(rel => !isExcluded(fs, rel, [out, staging], srcReal));
    for (const rel of [CLASSIC_CONFIG, ESM_CONFIG, ...Object.keys(HOST_FILES)]) {
      if (!sources.includes(rel)) throw new ConfigError(`expected source file is missing: ${rel}`);
    }
    const hash = createHash('sha256');
    for (const rel of sources) {
      const from = path.join(srcReal, rel);
      const to = path.join(staging, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      let content = null;
      if (mode !== 'local') {
        if (rel === CLASSIC_CONFIG) content = generateClassicConfig(fs.readFileSync(from, 'utf8'), supabase, mode);
        else if (rel === ESM_CONFIG) content = generateEsmConfig(fs.readFileSync(from, 'utf8'), supabase, mode);
        else if (HOST_FILES[rel]) content = rewriteHosts(rel, fs.readFileSync(from, 'utf8'), hosts);
      }
      if (content === null) fs.copyFileSync(from, to); else fs.writeFileSync(to, content);
      hash.update(rel + '\0').update(content === null ? fs.readFileSync(from) : Buffer.from(content)).update('\0');
    }
    const digest = hash.digest('hex');

    // 4. Verify the staged tree completely before it can replace anything.
    const staged = listFiles(fs, staging).filter(rel => rel !== STAGING_MARKER);
    if (staged.length !== sources.length || staged.some((rel, index) => rel !== sources[index])) {
      throw new ConfigError('verification failed: the staged file set does not match the source list');
    }
    if (treeDigest(fs, staging, staged) !== digest) throw new ConfigError('verification failed: staged content differs from what was generated');
    if (mode !== 'local') {
      for (const rel of Object.keys(HOST_FILES)) {
        if (/inhagame\.example/.test(fs.readFileSync(path.join(staging, rel), 'utf8'))) {
          throw new ConfigError(`verification failed: ${rel} still holds a template host`);
        }
      }
      for (const rel of [CLASSIC_CONFIG, ESM_CONFIG]) {
        const text = fs.readFileSync(path.join(staging, rel), 'utf8');
        if (!text.includes(JSON.stringify(supabase.url)) || !text.includes(JSON.stringify(supabase.publishableKey))) {
          throw new ConfigError(`verification failed: ${rel} does not carry the configured Supabase values`);
        }
      }
    }
    fs.writeFileSync(path.join(staging, MARKER), `mode=${mode}\ntree=${digest}\n`);
    fs.rmSync(path.join(staging, STAGING_MARKER), { force: true });

    // 5. Swap. The previous output is moved aside first and restored if the new one cannot be put in place.
    if (existed) {
      backup = path.join(parentReal, `.${base}.previous-${randomBytes(4).toString('hex')}`);
      fs.renameSync(out, backup);
    }
    try {
      fs.renameSync(staging, out);
    } catch (error) {
      let restored = !backup;
      if (backup) { try { fs.renameSync(backup, out); restored = true; } catch { restored = false; } }
      quietRemove(fs, staging);
      throw new ConfigError(restored
        ? `could not move the new build into place (${error.message}); the previous output was restored`
        : `could not move the new build into place (${error.message}); the previous output is preserved at ${backup}`);
    }
    if (backup && !quietRemove(fs, backup)) log(`public build: warning: could not remove the previous output at ${backup}`);

    log(`public build: mode=${mode} files=${sources.length} tree=${digest.slice(0, 16)}`);
    if (hosts) log(`public build: hosts ${KEYS.map(key => `${key}=${hosts[key]}`).join(' ')}`);
    if (supabase) log(`public build: supabase host=${new URL(supabase.url).hostname} key=${supabase.publishableKey.startsWith('sb_publishable_') ? 'publishable' : 'anon-jwt'}(${supabase.publishableKey.length} chars)`);
    return { mode, out, files: sources.length, tree: digest, hosts, templateHosts: templateHosts() };
  } catch (error) {
    quietRemove(fs, staging); // our own staging directory only; the existing output was never modified before the swap
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  try {
    build({ outDir: option('--out'), mode: option('--mode'), log: line => console.log(line) });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`build-public-config: ${error.message}`);
    process.exit(1);
  }
}
