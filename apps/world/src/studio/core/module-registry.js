const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const STATUSES = new Set(["available", "planned"]);

function freezeDescriptor(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("E_STUDIO_MODULE_INVALID");
  const id = String(candidate.id || "").trim();
  const label = String(candidate.label || "").trim();
  const icon = String(candidate.icon || "").trim();
  const status = String(candidate.status || "").trim();
  const order = Number(candidate.order);
  if (!ID_PATTERN.test(id)) throw new Error(`E_STUDIO_MODULE_ID_INVALID:${id || "missing"}`);
  if (!label) throw new Error(`E_STUDIO_MODULE_LABEL_INVALID:${id}`);
  if (!icon) throw new Error(`E_STUDIO_MODULE_ICON_INVALID:${id}`);
  if (!STATUSES.has(status)) throw new Error(`E_STUDIO_MODULE_STATUS_INVALID:${id}`);
  if (!Number.isFinite(order)) throw new Error(`E_STUDIO_MODULE_ORDER_INVALID:${id}`);

  const capabilities = Array.isArray(candidate.capabilities)
    ? candidate.capabilities.map(value => String(value).trim()).filter(Boolean)
    : [];
  const contentSections = Array.isArray(candidate.contentSections)
    ? candidate.contentSections.map(section => Object.freeze({
      label: String(section?.label || "").trim(),
      items: Object.freeze((Array.isArray(section?.items) ? section.items : []).map(item => String(item).trim()).filter(Boolean))
    })).filter(section => section.label)
    : [];

  return Object.freeze({
    id,
    label,
    icon,
    status,
    order,
    description: String(candidate.description || "").trim(),
    legacyHref: candidate.legacyHref ? String(candidate.legacyHref) : null,
    legacyLabel: candidate.legacyLabel ? String(candidate.legacyLabel) : null,
    capabilities: Object.freeze(capabilities),
    contentSections: Object.freeze(contentSections)
  });
}

export class ModuleRegistry {
  constructor(initial = []) {
    this._modules = new Map();
    for (const module of initial) this.registerModule(module);
  }

  registerModule(candidate) {
    const module = freezeDescriptor(candidate);
    if (this._modules.has(module.id)) throw new Error(`E_STUDIO_MODULE_DUPLICATE:${module.id}`);
    this._modules.set(module.id, module);
    return module;
  }

  getModule(id) {
    return this._modules.get(String(id || "")) ?? null;
  }

  hasModule(id) {
    return this._modules.has(String(id || ""));
  }

  listModules() {
    return Object.freeze([...this._modules.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)));
  }
}

export const createModuleRegistry = initial => new ModuleRegistry(initial);
