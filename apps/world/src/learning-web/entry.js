import {createLearningWeb} from './web-view.js';
// Only the approved loader can supply production content. No URL/global override.
createLearningWeb({host:document.querySelector('#study-app')});
