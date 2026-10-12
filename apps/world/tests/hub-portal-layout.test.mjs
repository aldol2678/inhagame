import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const load = name => readFile(new URL(name, import.meta.url), 'utf8');

test('portal homepage retains catalog fallback, game navigation and all non-home panels', async () => {
  const [html, js, catalog] = await Promise.all([
    load('../index.html'), load('../hub.js'), load('../data/game-catalog.json')
  ]);
  assert.match(html, /class="view portal-home" data-view="home"/);
  assert.match(html, /href="\/campus\/\?lobby=1"/);
  for (const panel of ['ranking','friends','messages','account','settings']) {
    assert.ok(html.includes('data-view="' + panel + '"'), panel);
  }
  const games = JSON.parse(catalog).games.filter(g => g.id !== 'campus');
  for (const game of games) {
    assert.ok(html.includes('data-game-id="' + game.id + '"'), game.id);
    assert.ok(html.includes('href="' + game.playUrl + '"'), game.id);
    assert.ok(js.includes('portalArt'), 'catalog renderer retains concept art allowlist');
  }
  assert.ok(html.includes('id="classicEventBadge"'));
  assert.match(js, /querySelectorAll\("#game-cards \.game-card\[data-game-id\]"\)/);
  assert.match(js, /hub_card_impression/);
  assert.match(js, /hub_game_click/);
  assert.match(js, /checkedPlayUrl/);
  assert.match(js, /existing\.forEach\(\(card\)/);
});

test('all illustrative SVG files are lightweight, local and declared as concept art', async () => {
  const names = ['campus','classic','induckup','survival','induck-grow'];
  for (const name of names) {
    const suffix = name === 'campus' ? 'campus-concept.svg' : name + '-concept.svg';
    const image = await load('../assets/hub/' + suffix);
    assert.match(image, /<svg\b/);
    assert.match(image, /<\/svg>/);
    assert.doesNotMatch(image, /<script\b|(?:href|src)=["']https?:\/\/|<foreignObject/i);
  }
});
