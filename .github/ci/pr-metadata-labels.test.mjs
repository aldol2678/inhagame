import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yml = readFileSync(new URL('../workflows/pr-metadata-labels.yml', import.meta.url), 'utf8');
const script = yml.split('          script: |\n')[1]?.split('\n').map(line =>
  line.startsWith('            ') ? line.slice(12) : line
).join('\n').trim();
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
test('trusted metadata-only security boundaries', () => {
  assert.ok(script, 'script block exists');
  assert.match(yml, /pull_request_target:/);
  assert.match(yml, /pull-requests: write/);
  assert.match(yml, /issues: write/);
  assert.doesNotMatch(yml, /actions\/checkout|secrets\.(?!GITHUB_TOKEN)|id-token:|deploy/);
  assert.doesNotMatch(script, /eval\(|exec\(|child_process|checkout/);
});
async function run({title='fix(world): restore model',files=['apps/world/src/character-model.js'],input='',known=[]}={}) {
  const created = [], added = [];
  const gh = {rest: {issues: {
    listLabelsForRepo() {}, listLabelsOnIssue() {}, createLabel: async args=>created.push(args.name),
    getLabel: async()=>{}, addLabels: async args=>added.push(...args.labels)
  }, pulls: {
    get: async()=>({data:{title,state:'open',base:{ref:'main'}}}), listFiles() {}
  }}};
  gh.paginate = async (fn) => fn===gh.rest.issues.listLabelsForRepo ? known.map(name=>({name})) :
    fn===gh.rest.issues.listLabelsOnIssue ? [] : files.map(filename=>({filename}));
  const context = {repo:{owner:'aldol2678',repo:'inhagame'},
    payload:{repository:{default_branch:'main'},pull_request:{number:305}},
    eventName:input==='catalog' ? 'workflow_dispatch' : 'pull_request_target'};
  await new AsyncFunction('github','context','core','process',script)(
    gh,context,{info(){}},{env:{PR_NUMBER:input==='catalog'?'':input}});
  return {created,added};
}
test('fix assets metadata adds type and areas, no status or priority',async()=>{
  const {added}=await run();
  assert.deepEqual(added,['type:bug','area:world','area:3d-assets']);
  assert.equal(added.some(label=>label.startsWith('status:')||label.startsWith('priority:')),false);
});
test('CI PR is classified without claiming CI pass',async()=>{
  const {added}=await run({title:'ci: tune workflow',files:['.github/workflows/verify.yml']});
  assert.deepEqual(added,['type:ci']);
});
test('catalog-only dispatch creates missing labels and changes no PR',async()=>{
  const {created,added}=await run({input:'catalog'});
  assert.ok(created.includes('priority:P0')&&created.includes('status:blocked'));
  assert.deepEqual(added,[]);
});
test('existing label names are not recreated',async()=>{
  const {created}=await run({known:['type:bug','status:blocked']});
  assert.equal(created.includes('type:bug'),false);
  assert.equal(created.includes('status:blocked'),false);
});
