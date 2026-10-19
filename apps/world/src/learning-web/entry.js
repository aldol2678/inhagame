import {createLearningWebClient} from './auth.js';
import {createLearningWeb} from './app.js';

// Wait for the existing deferred public configuration / SDK scripts. A failed
// download leaves a safe preparation page and an explicit unavailable Auth state.
if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
const app=createLearningWeb({client:createLearningWebClient()});
void app.start();
window.addEventListener('pagehide',event=>{if(!event.persisted)app.dispose();});
