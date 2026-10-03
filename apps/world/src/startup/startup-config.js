import { isLobbyShellRequested } from "../lobby/lobby-shell.js";
import { isMcm2026PreviewRequest } from "../events/zombie-university-2026/event-route.js";

export function resolveWorldStartupConfig(locationLike = globalThis.location) {
  if (!locationLike) throw new TypeError("World startup config requires a location");

  const startupParams = new URLSearchParams(locationLike.search ?? "");
  const hostname = String(locationLike.hostname ?? "");
  const previewHost = hostname.endsWith(".vercel.app") || ["localhost", "127.0.0.1"].includes(hostname);
  const roomPreviewStart = previewHost &&
    (startupParams.get("start") === "club-room" || locationLike.hash === "#club-room-preview");
  const dormLobbyPreviewStart = previewHost && startupParams.get("start") === "dorm-lobby";
  const personalRoomPreviewStart = previewHost && startupParams.get("start") === "personal-room";
  const mcmEventPreviewMode = isMcm2026PreviewRequest(locationLike);
  const mcmMinigamePreviewStart = mcmEventPreviewMode &&
    ["zombie-minigame-preview", "zombie-minigame"].includes(startupParams.get("start"));
  const lobbyPreview = !roomPreviewStart && !dormLobbyPreviewStart && !personalRoomPreviewStart &&
    !mcmMinigamePreviewStart && isLobbyShellRequested(locationLike);

  const npcTestMode = ["localhost", "127.0.0.1"].includes(hostname) &&
    startupParams.get("npcTest") === "a-r1";
  const npcAiPilotMode = npcTestMode && startupParams.get("npcAiPilot") === "1";
  const npcProductionMode = !previewHost;
  const npcPreviewMode = hostname.endsWith(".vercel.app") &&
    startupParams.get("npcTest") === "a-r1";
  const npcSharedScheduleMode = npcProductionMode || (previewHost && startupParams.get("npcSync") === "ng2");
  const npcRosterPreviewMode = previewHost && startupParams.get("campusLife") === "roster";
  const npcSocialPreviewLevel = previewHost ? startupParams.get("npcSocial") : null;
  const npcObservedConversationPreview = previewHost && startupParams.get("npcConversation") === "p0";
  const npcObservedConversationMode = npcProductionMode || npcObservedConversationPreview;
  const npcSocialBehaviorPreviewMode = npcSocialPreviewLevel === "ng15";
  const npcSocialPreviewMode = npcSocialPreviewLevel === "ng1" || npcSocialBehaviorPreviewMode;
  const npcSocialProductionMode = npcProductionMode;
  const npcSocialMode = npcSocialProductionMode || npcSocialPreviewMode || npcObservedConversationMode;
  const npcEnabled = npcSharedScheduleMode || npcTestMode || npcProductionMode || npcPreviewMode ||
    npcRosterPreviewMode || npcSocialMode;
  const campusLifePreview = previewHost && startupParams.get("campusLife") === "p0a";

  return Object.freeze({
    startupParams,
    editorWorldRequested: startupParams.get("editorWorld") === "1",
    previewHost,
    roomPreviewStart,
    dormLobbyPreviewStart,
    personalRoomPreviewStart,
    mcmEventPreviewMode,
    mcmMinigamePreviewStart,
    lobbyPreview,
    npcTestMode,
    npcAiPilotMode,
    npcProductionMode,
    npcPreviewMode,
    npcSharedScheduleMode,
    npcRosterPreviewMode,
    npcSocialPreviewLevel,
    npcObservedConversationPreview,
    npcObservedConversationMode,
    npcSocialBehaviorPreviewMode,
    npcSocialPreviewMode,
    npcSocialProductionMode,
    npcSocialMode,
    npcEnabled,
    campusLifePreview
  });
}
