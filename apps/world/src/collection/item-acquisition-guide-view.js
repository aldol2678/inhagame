// Presentation only: no purchase, navigation, account access, or HTML interpolation.
export function renderItemAcquisitionGuide({ doc, guide, onShowLocation } = {}) {
  const root = doc.createElement('div');
  root.className = 'item-acquisition-guide';
  root.dataset.availability = guide?.availability ?? 'UNKNOWN';
  const label = doc.createElement('p');
  label.className = 'item-acquisition-guide-label';
  label.textContent = `획득 방법 · ${guide?.label ?? '미확인'}`;
  const detail = doc.createElement('p');
  detail.className = 'item-acquisition-guide-detail';
  detail.textContent = guide?.detail ?? '공개된 획득 정보를 확인할 수 없어요.';
  root.append(label, detail);
  let locationButton = null;
  if (guide?.availability !== 'HIDDEN' && guide?.location?.poiId && typeof onShowLocation === 'function') {
    locationButton = doc.createElement('button');
    locationButton.type = 'button';
    locationButton.className = 'item-acquisition-guide-location';
    locationButton.textContent = '지도에서 위치 보기';
    locationButton.setAttribute('aria-label', `${guide.location.label} 지도에서 위치 보기`);
    locationButton.addEventListener('click', event => { event.stopPropagation(); onShowLocation(guide.location); });
    root.append(locationButton);
  }
  return { element: root, locationButton };
}
