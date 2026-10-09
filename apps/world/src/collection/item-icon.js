// Presentation-only assets. Never derives ownership, discovery, reward or equipment state.
// Fixed filenames prevent catalog misses or unexpected IDs from becoming arbitrary requests.
const ITEM_IDS = Object.freeze([
  'head.inha_cap', 'top.inha_basic', 'back.freshman_bag', 'badge.main_gate', 'head.induck_cap',
  'material.campus_leaf', 'material.fish_carp', 'material.artifact_fragment_01'
]);
const BY_ASSET_ID = new Map(ITEM_IDS.map(itemId => {
  const at = size => new URL(`../../assets/item-icons/active8-v1/png/${size}/${itemId}.png`, import.meta.url).href;
  return [`icon.${itemId}.v1`, Object.freeze({itemId, src:at(64), srcSet:`${at(64)} 1x, ${at(128)} 2x`})];
}));

export function resolveItemIcon(definition) {
  const asset = BY_ASSET_ID.get(definition?.iconAssetId);
  return asset && asset.itemId === definition?.itemId ? asset : null;
}

/** Stable-size, labelled image with text fallback during loading and after a failed load. */
export function createItemIcon({doc = globalThis.document, definition = null, name = definition?.displayName ?? '아이템'} = {}) {
  const root = doc.createElement('span');
  root.className = 'item-icon';
  root.setAttribute('role', 'img');
  const fallback = doc.createElement('span');
  fallback.className = 'item-icon-fallback';
  fallback.textContent = '?';
  fallback.setAttribute('aria-hidden', 'true');
  root.append(fallback);
  const asset = resolveItemIcon(definition);
  root.dataset.state = asset ? 'loading' : 'unavailable';
  root.setAttribute('aria-label', `${name} ${asset ? '아이콘' : '이미지 없음'}`);
  if (!asset) return root;
  const image = doc.createElement('img');
  image.className = 'item-icon-image';
  image.alt = ''; // The wrapper supplies one accessible name in every load state.
  image.width = 64;
  image.height = 64;
  image.decoding = 'async';
  image.hidden = true;
  let failed = false;
  image.addEventListener('load', () => {
    if (failed) return;
    image.hidden = false;
    fallback.hidden = true;
    root.dataset.state = 'ready';
  });
  image.addEventListener('error', () => {
    failed = true;
    image.hidden = true;
    fallback.hidden = false;
    root.dataset.state = 'unavailable';
    root.setAttribute('aria-label', `${name} 이미지 없음`);
    // No replacement URL or retry loop. Reopening/re-rendering can make a fresh attempt.
  });
  root.append(image);
  image.srcset = asset.srcSet;
  image.src = asset.src;
  return root;
}
