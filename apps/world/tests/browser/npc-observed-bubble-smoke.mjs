import assert from 'node:assert/strict';

// Actual DOM typography/overflow check. Fixtures do not claim natural NPC encounter QA.
export async function checkObservedBubble(smoke) {
  const page = await smoke.context.newPage();
  smoke.watch(page);
  await page.route('**/npc-observed-fixture', route=>route.fulfill({
    contentType:'text/html',body:'<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body></body></html>'
  }));
  await page.goto(`${smoke.origin}/npc-observed-fixture`);
  for (const viewport of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(async viewport=>{
      const { createObservedBubble } = await import('/npc-factory/npc-observed-bubble.mjs');
      const { OBSERVED_TEMPLATES, renderObservedTemplate } = await import('/npc-factory/npc-observed-templates.mjs');
      const bubble = createObservedBubble();
      const members = [{id:'a',department:'컴퓨터공학과'},{id:'b',department:'컴퓨터공학과'}];
      const point = {x:viewport.width/2,y:viewport.height/2,visible:true};
      let overflow = false, visible = 0;
      for (const template of OBSERVED_TEMPLATES) for (const tone of ['low','medium','high']) {
        const lines = renderObservedTemplate(template,members,{period:'morning',tone});
        for (let index=0;index<lines.length;index++) {
          const shown = bubble.render({conversation_id:`${template.conversation_id}:${tone}`,index,line:lines[index]},
            {point,name:'미리보기 학생'});
          const root = document.getElementById('npc-observed-bubble');
          overflow ||= root.scrollWidth>root.clientWidth || root.scrollHeight>root.clientHeight;
          if (shown) visible++;
        }
      }
      const root = document.getElementById('npc-observed-bubble');
      const rect = root.getBoundingClientRect();
      const fixture = {conversation_id:'collision',index:0,line:{npcId:'a',text:'오늘 과제 어디서 할 거야?'}};
      const blocked = !bubble.render(fixture,{point,name:'학생',obstacles:[{
        left:point.x-120,right:point.x+120,top:point.y-140,bottom:point.y
      }]});
      const behind = !bubble.render(fixture,{point:{...point,visible:false},name:'학생'});
      const noInput = getComputedStyle(root).pointerEvents==='none';
      bubble.destroy();
      return {visible,overflow,blocked,behind,noInput,rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}};
    },viewport);
    assert.equal(result.visible,360,'all 40 sets x 3 tones x 3 lines fit');
    assert.equal(result.overflow,false,'Korean text does not overflow the bubble');
    assert.ok(result.blocked && result.behind && result.noInput,'HUD obstruction/behind-camera/input policy');
    assert.ok(result.rect.left>=12 && result.rect.top>=12 && result.rect.right<=viewport.width-12 && result.rect.bottom<=viewport.height-12);
    console.log('observed bubble DOM',JSON.stringify({viewport,...result}));
  }
  await page.close();
}
