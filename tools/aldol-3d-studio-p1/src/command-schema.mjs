const isObject = o => o !== null && typeof o === 'object' && !Array.isArray(o);
export const plain = isObject;
const keysOnly = (obj, allowed) => Object.keys(obj).every(k => allowed.includes(k));
const string = v => typeof v === 'string' && v.trim().length > 0;
const vector = (v,n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
const jsonSafe = value => {
  try {
    if (JSON.stringify(value) === undefined) return false;
    // Detect functions, undefined, nonfinite, cycles, prototype/symbol surprises.
    const check = (v, seen = new Set()) => {
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
      if (typeof v === 'number') return Number.isFinite(v);
      if (typeof v !== 'object' || seen.has(v) || !Array.isArray(v) && !isObject(v)) return false;
      seen.add(v);
      const ok = Object.keys(v).every(k => check(v[k],seen));
      seen.delete(v);
      return ok;
    };
    return check(value);
  } catch { return false; }
};
export function validateTransform(t) {
  if (!isObject(t) || !keysOnly(t,['position','rotation','scale']) || !vector(t.position,3) || !vector(t.rotation,4) || !vector(t.scale,3) || !t.scale.every(x => x > 0) || Math.hypot(...t.rotation) < 1e-12) return 'E_TRANSFORM_INVALID';
  return null;
}
export function validateCommand(c) {
  if (!isObject(c) || !keysOnly(c,['commandId','expectedRevision','operation','targetId','payload']) || !string(c.commandId) || c.commandId.length > 150 || !string(c.expectedRevision) || !string(c.operation) || !isObject(c.payload) || !jsonSafe(c.payload)) return 'E_COMMAND_INVALID';
  const p = c.payload;
  const target = () => string(c.targetId);
  switch(c.operation){
    case 'node.create':
      if ('targetId' in c || !keysOnly(p,['id','name','kind','parentId','enabled','transform','tags','components','metadata']) || !string(p.id) || !string(p.name) || !string(p.kind) || (p.parentId !== undefined && p.parentId !== null && !string(p.parentId)) || (p.enabled !== undefined && typeof p.enabled !== 'boolean') || (p.transform !== undefined && validateTransform(p.transform)) || (p.tags !== undefined && (!Array.isArray(p.tags) || !p.tags.every(x=>typeof x==='string'))) || (p.components !== undefined && !isObject(p.components)) || (p.metadata !== undefined && !isObject(p.metadata))) return 'E_CREATE_INVALID';
      return null;
    case 'node.rename': return target() && keysOnly(p,['name']) && string(p.name) ? null : 'E_RENAME_INVALID';
    case 'node.transform': return target() && keysOnly(p,['transform']) ? validateTransform(p.transform) : 'E_TRANSFORM_INVALID';
    case 'node.duplicate': return target() && keysOnly(p,[]) ? null : 'E_DUPLICATE_INVALID';
    case 'node.delete': return target() && keysOnly(p,[]) ? null : 'E_DELETE_INVALID';
    case 'node.reparent': return target() && keysOnly(p,['parentId']) && ('parentId' in p) && (p.parentId===null || string(p.parentId)) ? null : 'E_REPARENT_INVALID';
    default: return 'E_OPERATION_UNSUPPORTED';
  }
}
export function safeKey(value){
  if (!jsonSafe(value)) throw new Error('E_NOT_JSON_SAFE');
  const sort = v => Array.isArray(v) ? v.map(sort) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
