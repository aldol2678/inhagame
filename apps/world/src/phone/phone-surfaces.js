// Move the existing DOM surface; its controller, listeners, search and coordinate system survive.
export function createPhoneSurface(element) {
  let parent = null, next = null, previousModal = null, previousInert = false;
  return Object.freeze({
    mount(host) {
      if (!element || parent) return;
      parent = element.parentNode; next = element.nextSibling; previousModal = element.getAttribute('aria-modal');
      previousInert = element.inert; element.inert = false;
      element.dataset.phoneHosted = 'true'; element.removeAttribute('aria-modal'); host.append(element);
    },
    restore() {
      if (!parent) return;
      element.removeAttribute('data-phone-hosted');
      element.inert = previousInert;
      if (previousModal !== null) element.setAttribute('aria-modal', previousModal);
      parent.insertBefore(element, next?.parentNode === parent ? next : null); parent = null; next = null;
    }
  });
}

export function mapPlaceRecord(value, mapSourceId) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.z)) return null;
  const point = value.mapPoint || value.poiId === 'map.point';
  return { id: point ? `${value.mapSourceId ?? mapSourceId}:${value.x}:${value.z}` : value.poiId || value.id || `${mapSourceId}:${value.x}:${value.z}`, poiId: point ? null : value.poiId ?? null,
    mapSourceId: value.mapSourceId ?? mapSourceId, title: value.title || '선택한 위치', x: value.x, z: value.z };
}

export function createPhoneMapHistory({ getStorage, getScope = () => 'guest', onError = () => {} }) {
  let favorites = [], recent = [];
  const key = () => `inha-world-phone-map-v1:${getScope()}`;
  function load() {
    favorites = []; recent = [];
    try {
      const raw = JSON.parse(getStorage()?.getItem(key()) || '{}');
      const valid = list => Array.isArray(list) ? [...new Map(list.map(x=>mapPlaceRecord(x,x?.mapSourceId)).filter(Boolean).map(x=>[x.id,x])).values()].slice(0,20) : [];
      favorites = valid(raw.favorites); recent = valid(raw.recent);
    } catch { onError('지도 기록을 불러오지 못했어요.'); }
  }
  function save() {
    try {
      const storage = getStorage(), value = JSON.stringify({favorites,recent});
      if (!storage) throw Error('storage'); storage.setItem(key(),value);
      if (storage.getItem(key()) !== value) throw Error('readback');
      return true;
    } catch { onError('지도 기록을 저장하지 못했어요. 현재 화면에만 적용했어요.'); return false; }
  }
  load();
  function favorite(value, mapSourceId, enabled) {
    const place=mapPlaceRecord(value,mapSourceId); if (!place) return false;
    favorites=enabled ? [place,...favorites.filter(x=>x.id!==place.id)].slice(0,20) : favorites.filter(x=>x.id!==place.id);
    return save();
  }
  return Object.freeze({ load, snapshot:()=>({favorites:[...favorites],recent:[...recent]}),
    has(value,mapSourceId) { const place=mapPlaceRecord(value,mapSourceId); return !!place && favorites.some(x=>x.id===place.id); },
    favorite,
    remember(value,mapSourceId) { const place=mapPlaceRecord(value,mapSourceId); if (!place) return; recent=[place,...recent.filter(x=>x.id!==place.id)].slice(0,20); save(); },
    toggle(value,mapSourceId) { const place=mapPlaceRecord(value,mapSourceId); if (!place) return false;
      return favorite(value,mapSourceId,!favorites.some(x=>x.id===place.id)); }
  });
}
