import {MAJOR_CATALOG, MAJOR_FAMILIES, FOUNDATION_MAJOR_IDS, LEGACY_MAJOR_IDS} from './major-registry.mjs';
const OWN = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const VALID_COMPETENCIES = new Set(['analysis','creative','expression','collaboration','execution','recovery']);
const VALID_TAGS = new Set(['location.exhibition','location.lake','location.shop','location.campus','location.club','location.library','location.cafeteria','location.festival']);
const ID = /^[a-z][a-z0-9]*$/;

// Static catalog data validation. Never reads/writes user saves or INHA WORLD state.
export function validateMajorRegistry(catalog = MAJOR_CATALOG) {
  const issues = [], counts = new Map([[1,0],[2,0],[3,0]]), seen = new Set();
  if (!Array.isArray(catalog)) return {ok:false,issues:['Catalog must be an array']};
  if (catalog.length !== 36) issues.push('Expected 36 majors, got '+catalog.length);
  for (const [i,major] of catalog.entries()) {
    const context = 'major['+i+']';
    if (!major || typeof major !== 'object' || Array.isArray(major)) { issues.push(context+': invalid object'); continue; }
    const id = major.id;
    if (typeof id !== 'string' || !ID.test(id)) issues.push(context+': invalid stable id');
    if (seen.has(id)) issues.push(context+': duplicate id '+id);
    seen.add(id);
    if (typeof major.displayName !== 'string' || !major.displayName.trim()) issues.push(id+': missing display name');
    if (!MAJOR_FAMILIES.includes(major.family)) issues.push(id+': invalid family');
    if (!counts.has(major.wave)) issues.push(id+': invalid wave'); else counts.set(major.wave,counts.get(major.wave)+1);
    if (major.catalogYear !== 2026 || major.sourceStatus !== 'provisional') issues.push(id+': missing provisional source metadata');
    if (major.calendarTemplate !== (id === 'premed' ? 'six_year_professional':'four_year_8_terms')) issues.push(id+': calendar mismatch');
    if (!Array.isArray(major.coursePool) || new Set(major.coursePool).size !== major.coursePool.length || major.coursePool.some(k => typeof k !== 'string' || !k.startsWith('grow2.course.'+id+'.'))) issues.push(id+': invalid course IDs');
    if (major.majorAction?.id !== 'grow2.action.'+id || typeof major.majorAction?.label !== 'string') issues.push(id+': invalid major action');
    if (major.assessmentProfileId !== 'grow2.assessment.'+major.family) issues.push(id+': unknown assessment profile');
    if (!Array.isArray(major.careerTrackIds) || major.careerTrackIds.length !== 1 || major.careerTrackIds[0] !== 'grow2.career.'+id+'.general') issues.push(id+': invalid career namespace');
    if (!Array.isArray(major.worldMemoryTagIds) || major.worldMemoryTagIds.some(tag=>!VALID_TAGS.has(tag))) issues.push(id+': invalid non-economic world tag');
    const first = FOUNDATION_MAJOR_IDS.includes(id);
    if (major.playability !== (first ? 'foundation' : 'planned')) issues.push(id+': invalid playability');
    if (first) {
      if (major.coursePool?.length !== 2) issues.push(id+': foundation requires two conceptual course IDs');
      const event = major.signatureEvent;
      if (!event || event.id !== 'grow2.event.'+id+'.signature' || event.year !== 1 || event.term !== 1 || !event.guaranteed || event.weekWindow?.[0] !== 4 || event.weekWindow?.[1] !== 12) issues.push(id+': invalid signature event');
      if (major.eventPackIds?.length !== 1 || major.eventPackIds[0] !== event?.id) issues.push(id+': unresolved event pack');
      if (!Array.isArray(event?.choices) || event.choices.length !== 3) issues.push(id+': expected three choices');
      else {
        const choiceIds = new Set(), flags = new Set();
        for (const choice of event.choices) {
          if (typeof choice.id !== 'string' || !choice.id.startsWith('grow2.choice.'+id+'.') || choiceIds.has(choice.id)) issues.push(id+': duplicate/invalid choice ID');
          choiceIds.add(choice.id);
          if (typeof choice.label !== 'string' || !choice.label.trim()) issues.push(id+': empty choice');
          if (!VALID_COMPETENCIES.has(choice.effects?.competency) || !Number.isInteger(choice.effects?.delta) || choice.effects.delta <= 0 || choice.effects.delta > 10) issues.push(id+': invalid choice effect');
          if (typeof choice.outcomeFlag !== 'string' || !choice.outcomeFlag.startsWith('grow2.outcome.'+id+'.') || flags.has(choice.outcomeFlag)) issues.push(id+': duplicate/invalid outcome');
          flags.add(choice.outcomeFlag);
          if (typeof choice.memoryTag !== 'string' || !choice.memoryTag.startsWith('grow2.memory.'+id+'.') || typeof choice.memoryText !== 'string' || !choice.memoryText.trim()) issues.push(id+': invalid memory');
        }
        if (new Set(event.choices.map(choice=>choice.effects.competency)).size < 2) issues.push(id+': choices are not meaningfully differentiated');
      }
    } else {
      if (major.signatureEvent !== null || major.eventPackIds?.length !== 0 || major.coursePool?.length !== 0) issues.push(id+': planned major cannot claim playable content');
    }
  }
  for (const [wave,count] of counts) if (count !== 12) issues.push('Wave '+wave+' expected 12, got '+count);
  for (const id of LEGACY_MAJOR_IDS) if (!seen.has(id)) issues.push('Lost legacy ID: '+id);
  for (const id of FOUNDATION_MAJOR_IDS) if (!seen.has(id)) issues.push('Missing foundation major: '+id);
  return {ok:issues.length===0,issues};
}
export function assertValidMajorRegistry(catalog=MAJOR_CATALOG) {
  const result=validateMajorRegistry(catalog);
  if (!result.ok) throw new Error('Major registry validation failed: '+result.issues.join('; '));
  return true;
}
