// Just enough DOM for UI modules under Node: elements, attributes, classList, events, containment.
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
}

export class FakeElement {
  constructor(tag, doc) {
    Object.assign(this, { tagName: tag.toUpperCase(), doc, children: [], parent: null, attributes: {}, dataset: {},
      classList: new FakeClassList(), listeners: new Map(), textContent: "", hidden: false, type: "", className: "" });
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  get innerHTML() { throw new Error("innerHTML is not allowed for chat rendering"); }
  set innerHTML(_v) { throw new Error("innerHTML is not allowed for chat rendering"); }
  addEventListener(type, fn) { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)).push(fn); }
  dispatch(type, event = {}) {
    const e = { type, target: event.target ?? this, stopPropagation() { this.stopped = true; }, preventDefault() {}, ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    if (!e.stopped && this.parent) this.parent.dispatch(type, e);
    else if (!e.stopped && !this.parent && this !== this.doc.root) this.doc.dispatch(type, e);
    return e;
  }
  click() { return this.dispatch("click"); }
  contains(node) { for (let n = node; n; n = n.parent) if (n === this) return true; return false; }
  focus() { this.doc.activeElement = this; }
  closest() { return null; }
}

export function createFakeDocument() {
  const doc = {
    listeners: new Map(),
    activeElement: null,
    createElement(tag) { return new FakeElement(tag, doc); },
    addEventListener(type, fn) { (doc.listeners.get(type) ?? doc.listeners.set(type, []).get(type)).push(fn); },
    dispatch(type, event = {}) { for (const fn of doc.listeners.get(type) ?? []) fn({ type, preventDefault() {}, ...event }); }
  };
  return doc;
}
