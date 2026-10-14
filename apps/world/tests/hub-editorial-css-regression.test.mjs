import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = (await readFile(new URL('../hub-editorial.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = selector => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([,s]) => s.trim() === selector).map(([, , body]) => body);
const has = (body, property, value) => assert.match(body, new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*${value}\\s*(?:;|$)`));

test('editorial desktop hero explicitly establishes grid and clears inherited art offsets', () => {
  has(rules('.editorial-portal .portal-hero')[0], 'display', 'grid');
  const art = rules('.editorial-portal .portal-hero-art')[0];
  has(art, 'inset', 'auto');
  has(art, 'position', 'relative');
  has(art, 'opacity', '1');
  has(rules('.editorial-portal .portal-hero::before')[0], 'content', 'none');
});

test('mobile concept note participates in flow between artwork and copy', () => {
  const note = rules('.editorial-portal .portal-art-note').at(-1);
  has(note, 'position', 'static');
  has(note, 'inset', 'auto');
  has(note, 'order', '2');
  has(rules('.editorial-portal .portal-hero-art').at(-1), 'order', '1');
  has(rules('.editorial-portal .portal-hero-copy').at(-1), 'order', '3');
  assert.doesNotMatch(note, /top\s*:\s*207px/);
});

test('theme overrides match legacy specificity only for editorial visible home', () => {
  const home = 'body.editorial-portal:has(.portal-home:not([hidden]))';
  has(rules(home)[0], 'background', 'var\\(--paper\\)');
  has(rules(home)[0], 'color', 'var\\(--ink\\)');
  has(rules(home+' .header')[0], 'background', 'rgba\\(245,242,236,\\.98\\)');
  has(rules(home+' .footer')[0], 'color', '#5a554c');
  has(rules(home+' .footer a')[0], 'color', 'inherit');
  has(rules(home+' .main')[0], 'max-width', '1200px');
  has(rules(home+' .main').at(-1), 'padding', '14px 14px 90px');
  // No unscoped replacement of the existing dark/non-editorial home theme.
  assert.equal(rules('body:has(.portal-home:not([hidden]))').length, 0);
});
