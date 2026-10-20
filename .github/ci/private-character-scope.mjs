// Conservative facial-only routing. All common private-character acceptance stays required.
// This is an audited, immutable dependency snapshot, NOT a general JavaScript graph parser.
// Both base and head must match reviewed blob/tree identities. A future shared dependency
// version forces FULL until an explicit review updates the snapshot; never auto-rewrite it.
// The 56-module character import closure includes mount/render/seat/layout dependencies.
// Also cover literal/dynamic data reads, facial HTML/metrics, harness, server directories,
// import maps, engine pins, asset sources/tooling and download/hash workflow contracts.
// Pin the WHOLE reality-data tree: computed JSON loads must never escape the snapshot.
// Reviewed baselines: b994dc62e2f1922e07bcfdea8f2511514c8edb02 and the #406 integration.
// The only alternate runtime blob is campus-render-kit (explicit Application ownership).
// A change to that path itself is still FULL, regardless of its known fingerprint.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const AUDITED_INPUTS = Object.freeze({
  "apps/world/src/character-model.js": [
    "4dbbf400c35cc432f13cb62b8fbb6cfe378d826a"
  ],
  "apps/world/src/mounts/campus-kickboard-render.js": [
    "ec08696572ce192f08802446e82103fb200297e1"
  ],
  "apps/world/src/mounts/campus-kickboard-world.js": [
    "79fb23261101029d7b301e6d53fda5456f83a9d0"
  ],
  "apps/world/src/mounts/campus-balloon-world.js": [
    "2433f948fa9241e5646577b7f5028f811bf946f2"
  ],
  "apps/world/src/mounts/campus-bike-world.js": [
    "4ec6d793adc663b607ef7d61e486b78e16a662ab"
  ],
  "apps/world/src/seat-anchors.js": [
    "ceaa646659948b10a9ba64434fe1db0c4e10f67c"
  ],
  "apps/world/src/mounts/campus-kart-render.js": [
    "6e2860c57813a519f2b3a3ac1e51046dc3bd431a"
  ],
  "apps/world/src/mounts/campus-helicopter-rider.js": [
    "393152e8e9a1ca25fe587e2328f72f4fcc881d39"
  ],
  "apps/world/src/player-dimensions.js": [
    "2f72b78cc6742b23f08527ca20ea5d93d3423658"
  ],
  "apps/world/src/online/emotes.js": [
    "97043fdc889e43ce61e130d925dcfbbc0bbd29b3"
  ],
  "apps/world/src/mounts/duck-boat-world.js": [
    "a9456bbc14a50352f1146b38c02c5235d87f0757"
  ],
  "apps/world/src/mounts/campus-bike-rider.js": [
    "b025b242a7158d42140fc55efbe97c7a958454ad"
  ],
  "apps/world/src/mounts/campus-kart-world.js": [
    "dff767a0faeb2269b887259aec9386cd511bf60a"
  ],
  "apps/world/src/mounts/campus-balloon-render.js": [
    "f5bbea80ed9ebbf668a49d1310723cc6bc98e6cd"
  ],
  "apps/world/src/mounts/campus-helicopter-world.js": [
    "92ae492f081356195a3fc78bcc4d7c56007db6c5"
  ],
  "apps/world/src/mounts/campus-shuttle-world.js": [
    "862366071e5bf9170b6b45e54fd1283030dcc4f4"
  ],
  "apps/world/src/mounts/duck-boat-render.js": [
    "129dcf6c4d1f58917a70373ba47e0e063d78a5e1"
  ],
  "apps/world/src/appearance/equipment-anchors.js": [
    "9f931e00411fcd8c0a8fb121bba1b79896b92dbf"
  ],
  "apps/world/src/mounts/campus-shuttle-render.js": [
    "f42d406505e760746c8af11d56a541e2f801e39f"
  ],
  "apps/world/src/back-furniture-layout.js": [
    "71f3a28ffebedb671ebd24988bb5f84efe6f411c"
  ],
  "apps/world/src/matching-tree-layout.js": [
    "692b6b59591b8d42591c623b0e1715f248c2bb6e"
  ],
  "apps/world/src/roadview-layout.js": [
    "3dc243941202f634b0a780c649e333f4c798d628"
  ],
  "apps/world/src/stadium-stands-layout.js": [
    "09b4a896f71d4406a44e0c1c5e53c723d72150ab"
  ],
  "apps/world/src/campus-facilities.js": [
    "d520e8d49a04acead9f06934d52c2c39fcd6ac68"
  ],
  "apps/world/src/place-zone-registry.js": [
    "e21689fdb50dd1c23b1744a6d8a4bfefd59cf8a6"
  ],
  "apps/world/src/network/protocol.js": [
    "5831b51f933e2f2d8b0e18161a1d9062dd1810e9"
  ],
  "apps/world/src/campus-render-kit.js": [
    "4578b9d703ac28b815f7da51a715057b167428d3",
    "2d6236c5e240f382850a653962ee1a5e0ad68433"
  ],
  "apps/world/src/mounts/duck-boat-motion.js": [
    "0f14341be3f911b575d2ba9d109635b341233094"
  ],
  "apps/world/src/world-scale.js": [
    "79e177920da008c5544127c22af803fa060cf03a"
  ],
  "apps/world/src/collection/item-catalog.js": [
    "1369ef9eb95eb516afa82741b91650f446f39e08"
  ],
  "apps/world/src/library-garden-layout.js": [
    "e3e281b508ed35a645a31fdc3325f8bf8dc850d4"
  ],
  "apps/world/src/basic-campus.js": [
    "2a0b8692745d85cf38c506aab5249f5c56a4041e"
  ],
  "apps/world/src/north-campus-layout.js": [
    "a93aa1ca039cac02675a4619a75fa4876ed9b262"
  ],
  "apps/world/src/north-side-gate-layout.js": [
    "0b9f79ab2e6cf51c66b932e2bdb94ac7b0d47f4b"
  ],
  "apps/world/src/back-gate-layout.js": [
    "1bd5df4a40bae57a8e31c3f46016bfb901d53635"
  ],
  "apps/world/src/campus-material-profile.js": [
    "aa0a3100fe39e8d82a0f70812278087442812445"
  ],
  "apps/world/src/editor/main-gate-production.js": [
    "fe0173ac00264da7ab5265ea63a45d9926432111"
  ],
  "apps/world/src/geo-coordinates.js": [
    "3d6b83117c40adaaa1764c3e7b9cca06a8766ad0"
  ],
  "apps/world/src/back-approach-layout.js": [
    "d2ad315e2182f70c79978b3b40b2e1c2232d2d9d"
  ],
  "apps/world/src/reality-adapter.js": [
    "d87c661f2b32536489f36e12f2861e1772fd5924"
  ],
  "apps/world/src/biryong/biryong-layout.js": [
    "78db1d5067d64719f74d2429793329df7fbf8321"
  ],
  "apps/world/src/main-gate-frame.js": [
    "e70ebe1553ea372921207009e542150044a4b48f"
  ],
  "apps/world/src/campus-road-layout.js": [
    "5a9eb2b23a71e299ddd0d363810003b23c95fbcd"
  ],
  "apps/world/src/north-landmark-massing.js": [
    "54e3658d5bdca9051abf31e72f8c1824f8d37e45"
  ],
  "apps/world/src/back-market-layout.js": [
    "c0f7662109f5f8c55deb52aa14c3347924d0495a"
  ],
  "apps/world/src/network/npc-talk-presence.js": [
    "a2acdedb0b53133d4a76c10df1614852e69c9bfa"
  ],
  "apps/world/src/culture-street-layout.js": [
    "e9ef5e76249f025a9b54cba6f58c3bbe5930a07f"
  ],
  "apps/world/src/world-exterior-bounds.js": [
    "a8b874299ab736b709119bfaf24f8d6c8bfe9b4a"
  ],
  "apps/world/src/library-route-layout.js": [
    "98e17e7225d5242a1e24f6bc6785f4007322c70c"
  ],
  "apps/world/src/polygon-collision.js": [
    "1bc47bd530d9110cc9c8d630822d2661025b862e"
  ],
  "apps/world/src/landmark-detail-layout.js": [
    "1e435b71ae943995eb5688f9ecaf873d6e6c71e1"
  ],
  "apps/world/src/back-street-layout.js": [
    "2a40c66a68c82d87f0c868f9cfebb33b7ffcc4d3"
  ],
  "apps/world/src/back-west-layout.js": [
    "00f8455c1b5fadfb039beed47dfd280858231a0e"
  ],
  "apps/world/src/back-alley-layout.js": [
    "9418d2ce3544d6191bb683cc97b98dc95a380bfe"
  ],
  "apps/world/src/street-sign-layout.js": [
    "84124d1704e2c234f344ba6db85b3124a7643706"
  ],
  "apps/world/src/market-interior-plan.js": [
    "bb7251af80c4c9dd10f9a56c3932e7b74ae2d51c"
  ],
  "apps/world/tests/browser/annyongi-face-diagnostic.mjs": [
    "a0dca7c9f191e33a117f23eefeab40f99418dcd5"
  ],
  "apps/world/tests/browser/annyongi-face-metrics.mjs": [
    "317629ac6aaf1ab4188242c9c3c29afa9c42e383"
  ],
  "apps/world/tests/browser/annyongi-face-interior-audit.mjs": [
    "128e86b1ee28a34e1a8189c8147d0f9b06de8bb1"
  ],
  "apps/world/tests/browser/annyongi-review-harness.html": [
    "47dc70a649e28f657e13881a7350e33ff3a6a831"
  ],
  "apps/world/tests/browser/harness.mjs": [
    "827a19c5354a90dc68a0239923564cfcf62bad4f"
  ],
  "apps/world/tests/browser/harness-source.mjs": [
    "33528ff6c7a0fb06b92b8d37cf5c0383e40f87b3"
  ],
  "apps/world/tests/browser/housing-sofa-cancellation-policy.mjs": [
    "3312030e6812c03628474d05db43933840af6a1d"
  ],
  "apps/world/tests/browser/package.json": [
    "383a19e3951817aa87970bb185eaed974d851ce9"
  ],
  "apps/world/tests/browser/package-lock.json": [
    "2864c07672b9614b901dc0cfd2ef20d9e5a9cc17"
  ],
  "apps/world/dev-server.mjs": [
    "8a94935b9595f31f7e3824bfbba3d2d61fd13008"
  ],
  "apps/world/npc-factory": [
    "ada20b6e650c60e40a9a1a06e0650e89c2f5b6af"
  ],
  "apps/world/model-converter": [
    "be0fe35b033ea0d18206fbe18456216fd230ee3c"
  ],
  "apps/world/data/reality/campus-landmarks.json": [
    "eca822fb17afa4a7acf23f590abfa2c775cd7321"
  ],
  "apps/world/data/editor/main-gate.world.json": [
    "3294fa44b7f87367d1638bca7a28d582ed0eeb49"
  ],
  "apps/world/campus/index.html": [
    "b12ab3ecbf180d56fe4acca52d7a97005a3ddc70"
  ],
  "apps/world/editor/index.html": [
    "4d69606fc9fa0edcd150167cda263cb829ff0b16"
  ],
  "apps/world/api/brand-asset.js": [
    "fafc076126e153505ba430ef8b54b9e55da02a27"
  ],
  "apps/world/vercel.json": [
    "233924b3593f4d99598e0dd6dce3e42c5be841af"
  ],
  "tools/world-assets": [
    "ce289d7f266787f29d6dad38dd6e663358aa9c77"
  ],
  "supabase/functions/inhagame-world-brand-assets-optimized-v1": [
    "2c399780949a90a35e38e9de396568dffd606e34"
  ],
  "apps/world/assets/annyongi-flight-v1.glb": [
    "c3b6da2df95d2b2b9915aa74fa75819b8e410baf"
  ],
  "apps/world/assets/induck-v3.glb": [
    "085c51b6b353534fe8a82b637ff35f2925563cbe"
  ],
  ".github/workflows/world-asset-optimizer.yml": [
    "b10f9fe79accd08f6d8907964abcf9348236f3ce"
  ],
  ".github/workflows/private-character-acceptance.yml": [
    "16b6b40fbc4dae425b496a11d51ef3a315c28283",
    "7daac00cf67b91b69e95daa6a75f08168563ab11"
  ],
  "apps/world/data/reality": [
    "3bf6684309ebb3981045f9d427a0df65493857fe"
  ]
});
const NO_FAST_TITLE = /(?:\brelease\b|\bhotfix\b|릴리스|출시|\[full-ci\])/i;
const FULL = reason => ({ full: true, reason });

// Only independently covered UI modules. No shared entrypoint, renderer, appearance,
// input, backend, build or harness path is eligible. Mixed changes force FULL.
export function eligibleUiPath(path) {
  if (typeof path !== 'string' || !path || path.includes('..') || /[\0\r\n\\]/.test(path)) return false;
  // The facial review harness has its own inline CSS and never imports styles.css.
  // Its exact HTML and both import-map owners must remain audited below.
  if (path === 'apps/world/styles.css') return true;
  return /^apps\/world\/src\/(?:phone|shop)\/[a-zA-Z0-9/_-]+\.js$/.test(path)
    || /^apps\/world\/tests\/(?:phone|shop)[a-zA-Z0-9_-]*\.test\.mjs$/.test(path)
    || /^apps\/world\/tests\/browser\/(?:phone|shop)[a-zA-Z0-9_-]*\.(?:mjs|html)$/.test(path);
}

export function classify(files, { event, title, beforeInputs, afterInputs } = {}) {
  if (event !== 'pull_request') return FULL('manual-or-unknown-event');
  if (typeof title !== 'string' || !title.trim() || NO_FAST_TITLE.test(title)) return FULL('release-or-unknown-pr');
  if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) return FULL('empty-or-invalid-changes');
  if (!files.every(eligibleUiPath)) return FULL('shared-mixed-or-unknown-path');
  // Audit the UNION of base/head inputs. A known version in only one side is insufficient.
  // The closed snapshot is deliberate: unknown/missing identities cannot opt out of QA.
  for (const [path, allowed] of Object.entries(AUDITED_INPUTS)) {
    if (!allowed.includes(beforeInputs?.[path]) || !allowed.includes(afterInputs?.[path])) {
      return FULL('unaudited-base-or-head-dependency');
    }
  }
  return { full: false, reason: 'audited-unrelated-ui' };
}

const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
});
export function inspect(env = process.env, runGit = git) {
  if (env.CI_EVENT !== 'pull_request') return FULL('manual-or-unknown-event');
  if (typeof env.CI_PR_TITLE !== 'string' || !env.CI_PR_TITLE.trim() || NO_FAST_TITLE.test(env.CI_PR_TITLE)) return FULL('release-or-unknown-pr');
  const base = env.CI_BASE_SHA, head = env.CI_HEAD_SHA;
  if (![base, head].every(sha => /^[0-9a-f]{40}$/.test(sha ?? '') && !/^0+$/.test(sha))) return FULL('unknown-sha');
  try {
    if (runGit('rev-parse', 'HEAD').trim() !== head) return FULL('head-mismatch');
    runGit('cat-file', '-e', base + '^{commit}');
    runGit('merge-base', '--is-ancestor', base, head);
    const raw = runGit('diff', '--no-renames', '--name-status', '-z', base, head, '--');
    if (!raw || !raw.endsWith('\0')) return FULL('empty-or-invalid-diff');
    const parts = raw.slice(0, -1).split('\0');
    if (parts.length % 2) return FULL('invalid-file-status');
    const files = [];
    for (let index = 0; index < parts.length; index += 2) {
      if (!['A', 'M'].includes(parts[index])) return FULL('unsafe-file-change');
      files.push(parts[index + 1]);
    }
    // Avoid hundreds of object reads for changes that already require full acceptance.
    if (!files.length || !files.every(eligibleUiPath)) return FULL('shared-mixed-or-unknown-path');
    const readInputs = ref => Object.fromEntries(Object.keys(AUDITED_INPUTS).map(path => {
      const sha = runGit('rev-parse', '--verify', ref + ':' + path).trim();
      if (!/^[0-9a-f]{40}$/.test(sha)) throw Error('invalid dependency identity');
      return [path, sha];
    }));
    return classify(files, { event: env.CI_EVENT, title: env.CI_PR_TITLE,
      beforeInputs: readInputs(base), afterInputs: readInputs(head) });
  } catch {
    return FULL('missing-history-or-dependency');
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = inspect();
  process.stdout.write('full=' + result.full + '\nreason=' + result.reason + '\n');
  console.error('private-character-scope: ' + (result.full ? 'FULL facial required' : 'NOT_RUN_SCOPE facial; common suites required') + ' (' + result.reason + ')');
}
