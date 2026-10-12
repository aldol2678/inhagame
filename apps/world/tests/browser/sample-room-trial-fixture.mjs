import {createSampleRoomTrialPanel} from '/src/commissions/sample-room-trial-panel.js';
let account='fixture-a',enabled=true;const changes=[];
const panel=createSampleRoomTrialPanel({getAccountId:()=>account,isAvailable:()=>enabled,onOpenChange:value=>changes.push(value)});
document.querySelector('#open').onclick=()=>panel.open();
window.__SAMPLE_TRIAL_QA__={panel,changes,account(value){account=value;panel.update();},enable(value){enabled=value;panel.update();}};
