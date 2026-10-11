import { createIncomeSceneInteraction } from './income-scene-interaction.mjs';
import { createIncomeScenePanelAdapter } from './income-scene-panel-adapter.mjs';
import { INCOME_CONVENIENCE_LOCATION } from './income-convenience-location.mjs';

// Host bridge only. No global auth lookup, map teleport, Quest write, NPC role mutation or automatic activation.
export function createIncomeSceneCandidate({ enabled = false, location = globalThis.location,
  readScene, getAuthorization, contextActions, acquireInput, labelElement, ...panelOptions }) {
  if (!enabled || !['localhost','127.0.0.1'].includes(location?.hostname) ||
      typeof acquireInput !== 'function' || !contextActions || !labelElement) throw new Error('INCOME_SCENE_HOST_REQUIRED');
  const panel = createIncomeScenePanelAdapter({ ...panelOptions, enabled, location, getAuthorization, acquireInput });
  const scene = createIncomeSceneInteraction({ enabled, location, readScene, panel, onLabel(view) {
    labelElement.hidden = !view.visible; labelElement.textContent = view.visible ? view.text : '';
  } });
  return { panel, convenienceLocation: INCOME_CONVENIENCE_LOCATION,
    update() { const action = scene.observe(); contextActions.set('income-taerin-candidate', action); return action; },
    dispose() { contextActions.set('income-taerin-candidate', null); scene.dispose(); }
  };
}
