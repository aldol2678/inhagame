import { createModuleRegistry } from "./core/module-registry.js";
import { StudioState } from "./core/studio-state.js";
import { createStudioDocumentHost } from "./core/document-host.js";
import { createStudioAssetRegistry } from "./core/asset-registry.js";
import { createWorldStudioAdapter } from "./adapters/world-adapter.js";
import { createAudioStudioAdapter } from "./adapters/audio-adapter.js";
import { worldModule } from "./modules/world/world-module.js";
import { audioModule } from "./modules/audio/audio-module.js";
import { npcModule } from "./modules/npc/npc-module.js";
import { eventModule } from "./modules/event/event-module.js";
import { gameplayModule } from "./modules/gameplay/gameplay-module.js";

const registry = createModuleRegistry([worldModule, audioModule, npcModule, eventModule, gameplayModule]);
const state = new StudioState({ activeModuleId: "world" });
const documentHost = createStudioDocumentHost();
const assetRegistry = createStudioAssetRegistry();

const els = {
  app: document.getElementById("studio-app"),
  modules: document.getElementById("studio-modules"),
  content: document.getElementById("studio-content"),
  contentTitle: document.getElementById("studio-content-title"),
  contentBody: document.getElementById("studio-content-body"),
  contentToggle: document.getElementById("studio-content-toggle"),
  viewportLabel: document.getElementById("studio-viewport-label"),
  viewportMode: document.getElementById("studio-viewport-mode"),
  viewportBody: document.getElementById("studio-viewport-body"),
  inspector: document.getElementById("studio-inspector"),
  inspectorTitle: document.getElementById("studio-inspector-title"),
  inspectorBody: document.getElementById("studio-inspector-body"),
  inspectorToggle: document.getElementById("studio-inspector-toggle"),
  preview: document.getElementById("studio-preview"),
  save: document.getElementById("studio-save"),
  bottomBody: document.getElementById("studio-bottom-body"),
  moduleCount: document.getElementById("studio-module-count"),
  layoutStatus: document.getElementById("studio-layout-status")
};

const moduleButtons = new Map();
let viewportModuleId = null;
let worldAdapter = null;
let audioAdapter = null;
let worldAdapterStatus = Object.freeze({ ready: false, mounted: false });
let audioAdapterStatus = Object.freeze({ ready: false, mounted: false });
let studioActionBusy = false;
let studioNotice = "";
const contentCache = new Map();
const contentSignatures = new Map();
const contentRequestTokens = new Map();
const inspectorCache = new Map();
const inspectorSignatures = new Map();
const inspectorRequestTokens = new Map();
let assetRegistryQuery = "";
let assetRegistryType = "";
let pendingRegistrySelection = null;

function escapeText(value) {
  return String(value ?? "");
}

function currentModule() {
  return registry.getModule(state.activeModuleId) ?? registry.listModules()[0];
}

function renderModuleRail() {
  els.modules.replaceChildren();
  for (const module of registry.listModules()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "studio-module-button";
    button.dataset.moduleId = module.id;
    button.dataset.status = module.status;
    button.setAttribute("aria-label", module.label);
    button.title = module.label;
    button.innerHTML = `<span aria-hidden="true">${module.icon}</span>${module.status === "planned" ? "<small>PLN</small>" : ""}`;
    button.addEventListener("click", () => state.setActiveModule(module.id));
    moduleButtons.set(module.id, button);
    els.modules.append(button);
  }
}

function contentSignature(moduleId, status) {
  if (!status?.ready) return "not-ready";
  if (moduleId === "world") {
    return JSON.stringify([
      status.revision,
      status.entityCount,
      status.selectedEntityId,
      status.selectedAssetId
    ]);
  }
  if (moduleId === "audio") {
    return JSON.stringify([
      status.revision,
      status.assetCount,
      status.cueCount,
      status.bindingCount,
      status.selectedAssetId,
      status.selectedCueId,
      status.selectedBindingId
    ]);
  }
  return "static";
}

async function refreshContent(moduleId, status, { force = false } = {}) {
  if (!status?.ready) {
    contentCache.delete(moduleId);
    contentSignatures.delete(moduleId);
    return;
  }
  const signature = contentSignature(moduleId, status);
  if (!force && contentSignatures.get(moduleId) === signature) return;
  const token = (contentRequestTokens.get(moduleId) || 0) + 1;
  contentRequestTokens.set(moduleId, token);
  // Lock the requested signature before posting the command. The response itself
  // carries a status snapshot, so without this guard that status would recursively
  // schedule another identical get-content request before this one resolves.
  contentSignatures.set(moduleId, signature);
  try {
    const content = await documentHost.getContent(moduleId);
    if (contentRequestTokens.get(moduleId) !== token) return;
    contentCache.set(moduleId, content);
    const assetSection = (content.sections || []).find(section => section.id === "assets");
    assetRegistry.replaceModuleAssets(moduleId, (assetSection?.items || []).map(item => ({
      id: item.id,
      assetType: item.assetType || (moduleId === "audio" ? "audio" : "other"),
      sourceKind: item.sourceKind || `${moduleId}-asset`,
      label: item.label || item.id,
      detail: item.detail || "",
      selectable: item.selectable !== false
    })));
    if (currentModule()?.id === moduleId) renderContent(currentModule());
  } catch (error) {
    if (contentRequestTokens.get(moduleId) !== token) return;
    if (contentSignatures.get(moduleId) === signature) contentSignatures.delete(moduleId);
    contentCache.set(moduleId, { moduleId, error: error?.message || String(error), sections: [] });
    if (currentModule()?.id === moduleId) renderContent(currentModule());
  }
}

function inspectorSignature(moduleId, status) {
  if (!status?.ready) return "not-ready";
  if (moduleId === "world") {
    return JSON.stringify([status.revision, status.selectedEntityId, status.selectedAssetId]);
  }
  if (moduleId === "audio") {
    return JSON.stringify([
      status.revision,
      status.selectedAssetId,
      status.selectedCueId,
      status.selectedBindingId
    ]);
  }
  return "static";
}

async function refreshInspector(moduleId, status, { force = false } = {}) {
  if (!status?.ready) {
    inspectorCache.delete(moduleId);
    inspectorSignatures.delete(moduleId);
    return;
  }
  const signature = inspectorSignature(moduleId, status);
  if (!force && inspectorSignatures.get(moduleId) === signature) return;
  const token = (inspectorRequestTokens.get(moduleId) || 0) + 1;
  inspectorRequestTokens.set(moduleId, token);
  inspectorSignatures.set(moduleId, signature);
  try {
    const inspector = await documentHost.getInspector(moduleId);
    if (inspectorRequestTokens.get(moduleId) !== token) return;
    inspectorCache.set(moduleId, inspector);
    if (currentModule()?.id === moduleId) renderInspector(currentModule());
  } catch (error) {
    if (inspectorRequestTokens.get(moduleId) !== token) return;
    if (inspectorSignatures.get(moduleId) === signature) inspectorSignatures.delete(moduleId);
    inspectorCache.set(moduleId, { moduleId, error: error?.message || String(error), selection: null, fields: [] });
    if (currentModule()?.id === moduleId) renderInspector(currentModule());
  }
}

async function updateInspectorField(moduleId, inspector, field, value) {
  const selection = inspector?.selection;
  if (!selection) return;
  studioNotice = `Inspector 수정 · ${field.label}`;
  try {
    const updated = await documentHost.updateInspector(
      moduleId,
      selection.kind,
      selection.id,
      field.key,
      value
    );
    inspectorCache.set(moduleId, updated);
    const status = documentHost.getStatus(moduleId);
    inspectorSignatures.set(moduleId, inspectorSignature(moduleId, status));
    contentSignatures.delete(moduleId);
    await refreshContent(moduleId, status, { force: true });
    if (currentModule()?.id === moduleId) renderInspector(currentModule());
    studioNotice = `Inspector 수정 완료 · ${field.label}`;
  } catch (error) {
    studioNotice = `Inspector 수정 실패 · ${error?.message || String(error)}`;
    inspectorSignatures.delete(moduleId);
    await refreshInspector(moduleId, documentHost.getStatus(moduleId), { force: true });
  }
  renderBottom(currentModule());
}

async function selectRegistryAsset(key) {
  const asset = assetRegistry.get(key);
  if (!asset || !asset.selectable) return;
  studioNotice = `Asset Registry · ${asset.moduleId} · ${asset.id}`;
  if (currentModule()?.id !== asset.moduleId) {
    pendingRegistrySelection = asset;
    state.setActiveModule(asset.moduleId);
    return;
  }
  await selectContentItem(asset.moduleId, "asset", asset.id);
}

function renderAssetRegistry(container, module) {
  const section = document.createElement("section");
  section.className = "studio-content-section studio-asset-registry";
  section.dataset.sectionId = "registry";

  const heading = document.createElement("strong");
  const snapshot = assetRegistry.snapshot();
  heading.textContent = `ASSET REGISTRY · ${snapshot.total}`;
  section.append(heading);

  const controls = document.createElement("div");
  controls.className = "studio-asset-registry-controls";

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Asset 검색";
  search.value = assetRegistryQuery;
  search.setAttribute("aria-label", "Asset Registry search");

  const filter = document.createElement("select");
  filter.setAttribute("aria-label", "Asset Registry type filter");
  const types = [
    ["", "All types"],
    ["model", "Model"],
    ["audio", "Audio"],
    ["other", "Other"]
  ];
  for (const [value, label] of types) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    filter.append(option);
  }
  filter.value = assetRegistryType;

  controls.append(search, filter);
  section.append(controls);

  const assets = assetRegistry.list();

  const indexed = document.createElement("div");
  indexed.className = "studio-asset-registry-indexed";
  indexed.textContent = `indexed: ${snapshot.indexedModules.join(", ") || "none"}`;
  section.append(indexed);

  const empty = document.createElement("p");
  empty.className = "studio-content-empty";
  section.append(empty);

  const applyFilter = () => {
    const needle = assetRegistryQuery.trim().toLowerCase();
    let visible = 0;
    for (const row of section.querySelectorAll("[data-registry-key]")) {
      const asset = assetRegistry.get(row.dataset.registryKey);
      const matchesType = !assetRegistryType || asset?.type === assetRegistryType;
      const matchesQuery = !needle || [
        asset?.label,
        asset?.id,
        asset?.detail,
        asset?.moduleId
      ].some(value => String(value || "").toLowerCase().includes(needle));
      row.hidden = !(matchesType && matchesQuery);
      if (!row.hidden) visible += 1;
    }
    empty.hidden = visible > 0;
    empty.textContent = snapshot.total
      ? "필터와 일치하는 Asset 없음"
      : "모듈을 열면 Asset Registry가 인덱싱됩니다.";
  };

  search.addEventListener("input", () => {
    assetRegistryQuery = search.value;
    applyFilter();
  });
  filter.addEventListener("change", () => {
    assetRegistryType = filter.value;
    applyFilter();
  });

  for (const asset of assets) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "studio-content-row studio-registry-row";
    row.dataset.registryKey = asset.key;
    row.dataset.registryModule = asset.moduleId;
    row.dataset.registryType = asset.type;
    row.disabled = !asset.selectable;

    const top = document.createElement("span");
    top.className = "studio-registry-row-top";
    const badge = document.createElement("b");
    badge.textContent = asset.moduleId.toUpperCase();
    const label = document.createElement("span");
    label.className = "studio-content-row-label";
    label.textContent = asset.label;
    top.append(badge, label);

    const detail = document.createElement("small");
    detail.textContent = `${asset.type} · ${asset.detail || asset.id}`;
    row.append(top, detail);
    if (!row.disabled) row.addEventListener("click", () => { void selectRegistryAsset(asset.key); });
    section.append(row);
  }

  applyFilter();
  container.append(section);
}

async function selectContentItem(moduleId, kind, id) {
  studioNotice = `Content 선택 · ${kind} · ${id}`;
  try {
    await documentHost.selectContent(moduleId, kind, id);
    const status = documentHost.getStatus(moduleId);
    contentSignatures.delete(moduleId);
    inspectorSignatures.delete(moduleId);
    await Promise.all([
      refreshContent(moduleId, status, { force: true }),
      refreshInspector(moduleId, status, { force: true })
    ]);
  } catch (error) {
    studioNotice = `Content 선택 실패 · ${error?.message || String(error)}`;
  }
  renderBottom(currentModule());
}

function renderContent(module) {
  els.contentTitle.textContent = module.label;
  els.contentBody.replaceChildren();
  renderAssetRegistry(els.contentBody, module);

  const liveModule = module.id === "world" || module.id === "audio";
  const content = liveModule ? contentCache.get(module.id) : null;
  if (liveModule && documentHost.getStatus(module.id).ready) {
    if (!content) {
      const loading = document.createElement("p");
      loading.className = "studio-content-empty";
      loading.textContent = "Content 동기화 중…";
      els.contentBody.append(loading);
      return;
    }
    if (content.error) {
      const error = document.createElement("p");
      error.className = "studio-content-empty";
      error.textContent = `Content 불러오기 실패 · ${content.error}`;
      els.contentBody.append(error);
      return;
    }
    for (const section of content.sections || []) {
      const container = document.createElement("section");
      container.className = "studio-content-section";
      container.dataset.sectionId = section.id;
      const heading = document.createElement("strong");
      heading.textContent = `${section.label} · ${section.items?.length || 0}`;
      container.append(heading);

      if (!section.items?.length) {
        const empty = document.createElement("p");
        empty.className = "studio-content-empty";
        empty.textContent = "항목 없음";
        container.append(empty);
      }

      for (const item of section.items || []) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "studio-content-row";
        row.dataset.contentKind = item.kind;
        row.dataset.contentId = item.id;
        row.dataset.selected = String(Boolean(item.selected));
        row.disabled = item.selectable === false;
        const label = document.createElement("span");
        label.className = "studio-content-row-label";
        label.textContent = item.label || item.id;
        const detail = document.createElement("small");
        detail.textContent = item.detail || item.id;
        row.append(label, detail);
        if (!row.disabled) {
          row.addEventListener("click", () => {
            void selectContentItem(module.id, item.kind, item.id);
          });
        }
        container.append(row);
      }
      els.contentBody.append(container);
    }
    return;
  }

  for (const section of module.contentSections) {
    const container = document.createElement("section");
    container.className = "studio-content-section";
    const heading = document.createElement("strong");
    heading.textContent = section.label;
    container.append(heading);
    for (const item of section.items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "studio-content-row";
      row.disabled = true;
      row.textContent = item;
      container.append(row);
    }
    els.contentBody.append(container);
  }
}

function disposeViewportAdapter() {
  if (worldAdapter) {
    const adapter = worldAdapter;
    worldAdapter = null;
    adapter.dispose();
    documentHost.detach("world");
    contentCache.delete("world");
    contentSignatures.delete("world");
    contentRequestTokens.set("world", (contentRequestTokens.get("world") || 0) + 1);
    inspectorCache.delete("world");
    inspectorSignatures.delete("world");
    inspectorRequestTokens.set("world", (inspectorRequestTokens.get("world") || 0) + 1);
  }
  if (audioAdapter) {
    const adapter = audioAdapter;
    audioAdapter = null;
    adapter.dispose();
    documentHost.detach("audio");
    contentCache.delete("audio");
    contentSignatures.delete("audio");
    contentRequestTokens.set("audio", (contentRequestTokens.get("audio") || 0) + 1);
    inspectorCache.delete("audio");
    inspectorSignatures.delete("audio");
    inspectorRequestTokens.set("audio", (inspectorRequestTokens.get("audio") || 0) + 1);
  }
  worldAdapterStatus = Object.freeze({ ready: false, mounted: false });
  audioAdapterStatus = Object.freeze({ ready: false, mounted: false });
}

function onWorldAdapterStatus(status) {
  worldAdapterStatus = status;
  documentHost.updateStatus("world", status);
  void refreshContent("world", status);
  void refreshInspector("world", status);
  if (status.ready && pendingRegistrySelection?.moduleId === "world") {
    const pending = pendingRegistrySelection;
    pendingRegistrySelection = null;
    void selectContentItem("world", "asset", pending.id);
  }
  if (currentModule()?.id !== "world") return;
  renderActions();
  renderInspector(currentModule());
  renderBottom(currentModule());
}

function onAudioAdapterStatus(status) {
  audioAdapterStatus = status;
  documentHost.updateStatus("audio", status);
  void refreshContent("audio", status);
  void refreshInspector("audio", status);
  if (status.ready && pendingRegistrySelection?.moduleId === "audio") {
    const pending = pendingRegistrySelection;
    pendingRegistrySelection = null;
    void selectContentItem("audio", "asset", pending.id);
  }
  if (currentModule()?.id !== "audio") return;
  renderActions();
  renderInspector(currentModule());
  renderBottom(currentModule());
}

function renderLegacyCard(module) {
  const status = module.status === "available" ? "AVAILABLE · LEGACY EDITOR" : "PLANNED";
  const link = module.legacyHref
    ? `<a class="studio-legacy-link" data-legacy-link="${module.id}" href="${module.legacyHref}">${escapeText(module.legacyLabel || "Open Editor")} ↗</a>`
    : "";
  els.viewportBody.innerHTML = `
    <article class="studio-empty-card" data-module-card="${module.id}">
      <span class="kicker">${module.id.toUpperCase()} MODULE</span>
      <h1>${escapeText(module.label)}</h1>
      <p>${escapeText(module.description)}</p>
      <span class="studio-module-status" data-status="${module.status}">${status}</span>
      <br>
      ${link}
    </article>
  `;
}

function renderViewport(module) {
  els.viewportLabel.textContent = module.label;
  if (viewportModuleId === module.id) return;

  disposeViewportAdapter();
  viewportModuleId = module.id;
  els.viewportBody.replaceChildren();
  delete els.viewportBody.dataset.hosted;

  if (module.id === "world") {
    els.viewportMode.textContent = "S1 · Hosted World Editor";
    worldAdapter = createWorldStudioAdapter({
      container: els.viewportBody,
      onStatus: onWorldAdapterStatus
    });
    documentHost.attach("world", worldAdapter);
    worldAdapter.mount();
    return;
  }

  if (module.id === "audio") {
    els.viewportMode.textContent = "S2 · Hosted Music Editor";
    audioAdapter = createAudioStudioAdapter({
      container: els.viewportBody,
      onStatus: onAudioAdapterStatus
    });
    documentHost.attach("audio", audioAdapter);
    audioAdapter.mount();
    return;
  }

  els.viewportMode.textContent = module.status === "planned" ? "Planned" : "Legacy";
  renderLegacyCard(module);
}

function appendInspectorField(container, moduleId, inspector, field) {
  const wrap = document.createElement("label");
  wrap.className = "studio-inspector-field";
  wrap.dataset.fieldKey = field.key;

  const caption = document.createElement("span");
  caption.textContent = field.label || field.key;
  wrap.append(caption);

  if (field.type === "readonly" || field.editable === false) {
    const output = document.createElement("div");
    output.className = "studio-inspector-readonly";
    output.textContent = String(field.value ?? "");
    wrap.append(output);
    container.append(wrap);
    return;
  }

  let input;
  if (field.type === "select") {
    input = document.createElement("select");
    for (const choice of field.options || []) {
      const option = document.createElement("option");
      if (typeof choice === "object" && choice) {
        option.value = String(choice.value ?? "");
        option.textContent = String(choice.label ?? choice.value ?? "");
      } else {
        option.value = String(choice);
        option.textContent = String(choice);
      }
      input.append(option);
    }
    input.value = String(field.value ?? "");
  } else {
    input = document.createElement("input");
    input.type = field.type === "checkbox" ? "checkbox" : field.type === "number" ? "number" : "text";
    if (input.type === "checkbox") input.checked = Boolean(field.value);
    else input.value = String(field.value ?? "");
    if (input.type === "number") {
      if (field.min !== undefined) input.min = String(field.min);
      if (field.max !== undefined) input.max = String(field.max);
      if (field.step !== undefined) input.step = String(field.step);
    }
  }

  input.dataset.inspectorField = field.key;
  input.addEventListener("change", () => {
    const value = input.type === "checkbox"
      ? input.checked
      : input.type === "number"
        ? Number(input.value)
        : input.value;
    void updateInspectorField(moduleId, inspector, field, value);
  });
  wrap.append(input);
  container.append(wrap);
}

function renderLiveInspector(module) {
  const status = documentHost.getStatus(module.id);
  delete els.inspectorBody.dataset.studioWorldDirty;
  delete els.inspectorBody.dataset.studioAudioDirty;
  if (module.id === "world") els.inspectorBody.dataset.studioWorldDirty = String(Boolean(status.dirty));
  if (module.id === "audio") els.inspectorBody.dataset.studioAudioDirty = String(Boolean(status.dirty));
  if (!status.ready) {
    els.inspectorBody.innerHTML = '<div class="studio-inspector-loading"><strong>Inspector 연결 중</strong><span>선택 상태와 속성 계약을 준비하고 있습니다.</span></div>';
    return;
  }

  const inspector = inspectorCache.get(module.id);
  if (!inspector) {
    els.inspectorBody.innerHTML = '<div class="studio-inspector-loading"><strong>Inspector 동기화 중</strong><span>현재 선택의 속성을 읽고 있습니다.</span></div>';
    return;
  }
  if (inspector.error) {
    els.inspectorBody.innerHTML = `<div class="studio-inspector-loading"><strong>Inspector 불러오기 실패</strong><span>${escapeText(inspector.error)}</span></div>`;
    return;
  }
  if (!inspector.selection) {
    els.inspectorBody.innerHTML = '<div class="studio-inspector-loading"><strong>선택 없음</strong><span>Content Browser 또는 편집기에서 항목을 선택하세요.</span></div>';
    return;
  }

  const selection = inspector.selection;
  els.inspectorTitle.textContent = selection.title || module.label;
  els.inspectorBody.replaceChildren();

  const head = document.createElement("div");
  head.className = "studio-inspector-selection";
  const kicker = document.createElement("span");
  kicker.textContent = String(selection.kind || "item").toUpperCase();
  const title = document.createElement("strong");
  title.textContent = selection.title || selection.id;
  const subtitle = document.createElement("small");
  subtitle.textContent = selection.subtitle || selection.id;
  head.append(kicker, title, subtitle);
  els.inspectorBody.append(head);

  const fields = document.createElement("div");
  fields.className = "studio-inspector-fields";
  for (const field of inspector.fields || []) appendInspectorField(fields, module.id, inspector, field);
  els.inspectorBody.append(fields);
}

function renderInspector(module) {
  els.inspectorTitle.textContent = module.label;
  if (module.id === "world" || module.id === "audio") {
    renderLiveInspector(module);
    return;
  }

  delete els.inspectorBody.dataset.studioWorldDirty;
  delete els.inspectorBody.dataset.studioAudioDirty;
  const capabilities = module.capabilities.length
    ? module.capabilities.map(item => `<span>${escapeText(item)}</span>`).join("")
    : "<span>none</span>";
  els.inspectorBody.innerHTML = `
    <dl class="studio-inspector-list">
      <div><dt>Module</dt><dd>${escapeText(module.id)}</dd></div>
      <div><dt>Status</dt><dd>${escapeText(module.status)}</dd></div>
      <div><dt>Capabilities</dt><dd class="studio-capabilities">${capabilities}</dd></div>
      <div><dt>Legacy editor</dt><dd>${escapeText(module.legacyHref || "Not connected")}</dd></div>
    </dl>
  `;
}

function renderBottom(module) {
  const tab = state.activeBottomTab;
  if (tab === "console") {
    const lines = [
      '<div class="studio-log-line"><strong>Studio</strong> S3.4 Asset Registry</div>',
      `<div class="studio-log-line"><strong>Registry</strong> ${registry.listModules().length} modules</div>`,
      `<div class="studio-log-line"><strong>Active</strong> ${escapeText(module.id)} · ${escapeText(module.status)}</div>`
    ];
    if (module.id === "world") {
      lines.push(`<div class="studio-log-line"><strong>World Adapter</strong> ${worldAdapterStatus.ready ? "ready" : "connecting"} · ${Number(worldAdapterStatus.entityCount || 0)} entities · rev ${Number(worldAdapterStatus.revision || 0)}</div>`);
      if (worldAdapterStatus.fileStatus) lines.push(`<div class="studio-log-line"><strong>Editor</strong> ${escapeText(worldAdapterStatus.fileStatus)}</div>`);
    }
    if (module.id === "audio") {
      lines.push(`<div class="studio-log-line"><strong>Audio Adapter</strong> ${audioAdapterStatus.ready ? "ready" : "connecting"} · ${Number(audioAdapterStatus.assetCount || 0)} assets · ${Number(audioAdapterStatus.cueCount || 0)} cues · ${Number(audioAdapterStatus.bindingCount || 0)} bindings</div>`);
      lines.push(`<div class="studio-log-line"><strong>Preview</strong> ${escapeText(audioAdapterStatus.previewContext || "locked")} · ${Number(audioAdapterStatus.previewSources || 0)} source(s)</div>`);
      if (audioAdapterStatus.fileStatus) lines.push(`<div class="studio-log-line"><strong>Editor</strong> ${escapeText(audioAdapterStatus.fileStatus)}</div>`);
    }
    if (studioNotice) lines.push(`<div class="studio-log-line"><strong>Action</strong> ${escapeText(studioNotice)}</div>`);
    els.bottomBody.innerHTML = lines.join("");
  } else if (tab === "validation") {
    const status = documentHost.getStatus(module.id);
    const validation = documentHost.getValidation(module.id);
    if (!status.ready) {
      els.bottomBody.textContent = "No document loaded.";
    } else {
      const result = validation
        ? `<span class="studio-core-result" data-valid="${String(Boolean(validation.valid))}">${validation.valid ? "PASS" : "FAIL"} · ${Number(validation.errors || 0)} errors · ${Number(validation.warnings || 0)} warnings${validation.firstCode ? ` · ${escapeText(validation.firstCode)}` : ""}</span>`
        : '<span class="studio-core-result">아직 검증하지 않았습니다.</span>';
      els.bottomBody.innerHTML = `
        <div class="studio-core-toolbar">
          <button type="button" data-studio-core-action="validate">Run Validation</button>
          ${result}
        </div>
        <div class="studio-core-note">Studio Shared Core가 활성 문서의 Validation 계약을 호출합니다.</div>
      `;
    }
  } else {
    const status = documentHost.getStatus(module.id);
    if (!status.ready) {
      els.bottomBody.textContent = "No command history.";
    } else {
      const history = status.history || {};
      els.bottomBody.innerHTML = `
        <div class="studio-core-toolbar">
          <button type="button" data-studio-core-action="undo" ${status.canUndo ? "" : "disabled"}>↶ Undo</button>
          <button type="button" data-studio-core-action="redo" ${status.canRedo ? "" : "disabled"}>↷ Redo</button>
          <span class="studio-core-result">
            undo ${Number(history.undoCount || 0)}${history.nextUndo ? ` · ${escapeText(history.nextUndo)}` : ""}
            &nbsp;|&nbsp;
            redo ${Number(history.redoCount || 0)}${history.nextRedo ? ` · ${escapeText(history.nextRedo)}` : ""}
          </span>
        </div>
        <div class="studio-core-note">History 실행은 Studio가 담당하고, 실제 command stack은 각 Document가 소유합니다.</div>
      `;
    }
  }
  for (const button of document.querySelectorAll("[data-bottom-tab]")) {
    button.setAttribute("aria-selected", String(button.dataset.bottomTab === tab));
  }
}

function activeAdapterState() {
  const module = currentModule();
  if (!module) return { adapter: null, status: null };
  return {
    adapter: documentHost.getAdapter(module.id),
    status: documentHost.getStatus(module.id)
  };
}

function renderActions() {
  const module = currentModule();
  const { status } = activeAdapterState();
  const ready = Boolean(status?.ready) && !studioActionBusy;
  els.preview.disabled = !ready;
  els.save.disabled = !ready || status?.canSave === false;

  const previewOpen = module?.id === "world"
    ? Boolean(worldAdapterStatus.previewOpen)
    : module?.id === "audio"
      ? Boolean(audioAdapterStatus.previewEnabled)
      : false;
  els.preview.textContent = previewOpen
    ? (module?.id === "world" ? "■ Edit" : "■ Preview")
    : "▶ Preview";
  els.preview.setAttribute("aria-pressed", String(previewOpen));
}

function render() {
  const module = currentModule();
  if (!module) throw new Error("E_STUDIO_ACTIVE_MODULE_MISSING");
  for (const [id, button] of moduleButtons) button.setAttribute("aria-pressed", String(id === module.id));
  els.app.dataset.layout = state.layoutMode;
  els.content.dataset.open = String(state.contentOpen);
  els.inspector.dataset.open = String(state.inspectorOpen);
  els.contentToggle.setAttribute("aria-pressed", String(state.contentOpen));
  els.inspectorToggle.setAttribute("aria-pressed", String(state.inspectorOpen));
  els.moduleCount.textContent = `${registry.listModules().length} modules`;
  els.layoutStatus.textContent = state.layoutMode;
  renderContent(module);
  renderViewport(module);
  renderInspector(module);
  renderActions();
  renderBottom(module);
}

function layoutForWidth(width) {
  if (width < 700) return "mobile";
  if (width < 1100) return "compact";
  return "desktop";
}

function syncLayout() {
  state.setLayoutMode(layoutForWidth(globalThis.innerWidth || 1440));
}

async function runDocumentHostAction(label, method) {
  const module = currentModule();
  const status = module ? documentHost.getStatus(module.id) : null;
  if (!module || !status?.ready || studioActionBusy) return;
  studioActionBusy = true;
  studioNotice = `${label} 실행 중…`;
  renderActions();
  renderBottom(module);
  try {
    const result = await documentHost[method](module.id);
    studioNotice = `${label} 완료`;
    return result;
  } catch (error) {
    studioNotice = `${label} 실패 · ${error?.message || String(error)}`;
    throw error;
  } finally {
    studioActionBusy = false;
    renderActions();
    renderBottom(currentModule());
  }
}

renderModuleRail();
state.subscribe(render);
for (const button of document.querySelectorAll("[data-bottom-tab]")) {
  button.addEventListener("click", () => state.setBottomTab(button.dataset.bottomTab));
}
els.contentToggle.addEventListener("click", () => {
  state.setPanel("content", !state.contentOpen);
  if (state.contentOpen && state.inspectorOpen) state.setPanel("inspector", false);
});
els.inspectorToggle.addEventListener("click", () => {
  state.setPanel("inspector", !state.inspectorOpen);
  if (state.inspectorOpen && state.contentOpen) state.setPanel("content", false);
});
els.preview.addEventListener("click", () => {
  void runDocumentHostAction("Preview", "togglePreview").catch(() => {});
});
els.save.addEventListener("click", () => {
  void runDocumentHostAction("Save", "save").catch(() => {});
});
els.bottomBody.addEventListener("click", event => {
  const action = event.target.closest("[data-studio-core-action]")?.dataset.studioCoreAction;
  if (!action) return;
  const map = { validate: ["Validation", "validate"], undo: ["Undo", "undo"], redo: ["Redo", "redo"] };
  const entry = map[action];
  if (!entry) return;
  void runDocumentHostAction(entry[0], entry[1]).catch(() => {});
});
globalThis.addEventListener("resize", syncLayout);
globalThis.addEventListener("beforeunload", () => {
  worldAdapter?.dispose();
  audioAdapter?.dispose();
}, { once: true });

syncLayout();
render();

const studioApi = Object.freeze({
  getStatus: () => Object.freeze({
    ready: true,
    stage: "S3.4",
    ...state.snapshot(),
    modules: registry.listModules().map(module => ({ id: module.id, status: module.status })),
    worldAdapter: Object.freeze({ ...worldAdapterStatus }),
    audioAdapter: Object.freeze({ ...audioAdapterStatus }),
    assetRegistry: assetRegistry.snapshot()
  }),
  validateWorld: () => documentHost.validate("world"),
  validateAudio: () => documentHost.validate("audio"),
  undoActive: () => documentHost.undo(currentModule()?.id),
  redoActive: () => documentHost.redo(currentModule()?.id)
});

globalThis.__INHA_STUDIO_S3__ = studioApi;
globalThis.__INHA_STUDIO_S2__ = studioApi;
globalThis.__INHA_STUDIO_S1__ = studioApi;
globalThis.__INHA_STUDIO_S0__ = studioApi;
