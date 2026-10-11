import { ALBUM_EXPORT_LIMITS, createAlbumZip, formatPhotoBytes, measureAlbum, requestAlbumDownload } from './phone-album-export.js';

export function createAlbumManager({ album, doc, win, el, btn }) {
  let controller = null, exporting = false, selecting = false, selected = new Set();
  const leave = () => { controller?.abort(); controller = null; exporting = false; };
  async function mount(content, { storage = false, openStorage }) {
    leave(); const mine = new AbortController(); controller = mine;
    const active = () => !mine.signal.aborted && controller === mine;
    const scopeGeneration = album.generation;
    const current = () => active() && scopeGeneration === album.generation;
    const section = el('section', 'smartphone-album-manager'); section.setAttribute('aria-label', storage ? '앨범 저장공간' : '사진 일괄 다운로드'); content.append(section);
    const summary = el('p', '', '사진 용량을 확인하는 중…'); section.append(summary);
    let stats;
    try { stats = await measureAlbum(album, { signal: mine.signal }); }
    catch (error) { if (current() && error.name !== 'AbortError') summary.textContent = '앨범 저장소에 접근하지 못했어요. 뒤로 돌아가 다시 시도해 주세요.'; return null; }
    if (!current()) return null;
    const byId = new Map(stats.photos.map(p => [p.id, p]));
    selected = new Set([...selected].filter(id => byId.has(id)));
    summary.textContent = `현재 계정 사진 ${stats.count}장 · 원본 ${formatPhotoBytes(stats.originalBytes)} · 썸네일 ${formatPhotoBytes(stats.thumbnailBytes)}`;
    if (stats.damaged) section.append(el('p', '', `손상되거나 누락된 사진 ${stats.damaged}장: 확인 가능한 용량만 표시해요. 원본이 손상되거나 누락된 사진은 내보낼 수 없어요.`));
    if (storage) {
      const site = el('p', '', '사이트 전체 저장공간을 확인하는 중…'); section.append(site);
      section.append(el('p', 'smartphone-hint', '위 사진 용량은 현재 계정 앨범 전용이에요. 아래 브라우저 추정치는 다른 계정·캐시 등을 포함한 사이트 전체이며, 기기의 남은 디스크 용량이 아니에요. 자동 삭제는 하지 않아요.'));
      try {
        if (!win.navigator.storage?.estimate) site.textContent = '이 브라우저는 사이트 저장공간 추정치를 제공하지 않아요.';
        else {
          const estimate = await win.navigator.storage.estimate(); if (!current()) return null;
          const valid = n => Number.isFinite(n) && n >= 0;
          site.textContent = `사이트 전체 추정 사용량 ${formatPhotoBytes(valid(estimate.usage) ? estimate.usage : null)} / 할당량 ${formatPhotoBytes(valid(estimate.quota) ? estimate.quota : null)}`;
          if (valid(estimate.usage) && valid(estimate.quota) && estimate.quota - estimate.usage < Math.max(10 * 1048576, estimate.quota * .1)) section.append(el('p', '', '브라우저 저장공간이 부족해요. 다운로드 파일을 확인한 뒤 브라우저 저장공간을 관리해 주세요.'));
        }
      } catch { if (current()) site.textContent = '브라우저 저장공간 추정치에 접근하지 못했어요. 앨범 용량은 위에서 별도로 확인할 수 있어요.'; }
      return { byId };
    }
    const controls = el('div', 'smartphone-actions'), selection = el('p'), status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    selection.setAttribute('aria-live', 'polite');
    const progress = el('progress'); progress.max = 1; progress.value = 0; progress.hidden = true; progress.setAttribute('aria-label', 'ZIP 생성 진행률');
    const buttons = [], gridButtons = new Map();
    const update = () => {
      const bytes = [...selected].reduce((n,id) => n + (byId.get(id)?.originalBytes ?? 0), 0);
      selection.textContent = `선택 ${selected.size}장 · 예상 원본 용량 ${formatPhotoBytes(bytes)} (ZIP 헤더 용량 별도)`;
      toggle.textContent = selecting ? '선택 모드 끝내기' : '사진 다중 선택'; toggle.setAttribute('aria-pressed', String(selecting)); toggle.setAttribute('aria-label', toggle.textContent);
      clear.disabled = exporting || !selected.size;
      for (const [id, button] of gridButtons) { if (selecting) button.setAttribute('aria-pressed', String(selected.has(id))); else button.removeAttribute('aria-pressed'); button.dataset.selecting = String(selecting); button.setAttribute('aria-label', `${button.dataset.photoLabel} 사진 ${selecting ? '선택' : '열기'}`); }
      for (const [button, mode] of buttons) button.disabled = exporting || !(mode === 'selected' ? selected.size : mode === 'favorites' ? stats.photos.some(p => p.favorite) : stats.count);
    };
    const toggle = btn('사진 다중 선택', () => { selecting = !selecting; update(); });
    const clear = btn('선택 전체 해제', () => { selected.clear(); update(); });
    const cancel = btn('다운로드 취소', () => { job?.abort(); }); cancel.hidden = true;
    let job = null;
    const exportPhotos = async mode => {
      if (exporting || !current()) return;
      exporting = true; job = new AbortController();
      const cancelJob = () => job?.abort(); mine.signal.addEventListener('abort', cancelJob, { once: true });
      update(); toggle.disabled = true; cancel.hidden = false; progress.hidden = false; progress.value = 0; status.textContent = '원본 사진을 확인하고 ZIP을 만드는 중…'; cancel.focus({ preventScroll: true });
      try {
        const blob = await createAlbumZip({ album, mode, selected: [...selected], signal: job.signal, onProgress: p => {
          if (!current()) return;
          progress.value = p.totalBytes ? p.processedBytes / p.totalBytes : 0;
          status.textContent = `ZIP 생성 ${p.completed}/${p.count}장 · ${formatPhotoBytes(p.processedBytes)} / ${formatPhotoBytes(p.totalBytes)}`;
        } });
        if (!current() || job.signal.aborted) return;
        requestAlbumDownload(blob, { doc, win });
        status.textContent = 'ZIP 생성 완료 · 다운로드를 요청했어요. 브라우저 다운로드 목록에서 저장 완료 여부를 확인해 주세요.';
      } catch (error) {
        if (!current()) return;
        status.textContent = error.name === 'AbortError' ? '다운로드를 취소했어요. 원본 사진은 그대로 보관돼요.' : error.code === 'LIMIT' ? `한 번에 최대 ${ALBUM_EXPORT_LIMITS.photos}장·원본 32 MiB까지 가능해요. 사진을 나누어 선택해 주세요.` : error.code === 'EMPTY' ? '다운로드할 사진이 없어요.' : error.code === 'DAMAGED_PHOTO' ? '원본 사진이 없거나 손상되었거나 지원 범위(PNG/JPEG·16메가픽셀)를 벗어나 ZIP을 만들지 못했어요.' : '사진 읽기 또는 다운로드에 실패했어요. 저장소 접근 권한과 브라우저 다운로드 설정을 확인해 주세요.';
      } finally {
        mine.signal.removeEventListener('abort', cancelJob);
        if (current()) { exporting = false; job = null; toggle.disabled = false; const returnFocus = doc.activeElement === cancel; cancel.hidden = true; progress.hidden = true; update(); if (returnFocus) buttons.find(([,kind]) => kind === mode)?.[0].focus({ preventScroll: true }); }
      }
    };
    controls.append(btn('저장공간 관리', openStorage), toggle, clear);
    for (const [mode, label] of [['all','전체 사진 ZIP'],['favorites','즐겨찾기 ZIP'],['selected','선택 사진 ZIP']]) { const button = btn(label, () => void exportPhotos(mode)); buttons.push([button,mode]); controls.append(button); }
    section.append(controls, selection, el('p', 'smartphone-hint', '한 번에 최대 100장·원본 32 MiB, 사진당 16메가픽셀까지. 원본 화질을 유지하며 위치·계정 등 메타데이터는 포함하지 않아요. 화면을 나가거나 계정이 바뀌면 취소돼요.'), progress, cancel, status);
    update();
    return { byId, bind(id, button) { button.dataset.photoLabel = button.getAttribute('aria-label').replace(/ 사진 열기$/, ''); gridButtons.set(id, button); update(); }, pick(id) {
      if (!selecting) return false;
      if (!exporting) { selected.has(id) ? selected.delete(id) : selected.add(id); update(); }
      return true;
    } };
  }
  return { mount, leave, reset() { leave(); selected.clear(); selecting = false; } };
}
