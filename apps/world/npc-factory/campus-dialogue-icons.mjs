// Original 24 px line icons for the Inha World dialogue menu.
const shapes = Object.freeze({
  status: 'M4 8h16v10H9l-5 3V8Z M8 13h8 M8 10.5h5',
  topic: 'M12 3l2.6 5.4 6 .8-4.3 4.3 1 6-5.3-2.8-5.3 2.8 1-6-4.3-4.3 6-.8L12 3Z',
  memory: 'M4 7c3-1 6-.6 8 1.5C14 6.4 17 6 20 7v12c-3-1-6-.6-8 1.5C10 18.4 7 18 4 19V7Z M12 8.5v12',
  quest: 'M8 4h8v2h4v14H4V6h4V4Z M8 6v2h8V6 M8 13l2 2 5-5',
  follow: 'M4 5h16v12h-7l-4 3v-3H4V5Z M12 8v6 M9 11h6',
  meet: 'M4 18c0-4 6-4 6 0 M14 18c0-4 6-4 6 0 M9 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z M19 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  back: 'M9 7l-5 5 5 5 M4 12h12a4 4 0 0 0 0-8',
  exit: 'M11 4H5v16h6 M9 12h12m-4-4 4 4-4 4',
});
export function dialogueIconFor(label, className = '') {
  if (/대화 (마치기|끝내기)/.test(label)) return 'exit';
  if (label.includes('처음으로')) return 'back';
  if (/quest|side-event/.test(className)) return 'quest';
  if (label==='지난번 이야기') return 'memory';
  if (label==='근황 묻기') return 'status';
  if (label.includes('조금 더')) return 'follow';
  if (label.includes('함께 할')) return 'meet';
  return 'topic';
}
export function createDialogueIcon(doc, name) {
  const ns='http://www.w3.org/2000/svg';
  const svg=doc.createElementNS(ns,'svg'), path=doc.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('class','campus-dialogue-icon');
  svg.setAttribute('aria-hidden','true');
  svg.setAttribute('focusable','false');
  svg.setAttribute('data-icon',name);
  path.setAttribute('d',shapes[name]??shapes.topic);
  svg.append(path);
  return svg;
}
