// Current gameplay envelopes remain fixed; facade/roof forms use the dedicated
// rear-gate infill helper without changing existing shop dressing or collision.
import { BACK_ALLEY_BLOCKS } from './back-alley-layout.js';
import { fillInfillBase, fillInfillNear, fillInfillDetail } from './backgate-infill-geometry.js';

export function fillBackAlleyBase(batch) {
  for(const q of BACK_ALLEY_BLOCKS)fillInfillBase(batch,q,'alley');
  return batch;
}
export function fillBackAlleyNear(batch,ids=[]) {
  for(const q of BACK_ALLEY_BLOCKS.filter(q=>ids.includes(q.id)))fillInfillNear(batch,q,'alley');
  return batch;
}
export function fillBackAlleyDetail(batch,ids=[]) {
  for(const q of BACK_ALLEY_BLOCKS.filter(q=>ids.includes(q.id)))fillInfillDetail(batch,q,'alley');
  return batch;
}
