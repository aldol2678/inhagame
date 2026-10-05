(() => {
  'use strict';
  if (typeof window === 'undefined' || location.hostname !== 'grow.inhagame.app') return;

  const SUPABASE_URL = ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url);
  const SUPABASE_KEY = ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey);
  const client = window.supabase?.createClient?.(
    SUPABASE_URL,
    SUPABASE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  if (!client) return;

  const sessionKey = 'induck-grow-analytics-session-v1';
  const attributionKey = 'induck-grow-analytics-attribution-v1';
  const sentKey = 'induck-grow-analytics-sent-v1';
  const startedKey = 'induck-grow-analytics-started-v1';
  const milestoneWeeks = new Set([1, 4, 8, 12, 15]);
  const validUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const uuid = () => crypto.randomUUID();

  function sessionId() {
    let value = null;
    try { value = sessionStorage.getItem(sessionKey); } catch {}
    if (validUuid(value)) return value;
    value = uuid();
    try { sessionStorage.setItem(sessionKey, value); } catch {}
    return value;
  }

  function sessionStartedAt() {
    let value = 0;
    try { value = Number(sessionStorage.getItem(startedKey) || 0); } catch {}
    if (Number.isFinite(value) && value > 0) return value;
    value = Date.now();
    try { sessionStorage.setItem(startedKey, String(value)); } catch {}
    return value;
  }

  function normalizeSource(value) {
    const source = String(value || '').trim().toLowerCase();
    if (!source) return null;
    if (source === 'everytime' || source === 'eta' || source === 'everytime_kr') return 'everytime';
    if (['direct', 'internal', 'external', 'unknown'].includes(source)) return source;
    return 'external';
  }

  function normalizeCampaign(value) {
    const campaign = String(value || '').trim().toLowerCase();
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(campaign) ? campaign : null;
  }

  function sourceFromReferrer() {
    if (!document.referrer) return 'direct';
    try {
      const url = new URL(document.referrer);
      const host = url.hostname.toLowerCase();
      if (host === 'everytime.kr' || host.endsWith('.everytime.kr')) return 'everytime';
      if (url.origin === location.origin) return 'internal';
      if (host === 'inhagame.app' || host.endsWith('.inhagame.example')) return 'internal';
      return 'external';
    } catch {
      return 'unknown';
    }
  }

  function attribution() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(attributionKey) || 'null'); } catch {}
    const url = new URL(location.href);
    const explicitSource = normalizeSource(url.searchParams.get('utm_source') || url.searchParams.get('src'));
    const explicitCampaign = normalizeCampaign(url.searchParams.get('utm_campaign') || url.searchParams.get('campaign'));
    const usableSaved = saved && ['direct', 'everytime', 'internal', 'external', 'unknown'].includes(saved.source)
      && (saved.campaign == null || normalizeCampaign(saved.campaign) === saved.campaign);
    const value = explicitSource || explicitCampaign || !usableSaved
      ? { source: explicitSource || sourceFromReferrer(), campaign: explicitCampaign }
      : { source: saved.source, campaign: saved.campaign || null };
    try { sessionStorage.setItem(attributionKey, JSON.stringify(value)); } catch {}
    return value;
  }

  const session = sessionId();
  const startedAt = sessionStartedAt();
  const source = attribution();
  let sent = new Set();
  let hiddenTimer = null;
  try { sent = new Set(JSON.parse(sessionStorage.getItem(sentKey) || '[]')); } catch {}

  function remember(key) {
    sent.add(key);
    try { sessionStorage.setItem(sentKey, JSON.stringify([...sent])); } catch {}
  }

  function gameState() {
    try { return typeof state !== 'undefined' && state ? state : null; }
    catch { return null; }
  }

  function deviceFreeBlockBonus() {
    try {
      return typeof ownedFreeBlockBonus === 'function' ? Number(ownedFreeBlockBonus()) || 0 : 0;
    } catch {
      return 0;
    }
  }

  function activeScreen() {
    const id = document.querySelector?.('.screen.active')?.id;
    return typeof id === 'string' && /^[a-z0-9_-]{1,32}$/.test(id) ? id : null;
  }

  function snapshot() {
    const current = gameState();
    const skipped = Array.isArray(current?.skippedSlots) ? current.skippedSlots.length : 0;
    const baseFree = Number.isFinite(Number(current?.baseFree)) ? Number(current.baseFree) : null;
    return {
      department: typeof current?.department === 'string' ? current.department : null,
      week: Number.isInteger(current?.week) ? current.week : null,
      gpa: Number.isFinite(Number(current?.gpa)) ? Number(current.gpa) : null,
      stamina: Number.isFinite(Number(current?.stamina)) ? Math.round(Number(current.stamina)) : null,
      stress: Number.isFinite(Number(current?.stress)) ? Math.round(Number(current.stress)) : null,
      money: Number.isFinite(Number(current?.money)) ? Math.round(Number(current.money)) : null,
      freeSlots: baseFree == null ? null : Math.max(0, Math.round(baseFree + deviceFreeBlockBonus() + skipped)),
      screen: activeScreen()
    };
  }

  async function report(eventType, details = {}) {
    const week = Number.isInteger(details.week) ? details.week : null;
    const key = eventType === 'week_checkpoint' ? eventType + ':' + week : eventType;
    if (sent.has(key)) return false;
    const { error, data } = await client.rpc('log_induck_grow_analytics_v1', {
      p_event_id: uuid(),
      p_session_id: session,
      p_event_type: eventType,
      p_week: week,
      p_department: details.department || null,
      p_gpa: Number.isFinite(details.gpa) ? details.gpa : null,
      p_acquisition_source: source.source,
      p_campaign: source.campaign
    });
    if (!error && data === true) remember(key);
    return !error && data === true;
  }

  async function resourceCheckpoint(details) {
    const week = Number.isInteger(details.week) ? details.week : null;
    const key = 'resource_checkpoint:' + week;
    if (!milestoneWeeks.has(week) || sent.has(key)) return false;
    const required = [details.stamina, details.stress, details.money, details.freeSlots];
    if (required.some(value => !Number.isFinite(value)) || !details.department) return false;
    const { error, data } = await client.rpc('log_induck_grow_resource_checkpoint_v1', {
      p_event_id: uuid(),
      p_session_id: session,
      p_week: week,
      p_department: details.department,
      p_stamina: details.stamina,
      p_stress: details.stress,
      p_money: details.money,
      p_free_slots: details.freeSlots,
      p_acquisition_source: source.source,
      p_campaign: source.campaign
    });
    if (!error && data === true) remember(key);
    return !error && data === true;
  }

  function sessionEndPayload(reason, completed) {
    const snap = snapshot();
    return {
      p_event_id: uuid(),
      p_session_id: session,
      p_last_week: Number.isInteger(snap.week) && snap.week >= 1 && snap.week <= 15 ? snap.week : null,
      p_last_screen: snap.screen,
      p_duration_sec: Math.max(0, Math.min(21600, Math.floor((Date.now() - startedAt) / 1000))),
      p_completed: completed === true,
      p_end_reason: completed ? 'completed' : reason,
      p_department: snap.department,
      p_final_gpa: completed && Number.isFinite(snap.gpa) ? snap.gpa : null,
      p_acquisition_source: source.source,
      p_campaign: source.campaign
    };
  }

  async function sessionEnd(reason = 'pagehide', completed = false) {
    const body = sessionEndPayload(reason, completed);
    try {
      const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/log_induck_grow_session_end_v1', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
        mode: 'cors'
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function reportScreen(screen) {
    if (!screen?.classList?.contains('active')) return;
    const snap = snapshot();
    if (screen.id === 'screen-brief' && snap.week === 1 && snap.department) {
      void report('semester_start', { week: 1, department: snap.department });
    } else if (screen.id === 'screen-recap' && snap.week >= 1 && snap.week <= 15 && snap.department) {
      void report('week_checkpoint', { week: snap.week, department: snap.department });
      if (milestoneWeeks.has(snap.week)) void resourceCheckpoint(snap);
    } else if (screen.id === 'screen-final' && snap.department) {
      void report('semester_result', { week: 15, department: snap.department, gpa: snap.gpa });
      void sessionEnd('completed', true);
    }
  }

  const watchedScreens = ['screen-brief', 'screen-recap', 'screen-final']
    .map(id => document.getElementById(id)).filter(Boolean);
  for (const screen of watchedScreens) {
    const observer = new MutationObserver(() => reportScreen(screen));
    observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
    reportScreen(screen);
  }

  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    const action = button?.getAttribute('onclick')?.replace(/\s/g, '');
    if (action === 'newGame()' || action === 'continueGame()') {
      void report('play_start');
    } else if (action === 'replaySame()' || action === 'replayOther()') {
      void report('retry');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (hiddenTimer) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
    if (document.hidden) {
      hiddenTimer = setTimeout(() => {
        if (document.hidden) void sessionEnd('hidden_timeout', false);
      }, 60000);
    }
  });

  window.addEventListener('pagehide', () => {
    void sessionEnd('pagehide', false);
  });

  const decisionCategories = new Set([
    'orientation','course','club','student_council','random_event','subscription','career'
  ]);
  const cleanDecisionId = value => {
    const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) ? id : null;
  };
  async function decisionEvent(category, decisionId, choiceId, snap = snapshot()) {
    const categoryId = cleanDecisionId(category);
    const decision = cleanDecisionId(decisionId);
    const choice = cleanDecisionId(choiceId);
    if (!decisionCategories.has(categoryId) || !decision || !choice || !snap.department) return false;
    const week = Number.isInteger(snap.week) && snap.week >= 0 && snap.week <= 15 ? snap.week : null;
    const { error, data } = await client.rpc('log_induck_grow_decision_v1', {
      p_event_id: uuid(),
      p_session_id: session,
      p_week: week,
      p_department: snap.department,
      p_category: categoryId,
      p_decision_id: decision,
      p_choice_id: choice,
      p_acquisition_source: source.source,
      p_campaign: source.campaign
    });
    return !error && data === true;
  }

  function wrapDecision(name, capture, resolve) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function(...args) {
      let before = null;
      try { before = capture?.(...args); } catch {}
      const result = original.apply(this, args);
      try {
        const event = resolve?.(args, before);
        if (event) void decisionEvent(event.category, event.decisionId, event.choiceId, event.snap || snapshot());
      } catch {}
      return result;
    };
  }

  wrapDecision('chooseOT',
    () => gameState()?.otChoice,
    (args, before) => gameState()?.otChoice === args[0] && before !== args[0]
      ? { category:'orientation', decisionId:'ot', choiceId:args[0] } : null);

  wrapDecision('choosePriority',
    () => gameState()?.priorityCourseId,
    (args, before) => gameState()?.priorityCourseId === args[0] && before !== args[0]
      ? { category:'course', decisionId:'priority_course', choiceId:'course_'+args[0] } : null);

  wrapDecision('finalizeClubTrack',
    () => ({ id:gameState()?.clubId, track:gameState()?.clubTrack }),
    (args, before) => gameState()?.clubId === args[0] && gameState()?.clubTrack === args[1]
      && (before?.id !== args[0] || before?.track !== args[1])
      ? { category:'club', decisionId:'club_join', choiceId:args[0]+'_'+args[1] } : null);

  wrapDecision('skipClubFair',
    () => null,
    args => ({ category:'club', decisionId:'club_join', choiceId:args[0] ? 'skip_final' : 'later' }));

  wrapDecision('joinCouncil',
    () => ({ id:gameState()?.councilId, track:gameState()?.councilTrack }),
    (args, before) => gameState()?.councilId === args[0] && gameState()?.councilTrack === args[1]
      && (before?.id !== args[0] || before?.track !== args[1])
      ? { category:'student_council', decisionId:'council_join', choiceId:args[0]+'_'+args[1] } : null);

  wrapDecision('declineCouncil',
    () => !!gameState()?.flags?.COUNCIL_DECLINED,
    (_args, before) => gameState()?.flags?.COUNCIL_DECLINED && !before
      ? { category:'student_council', decisionId:'council_join', choiceId:'decline' } : null);

  wrapDecision('chooseEvent',
    (...args) => {
      let eventId = null;
      try { eventId = typeof currentEvent !== 'undefined' ? currentEvent?.id : null; } catch {}
      return { eventId, choice:args[0], snap:snapshot() };
    },
    (_args, before) => before?.eventId
      ? { category:'random_event', decisionId:before.eventId, choiceId:before.choice, snap:before.snap } : null);

  wrapDecision('chooseClubEvent',
    index => {
      const snap=snapshot(), current=gameState();
      return { decisionId:'club_'+(current?.clubId||'unknown')+'_w'+(snap.week??0), choiceId:'option_'+index, snap };
    },
    (_args, before) => before ? { category:'club', ...before } : null);

  wrapDecision('chooseCouncilEvent',
    index => {
      const snap=snapshot(), current=gameState();
      return { decisionId:'council_'+(current?.councilId||'unknown')+'_'+(current?.councilTrack||'unknown')+'_w'+(snap.week??0), choiceId:'option_'+index, snap };
    },
    (_args, before) => before ? { category:'student_council', ...before } : null);

  wrapDecision('toggleSubscription',
    id => ({ id, active:!!gameState()?.subscriptions?.[id], snap:snapshot() }),
    (_args, before) => {
      if (!before?.id) return null;
      const active=!!gameState()?.subscriptions?.[before.id];
      if (active === before.active) return null;
      return { category:'subscription', decisionId:'subscription_'+before.id, choiceId:active?'start':'cancel', snap:before.snap };
    });

  wrapDecision('chooseLanguageTrack',
    () => gameState()?.career?.language?.track,
    (args, before) => gameState()?.career?.language?.track === args[0] && before !== args[0]
      ? { category:'career', decisionId:'language_track', choiceId:args[0] } : null);

  wrapDecision('chooseCertificateTrack',
    () => gameState()?.career?.certificate?.track,
    (args, before) => gameState()?.career?.certificate?.track === args[0] && before !== args[0]
      ? { category:'career', decisionId:'certificate_track', choiceId:args[0] } : null);

  wrapDecision('startContest',
    () => gameState()?.career?.contest?.mode,
    (args, before) => gameState()?.career?.contest?.mode === args[0] && before !== args[0]
      ? { category:'career', decisionId:'contest_mode', choiceId:args[0] } : null);

  window.InduckGrowAnalytics = Object.freeze({
    report,
    accountSave: () => report('account_save'),
    resourceCheckpoint,
    sessionEnd,
    decisionEvent,
    snapshot
  });
  void report('landing');
})();