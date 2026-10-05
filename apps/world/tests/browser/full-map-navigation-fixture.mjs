// Isolated browser acceptance for the real DOM/CSS/controllers and campus POIs.
// No game engine, player movement, accounts, network state or live services.
import { createFullMapController } from "../../src/minimap/full-map-controller.js";
import { createMiniMapDataSource } from "../../src/minimap/minimap-data.js";
import { createMiniMapController } from "../../src/minimap/minimap-controller.js";
import { createMiniMapRenderer } from "../../src/minimap/minimap-renderer.js";

try {
  const response = await fetch(new URL("../../campus/index.html", import.meta.url));
  if (!response.ok) throw new Error(`Map markup: ${response.status}`);
  const markup = new DOMParser().parseFromString(await response.text(), "text/html");
  for (const id of ["minimap", "full-map-panel"]) document.body.appendChild(document.importNode(markup.getElementById(id), true));
  const byId = id => document.getElementById(id);
  const campusSource = createMiniMapDataSource({ isPlaceDiscovered: () => false });
  const stateFixtures = new Map();
  const dataSource = { ...campusSource, poiRegistry: () => ({
    list(options) { return campusSource.poiRegistry().list(options).map(poi => ({ ...poi, ...stateFixtures.get(poi.poiId) })); }
  }) };
  const player = { getLocalPosition: () => ({ x: 0, z: -100 }) };
  let fullMap;
  const minimap = createMiniMapController({
    player, orbit: { yaw: 0 }, dataSource,
    getOverlayState: () => ({ fullMap: fullMap?.openState === true }),
    renderer: createMiniMapRenderer({ root: byId("minimap"), geometryLayer: byId("minimap-geometry"),
      poiLayer: byId("minimap-pois"), objectiveLayer: byId("minimap-objective"), socialLayer: byId("minimap-social"),
      playerLayer: byId("minimap-player"), compassLayer: byId("minimap-compass") })
  });
  const ids = {
    root: "panel", closeButton: "close", searchRoot: "search", surface: "surface", svg: "svg",
    markerLayer: "marker-layer", geometryLayer: "geometry", poiLayer: "pois", playerMarker: "player",
    objectiveMarker: "objective", destinationMarker: "destination", socialLayer: "social", titleElement: "title",
    infoPanel: "info", infoTitle: "info-title", infoMeta: "info-meta", destinationButton: "set-destination",
    clearDestinationButton: "clear-destination", autoMoveButton: "auto-move", zoomInButton: "zoom-in",
    zoomOutButton: "zoom-out", locateButton: "locate", resetViewButton: "reset-view", zoomLabel: "zoom-label"
  };
  fullMap = createFullMapController({
    ...Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, byId(`full-map-${id}`)])),
    openButton: byId("minimap-open-map"), dataSource, getPlayerPosition: player.getLocalPosition,
    onOpen: () => minimap.update({ force: true }),
    // Matches production: make the suspended opener visible before return-focus validation.
    onClose: () => minimap.update({ force: true })
  });
  minimap.update({ force: true });
  window.__FULL_MAP_NAVIGATION_QA__ = { ready: true, fullMap, minimap,
    // Explicit presentation fixtures, never mutations of a game/account authority.
    setStateFixture(id, value) { if (value) stateFixtures.set(id, value); else stateFixtures.delete(id); fullMap.refreshPois(); },
    snapshot: () => ({ map: fullMap.status(), player: player.getLocalPosition(),
      activeId: document.activeElement?.id, miniHidden: byId("minimap").hidden }) };
} catch (error) {
  window.__FULL_MAP_NAVIGATION_QA__ = { ready: false, error: String(error?.stack ?? error) };
  throw error;
}
