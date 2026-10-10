const {test,expect}=require('@playwright/test');
const {offline}=require('./offline.cjs');

const LOCAL='http://localhost:4173/';
// Routed to local files by offline.cjs: game-entry.js only activates on the real Survival hostname.
const PROD_HOST='https://survival.inhagame.app/';
const ENTRY='3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';

let net,problems;
test.beforeEach(async({context,page})=>{
  net=await offline(context);
  problems=[];
  page.on('pageerror',error=>problems.push(`pageerror: ${error.message}`));
  page.on('console',message=>{if(message.type()==='error')problems.push(`console: ${message.text()}`);});
});
test.afterEach(()=>{
  expect(net.blocked,'unexpected external requests').toEqual([]);
  expect(problems,'console/page errors').toEqual([]);
});

async function booted(page){
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:45000});
  await expect(page.locator('#mainMenu')).toBeVisible();
  await expect(page.locator('#menuStartBtn')).toBeEnabled();
}
async function running(page,deadline){
  await expect(page.locator('#mainMenu')).toBeHidden();
  await expect(page.locator('#timer')).toHaveText(new RegExp(`^\\d\\d:\\d\\d / ${deadline}$`));
  // The game loop advances the clock past 00:00 once the run is live.
  await expect(page.locator('#timer')).not.toHaveText(/^00:00 /,{timeout:20000});
}

test('boots without hub entry and starts Stage 1 with staged skills locked',async({page})=>{
  await page.goto(LOCAL);
  await booted(page);
  await expect(page.locator('.stageCardMenu')).toHaveCount(6);
  await expect(page.locator('#menuStageSummary')).toContainText('Stage 1');
  expect(await page.evaluate(()=>typeof window.InhaGameEntry?.play)).toBe('function');
  await page.locator('#menuStartBtn').click();
  await running(page,'03:00');
  await expect(page.locator('#quack')).toHaveClass(/locked/);
  await expect(page.locator('#storm')).toHaveClass(/locked/);
  expect(net.entries,'no ih_entry means no hub reports').toEqual([]);
});

test('Stage 2 starts with Q and E immediately available',async({page})=>{
  await page.goto(`${LOCAL}?stage=2`);
  await booted(page);
  await page.locator('#menuStartBtn').click();
  await running(page,'03:30');
  await expect(page.locator('#quack')).not.toHaveClass(/locked/);
  await expect(page.locator('#storm')).not.toHaveClass(/locked/);
});

test('Stage 3 can be selected from the menu and starts',async({page})=>{
  await page.goto(LOCAL);
  await booted(page);
  await page.locator('.stageCardMenu[data-stage="3"]').click();
  await expect(page.locator('#menuStageSummary')).toContainText('Stage 3');
  await page.locator('#menuStartBtn').click();
  await page.waitForURL(url=>url.searchParams.get('stage')==='3');
  await expect(page.locator('#loading')).toHaveCount(0,{timeout:45000});
  // The replay flag auto-starts the run and is removed from the address bar.
  await expect.poll(()=>new URL(page.url()).searchParams.has('replay')).toBe(false);
  await running(page,'03:45');
});

test('Stage 4 route boots and starts',async({page})=>{
  await page.goto(`${LOCAL}?stage=4`);
  await booted(page);
  await page.locator('#menuStartBtn').click();
  await running(page,'04:45');
});

test('Stage 5 preview route boots with lobby objectives and 04:10 deadline',async({page})=>{
  await page.goto(`${LOCAL}?stage=5`);
  await booted(page);
  await expect(page.locator('#menuStageSummary')).toContainText('Stage 5');
  await page.locator('#menuStartBtn').click();
  await running(page,'04:10');
  await expect(page.locator('#attendanceHud')).toContainText('전시 0/2');
});

test('Stage 6 preview route boots with graduation requirements and 04:30 deadline',async({page})=>{
  await page.goto(`${LOCAL}?stage=6`);
  await booted(page);
  await expect(page.locator('#menuStageSummary')).toContainText('Stage 6');
  await page.locator('#menuStartBtn').click();
  await running(page,'04:30');
  await expect(page.locator('#attendanceHud')).toContainText('졸업요건 0/3');
});

test('locked stages fall back to Stage 1 on the production hostname',async({page})=>{
  await page.goto(`${PROD_HOST}?stage=4`);
  await booted(page);
  await expect(page.locator('.stageCardMenu[data-stage="4"]')).toHaveClass(/locked/);
  await page.locator('#menuStartBtn').click();
  await running(page,'03:00');
});

test('ih_entry is cleaned and reports landing and play exactly once',async({page})=>{
  await page.goto(`${PROD_HOST}?ih_entry=${ENTRY}`);
  await booted(page);
  expect(page.url()).toBe(PROD_HOST);
  await expect.poll(()=>net.entries.map(e=>e.body.event_type)).toEqual(['game_landing']);
  await page.locator('#menuStartBtn').click();
  await running(page,'03:00');
  await expect.poll(()=>net.entries.map(e=>e.body.event_type)).toEqual(['game_landing','game_play_start']);
  await page.waitForTimeout(1500);
  expect(net.entries).toHaveLength(2);
  for(const {body,origin} of net.entries){
    expect(Object.keys(body).sort()).toEqual(['entry_id','event_id','event_type','target']);
    expect(body).toMatchObject({entry_id:ENTRY,target:'survival'});
    expect(origin).toBe('https://survival.inhagame.app');
  }
  expect(new Set(net.entries.map(e=>e.body.event_id)).size).toBe(2);
});

test('a reload in the same tab does not report confirmed stages again',async({page})=>{
  await page.goto(`${PROD_HOST}?ih_entry=${ENTRY}`);
  await booted(page);
  await page.locator('#menuStartBtn').click();
  await running(page,'03:00');
  await expect.poll(()=>net.entries.map(e=>e.body.event_type)).toEqual(['game_landing','game_play_start']);
  // Survival restarts and switches stages with a full page load.
  await page.reload();
  await booted(page);
  await page.locator('#menuStartBtn').click();
  await running(page,'03:00');
  await page.waitForTimeout(1500);
  expect(net.entries.map(e=>e.body.event_type)).toEqual(['game_landing','game_play_start']);
});

test('409 for a not-yet-stored stage is retried until accepted',async({page})=>{
  net.replies.push(409,204);
  await page.goto(`${PROD_HOST}?ih_entry=${ENTRY}`);
  await booted(page);
  await expect.poll(()=>net.entries.length,{timeout:10000}).toBe(2);
  expect(net.entries.map(e=>e.body.event_type)).toEqual(['game_landing','game_landing']);
  expect(net.entries[0].body.event_id).toBe(net.entries[1].body.event_id);
  await page.locator('#menuStartBtn').click();
  await expect.poll(()=>net.entries.map(e=>e.body.event_type).at(-1)).toBe('game_play_start');
  expect(net.entries).toHaveLength(3);
  // Chromium logs the injected 409 response itself; nothing else may appear.
  problems=problems.filter(p=>!/status of 409/.test(p));
});
