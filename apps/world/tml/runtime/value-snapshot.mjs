// PR1 owns the data it prepares before awaiting providers. This is deliberately
// not a canonical serializer, evidence admission policy, or equality function.
export function snapshotTmlData(value) {
  const active = new Set();

  function copy(item) {
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') throw new TypeError('TML data must contain only plain data values');
    if (active.has(item)) throw new TypeError('TML data must not contain cycles');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('TML data must contain only plain objects');
    }
    active.add(item);
    const result = array ? [] : {};
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key];
      if (typeof key !== 'string' || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('TML data must not contain symbols or accessors');
      }
      if (!descriptor.enumerable) continue;
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) {
        throw new TypeError('TML lists must contain only indexed values');
      }
      Object.defineProperty(result, key, {
        value: copy(descriptor.value), enumerable: true, configurable: true, writable: true
      });
    }
    if (array && (result.length !== item.length || Object.keys(result).length !== item.length)) {
      throw new TypeError('TML lists must not contain empty slots');
    }
    active.delete(item);
    return Object.freeze(result);
  }

  return copy(value);
}

// Diagnostics must remain available even when a provider throws an unusual
// object whose error properties cannot safely be read.
export function summarizeTmlError(error) {
  let code = 'TML_RUNTIME_ERROR';
  let message;
  try {
    if (typeof error?.code === 'string') code = error.code;
    else if (typeof error?.name === 'string') code = error.name;
  } catch { /* Keep the safe fallback. */ }
  try {
    if (typeof error?.message === 'string') message = error.message;
  } catch { /* The diagnostic code still survives. */ }
  return Object.freeze(message === undefined ? { code } : { code, message });
}
