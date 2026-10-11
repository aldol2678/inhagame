// Store-only ZIP: original bytes, no coordinates, account keys or metadata.
export const ALBUM_EXPORT_LIMITS = Object.freeze({ photos: 100, bytes: 32 * 1024 * 1024 });
const fail = code => Object.assign(new Error(code), { code });
const abort = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
export const formatPhotoBytes = bytes => bytes == null ? '확인 불가' : bytes < 1024 ? `${bytes} B` : `${(bytes / (bytes < 1048576 ? 1024 : 1048576)).toFixed(1)} ${bytes < 1048576 ? 'KiB' : 'MiB'}`;

export async function measureAlbum(album, { signal } = {}) {
  const generation = album.generation;
  const check = () => { if (signal?.aborted || generation !== album.generation) throw abort(); };
  check(); const records = await album.list(); check();
  let originalBytes = 0, thumbnailBytes = 0, damaged = 0;
  const photos = [];
  for (const record of records) {
    const sizes = await album.sizes(record.id); check();
    originalBytes += sizes.originalBytes ?? 0; thumbnailBytes += sizes.thumbnailBytes ?? 0;
    damaged += sizes.damaged ? 1 : 0;
    photos.push({ id: record.id, favorite: record.favorite === true, ...sizes });
  }
  return { count: records.length, originalBytes, thumbnailBytes, damaged, photos };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function header(length, fields) {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  for (const [offset, value, size] of fields) size === 4 ? view.setUint32(offset, value, true) : view.setUint16(offset, value, true);
  return bytes;
}
async function validateImage(blob) {
  if (typeof globalThis.createImageBitmap !== 'function') throw fail('DAMAGED_PHOTO');
  {
    const bitmap = await globalThis.createImageBitmap(blob);
    try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16 * 1024 * 1024) throw fail('DAMAGED_PHOTO'); }
    finally { bitmap.close(); }
  }
}

export async function createAlbumZip({ album, mode = 'all', selected = [], signal, onProgress = () => {}, validate = validateImage, yieldTask = turn }) {
  const generation = album.generation;
  const check = () => { if (signal?.aborted || album.generation !== generation) throw abort(); };
  check();
  if (!['all', 'favorites', 'selected'].includes(mode)) throw fail('INVALID_SELECTION');
  const wanted = new Set(selected), records = await album.list(); check();
  const photos = records.filter(p => mode === 'all' || (mode === 'favorites' ? p.favorite === true : wanted.has(p.id)));
  if (!photos.length) throw fail('EMPTY');
  if (photos.length > ALBUM_EXPORT_LIMITS.photos) throw fail('LIMIT');
  let totalBytes = 0;
  for (const photo of photos) {
    const size = await album.sizes(photo.id); check();
    if (size.originalBytes === null || !Number.isSafeInteger(size.originalBytes) || size.originalBytes <= 0) throw fail('DAMAGED_PHOTO');
    totalBytes += size.originalBytes;
    if (totalBytes > ALBUM_EXPORT_LIMITS.bytes) throw fail('LIMIT');
  }
  const parts = [], directory = []; let offset = 0, processedBytes = 0;
  try {
    for (let index = 0; index < photos.length; index++) {
      check(); const blob = await album.image(photos[index].id); check();
      if (!(blob instanceof Blob) || !blob.size) throw fail('DAMAGED_PHOTO');
      if (processedBytes + blob.size > totalBytes || processedBytes + blob.size > ALBUM_EXPORT_LIMITS.bytes) throw fail('LIMIT');
      const signature = new Uint8Array(await blob.slice(0, 24).arrayBuffer()); check();
      const png = [137,80,78,71,13,10,26,10].every((n,i) => signature[i] === n);
      const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
      if (!png && !jpeg) throw fail('DAMAGED_PHOTO');
      // Check dimensions before decode so a compressed image cannot allocate unbounded pixels.
      let width = 0, height = 0;
      if (png) {
        if (signature.length < 24) throw fail('DAMAGED_PHOTO');
        const view = new DataView(signature.buffer); width = view.getUint32(16); height = view.getUint32(20);
      } else {
        const bytes = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer()); check();
        const view = new DataView(bytes.buffer);
        for (let at = 2; at + 8 < bytes.length;) {
          if (bytes[at++] !== 255) break;
          while (bytes[at] === 255) at++;
          const marker = bytes[at++];
          if (marker === 0xda || marker === 0xd9 || at + 7 >= bytes.length) break;
          const length = view.getUint16(at);
          if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) { height = view.getUint16(at + 3); width = view.getUint16(at + 5); break; }
          if (length < 2) break;
          at += length;
        }
      }
      if (!width || !height || width * height > 16 * 1024 * 1024) throw fail('DAMAGED_PHOTO');
      await yieldTask(); check();
      try { await validate(blob); } catch { throw fail('DAMAGED_PHOTO'); } check();
      const name = new TextEncoder().encode(`photo-${String(index + 1).padStart(4, '0')}.${png ? 'png' : 'jpg'}`);
      let crc = 0xffffffff;
      const chunks = [];
      for (let start = 0; start < blob.size; start += 1024 * 1024) {
        check(); const chunk = new Uint8Array(await blob.slice(start, start + 1024 * 1024).arrayBuffer()); check();
        for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
        chunks.push(chunk); processedBytes += chunk.length;
        onProgress({ completed: index, count: photos.length, processedBytes, totalBytes });
        await yieldTask(); check();
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      // Fixed valid DOS date avoids copying private timestamps into ZIP metadata.
      parts.push(header(30, [[0,0x04034b50,4],[4,20,2],[12,33,2],[14,crc,4],[18,blob.size,4],[22,blob.size,4],[26,name.length,2]]), name, ...chunks);
      directory.push(header(46, [[0,0x02014b50,4],[4,20,2],[6,20,2],[14,33,2],[16,crc,4],[20,blob.size,4],[24,blob.size,4],[28,name.length,2],[42,offset,4]]), name);
      offset += 30 + name.length + blob.size;
      onProgress({ completed: index + 1, count: photos.length, processedBytes, totalBytes });
    }
    check();
    const directorySize = directory.reduce((sum, part) => sum + part.length, 0);
    return new Blob([...parts, ...directory, header(22, [[0,0x06054b50,4],[8,photos.length,2],[10,photos.length,2],[12,directorySize,4],[16,offset,4]])], { type: 'application/zip' });
  } finally { parts.length = 0; directory.length = 0; }
}

export function requestAlbumDownload(blob, { doc = globalThis.document, win = globalThis.window } = {}) {
  const url = win.URL.createObjectURL(blob), link = doc.createElement('a');
  try { link.href = url; link.download = 'inha-world-photos.zip'; link.hidden = true; doc.body.append(link); link.click(); }
  catch (error) { win.URL.revokeObjectURL(url); throw error; }
  finally { link.remove(); }
  // Browser download completion/disk errors are not exposed to JavaScript.
  win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
}
