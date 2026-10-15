import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneShell } from '../src/phone/phone-shell.js';
import { createInputFocusManager } from '../src/input/input-focus-manager.js';

test('visual transitions never defer app teardown or closed input release', () => {
  const focus=createInputFocusManager(),events=[];
  const registry=['induck-store','notifications'].map(id=>({id,available:()=>true,
    open:()=>events.push('open:'+id),close:()=>events.push('close:'+id)}));
  const shell=createPhoneShell({inputFocus:focus,registry,onChange:s=>{
    events.push('render:'+s.state);
    if(s.state==='CLOSED')assert.equal(focus.size,0,'release precedes outgoing visual work');
  }});
  shell.open();shell.launch('induck-store');events.length=0;
  shell.launch('notifications');
  assert.deepEqual(events,['close:induck-store','open:notifications','render:APP']);
  events.length=0;shell.home();
  assert.deepEqual(events,['close:notifications','render:HOME']);
  shell.launch('induck-store');events.length=0;shell.close();
  assert.deepEqual(events,['close:induck-store','render:CLOSED']);
  assert.equal(focus.size,0);shell.destroy();
});

test('destroy does not allow old animation callbacks to reopen the shell', () => {
  const focus=createInputFocusManager();let closed=0;
  const shell=createPhoneShell({inputFocus:focus,registry:[{id:'induck-store',available:()=>true,close:()=>closed++}]});
  shell.open();shell.launch('induck-store');shell.destroy();
  assert.equal(closed,1);assert.equal(shell.open(),false);assert.equal(shell.launch('induck-store'),false);
  assert.equal(shell.home(),false);assert.equal(shell.state,'CLOSED');assert.equal(focus.size,0);
});
