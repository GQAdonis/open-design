import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
 for (const w of [1366, 1440, 1512, 1728]) {
  const page = await browser.newPage({ viewport: { width: w, height: 880 }, deviceScaleFactor: dpr });
  await page.goto('http://127.0.0.1:17574/zh/', { waitUntil: 'networkidle' });
  const li = page.locator('.nav-links li.has-dropdown', { hasText: 'Community' }).last();
  const box = await li.locator('> a').boundingBox();
  const g = await li.evaluate(el => { const d=el.querySelector('.nav-dropdown'); const dr=d.getBoundingClientRect(); const ar=el.getBoundingClientRect(); const bb=d.querySelector('::before'); 
    return { ddTop:dr.top, ddLeft:dr.left, liBottom:ar.bottom, aBottom:el.querySelector(':scope>a').getBoundingClientRect().bottom }; });
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
  await page.waitForTimeout(250);
  // very fine vertical traverse through the trigger->menu boundary, 0.5px steps
  const cx = box.x+box.width/2;
  const y0 = g.aBottom - 3, y1 = g.ddTop + 6;
  const seq=[];
  for (let y=y0; y<=y1; y+=0.5){ await page.mouse.move(cx, y); const v=await page.evaluate(()=>{const d=document.querySelector('.nav-links li.has-dropdown:last-child .nav-dropdown');const cs=getComputedStyle(d);return (cs.visibility==='visible'&&cs.opacity!=='0')?'1':'0';}); seq.push(v); }
  const flick = seq.join('').includes('10');
  console.log(`dpr=${dpr} w=${w}: aBottom=${g.aBottom.toFixed(2)} liBottom=${g.liBottom.toFixed(2)} ddTop=${g.ddTop.toFixed(2)} gap=${(g.ddTop-g.liBottom).toFixed(2)} seq=${seq.join('')} ${flick?'<<FLICKER':''}`);
  await page.close();
 }
}
await browser.close();
