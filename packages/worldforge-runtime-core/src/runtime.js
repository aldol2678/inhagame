const RECOGNIZED = new Set(['core.primitive', 'core.renderable', 'core.camera']);
const clone = value => structuredClone(value);
const isFiniteVec3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const diagnostic = (severity, code, detail = '') => ({ severity, code, detail });

/**
 * The renderer and validator are ports. No dependency on Studio, Campus, PlayCanvas, or DOM.
 * `validateManifest` is normally @worldforge/schema.validateWorldManifest.
 */
export function createEngine({ renderer, validateManifest, scheduler = globalThis, systems = [], fixedStep = 1 / 60 } = {}) {
  if (!renderer || typeof renderer.mount !== 'function' || typeof renderer.dispose !== 'function') throw new TypeError('E_RENDERER_REQUIRED');
  if (typeof validateManifest !== 'function') throw new TypeError('E_VALIDATOR_REQUIRED');
  if (!Number.isFinite(fixedStep) || fixedStep <= 0) throw new TypeError('E_FIXED_STEP_INVALID');
  let state = 'created';
  let world = null;
  let frameId = null;
  let lastStamp = null;
  let accumulator = 0;
  let diagnostics = [];
  let cleanups = [];
  const entities = new Map();
  const getEntity = id => entities.has(id) ? clone(entities.get(id)) : null;
  const context = {
    getEntity,
    getAction: () => 0,
    setTransform(id, transform) {
      const existing = entities.get(id);
      if (!existing) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
      if (!transform || !isFiniteVec3(transform.position) || !isFiniteVec3(transform.scale) ||
          !Array.isArray(transform.rotation) || transform.rotation.length !== 4 || !transform.rotation.every(Number.isFinite)) {
        throw new TypeError('E_TRANSFORM_INVALID');
      }
      const updated = { ...existing, transform: clone(transform) };
      entities.set(id, updated);
      renderer.setTransform?.(id, updated.transform);
    },
    diagnose(severity, code, detail = '') { diagnostics.push(diagnostic(severity, code, detail)); }
  };
  const cancelTick = () => {
    if (frameId !== null) scheduler.cancelAnimationFrame(frameId);
    frameId = null;
    lastStamp = null;
    accumulator = 0;
  };
  const runTick = stamp => {
    if (state !== 'running') return;
    frameId = null;
    const delta = lastStamp === null ? 0 : Math.min(Math.max((stamp - lastStamp) / 1000, 0), 0.1);
    lastStamp = stamp;
    accumulator += delta;
    try {
      let loops = 0;
      while (accumulator >= fixedStep && loops++ < 6) {
        for (const system of systems) system.fixedUpdate?.(context, fixedStep);
        accumulator -= fixedStep;
      }
      if (loops > 6) accumulator = 0;
      for (const system of systems) system.update?.(context, delta);
      renderer.frame?.(delta);
    } catch (error) {
      diagnostics.push(diagnostic('ERROR', 'E_ENGINE_TICK', String(error)));
      state = 'failed';
      cancelTick();
      return;
    }
    if (state === 'running') frameId = scheduler.requestAnimationFrame(runTick);
  };
  const engine = {
    get state() { return state; },
    get diagnostics() { return clone(diagnostics); },
    getEntity,
    get worldId() { return world?.world?.id ?? null; },
    setTransform: context.setTransform,
    setActionProvider(provider) { context.getAction = typeof provider === 'function' ? provider : () => 0; },
    async load(source) {
      if (state !== 'created') throw new Error(`E_ENGINE_LOAD_STATE:${state}`);
      state = 'loading';
      diagnostics = [];
      let parsed;
      try { parsed = validateManifest(source); }
      catch (error) { parsed = { valid: false, errors: [diagnostic('ERROR', 'E_SCHEMA', String(error))] }; }
      if (!parsed?.valid || !parsed.value) {
        diagnostics.push(...(parsed?.diagnostics ?? parsed?.errors ?? [diagnostic('ERROR', 'E_SCHEMA')]));
        state = 'failed';
        return { ok: false, diagnostics: engine.diagnostics };
      }
      world = clone(parsed.value);
      for (const entity of world.entities) {
        entities.set(entity.id, clone(entity));
        for (const name of Object.keys(entity.components ?? {})) {
          if (!RECOGNIZED.has(name)) diagnostics.push(diagnostic('WARNING', 'W_COMPONENT_UNSUPPORTED', `${entity.id}:${name}`));
        }
      }
      try {
        await renderer.mount(world, { diagnose: context.diagnose });
        for (const system of systems) {
          await system.init?.(context);
          if (system.dispose) cleanups.push(() => system.dispose(context));
        }
        state = 'ready';
        return { ok: true, diagnostics: engine.diagnostics };
      } catch (error) {
        diagnostics.push(diagnostic('ERROR', 'E_ENGINE_LOAD', String(error)));
        state = 'failed';
        try { await renderer.dispose(); }
        catch (disposeError) { diagnostics.push(diagnostic('WARNING', 'W_RENDERER_DISPOSE', String(disposeError))); }
        return { ok: false, diagnostics: engine.diagnostics };
      }
    },
    start() {
      if (state !== 'ready' && state !== 'stopped') throw new Error(`E_ENGINE_START_STATE:${state}`);
      if (typeof scheduler.requestAnimationFrame !== 'function' || typeof scheduler.cancelAnimationFrame !== 'function') throw new Error('E_SCHEDULER_REQUIRED');
      state = 'running';
      frameId = scheduler.requestAnimationFrame(runTick);
    },
    pause() {
      if (state !== 'running') return false;
      cancelTick(); state = 'paused'; return true;
    },
    resume() {
      if (state !== 'paused') return false;
      state = 'running'; frameId = scheduler.requestAnimationFrame(runTick); return true;
    },
    stop() {
      if (!['running', 'paused', 'ready'].includes(state)) return false;
      cancelTick(); state = 'stopped'; return true;
    },
    async dispose() {
      if (state === 'disposed') return;
      cancelTick();
      for (const cleanup of cleanups.reverse()) {
        try { await cleanup(); }
        catch (error) { diagnostics.push(diagnostic('WARNING', 'W_SYSTEM_DISPOSE', String(error))); }
      }
      cleanups = [];
      try { await renderer.dispose(); }
      catch (error) { diagnostics.push(diagnostic('WARNING', 'W_RENDERER_DISPOSE', String(error))); }
      entities.clear(); world = null; state = 'disposed';
    }
  };
  return engine;
}
