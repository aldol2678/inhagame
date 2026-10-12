import {findMajor} from './major-registry.mjs';
// Deterministic, local-only preview transition. Not a full Life Engine, cloud save, or reward bridge.
// The state passed in is owned by the caller; this function never mutates it.
export function applySignatureChoice(majorId,choiceId,state) {
  const major=findMajor(majorId),event=major?.signatureEvent;
  if (!event) throw new Error('Signature not implemented for '+majorId);
  const choice=event.choices.find(item=>item.id===choiceId);
  if (!choice) throw new Error('Unknown signature choice');
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('Invalid life state');
  const stats=state.stats, completed=state.completedEventInstances, memories=state.memories;
  if (!stats || typeof stats !== 'object' || Array.isArray(stats) || !Array.isArray(completed) || !Array.isArray(memories)) throw new TypeError('Invalid life state shape');
  const key=event.id;
  if (completed.includes(key)) return {applied:false,state:{...state,stats:{...stats},completedEventInstances:[...completed],memories:memories.map(m=>({...m}))}};
  const previous=stats[choice.effects.competency] ?? 0;
  if (!Number.isFinite(previous) || previous<0 || previous>100) throw new RangeError('Invalid competency');
  const nextValue=Math.min(100,previous+choice.effects.delta);
  const next={...state,stats:{...stats,[choice.effects.competency]:nextValue},completedEventInstances:[...completed,key],memories:[...memories,{eventId:key,choiceId,memoryTag:choice.memoryTag,text:choice.memoryText}],flags:{...(state.flags||{}),[choice.outcomeFlag]:true}};
  return {applied:true,state:next};
}
