const DATABASE = 'inha-world-phone-v1';
const abortError = () => Object.assign(new Error('account changed'), { name: 'AbortError' });
const safePosition = p => p && [p.x,p.y,p.z].every(Number.isFinite) ? { x:p.x,y:p.y,z:p.z } : null;

export async function createPhotoThumbnail(blob, { doc = globalThis.document, decode = globalThis.createImageBitmap } = {}) {
  const bitmap = await decode(blob);
  try {
    const canvas = doc.createElement('canvas'), scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve,reject) => canvas.toBlob(value => value ? resolve(value) : reject(Error('thumbnail failed')), 'image/jpeg', .8));
  } finally { bitmap.close(); }
}

// Device-local, account-scoped travel records. Three separate entries are committed atomically.
// This store is never Player/Profile, server progress, or cross-device account authority.
export function createPhoneAlbum({ indexedDB = globalThis.indexedDB, thumbnail = createPhotoThumbnail,
  makeId = () => globalThis.crypto.randomUUID(), onError = () => {} } = {}) {
  let dbPromise = null, scope = 'guest', epoch = 0, lastError = null;
  const activeTransactions = new Set();
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
      if (!indexedDB) { reject(Error('IndexedDB unavailable')); return; }
      const request = indexedDB.open(DATABASE, 1);
      const timer = setTimeout(() => reject(Error('Album storage blocked')), 5000);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('records', { keyPath:'key' }).createIndex('scope', 'scope');
        db.createObjectStore('images', { keyPath:'key' });
      };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => { clearTimeout(timer); const db = request.result; db.onversionchange = () => { db.close(); dbPromise = null; }; resolve(db); };
    }).catch(error => { dbPromise = null; throw error; });
    return dbPromise;
  }
  async function transact(mode, mine, fn) {
    const db = await database();
    if (mine !== epoch) throw abortError();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(['records','images'], mode); activeTransactions.add(tx);
      let result;
      tx.oncomplete = () => { activeTransactions.delete(tx); mine === epoch ? resolve(result) : reject(abortError()); };
      tx.onerror = tx.onabort = () => { activeTransactions.delete(tx); reject(tx.error ?? abortError()); };
      try { fn(tx.objectStore('records'), tx.objectStore('images'), value => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  const keyFor = id => `${scope}/${id}`;
  const reportError = error => { if (error.name !== 'AbortError') { lastError = '앨범 저장소를 사용할 수 없어요. PNG 파일을 이 기기에 저장해 주세요.'; onError(lastError); } };
  async function read(id) {
    const key = keyFor(id), mine = epoch;
    return transact('readonly', mine, (records,images,done) => {
      const request = records.get(key); request.onsuccess = () => done(request.result?.record ?? null);
    });
  }
  async function list() {
    const at = scope, mine = epoch;
    try {
      return await transact('readonly', mine, (records,images,done) => {
        const r = records.index('scope').getAll(at);
        r.onsuccess = () => done(r.result.map(x=>x.record).sort((a,b) => b.capturedAtReal.localeCompare(a.capturedAtReal)));
      });
    } catch (error) { reportError(error); throw error; }
  }
  async function image(id, kind = 'original') {
    const record = await read(id); if (!record) return null;
    const ref = kind === 'thumbnail' ? record.thumbnailRef : record.imageRef;
    return transact('readonly', epoch, (records,images,done) => { const r = images.get(ref); r.onsuccess = () => done(r.result?.blob ?? null); });
  }
  async function save(result, context = {}) {
    const mine = epoch, at = scope;
    try {
      if (!result?.blob?.size || context.scope !== undefined && context.scope !== at) return null;
      const thumb = await thumbnail(result.blob);
      if (mine !== epoch) return null;
      const id = makeId(), key = keyFor(id);
      const record = { id, imageRef: `${key}:original`, thumbnailRef: `${key}:thumbnail`,
        capturedAtReal: context.capturedAtReal ?? new Date().toISOString(), capturedAtWorld: context.capturedAtWorld ?? null,
        position: safePosition(context.position), mapSourceId: context.mapSourceId ?? 'campus',
        locationId: context.locationId ?? null, locationName: context.locationName || '캠퍼스',
        weatherId: context.weatherId ?? null, nearbyNpcIds: Array.isArray(context.nearbyNpcIds) ? [...context.nearbyNpcIds] : [],
        questId: context.questId ?? null, favorite: false, caption: '' };
      await transact('readwrite', mine, (records,images) => {
        records.put({key,scope:at,record}); images.put({key:record.imageRef,blob:result.blob}); images.put({key:record.thumbnailRef,blob:thumb});
      });
      const verify = await read(id), original = await image(id), preview = await image(id,'thumbnail');
      if (mine !== epoch || !verify || original?.size !== result.blob.size || preview?.size !== thumb.size) throw Error('Album readback failed');
      lastError = null; return verify;
    } catch (error) { reportError(error); return null; }
  }
  async function favorite(id, value) {
    const mine = epoch, key = keyFor(id);
    try {
      await transact('readwrite', mine, (records,images) => {
        const r = records.get(key); r.onsuccess = () => { if (r.result) records.put({...r.result,record:{...r.result.record,favorite:value === true}}); };
      });
      return (await read(id))?.favorite === value;
    } catch (error) { reportError(error); return false; }
  }
  async function remove(id) {
    const mine = epoch, key = keyFor(id), record = await read(id);
    if (!record || mine !== epoch) return false;
    try {
      await transact('readwrite', mine, (records,images) => { records.delete(key); images.delete(record.imageRef); images.delete(record.thumbnailRef); });
      return await transact('readonly', mine, (records,images,done) => {
        const requests = [records.get(key),images.get(record.imageRef),images.get(record.thumbnailRef)];
        let left=3, empty=true;
        for (const r of requests) r.onsuccess=()=>{empty &&= r.result === undefined; if (!--left) done(empty);};
      });
    } catch (error) { reportError(error); return false; }
  }
  return Object.freeze({ list, read, image, save, favorite, remove,
    setScope(userId) { epoch++; for (const tx of activeTransactions) { try { tx.abort(); } catch {} } scope = userId ? `member:${userId}` : 'guest'; lastError = null; },
    get scope() { return scope; }, get error() { return lastError; },
    destroy() { epoch++; for (const tx of activeTransactions) { try { tx.abort(); } catch {} } }
  });
}
