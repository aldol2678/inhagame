(() => {
  const visitorKey = 'inhagame-hub-visitor-v1';
  const sessionKey = 'inhagame-hub-session-v1';
  const attributionKey = 'inhagame-hub-attribution-v1';
  const valid = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    return Array.from(bytes, (v, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + v.toString(16).padStart(2, '0')).join('');
  };
  function getId(storage, key) {
    let id;
    try { id = storage.getItem(key); } catch { /* Private browsing: use this page's ID. */ }
    if (valid(id)) return id;
    id = uuid();
    try { storage.setItem(key, id); } catch { /* Analytics remain best effort. */ }
    return id;
  }
  const normalizeSource = value => {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return null;
    if (source === 'everytime' || source === 'eta' || source === 'everytime_kr') return 'everytime';
    if (['direct','internal','external','unknown'].includes(source)) return source;
    return 'external';
  };
  const normalizeCampaign = value => {
    const campaign = String(value || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(campaign) ? campaign : null;
  };
  function sourceFromReferrer() {
    if (!document.referrer) return 'direct';
    try {
      const url = new URL(document.referrer);
      const host = url.hostname.toLowerCase();
      if (host === 'everytime.kr' || host.endsWith('.everytime.kr')) return 'everytime';
      if (url.origin === location.origin) return 'internal';
      return 'external';
    } catch {
      return 'unknown';
    }
  }
  function readAttribution() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(attributionKey) || 'null'); } catch { /* ignored */ }
    const params = new URL(location.href);
    const explicitSource = normalizeSource(params.searchParams.get('utm_source') || params.searchParams.get('src'));
    const explicitCampaign = normalizeCampaign(params.searchParams.get('utm_campaign') || params.searchParams.get('campaign'));
    const usableSaved = saved && ['direct','everytime','internal','external','unknown'].includes(saved.source) &&
      (saved.campaign == null || normalizeCampaign(saved.campaign) === saved.campaign);
    const value = explicitSource || explicitCampaign || !usableSaved
      ? { source: explicitSource || sourceFromReferrer(), campaign: explicitCampaign }
      : { source: saved.source, campaign: saved.campaign || null };
    try { sessionStorage.setItem(attributionKey, JSON.stringify(value)); } catch { /* ignored */ }
    if (explicitSource || explicitCampaign) {
      ['utm_source','utm_campaign','src','campaign'].forEach(key => params.searchParams.delete(key));
      history.replaceState(history.state, '', params.pathname + params.search + params.hash);
    }
    return value;
  }
  let visitorId;
  let sessionId;
  try {
    visitorId = getId(localStorage, visitorKey);
    sessionId = getId(sessionStorage, sessionKey);
  } catch {
    // A restricted browser can still show the hub without analytics.
  }
  const acquisition = readAttribution();
  function eventBody(eventId, eventType, surface, target) {
    return JSON.stringify({
      event_id: eventId, session_id: sessionId, visitor_id: visitorId,
      event_type: eventType, surface, target,
      acquisition_source: acquisition.source, campaign: acquisition.campaign
    });
  }
  function track(eventType, surface, target = null) {
    if (!visitorId || !sessionId) return null;
    const eventId = uuid();
    const body = eventBody(eventId, eventType, surface, target);
    const url = '/api/hub-event';
    if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return eventId;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true })
      .catch(() => { /* Telemetry must never interrupt navigation or gameplay. */ });
    return eventId;
  }
  async function trackConfirmed(eventType, surface, target = null, {
    eventId = null,
    retryDelays = [1000, 3000, 8000]
  } = {}) {
    if (!visitorId || !sessionId) return null;
    const stableEventId = valid(eventId) ? eventId : uuid();
    const body = eventBody(stableEventId, eventType, surface, target);
    const url = '/api/hub-event';
    const waits = [0, ...retryDelays.filter(ms => Number.isFinite(ms) && ms >= 0)];
    for (let attempt = 0; attempt < waits.length; attempt++) {
      if (waits[attempt] > 0) await new Promise(resolve => setTimeout(resolve, waits[attempt]));
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body
        });
        if (response.status === 204) return stableEventId;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) return null;
      } catch {
        // Confirmed telemetry is still best effort; bounded retries handle transient failures.
      }
    }
    return null;
  }
  window.InhaHubTelemetry = {
    track,
    trackConfirmed,
    attribution: () => ({ source: acquisition.source, campaign: acquisition.campaign })
  };
})();
