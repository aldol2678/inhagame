import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createChatPanel } from '../src/online/chat-panel.js';
import { createFakeDocument } from './support/fake-dom.mjs';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

// A deliberately bounded static cascade check, not a browser/layout emulator. It reads
// actual declarations and media ancestry, then compares importance, specificity and
// source order for the simple body/class/attribute selectors used by the chat rules.
function parseRules(source, media = [], rules = []) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '');
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    const selector = source.slice(cursor, open).trim();
    let end = open + 1, depth = 1;
    while (depth && end < source.length) {
      if (source[end] === '{') depth++;
      if (source[end] === '}') depth--;
      end++;
    }
    assert.equal(depth, 0, `balanced rule: ${selector}`);
    const body = source.slice(open + 1, end - 1);
    if (selector.startsWith('@media ')) parseRules(body, [...media, selector.slice(7)], rules);
    else if (!selector.startsWith('@')) {
      const declarations = body.split(';').flatMap(entry => {
        const colon = entry.indexOf(':');
        if (colon < 0) return [];
        const value = entry.slice(colon + 1).trim();
        return [{ property: entry.slice(0, colon).trim(),
          value: value.replace(/\s*!important$/, ''), important: /!important$/.test(value) }];
      });
      rules.push({ selectors: selector.split(',').map(value => value.trim()), declarations, media });
    }
    cursor = end;
  }
  return rules;
}

function mediaMatches(query, viewport) {
  return query.split(',').some(branch => branch.split(/\s+and\s+/).every(part => {
    const feature = part.trim().match(/^\((pointer|orientation|min-width|max-width|min-height|max-height):\s*([\w.-]+)\)$/);
    assert.ok(feature, `unsupported chat media feature: ${part}`);
    const [, name, value] = feature;
    if (name === 'pointer') return viewport.pointer === value;
    if (name === 'orientation') return (viewport.width > viewport.height ? 'landscape' : 'portrait') === value;
    const [, bound, dimension] = name.match(/^(min|max)-(width|height)$/);
    return bound === 'min' ? viewport[dimension] >= parseFloat(value) : viewport[dimension] <= parseFloat(value);
  }));
}

function matches(selector, node, hand) {
  if (selector === 'body' || selector === 'body.joystick-right') {
    return node.tagName === 'BODY' && (selector === 'body' || hand === 'right');
  }
  const match = selector.match(/^(?:body(?:\.joystick-right)?\s+)?\.(chat-feed|chat-form|chat-hint)((?:\[[^\]]+\])*)$/);
  if (!match || !node.className.split(/\s+/).includes(match[1])) return false;
  if (selector.startsWith('body.joystick-right') && hand !== 'right') return false;
  return [...match[2].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, attr, value]) => {
    if (attr === 'hidden') return node.hidden;
    return value === undefined ? node.getAttribute(attr) !== null : node.getAttribute(attr) === value;
  });
}

function specificity(selector) {
  const attributes = selector.match(/\[[^\]]+\]/g) ?? [];
  const plain = selector.replace(/\[[^\]]+\]/g, '');
  return [(plain.match(/#/g) ?? []).length,
    (plain.match(/\./g) ?? []).length + attributes.length,
    (plain.match(/(?:^|\s)[a-z][\w-]*/g) ?? []).length];
}

function winner(rules, node, property, viewport, hand = 'left') {
  let best;
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (!matches(selector, node, hand) || !rule.media.every(query => mediaMatches(query, viewport))) continue;
      for (const declaration of rule.declarations) {
        if (declaration.property !== property) continue;
        const rank = [Number(declaration.important), ...specificity(selector)];
        const comparison = best ? rank.map((value, index) => value - best.rank[index]).find(value => value !== 0) ?? 0 : 1;
        if (comparison >= 0) best = { ...declaration, selector, media: rule.media, rank };
      }
    }
  }
  return best;
}

const rules = parseRules(css);
const landscape = { pointer: 'coarse', width: 844, height: 390 };
const portrait = { pointer: 'coarse', width: 390, height: 844 };
const desktop = { pointer: 'fine', width: 1280, height: 800 };

function fixture() {
  const doc = createFakeDocument();
  const body = doc.createElement('body');
  const toggle = doc.createElement('button'), input = doc.createElement('input');
  const form = doc.createElement('form'), feedList = doc.createElement('ol'), hint = doc.createElement('p');
  form.className = 'chat-form'; feedList.className = 'chat-feed'; hint.className = 'chat-hint';
  form.append(input); body.append(toggle, form, feedList, hint);
  const panel = createChatPanel({ toggle, input, form, feedList, hint, doc,
    getChat: () => ({ signedIn: true }), win: { setTimeout() {}, clearTimeout() {} } });
  panel.renderFeed(Array.from({ length: 15 }, (_, i) => ({ name: 'duck', text: `message ${i}` })));
  return { panel, body, feedList, form, hint, input };
}

// Evaluate only the length functions used by chat positioning. Unsupported syntax
// fails rather than silently pretending to be a full CSS engine.
function pixels(expression, { viewport, safe = 0, keyboard = 0, variables = {} }) {
  const context = { viewport, safe, keyboard, variables };
  let value = expression.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name, fallback) => {
    if (name === '--keyboard-inset') return keyboard;
    assert.ok(variables[name] !== undefined || fallback !== undefined, `missing ${name}`);
    return pixels(variables[name] ?? fallback, context);
  }).replace(/env\(safe-area-inset-bottom\)/g, String(safe)).replace(/(-?[\d.]+)(px|vw|dvh|vh)/g,
    (_, number, unit) => Number(number) * (unit === 'px' ? 1 : unit === 'vw' ? viewport.width / 100 : viewport.height / 100));
  const sum = text => {
    assert.match(text, /^\s*-?[\d.]+(?:\s*[+-]\s*[\d.]+)*\s*$/, `unsupported length: ${text}`);
    return (text.replace(/\s/g, '').match(/[+-]?[\d.]+/g) ?? []).reduce((total, token) => total + Number(token), 0);
  };
  while (/[a-z]+\(/.test(value)) {
    const previous = value;
    value = value.replace(/(calc|max|min)\(([^()]*)\)/g, (_, fn, args) => {
      const numbers = args.split(',').map(sum);
      return fn === 'max' ? Math.max(...numbers) : fn === 'min' ? Math.min(...numbers) : numbers[0];
    });
    assert.notEqual(value, previous, `unsupported length function: ${value}`);
  }
  return sum(value);
}

function bottom(node, viewport, { safe = 0, keyboard = 0, hand = 'left' } = {}) {
  const body = { tagName: 'BODY', className: '' };
  const lane = winner(rules, body, '--ls-lane-bottom', viewport, hand)?.value;
  return pixels(winner(rules, node, 'bottom', viewport, hand).value,
    { viewport, safe, keyboard, variables: { '--ls-lane-bottom': lane } });
}

test('cascade helper uses specificity before source order, then importance, with media gating', () => {
  const { feedList, panel } = fixture();
  panel.setOpen(true, { focus: false });
  const conflict = '.chat-feed[data-mode="EXPANDED"] { bottom: 290px; } body .chat-feed { bottom: 60px; }';
  assert.equal(winner(parseRules(conflict), feedList, 'bottom', landscape).value, '290px');
  assert.equal(winner(parseRules(`${conflict} .chat-feed[data-mode="EXPANDED"] { bottom: 61px; }`), feedList, 'bottom', landscape).value, '61px');
  assert.equal(winner(parseRules(`${conflict} .chat-feed { bottom: 62px !important; }`), feedList, 'bottom', landscape).value, '62px');
  assert.equal(mediaMatches('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)', portrait), false);
  assert.deepEqual(specificity('.chat-feed[data-mode="EXPANDED"]'), [0, 2, 0]);
  assert.deepEqual(specificity('body .chat-feed'), [0, 1, 1]);
});

for (const viewport of [landscape, { ...landscape, width: 740, height: 360 }, { ...landscape, width: 932, height: 430 }]) {
  test(`expanded chat stays in the 60px landscape lane at ${viewport.width}x${viewport.height}`, () => {
    const { panel, feedList, form, hint } = fixture();
    panel.setOpen(true, { focus: false });
    assert.equal(feedList.getAttribute('data-mode'), 'EXPANDED');
    assert.equal(panel.renderedCount, 12);
    assert.equal(bottom(feedList, viewport), 60, 'expanded feed must not inherit the 290px portrait offset');
    assert.equal(bottom(form, viewport), 10);
    assert.equal(bottom(hint, viewport), 60);
    assert.equal(winner(rules, feedList, 'max-height', viewport).value, '76px');
    assert.equal(winner(rules, feedList, 'bottom', viewport).important, false, 'no !important escalation');
  });
}

test('preview, expanded, close and reopen keep the same landscape lane for either joystick hand', () => {
  const { panel, feedList, form, input } = fixture();
  for (const hand of ['left', 'right']) for (const open of [false, true, false, true, false]) {
    panel.setOpen(open);
    assert.equal(feedList.getAttribute('data-mode'), open ? 'EXPANDED' : 'PREVIEW');
    assert.equal(form.hidden, !open);
    assert.equal(input.doc.activeElement === input, open);
    assert.equal(bottom(feedList, landscape, { hand }), 60);
    assert.equal(winner(rules, feedList, 'left', landscape, hand).value, 'var(--ls-lane-left)');
    assert.equal(winner(rules, feedList, 'width', landscape, hand).value,
      'min(340px, calc(100vw - var(--ls-lane-left) - var(--ls-lane-end)))');
  }
});

test('keyboard and safe-area offsets stay additive for preview and expanded feed/form/hint', () => {
  const { panel, feedList, form, hint } = fixture();
  for (const open of [false, true]) for (const safe of [0, 34, 60]) for (const keyboard of [0, 180]) {
    panel.setOpen(open, { focus: false });
    const options = { safe, keyboard };
    const lane = Math.max(10, safe) + keyboard;
    assert.equal(bottom(form, landscape, options), lane);
    assert.equal(bottom(feedList, landscape, options), lane + 50);
    assert.equal(bottom(hint, landscape, options), lane + 50);
  }
});

test('rotation and media boundaries restore portrait and desktop expanded/preview offsets', () => {
  const { panel, feedList, form } = fixture();
  for (const open of [false, true]) {
    panel.setOpen(open, { focus: false });
    for (const viewport of [portrait, landscape, portrait]) {
      assert.equal(bottom(feedList, viewport), viewport === landscape ? 60 : open ? 290 : 228);
    }
    assert.equal(bottom(feedList, { ...landscape, height: 500 }), 60, 'inclusive max-height');
    assert.equal(bottom(feedList, { ...landscape, height: 501 }), open ? 290 : 228, 'tall coarse landscape stays unchanged');
    assert.equal(bottom(feedList, desktop), open ? 142 : 68);
    assert.equal(bottom(feedList, { ...landscape, pointer: 'fine' }), open ? 142 : 68, 'short fine-pointer desktop stays unchanged');
    assert.equal(bottom(form, portrait), 218);
    assert.equal(bottom(form, desktop), 68);
  }
});

test('empty feed and closed composer retain hidden authority in landscape', () => {
  const { panel, feedList, form } = fixture();
  panel.renderFeed([]);
  for (const open of [false, true, false]) {
    panel.setOpen(open, { focus: false });
    assert.equal(feedList.hidden, true);
    assert.equal(winner(rules, feedList, 'display', landscape).value, 'none');
    assert.equal(winner(rules, feedList, 'display', landscape).important, true);
    if (!open) assert.equal(winner(rules, form, 'display', landscape).value, 'none');
  }
});
