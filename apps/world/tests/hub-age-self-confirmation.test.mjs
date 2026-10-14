import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../hub-account.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function fixture({ oauthError = null, signupError = null, oauthResult = {error:null}, oauthPending = null } = {}) {
  const elements = new Map(), windowEvents = {}, calls = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      checked: false, disabled: false, hidden: false, value: '', textContent: '', events: {},
      addEventListener(name, fn) { this.events[name] = fn; },
      reportValidity() { return true; }, focus() { this.focused = true; },
      setAttribute() {}, querySelector() { return element(id + '-submit'); }
    });
    return elements.get(id);
  }
  for (const id of ['hub-signup-form', 'hub-login-form']) {
    element(id).elements = Object.fromEntries(Object.entries({ nickname:'Tester', email:'test@example.test', password:'test-password', passwordConfirm:'test-password' }).map(([key,value])=>[key,{value}]));
  }
  let authChange;
  const client = { auth: {
    onAuthStateChange(fn) { authChange = fn; },
    async getUser() { return { data:{user:null} }; },
    async signUp(args) { calls.push(['signup',args]); if (signupError) throw signupError; return {data:{},error:null}; },
    async signInWithOAuth(args) { calls.push(['google',args]); if (oauthError) throw oauthError; return oauthPending || oauthResult; },
    async signInWithPassword(args) { calls.push(['login',args]); return {error:null}; }
  }};
  const context = { document:{getElementById:element,querySelectorAll:()=>[]},
    window:{supabase:{createClient:()=>client},addEventListener:(name,fn)=>{windowEvents[name]=fn;}},
    __INHAGAME_PUBLIC_SUPABASE__:{url:'https://test.example',publishableKey:'public-test-key'},
    location:{origin:'https://example.test',search:'',hash:''}, URL, URLSearchParams,
    sessionStorage:{getItem:()=>null,removeItem(){}}, console:{warn(){}}, setTimeout(){}
  };
  runInNewContext(source, context);
  return { element, calls, windowEvents, authChange:()=>authChange(),
    fire:(id,event)=>element(id).events[event]({preventDefault(){}}) };
}

test('email signup and Google require explicit checks even when form validity is bypassed', async () => {
  const f=fixture();
  await f.fire('hub-signup-form','submit');
  await f.fire('hub-google-auth','click');
  assert.equal(f.calls.length,0);
  assert.equal(f.element('hub-google-age-confirm').focused,true);
  assert.equal(f.element('hub-google-auth').disabled,false);
});

test('email signup sends original payload only and consumes successful confirmation', async () => {
  const f=fixture(); f.element('hub-signup-age-confirm').checked=true;
  await f.fire('hub-signup-form','submit');
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'signup');
  assert.deepEqual(Object.keys(f.calls[0][1].options.data),['nickname']);
  assert.equal(f.element('hub-signup-age-confirm').checked,false);
  assert.equal(f.element('hub-signup-form-submit').disabled,false);
});

test('Google consumes a fresh confirmation on every attempt and restores failed button', async () => {
  const f=fixture({oauthError:new Error('offline')});
  f.element('hub-google-age-confirm').checked=true;
  await f.fire('hub-google-auth','click');
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][1].provider,'google');
  assert.equal(f.element('hub-google-age-confirm').checked,false);
  assert.equal(f.element('hub-google-auth').disabled,false);
  await f.fire('hub-google-auth','click'); assert.equal(f.calls.length,1);
});

test('email signup failure restores submit control', async () => {
  const f=fixture({signupError:new Error('offline')}); f.element('hub-signup-age-confirm').checked=true;
  await f.fire('hub-signup-form','submit');
  assert.equal(f.element('hub-signup-form-submit').disabled,false);
});

test('ordinary email login has no age checkbox dependency', async () => {
  const f=fixture(); await f.fire('hub-login-form','submit');
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'login');
});

test('account changes and browser restoration clear both checks', () => {
  const f=fixture();
  for (const reset of [f.authChange,f.windowEvents.pageshow]) {
    f.element('hub-signup-age-confirm').checked=true;
    f.element('hub-google-age-confirm').checked=true;
    reset();
    assert.equal(f.element('hub-signup-age-confirm').checked,false);
    assert.equal(f.element('hub-google-age-confirm').checked,false);
  }
});

test('required inputs have labels and clear self-declaration disclosures', () => {
  for (const kind of ['google','signup']) {
    assert.match(html,new RegExp('for="hub-'+kind+'-age-confirm"'));
    assert.match(html,new RegExp('id="hub-'+kind+'-age-confirm"[^>]*type="checkbox"[^>]*required[^>]*aria-describedby="hub-'+kind+'-age-note"'));
  }
  assert.match(html,/실제 나이를 인증하지 않습니다/);
  assert.match(html,/Google로 계속하려면 기존 회원도 확인/);
  const login=html.match(/<form id="hub-login-form"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(login,/age-confirm/);
});


test('Google returned Auth error restores control and still requires a fresh confirmation', async () => {
  const f=fixture({oauthResult:{error:{message:'Provider unavailable'}}});
  f.element('hub-google-age-confirm').checked=true;
  await f.fire('hub-google-auth','click');
  assert.equal(f.calls.length,1);
  assert.equal(f.element('hub-google-auth').disabled,false);
  assert.equal(f.element('hub-google-age-confirm').checked,false);
  assert.match(f.element('hub-account-status').textContent,/시작하지 못했습니다/);
  await f.fire('hub-google-auth','click');
  assert.equal(f.calls.length,1);
});

test('Google pending request rejects duplicate clicks even if checkbox is checked again', async () => {
  let finish;
  const pending=new Promise(resolve=>{finish=resolve;});
  const f=fixture({oauthPending:pending});
  f.element('hub-google-age-confirm').checked=true;
  const first=f.fire('hub-google-auth','click');
  f.element('hub-google-age-confirm').checked=true;
  await f.fire('hub-google-auth','click');
  assert.equal(f.calls.length,1);
  assert.equal(f.element('hub-google-auth').disabled,true);
  finish({error:null}); await first;
  assert.equal(f.calls.length,1);
  f.windowEvents.pageshow();
  assert.equal(f.element('hub-google-auth').disabled,false);
  assert.equal(f.element('hub-google-age-confirm').checked,false);
});

test('account pageshow handler is unique and never starts another Auth request', () => {
  assert.equal((source.match(/addEventListener\('pageshow'/g)||[]).length,1);
  const f=fixture();
  f.element('hub-google-auth').disabled=true;
  f.windowEvents.pageshow();
  assert.equal(f.element('hub-google-auth').disabled,false);
  assert.equal(f.calls.length,0);
});
