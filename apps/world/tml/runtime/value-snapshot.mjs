import { assertTmlValueStructure } from './conformance.mjs';

function copyTmlData(value) {
  const active = new Set();

  function copy(item) {
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') throw new TypeError('TML data must contain only plain data values');
    if (active.has(item)) throw new TypeError('TML data must not contain cycles');
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if ((array && prototype !== Array.prototype) ||
        (!array && prototype !== Object.prototype && prototype !== null)) {
      throw new TypeError('TML data must contain only plain objects or arrays');
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
      if (!descriptor.enumerable) {
        // Dropping hidden members could turn malformed typed data into valid
        // data before PR1 admission or post-read verification sees it.
        throw new TypeError('TML data must not contain hidden properties');
      }
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

// Ownership remains separate from value comparison. PR1 retained outcomes may
// contain undefined optional data; the caller's objects are never frozen.
export function snapshotTmlData(value) {
  return copyTmlData(value);
}

function canonicalOwnedData(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(canonicalOwnedData).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalOwnedData(value[key])}`).join(',')}}`;
}

// Sorted object members and ordered lists give plain data a deterministic
// representation. Bare undefined cannot alias a quoted string, null or an
// omitted member. This is not the P13 fingerprint byte format.
export function canonicalTmlData(value) {
  return canonicalOwnedData(copyTmlData(value));
}

export function canonicalTmlValue(value) {
  // Validate the original, before ownership could omit a non-JSON property.
  // The published IR schema owns typed-value structure; no values are coerced.
  assertTmlValueStructure(value);
  return canonicalTmlData(value);
}

export function sameTmlValue(left, right) {
  return canonicalTmlValue(left) === canonicalTmlValue(right);
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
