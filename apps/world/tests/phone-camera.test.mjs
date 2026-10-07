import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhotoMode } from '../src/photo/photo-mode.js';
import { createPhoneShell, PHONE_OWNER } from '../src/phone/phone-shell.js';
import { createPhotoCameraController } from '../src/photo/photo-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '../src/input/input-focus-manager.js';
import { createFakeCameraEntity } from './support/fake-camera.mjs';
function setup() {
  const focus = createInputFocusManager(), camera = createFakeCameraEntity();
  const orbit = {camera,yaw:0,pitch:.3,distance:3,firstPerson:false};
  const rig = createPhotoCameraController({camera});
  const mode = createPhotoMode({orbit,rig,inputFocus:focus,entryOwnerId:PHONE_OWNER,
    getPosition:()=>({x:0,y:1,z:0}),getState:()=>({world:true,region:'campus',grounded:true})});
  const shell = createPhoneShell({inputFocus:focus,registry:[]}); mode.subscribe(shell.cameraChanged);
  return {focus,mode,shell};
}
test('Phone and Photo Mode hand off both ways without enabling gameplay; direct exit returns World', () => {
  const {focus,mode,shell} = setup(); shell.open();
  const states = []; focus.subscribe(s=>states.push(s.worldAction));
  assert.equal(shell.camera(mode),true); assert.equal(shell.state,'CAMERA'); assert.equal(mode.inputAllowed(),true);
  mode.close('escape'); assert.equal(shell.state,'HOME'); assert.equal(focus.size,1);
  assert.ok(states.every(v=>!v)); shell.close(); states.length=0;
  assert.equal(mode.open(),true); mode.close(); assert.equal(shell.state,'CLOSED'); assert.equal(focus.size,0);
});
test('another modal blocks Phone-origin camera and system takeover closes without Phone resurrection', () => {
  const {focus,mode,shell} = setup(); shell.open();
  const other = focus.claim('full-map',INPUT_FOCUS_POLICY.BLOCKING_UI);
  assert.equal(shell.camera(mode),false); focus.release(other);
  shell.camera(mode); const lock = focus.claim('lobby',INPUT_FOCUS_POLICY.SYSTEM_LOCK);
  assert.equal(mode.active,false); assert.equal(shell.state,'CLOSED'); assert.equal(focus.can('MOVE'),false);
  focus.release(lock); assert.equal(focus.size,0);
});
