import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = name => readFile(new URL('../' + name + '.html', import.meta.url), 'utf8');

test('privacy publishes the policy itself, with original effective date and current revision', async () => {
  const html = await page('privacy');
  for (const heading of ['1. 처리 목적 및 항목', '2. 보유 기간과 삭제', '3. 외부 제공과 처리 위탁', '4. 자동 수집 및 브라우저 저장', '5. 권리 행사와 삭제 요청', '6. 안전성 확보 및 파기', '7. 개인정보 문의처', '8. 변경 안내']) {
    assert.ok(html.includes('<h2>' + heading + '</h2>'), heading);
  }
  assert.match(html, /시행일: 2026년 9월 25일/);
  assert.match(html, /최근 개정: 2026년 10월 15일/);
  assert.match(html, /최지석/);
  assert.match(html, /mailto:aldol@inha.edu/);
  assert.match(html, /친구 기능/);
  assert.match(html, /쪽지 및 신고/);
  assert.match(html, /캠퍼스 방명록/);
  assert.match(html, /대화방 보관은 메시지 본문 삭제가 아닙니다/);
  assert.doesNotMatch(html, /최근 7일|최근 1일/);
  assert.equal((html.match(/<header>/g) || []).length, (html.match(/<\/header>/g) || []).length);
  assert.equal((html.match(/<table>/g) || []).length, (html.match(/<\/table>/g) || []).length);
  assert.match(html, /\.table-wrap\{overflow-x:auto/);
});

test('public help pages contain no internal drafting or deployment checklist copy', async () => {
  for (const name of ['privacy', 'support', 'updates']) {
    const html = await page(name);
    assert.doesNotMatch(html, /통합 전 점검|새로 작성하는 동안|별도 검증·개정|검토안|정식 배포 확인을 기다|개발 브랜치·PR|가상의 업데이트 날짜|기존 정책 문서 확인/);
    for (const path of ['/terms.html', '/privacy.html', '/support.html', '/updates.html']) assert.ok(html.includes('href="' + path + '"'));
  }
  const updates = await page('updates');
  assert.match(updates, /등록된 업데이트 소식이 없습니다/);
  assert.doesNotMatch(updates, /2026년 \d+월 \d+일/);
});
