import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {renderLearningView} from '../src/learning/learning-view.js';

const worldRoot=fileURLToPath(new URL('../',import.meta.url));
class FakeElement {
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.textContent='';this.className='';this.disabled=false;this.value=null;this.max=null;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  addEventListener(){}
}
const doc={createElement:tag=>new FakeElement(tag)};
const tree=(node,fn)=>[...(fn(node)?[node]:[]),...(node.children||[]).flatMap(c=>tree(c,fn))];
const q={questionId:'test.en.e01.p1',version:1,type:'choice',prompt:'Choose a greeting.',options:['Hello','Bye'],a:0,why:'Hello is a greeting.'};
const catalog={lessons:[{id:'e01',lang:'en',unit:0,name:'First lesson'}],questions:[q],get:()=>q};
const progress={completed:{},wrong:{},masteries:{},learningHistory:{},speech:{}};
const makeModel=(screen,run=null)=>({catalog,progress,engine:{run,level:()=>1,bossReady:()=>false,reviewKeys:()=>[]},
  screen,lang:'en',notice:'',speechIndex:0,speechText:'',speechSupport:{recognition:false},backup:'',importReady:false,
  importText:'',cloudState:{status:'local'},saveState:{status:'saved'},exportedRecovery:false,recoveryChoices:[]});
function render(screen,run=null){
  const host=new FakeElement('main');
  renderLearningView({host,doc,model:makeModel(screen,run),act:()=>true,input:()=>{},guard:f=>f()});
  return host.children[0];
}
test('learning screen marks active tab and gives the primary lesson action an explicit style hook',()=>{
  const root=render('home');assert.match(root.className,/learning-app--home/);
  const active=tree(root,n=>n.getAttribute?.('aria-current')==='page');
  assert.equal(active.length,1);assert.equal(active[0].textContent,'학습 홈');
  assert.equal(tree(root,n=>n.className==='learning-primary-action'&&n.textContent==='이어서 배우기').length,1);
});
test('question has semantic progress and touch-primary action without altering answer handling',()=>{
  const run={questions:[q,q,q],index:1,combo:2,attempt:{selection:null,checked:false,isCorrect:false}};
  const root=render('question',run);
  assert.match(root.className,/learning-app--question/);
  const meters=tree(root,n=>n.tagName==='PROGRESS');
  assert.equal(meters.length,1);assert.equal(meters[0].value,2);assert.equal(meters[0].max,3);
  assert.equal(meters[0].getAttribute('aria-label'),'학습 진행률');
  const primary=tree(root,n=>n.className==='learning-primary-action');
  assert.equal(primary.length,1);assert.equal(primary[0].textContent,'정답 확인하기');assert.equal(primary[0].disabled,true);
});
test('standalone CSS scopes touch and landscape behavior without impacting the World UI',async()=>{
  const css=await readFile(worldRoot+'learn.css','utf8');
  assert.match(css,/WEB-LEARN-UX-01/);
  assert.match(css,/\.learn-page \.learning-app--question>\.learning-primary-action/);
  assert.match(css,/@media\(max-width:760px\)/);
  assert.match(css,/@media\(max-height:480px\) and \(orientation:landscape\)/);
  const html=await readFile(worldRoot+'learn/index.html','utf8');
  assert.match(html,/class="learn-jump" href="#learn-content"/);
  assert.match(html,/id="learn-content"/);
  assert.doesNotMatch(html,/main\.js|playcanvas|webgpu|\.glb|learning-content\/.*\.json/i);
});
