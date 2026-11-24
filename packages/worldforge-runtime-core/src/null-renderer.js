/** Recording renderer for deterministic headless tests. Never touches a DOM or GPU. */
export function createNullRenderer() {
  const objects = new Map();
  return {
    objects,
    mounts: 0,
    disposals: 0,
    async mount(manifest) {
      this.mounts += 1;
      objects.clear();
      for (const entity of manifest.entities) objects.set(entity.id, structuredClone(entity.transform));
    },
    setTransform(id, transform) {
      if (!objects.has(id)) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
      objects.set(id, structuredClone(transform));
    },
    frame() {},
    async dispose() { this.disposals += 1; objects.clear(); }
  };
}
