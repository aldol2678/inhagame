import { groundFromViewport, projectGround } from "./inha-tools.js";
import { buildingMassEntityId, createBuildingMassCandidate } from "./building-mass.js";
import {
  calibrateMapReference,
  createMapReference,
  footprintWorldPoints,
  imagePixelToWorld,
  validateFootprint,
  validateMapReference,
  worldToImagePixel
} from "./map-reference.js";

const byId = id => document.getElementById(id);
const number = input => Number(input.value);
const rounded = value => Number(value.toFixed(3));

export class MapReferenceController {
  constructor({ viewport, getStore, getWorld, isPreviewOpen, onStart, onCreateMass }) {
    this.viewport = viewport;
    this.getStore = getStore;
    this.getWorld = getWorld;
    this.isPreviewOpen = isPreviewOpen;
    this.onStart = onStart;
    this.onCreateMass = onCreateMass;
    this.canvas = byId("editor-reference-canvas");
    this.controls = byId("editor-reference-controls");
    this.status = byId("editor-reference-status");
    this.meta = byId("editor-reference-meta");
    this.footprintList = byId("editor-reference-footprints");
    this.buildingHeight = byId("editor-reference-building-height");
    this.imageFile = byId("editor-reference-file");
    this.rights = byId("editor-reference-rights");
    this.opacity = byId("editor-reference-opacity");
    this.opacityValue = byId("editor-reference-opacity-value");
    this.scale = byId("editor-reference-scale");
    this.anchorX = byId("editor-reference-anchor-x");
    this.anchorZ = byId("editor-reference-anchor-z");
    this.distance = byId("editor-reference-distance");
    this.calibrateButton = byId("editor-reference-calibrate");
    this.traceButton = byId("editor-reference-trace");
    this.finishButton = byId("editor-reference-finish");
    this.cancelButton = byId("editor-reference-cancel");
    this.worldId = null;
    this.reference = null;
    this.imageBlob = null;
    this.bitmap = null;
    this.mode = null;
    this.firstCalibration = null;
    this.draft = [];
    this.loadSequence = 0;
    this.writeQueue = Promise.resolve();

    byId("editor-reference-load").addEventListener("click", () => this.importImage());
    byId("editor-reference-clear").addEventListener("click", () => this.clear());
    this.opacity.addEventListener("input", () => {
      if (!this.reference) return;
      this.reference = { ...this.reference, opacity: number(this.opacity) / 100 };
      this.opacityValue.value = `${this.opacity.value}%`;
      this.render();
    });
    this.opacity.addEventListener("change", () => this.persist());
    this.rights.addEventListener("change", () => {
      if (!this.reference) return;
      const rightsNote = this.rights.value.trim();
      if (!rightsNote) { this.error(new Error("E_MAP_REFERENCE_RIGHTS_NOTE_REQUIRED")); this.rights.value = this.reference.rightsNote; return; }
      this.reference = { ...this.reference, rightsNote };
      this.persist();
    });
    for (const [input, key] of [[this.scale, "metersPerPixel"], [this.anchorX, "anchorX"], [this.anchorZ, "anchorZ"]]) {
      input.addEventListener("change", () => this.changeNumber(key, number(input)));
    }
    this.calibrateButton.addEventListener("click", () => this.setMode(this.mode === "calibrate" ? null : "calibrate"));
    this.traceButton.addEventListener("click", () => this.setMode(this.mode === "trace" ? null : "trace"));
    this.finishButton.addEventListener("click", () => this.finishFootprint());
    this.cancelButton.addEventListener("click", () => this.setMode(null));
    this.viewport.addEventListener("click", event => this.onViewportClick(event), true);
    document.addEventListener("keydown", event => {
      if (!this.mode || event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "Escape") { event.preventDefault(); this.setMode(null); }
      if (event.key === "Enter" && this.mode === "trace") { event.preventDefault(); this.finishFootprint(); }
    }, true);
    new ResizeObserver(() => this.render()).observe(this.viewport);
  }

  message(text) { this.status.textContent = text; }
  error(error) { this.message(error?.message || String(error)); }

  async loadForWorld(worldId) {
    const sequence = ++this.loadSequence;
    this.worldId = worldId;
    this.setMode(null);
    this.bitmap?.close?.();
    this.bitmap = null;
    this.reference = null;
    this.imageBlob = null;
    this.imageFile.value = "";
    this.rights.value = "";
    this.syncControls();
    this.render();
    this.message("이미지를 선택하고 출처·사용 권한 근거를 적으세요.");
    const store = this.getStore();
    if (!store) return;
    try {
      await this.writeQueue.catch(() => {});
      const record = await store.readReference(worldId);
      if (sequence !== this.loadSequence || !record) return;
      const reference = validateMapReference(record.reference);
      if (!(record.imageBlob instanceof Blob)) throw new Error("E_MAP_REFERENCE_BLOB_MISSING");
      const bitmap = await createImageBitmap(record.imageBlob);
      if (sequence !== this.loadSequence) { bitmap.close(); return; }
      this.reference = reference;
      this.imageBlob = record.imageBlob;
      this.bitmap = bitmap;
      this.syncControls();
      this.render();
      this.message(`${reference.name} · 로컬 Reference 복원`);
    } catch (error) { if (sequence === this.loadSequence) this.error(error); }
  }

  async importImage() {
    const file = this.imageFile.files?.[0];
    const store = this.getStore();
    const worldId = this.worldId;
    if (!file || !store || !worldId) { this.message("이미지와 프로젝트 저장소가 필요합니다."); return; }
    if (file.size > 15 * 1024 * 1024) { this.message("이미지는 15 MB 이하로 선택하세요."); return; }
    if (this.reference?.footprints.length && !window.confirm("새 이미지를 불러오면 현재 외곽선이 제거됩니다. 계속할까요?")) return;
    const sequence = ++this.loadSequence;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const reference = createMapReference({
        name: file.name, mimeType: file.type, width: bitmap.width, height: bitmap.height,
        rightsNote: this.rights.value
      });
      if (worldId !== this.worldId || sequence !== this.loadSequence) { bitmap.close(); return; }
      this.writeQueue = this.writeQueue.catch(() => {}).then(() => store.writeReference(worldId, { reference, imageBlob: file }));
      await this.writeQueue;
      if (worldId !== this.worldId || sequence !== this.loadSequence) { bitmap.close(); return; }
      this.bitmap?.close?.();
      this.bitmap = bitmap;
      this.reference = reference;
      this.imageBlob = file;
      this.setMode(null);
      this.syncControls();
      this.render();
      this.message(`${file.name} · 이 브라우저에 저장됨`);
    } catch (error) { bitmap?.close?.(); this.error(error); }
  }

  changeNumber(key, value) {
    if (!this.reference) return;
    try {
      const next = validateMapReference({ ...this.reference, [key]: value });
      this.reference = next;
      this.render();
      this.persist();
    } catch (error) { this.error(error); }
    this.syncControls();
  }

  persist() {
    if (!this.reference || !this.imageBlob || !this.worldId || !this.getStore()) return;
    const record = { reference: structuredClone(this.reference), imageBlob: this.imageBlob };
    const worldId = this.worldId;
    const sequence = this.loadSequence;
    const store = this.getStore();
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => store.writeReference(worldId, record));
    this.writeQueue.then(
      () => { if (worldId === this.worldId && sequence === this.loadSequence) this.message("Reference 저장됨"); },
      error => { if (worldId === this.worldId && sequence === this.loadSequence) this.error(error); }
    );
  }

  async clear() {
    if (!this.reference || !window.confirm("이 프로젝트의 로컬 Reference 이미지와 외곽선을 제거할까요?")) return;
    const worldId = this.worldId;
    const sequence = ++this.loadSequence;
    try {
      const store = this.getStore();
      this.writeQueue = this.writeQueue.catch(() => {}).then(() => {
        if (worldId === this.worldId && sequence === this.loadSequence) return store.clearReference(worldId);
      });
      await this.writeQueue;
      if (worldId !== this.worldId || sequence !== this.loadSequence) return;
      this.bitmap?.close?.();
      this.bitmap = null;
      this.reference = null;
      this.imageBlob = null;
      this.setMode(null);
      this.syncControls();
      this.render();
      this.message("로컬 Reference를 제거했습니다. world.json은 변경되지 않았습니다.");
    } catch (error) { this.error(error); }
  }

  setMode(mode) {
    if (mode && (!this.reference || this.isPreviewOpen())) { this.message("Reference를 불러오고 Runtime Preview를 닫으세요."); return; }
    this.mode = mode;
    if (mode) this.onStart?.();
    this.firstCalibration = null;
    this.draft = [];
    this.viewport.dataset.referenceMode = mode || "";
    this.calibrateButton.setAttribute("aria-pressed", String(mode === "calibrate"));
    this.traceButton.setAttribute("aria-pressed", String(mode === "trace"));
    this.cancelButton.disabled = !mode;
    this.finishButton.disabled = mode !== "trace";
    if (mode === "calibrate") this.message("이미지의 두 지점을 순서대로 클릭하세요.");
    if (mode === "trace") this.message("건물 모서리를 클릭하세요. Enter 또는 완료 버튼으로 확정합니다.");
    this.render();
  }

  onViewportClick(event) {
    if (!this.mode || this.isPreviewOpen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const ground = groundFromViewport(event.clientX, event.clientY, this.viewport.getBoundingClientRect());
    const worldPoint = [ground[0], ground[2]];
    const pixel = worldToImagePixel(this.reference, worldPoint);
    if (pixel[0] < 0 || pixel[1] < 0 || pixel[0] > this.reference.width || pixel[1] > this.reference.height) {
      this.message("Reference 이미지 안의 지점을 클릭하세요.");
      return;
    }
    if (this.mode === "calibrate") {
      if (!this.firstCalibration) {
        this.firstCalibration = { pixel, worldPoint };
        this.message("첫 지점 선택됨 · 두 번째 지점을 클릭하세요.");
      } else {
        try {
          this.reference = calibrateMapReference(this.reference, this.firstCalibration.pixel, pixel, number(this.distance));
          this.syncControls();
          this.setMode(null);
          this.persist();
          this.message(`거리 보정 완료 · ${Number(this.reference.metersPerPixel.toPrecision(6))} m/px`);
        } catch (error) { this.error(error); }
      }
    } else {
      this.draft.push(pixel);
      this.message(this.draft.length < 3
        ? `외곽선 점 ${this.draft.length}개 · 3개 이상 찍으세요.`
        : `외곽선 점 ${this.draft.length}개 · 완료를 누르면 저장됩니다.`);
    }
    this.render();
  }

  finishFootprint() {
    if (this.mode !== "trace") return;
    try {
      validateFootprint(this.draft);
      const points = this.draft.map(point => point.map(rounded));
      this.reference = {
        ...this.reference,
        footprints: [...this.reference.footprints, { id: `footprint.${crypto.randomUUID()}`, name: `Building ${this.reference.footprints.length + 1}`, points }]
      };
      this.setMode(null);
      this.syncControls();
      this.persist();
      this.message("건물 외곽선을 로컬 Reference에 저장했습니다.");
    } catch (error) { this.error(error); }
  }

  syncControls() {
    const reference = this.reference;
    this.controls.hidden = !reference;
    if (!reference) { this.footprintList.replaceChildren(); return; }
    this.rights.value = reference.rightsNote;
    this.meta.textContent = `${reference.name} · ${reference.width}×${reference.height} px · world.json과 분리`;
    this.opacity.value = String(Math.round(reference.opacity * 100));
    this.opacityValue.value = `${this.opacity.value}%`;
    this.scale.value = String(Number(reference.metersPerPixel.toPrecision(8)));
    this.anchorX.value = String(rounded(reference.anchorX));
    this.anchorZ.value = String(rounded(reference.anchorZ));
    this.footprintList.replaceChildren();
    for (const footprint of reference.footprints) {
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = `${footprint.name} · ${footprint.points.length}점`;
      const actions = document.createElement("span");
      actions.className = "editor-reference-footprint-actions";
      const create = document.createElement("button");
      create.type = "button";
      const exists = this.getWorld()?.hasEntity(buildingMassEntityId(footprint));
      create.textContent = exists ? "건물 선택" : "건물 생성";
      create.setAttribute("aria-label", `${footprint.name} ${create.textContent}`);
      create.addEventListener("click", () => {
        try {
          const mass = createBuildingMassCandidate(this.reference, footprint, number(this.buildingHeight));
          const result = this.onCreateMass?.(mass);
          if (result === false) return;
          this.syncControls();
          this.message(result === "selected" ? `${footprint.name} 건물을 선택했습니다.` : `${footprint.name} 건물을 생성했습니다. 프로젝트를 저장하세요.`);
        } catch (error) { this.error(error); }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "삭제";
      remove.setAttribute("aria-label", `${footprint.name} 외곽선 삭제`);
      remove.addEventListener("click", () => {
        if (!window.confirm(`${footprint.name} 외곽선을 삭제할까요?`)) return;
        this.reference = { ...this.reference, footprints: this.reference.footprints.filter(item => item.id !== footprint.id) };
        this.syncControls(); this.render(); this.persist();
      });
      actions.append(create, remove);
      row.append(label, actions);
      this.footprintList.append(row);
    }
  }

  render() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    const context = this.canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!this.reference || !this.bitmap) return;
    const reference = this.reference;
    const topLeft = projectGround([reference.anchorX, 0, reference.anchorZ]);
    const scaleX = width * 0.014 * reference.metersPerPixel;
    const scaleY = height * 0.014 * reference.metersPerPixel;
    context.save();
    context.globalAlpha = reference.opacity;
    context.transform(scaleX, 0, scaleX * 0.35, scaleY * 0.75, width * topLeft.left / 100, height * topLeft.top / 100);
    context.drawImage(this.bitmap, 0, 0);
    context.restore();
    const drawPolygon = (points, color, close) => {
      if (!points.length) return;
      context.beginPath();
      points.forEach(([x, z], index) => {
        const point = projectGround([x, 0, z]);
        const px = width * point.left / 100;
        const py = height * point.top / 100;
        if (index === 0) context.moveTo(px, py); else context.lineTo(px, py);
      });
      if (close) context.closePath();
      context.lineWidth = 2;
      context.strokeStyle = color;
      context.stroke();
      if (close) { context.fillStyle = "rgba(255, 187, 108, .13)"; context.fill(); }
    };
    for (const footprint of reference.footprints) drawPolygon(footprintWorldPoints(reference, footprint), "#ffbb6c", true);
    drawPolygon(this.draft.map(pixel => imagePixelToWorld(reference, pixel)), "#84e5ff", false);
    if (this.firstCalibration) {
      const point = projectGround([this.firstCalibration.worldPoint[0], 0, this.firstCalibration.worldPoint[1]]);
      context.beginPath();
      context.arc(width * point.left / 100, height * point.top / 100, 5, 0, Math.PI * 2);
      context.fillStyle = "#84e5ff";
      context.fill();
    }
  }
}
