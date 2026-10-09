import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const matches = (path, patterns) => patterns.some(pattern => pattern.test(path));

const SHARED = [
  /^\.github\/workflows\/world-asset-optimizer\.yml$/,
  /^\.github\/ci\/world-asset-scope(?:\.test)?\.mjs$/,
  /^apps\/world\/tests\/browser\/harness\.mjs$/,
  /^apps\/world\/tests\/browser\/package(?:-lock)?\.json$/
];

const CORE_AND_CANARY = [
  /^tools\/world-assets\//,
  /^apps\/world\/assets\/[^/]+\.glb$/,
  /^apps\/world\/src\/asset-optimization-shadow\.js$/,
  /^apps\/world\/src\/character-model\.js$/
];

const OPTIMIZER = [
  /^apps\/world\/tests\/asset-optimization-shadow\.test\.mjs$/,
  /^apps\/world\/tests\/browser\/asset-optimization-shadow-/
];

const GRAPHICS = [
  /^apps\/world\/src\/main\.js$/,
  /^apps\/world\/src\/campus-render-kit\.js$/,
  /^apps\/world\/src\/campus-material-profile\.js$/,
  /^apps\/world\/src\/lobby\/lobby-loading\.js$/,
  /^apps\/world\/src\/campus-road-geometry\.js$/,
  /^apps\/world\/src\/campus-road-micro-details\.js$/,
  /^apps\/world\/src\/campus-contact-shading.*\.js$/,
  /^apps\/world\/src\/campus-chunk-renderer\.js$/,
  /^apps\/world\/src\/graphics-presets\.js$/,
  /^apps\/world\/src\/view-distance-settings\.js$/,
  /^apps\/world\/src\/environment\/environment-(director|presets|world-time)\.js$/,
  /^apps\/world\/src\/environment\/winter-soak-policy\.js$/,
  /^apps\/world\/src\/biryong\/biryong-performance-(budget|monitor)\.js$/,
  /^apps\/world\/tests\/campus-material-profile\.test\.mjs$/,
  /^apps\/world\/tests\/campus-road-micro-details\.test\.mjs$/,
  /^apps\/world\/tests\/campus-contact-shading\.test\.mjs$/,
  /^apps\/world\/tests\/graphics-parallel-smoke-contract\.test\.mjs$/,
  /^apps\/world\/tests\/environment-p6l-winter-soak\.test\.mjs$/,
  /^apps\/world\/tests\/biryong-performance-budget\.test\.mjs$/,
  /^apps\/world\/tests\/biryong-performance-smoke-diagnostics\.test\.mjs$/,
  /^apps\/world\/tests\/browser\/(material-profile|loading-render|winter-soak|contact-shading|graphics-parallel|biryong-performance)/
];

const CANARY = [
  /^apps\/world\/src\/asset-(authority-canary|production-canary|canary-remote-control|canary-telemetry)\.js$/,
  /^apps\/world\/api\/(asset-canary-flag|hub-event|brand-asset)\.js$/,
  /^apps\/world\/vercel\.json$/,
  /^apps\/world\/tests\/brand-asset-routing\.test\.mjs$/,
  /^apps\/world\/tests\/asset-(authority-canary|production-canary|canary-flag-api|canary-remote-control)\.test\.mjs$/,
  /^apps\/world\/tests\/browser\/asset-(authority-canary|production-canary|canary-remote-kill)-/,
  /^supabase\/functions\/inhagame-world-brand-assets-optimized-v1\//,
  /^supabase\/migrations\/.*asset_canary.*$/,
  /^supabase\/tests\/database\/91_world_asset_canary_remote_control\.test\.sql$/
];

export function classifyWorldAssetPaths(paths) {
  const scope = { optimizer: false, graphics: false, canary: false };
  let matched = false;

  for (const path of paths.filter(Boolean)) {
    if (matches(path, SHARED)) {
      scope.optimizer = scope.graphics = scope.canary = true;
      matched = true;
      continue;
    }
    if (matches(path, CORE_AND_CANARY)) {
      scope.optimizer = true;
      scope.canary = true;
      matched = true;
    }
    if (matches(path, OPTIMIZER)) {
      scope.optimizer = true;
      matched = true;
    }
    if (matches(path, GRAPHICS)) {
      scope.graphics = true;
      matched = true;
    }
    if (matches(path, CANARY)) {
      scope.canary = true;
      matched = true;
    }
  }

  // Fail open for safety: a newly-added workflow trigger must never silently skip QA
  // just because the classifier was not updated in the same change.
  if (!matched) scope.optimizer = scope.graphics = scope.canary = true;
  return scope;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = readFileSync(0, "utf8").split(/\r?\n/u).filter(Boolean);
  const scope = classifyWorldAssetPaths(paths);
  for (const [key, value] of Object.entries(scope)) console.log(`${key}=${value}`);
}
