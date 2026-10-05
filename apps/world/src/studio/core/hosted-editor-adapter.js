const freezeStatus = status => status && typeof status === "object"
  ? Object.freeze({ ...status })
  : Object.freeze({ ready: false });

export class HostedEditorAdapter {
  constructor({
    moduleId,
    channel,
    container,
    src,
    frameId,
    frameClass,
    frameTitle,
    allow = "clipboard-read; clipboard-write",
    errorPrefix,
    windowTarget = globalThis.window,
    documentLike = globalThis.document,
    onStatus = () => {},
    timeoutMs = 30_000
  } = {}) {
    if (!moduleId || !channel || !container || !src || !frameId || !frameTitle || !errorPrefix ||
        !windowTarget || !documentLike) {
      throw new Error("E_STUDIO_HOST_ADAPTER_REQUIRED");
    }
    this.moduleId = moduleId;
    this.channel = channel;
    this.container = container;
    this.src = src;
    this.frameId = frameId;
    this.frameClass = frameClass || frameId;
    this.frameTitle = frameTitle;
    this.allow = allow;
    this.errorPrefix = errorPrefix;
    this.windowTarget = windowTarget;
    this.documentLike = documentLike;
    this.onStatus = onStatus;
    this.timeoutMs = timeoutMs;
    this.frame = null;
    this.status = freezeStatus({ ready: false, mounted: false, moduleId });
    this.pending = new Map();
    this.requestSequence = 0;
    this._onMessage = event => this._handleMessage(event);
  }

  mount() {
    if (this.frame) return this.frame;
    const frame = this.documentLike.createElement("iframe");
    frame.id = this.frameId;
    frame.className = this.frameClass;
    frame.title = this.frameTitle;
    frame.src = this.src;
    frame.setAttribute("allow", this.allow);
    frame.setAttribute("loading", "eager");
    this.container.replaceChildren(frame);
    this.container.dataset.hosted = "true";
    this.frame = frame;
    this.windowTarget.addEventListener("message", this._onMessage);
    this._setStatus({ ready: false, mounted: true });
    return frame;
  }

  _setStatus(next) {
    this.status = freezeStatus({ ...this.status, ...next, moduleId: this.moduleId });
    this.onStatus(this.status);
  }

  _handleMessage(event) {
    if (!this.frame?.contentWindow || event.source !== this.frame.contentWindow) return;
    if (event.origin !== this.windowTarget.location.origin) return;
    const message = event.data;
    if (!message || message.channel !== this.channel) return;

    if (message.status) this._setStatus({ ...message.status, mounted: true });
    if (message.type !== "response" || !message.requestId) return;

    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    this.windowTarget.clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result ?? null);
    else pending.reject(new Error(message.error || `${this.errorPrefix}_COMMAND_FAILED`));
  }

  command(action, payload = null) {
    if (!this.frame?.contentWindow) return Promise.reject(new Error(`${this.errorPrefix}_NOT_MOUNTED`));
    if (!this.status.ready) return Promise.reject(new Error(`${this.errorPrefix}_NOT_READY`));
    const requestId = `${this.moduleId}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = this.windowTarget.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${this.errorPrefix}_COMMAND_TIMEOUT:${action}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.frame.contentWindow.postMessage({
        channel: this.channel,
        type: "command",
        requestId,
        action,
        payload
      }, this.windowTarget.location.origin);
    });
  }

  save() { return this.command("save"); }
  togglePreview() { return this.command("toggle-preview"); }
  validate() { return this.command("validate"); }
  undo() { return this.command("undo"); }
  redo() { return this.command("redo"); }
  getContent() { return this.command("get-content"); }
  selectContent(kind, id) { return this.command("select-content", { kind, id }); }
  getInspector() { return this.command("get-inspector"); }
  updateInspector(kind, id, field, value) {
    return this.command("update-inspector", { kind, id, field, value });
  }
  getStatus() { return this.status; }

  dispose() {
    this.windowTarget.removeEventListener("message", this._onMessage);
    for (const [requestId, pending] of this.pending) {
      this.windowTarget.clearTimeout(pending.timer);
      pending.reject(new Error(`${this.errorPrefix}_ADAPTER_DISPOSED:${requestId}`));
    }
    this.pending.clear();
    this.frame?.remove();
    this.frame = null;
    delete this.container.dataset.hosted;
    this._setStatus({ ready: false, mounted: false });
  }
}
