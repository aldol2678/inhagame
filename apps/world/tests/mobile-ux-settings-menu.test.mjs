import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createViewDistanceSettings } from '../src/view-distance-settings.js';

const html = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../phone.css', import.meta.url), 'utf8');
const hudCss = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const hudSource = readFileSync(new URL('../src/campus-hud.js', import.meta.url), 'utf8');

test('all existing menu actions and settings persistence IDs remain unique', () => {
  const ids = ['hud-menu','open-profile','open-quest-journal','open-inventory',
    'open-mobility-book','open-wardrobe','open-shop','open-life-skills','open-friends',
    'open-daily-quiz','open-attendance','toggle-first-person','open-keyboard-help',
    'open-settings','view-settings','graphics-quality','graphics-frame-limit',
    'graphics-render-scale','graphics-shadows','graphics-show-fps','graphics-reset',
    'view-distance','mouse-sensitivity','invert-mouse-y','audio-volume',
    'open-runtime-diagnostics','view-settings-status'];
  for (const id of ids) assert.equal(html.split('id="'+id+'"').length-1, 1, id);
});
test('mobile HUD drawer and embedded Phone settings have independent bounded scrolling', () => {
  assert.match(html, /class="hud-menu-grid"/);
  assert.match(html, /class="hud-menu-tools"/);
  assert.match(html, /id="open-phone-menu"/);
  assert.match(hudCss, /\.identity-actions\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:\s*auto/s);
  assert.match(hudCss, /\.identity-actions\s*\{[^}]*touch-action:\s*pan-y/s);
  assert.match(css, /\.smartphone-content\s*\{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y/s);
  assert.match(css, /\.smartphone \.view-settings\[data-phone-hosted="true"\]\s*\{[^}]*overflow:\s*visible;[^}]*overscroll-behavior:\s*auto/s);
  assert.match(hudSource, /open-phone-menu/);
});
test('settings category buttons map to unique pages with actual existing controls', () => {
  for (const [section, id] of [['graphics','graphics-quality'],['audio','audio-volume'],
    ['controls','mouse-sensitivity'],['diagnostics','open-runtime-diagnostics']]) {
    assert.match(html, new RegExp('data-settings-target="'+section+'"'));
    const page = html.split('id="settings-page-'+section+'"')[1]?.split('</div>')[0] ?? '';
    assert.ok(page.includes('id="'+id+'"'), section);
  }
});

class Node extends EventTarget {
  constructor(id='', dataset={}) { super(); this.id=id; this.dataset=dataset; this.hidden=true;
    this.value='auto'; this.checked=false; this.textContent=''; this.scrollTop=0; }
  setAttribute() {}
  focus() {}
  closest() { return null; }
  querySelector() { return null; }
}
test('category navigation resets scroll without resetting graphics preferences', () => {
  const ids=['open-settings','view-settings','close-settings','view-distance','graphics-quality',
    'graphics-quality-hint','view-settings-status','graphics-frame-limit','graphics-render-scale',
    'graphics-shadows','graphics-show-fps','graphics-reset','settings-category-home',
    'settings-section-back','view-settings-title'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Node(id)]));
  const pages=['graphics','audio','controls','diagnostics'].map(k=>new Node('settings-page-'+k,{settingsPage:k}));
  const categories=pages.map(p=>new Node('link-'+p.dataset.settingsPage,{settingsTarget:p.dataset.settingsPage}));
  const outer={scrollTop:123};
  const panel=nodes['view-settings'];
  panel.querySelectorAll=selector=>selector==='[data-settings-page]'?pages:
    selector==='[data-settings-target]'?categories:[];
  panel.closest=selector=>selector==='.smartphone-content'?outer:null;
  const doc=new EventTarget();doc.getElementById=id=>nodes[id]??null;doc.body={dataset:{}};
  const oldDoc=globalThis.document,oldWindow=globalThis.window;
  globalThis.document=doc;globalThis.window={localStorage:undefined};
  const graphics={preference:'auto',tier:'medium',visualPolicy:p=>p,
    status:()=>({frameLimit:'auto',renderScale:'auto',shadows:'auto',showFps:false})};
  try {
    const settings=createViewDistanceSettings({setPolicy(){}},{camera:{}},graphics);
    settings.setOpen(true);assert.equal(nodes['settings-category-home'].hidden,false);
    outer.scrollTop=210; categories[0].dispatchEvent(new Event('click'));
    assert.equal(outer.scrollTop,0);
    assert.equal(nodes['settings-category-home'].hidden,true);
    assert.equal(pages[0].hidden,false);assert.equal(pages[1].hidden,true);
    assert.equal(nodes['settings-section-back'].hidden,false);
    assert.equal(nodes['view-settings-title'].textContent,'화면 및 그래픽');
    assert.equal(graphics.preference,'auto');
    outer.scrollTop=170;nodes['settings-section-back'].dispatchEvent(new Event('click'));
    assert.equal(outer.scrollTop,0);assert.equal(pages[0].hidden,true);
    assert.equal(nodes['settings-category-home'].hidden,false);
    assert.equal(nodes['settings-section-back'].hidden,true);
    settings.setOpen(false,{focus:false});settings.destroy();
  } finally {globalThis.document=oldDoc;globalThis.window=oldWindow;}
});


test('browser smokes reach settings controls through visible category navigation', () => {
  const readSmoke = name => readFileSync(new URL(`./browser/${name}.mjs`, import.meta.url), 'utf8');
  const navigation = readSmoke('settings-navigation');
  for (const selector of ['#view-settings', '#settings-category-home', '#settings-page-', 'data-settings-target', '#settings-section-back']) {
    assert.ok(navigation.includes(selector), selector);
  }
  assert.match(navigation, /await button\.tap\(\)/);
  assert.match(navigation, /await button\.click\(\)/);
  assert.doesNotMatch(navigation, /force:|evaluate\(/, 'navigation uses trusted visible UI actions');
  for (const [name, category] of [['graphics-smoke', 'graphics'], ['graphics-parallel-smoke', 'graphics'], ['runtime-diagnostics-smoke', 'diagnostics'], ['boot-smoke', 'graphics']]) {
    const smoke = readSmoke(name);
    assert.match(smoke, /import \{ openSettingsCategory \} from '.\/settings-navigation\.mjs'/);
    assert.ok(smoke.includes(`openSettingsCategory(page, '${category}'`), name);
  }
  assert.ok(readSmoke('graphics-smoke').includes("openSettingsCategory(mobile, 'graphics')"), 'mobile lobby graphics follows categories too');
  assert.equal(readSmoke('runtime-diagnostics-smoke').split("openSettingsCategory(page, 'diagnostics', { touch: true })").length - 1, 2, 'both lobby and campus diagnostics use touch category navigation');
});
