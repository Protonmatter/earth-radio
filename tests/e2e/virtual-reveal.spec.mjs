import {test,expect} from '@playwright/test';
import {setupApp,card,revealCard} from './helpers.mjs';

test('a pending virtualizer frame cannot make the reveal helper skip a loaded station',async({page})=>{
  await page.setViewportSize({width:1280,height:720});
  await page.addInitScript(()=>{
    const native=requestAnimationFrame.bind(window);
    window.__virtualFrame={hold:false,pending:[],native,flush(){for(const fn of this.pending.splice(0))fn(performance.now());}};
    window.requestAnimationFrame=fn=>window.__virtualFrame.hold&&fn.toString().includes('this.render(!1)')
      ?(window.__virtualFrame.pending.push(fn),-window.__virtualFrame.pending.length):native(fn);
  });
  await setupApp(page);await expect(card(page,'LISTEN.moe')).toHaveCount(1);
  await page.evaluate(()=>{
    window.__virtualFrame.hold=true;
    const grid=document.getElementById('station-grid');
    grid.scrollTop=grid.scrollHeight-grid.clientHeight;grid.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(()=>page.evaluate(()=>window.__virtualFrame.pending.length)).toBeGreaterThan(0);
  const prototype=Object.getPrototypeOf(page.locator('.station-card')),original=prototype.count;let sampled=false;
  prototype.count=async function(...args){
    const result=await original.apply(this,args);
    if(!sampled&&this.toString().includes('LISTEN.moe')){sampled=true;await page.evaluate(()=>window.__virtualFrame.flush());}
    return result;
  };
  try{
    // Deliver the actual held renderer immediately after the first presence
    // sample. The fixture changes scheduling, not catalog records or DOM nodes.
    await expect(await revealCard(page,'LISTEN.moe')).toBeVisible();
    expect(sampled).toBe(true);
  }finally{
    prototype.count=original;
    await page.evaluate(()=>{window.__virtualFrame.hold=false;window.__virtualFrame.flush();window.requestAnimationFrame=window.__virtualFrame.native;});
  }
});
