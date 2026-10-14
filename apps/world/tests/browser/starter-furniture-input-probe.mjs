// Read-only DOM evidence for the real click/tap below. No scrolling or event dispatch.
// The viewport-clipped center is a probe point, not Playwright's actual click coordinate.
export function inspectStarterPurchaseButton(button) {
  const doc = button.ownerDocument, view = doc.defaultView;
  const describe = node => node ? {
    tag: node.tagName, id: node.id || null, className: node.getAttribute('class'),
    focusKey: node.dataset?.focusKey ?? null,
    pointerEvents: view.getComputedStyle(node).pointerEvents
  } : null;
  const rect = button.getBoundingClientRect();
  const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  const right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom);
  const point = right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2 } : null;
  const hits = point ? doc.elementsFromPoint(point.x, point.y) : [];
  const panel = button.closest('.shop-panel'), style = view.getComputedStyle(button);
  return {
    target: describe(button), connected: button.isConnected, disabled: button.disabled,
    listingId: button.closest('[data-listing-id]')?.dataset.listingId ?? null,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    viewport: { width: view.innerWidth, height: view.innerHeight },
    style: { display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents },
    hiddenAncestor: Boolean(button.closest('[hidden]')), inertAncestor: Boolean(button.closest('[inert]')),
    probePoint: point, probeHitsTarget: Boolean(hits[0] && button.contains(hits[0])),
    hitStack: hits.slice(0, 8).map(describe),
    activeCategory: panel?.querySelector('.shop-showroom-tab[aria-pressed="true"]')?.dataset.category ?? null,
    detailOpen: Boolean(panel?.querySelector('.shop-showroom-detail')),
    presentation: panel?.dataset.presentation ?? null,
    focus: describe(doc.activeElement), page: { visibility: doc.visibilityState, focused: doc.hasFocus() },
    frames: view.__STARTER_FURNITURE__?.frameCounts?.() ?? null,
    canvasCount: doc.querySelectorAll('canvas').length
  };
}

// Binding entry proves the browser attempted its real RPC, not that HTTP completed.
// The DB fixture's `calls` list is written only after its fetch/JSON response arrives.
export async function trackStarterPurchaseRpc(invocations, name, args, invoke) {
  const entry={name,listingId:args.p_listing_id,state:'BINDING_ENTERED',startedAt:new Date().toISOString()};
  invocations.push(entry);
  try {
    const response=await invoke();
    entry.state=response.error?'ERROR_RESPONSE':'RETURNED';
    return response;
  } catch(error) {
    entry.state='THREW';throw error;
  } finally { entry.finishedAt=new Date().toISOString(); }
}
