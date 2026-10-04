import {
  NPC_DIALOGUE_STATE
} from "../../npc-factory/npc-dialogue-session.mjs";
import {
  buildNpcDialogueCandidates,
  resolveNpcDialogueBaseline
} from "../../npc-factory/npc-dialogue-context.mjs";
import { createNpcJevDialogueRouter } from "../../npc-factory/npc-dialogue-jev-client.mjs";
import {
  authoredBiryongDialogueLine,
  biryongDialogueTopics,
  buildBiryongGeminiGroundedPacket,
  compileBiryongClientKnowledge,
  getBiryongDialogueProfile
} from "./biryong-village-dialogue-contract.js";

const DIALOGUE_PRIORITY = 300;

const turnState = mode => mode === "STATUS"
  ? NPC_DIALOGUE_STATE.STATUS
  : mode === "TOPIC" ? NPC_DIALOGUE_STATE.TOPIC_RESPONSE : NPC_DIALOGUE_STATE.HOME;

function makePanel() {
  const panel = document.createElement("section");
  panel.id = "biryong-village-dialogue";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "비룡마을 주민 대화");
  panel.hidden = true;
  panel.style.cssText = [
    "position:fixed","left:50%","bottom:110px","transform:translateX(-50%)",
    "z-index:105","width:min(440px,calc(100vw - 20px))","max-height:min(64vh,560px)",
    "overflow:auto","padding:12px","border-radius:14px","border:1px solid #d7bd78",
    "background:#10251ff4","color:#f7fbf4","box-shadow:0 12px 34px #0009",
    "font:14px/1.45 system-ui,sans-serif"
  ].join(";");
  panel.innerHTML = `
    <header style="display:flex;gap:10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <strong data-name style="display:block;font-size:18px"></strong>
        <small data-role style="display:block;color:#c9d7cc"></small>
      </div>
      <button data-close type="button" aria-label="대화 닫기"
        style="min-width:34px;min-height:34px;border-radius:50%;border:1px solid #789b87;background:#203c33;color:#fff">×</button>
    </header>
    <p data-line style="margin:12px 0;padding:12px;border-radius:10px;background:#e9f0e7;color:#14251d"></p>
    <div data-actions style="display:grid;gap:7px"></div>
    <small data-debug hidden style="display:block;margin-top:8px;color:#9fb4a5"></small>
  `;
  document.body.appendChild(panel);
  return panel;
}

function safeStage(value) {
  return Number.isInteger(value) ? Math.min(3, Math.max(1, value)) : 1;
}

export function createBiryongVillageDialogueRuntime({
  npcRuntime,
  getWorldContext = () => ({}),
  getSession = async () => null,
  getRelationshipStage = () => 1,
  onOpenChange = () => {},
  jevEnabled = false,
  jevEndpoint = "/api/npc-dialogue-route"
} = {}) {
  if (!npcRuntime?.nearestNpc || !npcRuntime?.pauseNpc || !npcRuntime?.resumeNpc)
    throw new TypeError("Biryong dialogue requires NPC runtime proximity controls");

  const panel = makePanel();
  const nameEl = panel.querySelector("[data-name]");
  const roleEl = panel.querySelector("[data-role]");
  const lineEl = panel.querySelector("[data-line]");
  const actionsEl = panel.querySelector("[data-actions]");
  const debugEl = panel.querySelector("[data-debug]");
  const closeButton = panel.querySelector("[data-close]");

  let openNpcId = null;
  let turnCounter = 0;
  let lastTopic = null;
  let lastShadow = null;
  let lastGeminiPacket = null;
  let routerEnabled = Boolean(jevEnabled);
  let dialogueRouter = createNpcJevDialogueRouter({
    enabled: routerEnabled,
    endpoint: jevEndpoint,
    getSession
  });

  function rebuildRouter(enabled) {
    routerEnabled = Boolean(enabled);
    dialogueRouter = createNpcJevDialogueRouter({
      enabled: routerEnabled,
      endpoint: jevEndpoint,
      getSession
    });
  }

  function currentNpc() {
    return openNpcId ? npcRuntime.actorSnapshot(openNpcId) : null;
  }

  function relationshipStage(npcId) {
    try { return safeStage(getRelationshipStage(npcId)); }
    catch { return 1; }
  }

  function genericContext(npc, { mode = "GREETING", topicId = null, generationAllowed = false } = {}) {
    const profile = getBiryongDialogueProfile(npc.id);
    const knowledge = compileBiryongClientKnowledge(npc.id, relationshipStage(npc.id));
    const world = getWorldContext() ?? {};
    const period = npcRuntime.status().period ?? null;
    return Object.freeze({
      schemaVersion: "dialogue-context-p1",
      identity: Object.freeze({
        npcId: npc.id,
        name: npc.name,
        archetype: npc.role,
        department: npc.faction,
        yearLevel: null,
        residence: "BIRYONG_REALM",
        interests: knowledge.topicIds,
        traits: profile?.traits ?? []
      }),
      current: Object.freeze({
        period,
        location: npc.destination,
        activity: npc.activity,
        socialMode: "SOLO",
        moving: npc.moving === true
      }),
      world: Object.freeze({
        weather: typeof world.weather === "string" ? world.weather : null,
        environmentTime: typeof world.environmentTime === "string" ? world.environmentTime : null,
        placeZoneId: typeof world.placeZoneId === "string" ? world.placeZoneId : null,
        eventId: null,
        eventPhase: null
      }),
      memory: Object.freeze({
        familiarity: turnCounter > 0 ? "KNOWN" : "FIRST",
        lastPeriod: period,
        lastTopic
      }),
      social: Object.freeze({
        group: null,
        closeTies: Object.freeze(knowledge.relations.slice(0, 2).map(edge => Object.freeze({
          npcId: edge.npcId,
          name: edge.name,
          strength: edge.strength
        })))
      }),
      quest: Object.freeze({
        enabled: false, signedIn: false, available: false, complete: false,
        stage: null, objective: null, npcActionAvailable: false, sideEventAvailable: false
      }),
      turn: Object.freeze({
        state: turnState(mode),
        topic: topicId,
        followUp: mode === "TOPIC" && lastTopic === topicId
      }),
      generationAllowed: generationAllowed === true
    });
  }

  async function shadowDecision(npc, options) {
    const context = genericContext(npc, options);
    const candidates = buildNpcDialogueCandidates(context);
    const baseline = resolveNpcDialogueBaseline(context);
    lastShadow = Object.freeze({
      state: "PENDING",
      npcId: npc.id,
      baseline,
      candidates
    });
    try {
      const decision = await dialogueRouter.route({ context, candidates, baseline });
      if (openNpcId !== npc.id) return;
      lastShadow = Object.freeze({
        state: "READY",
        npcId: npc.id,
        decision,
        baseline,
        candidates
      });
      debugEl.textContent = `Jev shadow: ${decision.provider} · ${decision.intent} · ${decision.contextPriority ?? "—"}`;
    } catch {
      if (openNpcId !== npc.id) return;
      lastShadow = Object.freeze({ state: "FAILED", npcId: npc.id, baseline, candidates });
    }
  }

  function button(label, onClick) {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.style.cssText = "min-height:42px;padding:8px 10px;border-radius:9px;border:1px solid #6e9580;background:#234337;color:#fff;text-align:left;font:inherit";
    el.addEventListener("click", onClick);
    return el;
  }

  function showHome() {
    const npc = currentNpc();
    if (!npc) return false;
    const stage = relationshipStage(npc.id);
    lastTopic = null;
    lineEl.textContent = authoredBiryongDialogueLine(npc.id, { relationshipStage: stage, mode: "GREETING" });
    actionsEl.replaceChildren();
    actionsEl.append(button("요즘 어떻게 지내세요?", () => showStatus()));
    for (const topic of biryongDialogueTopics(npc.id, stage)) {
      actionsEl.append(button(topic.label, () => showTopic(topic.id)));
    }
    actionsEl.append(button("대화 마치기", () => close()));
    void shadowDecision(npc, { mode: "GREETING", generationAllowed: false });
    return true;
  }

  function showStatus() {
    const npc = currentNpc();
    if (!npc) return false;
    const stage = relationshipStage(npc.id);
    turnCounter += 1;
    lineEl.textContent = authoredBiryongDialogueLine(npc.id, { relationshipStage: stage, mode: "STATUS" });
    actionsEl.replaceChildren(
      button("다른 이야기", () => showHome()),
      button("대화 마치기", () => close())
    );
    void shadowDecision(npc, { mode: "STATUS", generationAllowed: false });
    return true;
  }

  function showTopic(topicId) {
    const npc = currentNpc();
    if (!npc) return false;
    const stage = relationshipStage(npc.id);
    const world = getWorldContext() ?? {};
    const current = {
      period: npcRuntime.status().period ?? null,
      destination: npc.destination,
      activity: npc.activity,
      placeZoneId: world.placeZoneId ?? null
    };
    lastGeminiPacket = buildBiryongGeminiGroundedPacket(npc.id, {
      relationshipStage: stage,
      topicId,
      current,
      world
    });
    turnCounter += 1;
    lineEl.textContent = authoredBiryongDialogueLine(npc.id, {
      relationshipStage: stage,
      topicId,
      mode: "TOPIC",
      salt: turnCounter
    });
    actionsEl.replaceChildren(
      button("다른 이야기", () => showHome()),
      button("대화 마치기", () => close())
    );
    void shadowDecision(npc, { mode: "TOPIC", topicId, generationAllowed: true });
    lastTopic = topicId;
    return true;
  }

  function open(npcId) {
    if (openNpcId) close();
    const npc = npcRuntime.actorSnapshot(npcId);
    if (!npc?.visible) return false;
    openNpcId = npcId;
    turnCounter = 0;
    lastTopic = null;
    lastShadow = null;
    lastGeminiPacket = null;
    npcRuntime.pauseNpc(npcId);
    nameEl.textContent = npc.name;
    roleEl.textContent = `${npc.role} · ${npc.faction}`;
    panel.hidden = false;
    onOpenChange(true);
    showHome();
    closeButton.focus?.();
    return true;
  }

  function close() {
    if (!openNpcId) return false;
    const npcId = openNpcId;
    openNpcId = null;
    panel.hidden = true;
    npcRuntime.resumeNpc(npcId);
    onOpenChange(false);
    return true;
  }

  function getContextAction({ blocked = false } = {}) {
    if (blocked || openNpcId) return null;
    const nearby = npcRuntime.nearestNpc(2.2);
    if (!nearby) return null;
    return Object.freeze({
      id: "biryong-npc-talk",
      icon: "💬",
      label: `${nearby.name}와 대화`,
      compactLabel: "대화",
      shortcut: "F",
      priority: DIALOGUE_PRIORITY,
      distance: nearby.distance,
      trigger: () => open(nearby.id)
    });
  }

  const keydown = event => {
    if (!openNpcId || event.code !== "Escape") return;
    event.preventDefault();
    close();
  };
  document.addEventListener("keydown", keydown);
  closeButton.addEventListener("click", close);

  return Object.freeze({
    open,
    close,
    getContextAction,
    setJevEnabled: rebuildRouter,
    get open() { return Boolean(openNpcId); },
    status() {
      const npc = currentNpc();
      return Object.freeze({
        open: Boolean(openNpcId),
        npcId: openNpcId,
        npcName: npc?.name ?? null,
        relationshipStage: openNpcId ? relationshipStage(openNpcId) : null,
        lastTopic,
        jev: Object.freeze({
          enabled: routerEnabled,
          ...(dialogueRouter.status?.() ?? {}),
          shadow: lastShadow
        }),
        gemini: Object.freeze({
          live: false,
          groundedPacketReady: Boolean(lastGeminiPacket),
          packetSchema: lastGeminiPacket?.schemaVersion ?? null,
          allowedFactCount: lastGeminiPacket?.allowedFacts?.length ?? 0,
          secretTextShipped: false
        })
      });
    },
    destroy() {
      close();
      document.removeEventListener("keydown", keydown);
      panel.remove();
    }
  });
}
