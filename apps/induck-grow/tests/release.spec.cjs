const { test, expect } = require('@playwright/test');

for (const width of [390, 1280]) {
  test(`bag drag preview and saved placement at ${width}px`, async ({page}) => {
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
      contentType:'application/javascript',body:'window.supabase={createClient:()=>null};'
    }));
    await page.setViewportSize({width,height:800});
    await page.goto('/');
    await page.evaluate(() => {
      state=initState();state.inventory=[{uid:'notes-test',type:'notes'},{uid:'coffee-test',type:'coffee'}];
      state.bagPlacements=[{instanceId:'coffee-test',x:1,y:0,w:1,h:1,rotated:false}];
      openBag();
    });
    const source=page.locator('#bagQuickTray [data-bag-id="notes-test"]');
    const bad=page.locator('#bagGrid [data-x="1"][data-y="0"]');
    const good=page.locator('#bagGrid [data-x="0"][data-y="0"]');
    const center=async locator=>{const box=await locator.boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2}};
    await source.scrollIntoViewIfNeeded();
    const start=await center(source),red=await center(bad),green=await center(good);
    if(width===390){
      const cdp=await page.context().newCDPSession(page);
      const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      await send('touchStart',[start]);await send('touchMove',[red]);
      await expect(bad).toHaveClass(/preview-bad/);
      await expect(page.locator('#bagGrid [data-x="1"][data-y="1"]')).toHaveClass(/preview-bad/);
      await send('touchMove',[green]);await expect(good).toHaveClass(/preview-ok/);
      await send('touchEnd',[]);
    }else{
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      await page.mouse.move(red.x,red.y,{steps:5});await expect(bad).toHaveClass(/preview-bad/);
      await page.mouse.move(green.x,green.y,{steps:5});await expect(good).toHaveClass(/preview-ok/);
      await page.mouse.up();
    }
    await expect.poll(()=>page.evaluate(()=>bagPlacement('notes-test')?.x)).toBe(0);
    expect(await page.evaluate(()=>bagPlacement('coffee-test')?.x)).toBe(1);
    await page.reload();
    expect(await page.evaluate(()=>load().bagPlacements.find(p=>p.instanceId==='notes-test')?.x)).toBe(0);
  });
}

for (const width of [360, 390, 430, 1280]) {
  test(`release layout and first-week actions at ${width}px`, async ({page}) => {
    // CI guest-play tests run offline; account RPC behavior is covered by account.cjs.
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
      contentType:'application/javascript',body:'window.supabase={createClient:()=>null};'
    }));
    await page.setViewportSize({width, height: 800});
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page).toHaveTitle('인덕이 키우기 · v1.0');
    await expect(page.getByText('v1.0 · 공식 출시')).toBeVisible();
    await expect(page.getByText('← 허브로 돌아가기')).toHaveAttribute('href','https://inhagame.example/');
    await page.getByRole('button', {name:'새 게임'}).click();
    await page.evaluate(() => { selectDept('culture');chooseOT('academic');finishOT();choosePriority(0);openConfirm();startSemester();openPlanner(); });
    const title=page.locator('#screen-plan h2').first();
    await expect(title).toHaveText('주간 계획표');
    const geometry=await page.evaluate(() => {
      const h=document.querySelector('.plan-head-title h2').getBoundingClientRect();
      const actions=document.querySelector('.plan-head-actions').getBoundingClientRect();
      return {whole:document.documentElement.scrollWidth, viewport:innerWidth, titleLine:Math.round(h.height),
        font:parseFloat(getComputedStyle(document.querySelector('.plan-head-title h2')).fontSize),
        actionsRight:actions.right,titleRight:h.right};
    });
    expect(geometry.whole).toBeLessThanOrEqual(geometry.viewport+1);
    expect(geometry.titleLine).toBeLessThanOrEqual(geometry.font*1.6);
    expect(geometry.actionsRight).toBeLessThanOrEqual(width+1);
    await expect(page.locator('#screen-plan .plan-head-actions button')).toHaveCount(2);
    await expect(page.getByText('남은 자유 블록', {exact:true})).toHaveCount(0);
    await page.locator('#screen-plan .plan-head-actions button').first().click();
    await expect(page.locator('#screen-bag')).toHaveClass(/active/);
    await page.evaluate(() => { closeBag();openSubscriptions('plan'); });
    await expect(page.locator('#screen-bag')).toHaveClass(/active/);
    expect(errors).toEqual([]);
  });
}

test('desktop browser: full semester, exam, final screen and reload', async ({page}) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    contentType:'application/javascript',body:'window.supabase={createClient:()=>null};'
  }));
  test.setTimeout(90000);
  await page.setViewportSize({width:1280,height:800});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  await page.evaluate(() => {
    newGame();selectDept('cse');chooseOT('academic');finishOT();choosePriority(0);openConfirm();startSemester();
  });
  for(let week=1;week<=15;week++){
    await page.evaluate(() => {
      openPlanner();
      state.plan=[{uid:'browser-smoke',action:'study',slots:[15],target:0}];
      commitPlan();
    });
    await expect(page.locator('#resolveNextBtn')).toBeEnabled();
    await page.evaluate(() => {
      afterResolve();
      while(state.evaluationSession){
        chooseEvaluation(evaluationOptions(state.evaluationSession)[0].id);
        continueEvaluation();
      }
      if(currentEvent){
        if(currentEvent.id==='club_offer')skipClubFair(true);
        else if(currentEvent.id==='relationship_moment')relationshipMomentChoice(relationshipRoster()[0].id);
        else chooseEvent(currentEvent.choices[0][1]);
      }
    });
    await expect(page.locator('#screen-recap')).toHaveClass(/active/);
    if(week===8){
      await page.evaluate(() => {
        nextWeek();
        while(!state.examSession.done){state.examSession.selected=examQuestion().correct;submitExamAnswer()}
        finishMidterm();
      });
      await expect(page.locator('#screen-brief')).toHaveClass(/active/);
    }else await page.evaluate(() => nextWeek());
  }
  await expect(page.locator('#screen-final')).toHaveClass(/active/);
  await expect(page.locator('#gpaBig')).not.toHaveText(/NaN|undefined/);
  await expect(page.locator('#finalStyle')).toContainText('대표 플레이스타일');
  const saved=await page.evaluate(() => ({week:state.week,gpa:state.gpa,version:state.version,style:state.style}));
  await page.reload();
  await page.getByRole('button',{name:'이어하기'}).click();
  await expect(page.locator('#screen-final')).toHaveClass(/active/);
  expect(await page.evaluate(() => ({week:state.week,gpa:state.gpa,version:state.version,style:state.style}))).toEqual(saved);
  expect(errors).toEqual([]);
});
