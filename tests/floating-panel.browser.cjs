const { chromium: playwright } = require('playwright');
const katex = require('katex');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const math = katex.renderToString(String.raw`a_1 \approx g + a_\text{forward}`, {displayMode:true});
const second = katex.renderToString(String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`, {displayMode:true});
const integral = katex.renderToString(String.raw`\int_0^1 x^2\,dx = \frac13`, {displayMode:true});
const wide = katex.renderToString(Array(40).fill('a').join('+'), {displayMode:true});
const image = 'data:image/png;base64,' + fs.readFileSync(path.join(root,'tests/fixtures/pin-rocket.png')).toString('base64');
(async () => {
  const executablePath = process.env.CDC_CHROMIUM_PATH;
  console.log('Browser available');
  const browser = await playwright.launch({executablePath, args:['--no-sandbox','--disable-gpu'], headless:true});
  const page = await browser.newPage({viewport:{width:1100,height:800}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/fonts/')) {
      const file = path.join(path.dirname(require.resolve('katex')), 'fonts', path.basename(url.pathname));
      if (fs.existsSync(file)) return route.fulfill({body:fs.readFileSync(file),contentType:'font/woff2'});
    }
    await route.fulfill({contentType:'text/html; charset=utf-8',body:`<html><head><meta charset="utf-8"></head><body style="background:#212121;color:#ececec;font:16px/1.5 Arial;padding:40px">
      <article id="message"><p id="text">The silver fox crossed the <strong>quiet bridge</strong> at 07:42.</p>
      <span id="eq" data-math-display="true" data-math-source="formula">${math}</span>
      <p id="tail" dir="rtl">هذه معادلة للاختبار ${second} نهاية النص.</p><span id="integral" data-math-display="true">${integral}</span></article>
      <div id="unsafe"><b onclick="window.failed=1">Safe bold</b><script type="application/json">bad</script><iframe></iframe><button>bad</button><a href="javascript:window.failed=1">safe link</a></div>
      <span id="wide" data-math-display="true">${wide}</span><img id="image" src="${image}" style="width:64px;height:64px" alt="Sample"><textarea id="editor">Private draft</textarea>
      <div style="height:2400px"></div></body></html>`});
  });
  await page.goto('https://chatgpt.com/c/pin-test');
  await page.addStyleTag({content:fs.readFileSync(path.join(path.dirname(require.resolve('katex')), 'katex.min.css'),'utf8')});
  // Reproduce constrained ChatGPT math scrollers instead of testing only the
  // unconstrained default KaTeX layout.
  await page.addStyleTag({content:'.katex-display { overflow-x:auto; overflow-y:hidden; max-height:34px; } [data-math-display="true"] { display:block; overflow:auto; max-height:48px; }'});
  await page.evaluate(() => {
    window.roots=new Map(); const attach=Element.prototype.attachShadow;
    Element.prototype.attachShadow=function(options){const shadow=attach.call(this, options);window.roots.set(this,shadow);return shadow;};
    window.onPin=null;window.subscribers=[];window.featureEnabled=true;
    window.ChatDirectionControl={getCurrentSiteAdapter:()=>({id:'chatgpt'})};
    window.ChatDirectionSettings={enabled:()=>window.featureEnabled,subscribe:fn=>window.subscribers.push(fn)};
    window.chrome={runtime:{id:'test-extension',onMessage:{addListener:fn=>window.onPin=fn}}};
    window.pin=(sender='test-extension')=>{let response;window.onPin({type:'cdc:pin-floating-panel'},{id:sender},value=>response=value);return response;};
    window.panelRoot=()=>window.roots.get(document.getElementById('cdc-floating-panel'));
    window.select=(selector,start=0,end)=>{const el=document.querySelector(selector);const range=document.createRange();if(end===undefined)range.selectNodeContents(el);else {range.setStart(el.firstChild,start);range.setEnd(el.firstChild,end);}const selection=getSelection();selection.removeAllRanges();selection.addRange(range);};
    window.context=selector=>document.querySelector(selector).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,composed:true,button:2}));
    window.panelText=()=>window.panelRoot().querySelector('.content').textContent;
  });
  await page.addScriptTag({path:path.join(root,'floating-panel.js')});
  await page.evaluate(()=>{context('#eq .mord');pin();});
  const initial=await page.locator('#cdc-floating-panel').boundingBox();
  assert.equal(initial.x,84,'New panels should start at the top left beside navigation');
  assert.equal(initial.y,56,'New panels should start below the page header');
  assert(await page.evaluate(()=>{const title=panelRoot().querySelector('.title');return title.scrollWidth<=title.clientWidth+1;}),'The full title must fit even with short references');
  assert.equal(await page.evaluate(()=>panelText()), await page.locator('#eq .katex-html').textContent());
  assert(await page.evaluate(()=>{const content=panelRoot().querySelector('.content');const atom=[...content.querySelectorAll('span')].find(node=>node.textContent==='a'&&node.getBoundingClientRect().width>3);const box=atom.getBoundingClientRect();const area=content.getBoundingClientRect();return box.x>=area.x&&box.right<=area.right&&box.y>=area.y&&box.bottom<=area.bottom;}),'Visible math must fit inside the panel');
  await page.evaluate(()=>{const node=document.querySelector('#eq .katex-html .mord').firstChild; const r=document.createRange();r.setStart(node,0);r.setEnd(node,1);getSelection().removeAllRanges();getSelection().addRange(r);context('#eq .katex-html .mord');pin();});
  assert.equal(await page.evaluate(()=>panelText()), await page.locator('#eq .katex-html').textContent());
  assert(await page.evaluate(()=>{const c=panelRoot().querySelector('.content');return c.scrollWidth<=c.clientWidth+1&&c.scrollHeight<=c.clientHeight+1;}),'Short equation must fit without scrollbars');
  assert((await page.locator('#cdc-floating-panel').boundingBox()).height<150,'Short equation panel must fit its content');
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'cdc-equation-panel.png')});
  for (const selector of ['#tail .katex-display','#integral']) {
    await page.evaluate(selector=>{getSelection().removeAllRanges();context(selector);pin();},selector);
    assert(await page.evaluate(()=>{const c=panelRoot().querySelector('.content');return c.scrollWidth<=c.clientWidth+1&&c.scrollHeight<=c.clientHeight+1;}),'Fractions, square roots and integrals must fit without scrollbars');
  }
  await page.screenshot({path:path.join(require('node:os').tmpdir(),'cdc-integral-panel.png')});
  await page.evaluate(()=>{getSelection().removeAllRanges();context('#wide');pin();});
  assert(await page.evaluate(()=>{const c=panelRoot().querySelector('.content');return c.scrollWidth>c.clientWidth&&c.scrollHeight<=c.clientHeight+1;}),'Oversized equations should scroll horizontally without vertically clipping');
  await page.evaluate(()=>{const r=document.createRange();r.setStart(document.querySelector('#text').firstChild,0);r.setEnd(document.querySelector('#eq'),0);getSelection().removeAllRanges();getSelection().addRange(r);context('#text');pin();});
  assert.equal(await page.evaluate(()=>panelRoot().querySelectorAll('[data-cdc-equation]').length),0,'An empty equation boundary must not add equation fragments');
  await page.evaluate(()=>{select('#text',4,10);context('#text');pin();});
  assert.equal(await page.evaluate(()=>panelText()),'silver');
  await page.evaluate(()=>{panelRoot().querySelector('.title').style.fontSize='18px';context('#text');pin();});
  assert(await page.evaluate(()=>{const title=panelRoot().querySelector('.title');return title.scrollWidth<=title.clientWidth+1;}),'Header width must account for font differences');
  await page.evaluate(()=>{panelRoot().querySelector('.title').style.fontSize='';context('#text');pin();});
  assert((await page.locator('#cdc-floating-panel').boundingBox()).height<120,'Short text must fit without an empty fixed-height panel');
  await page.evaluate(()=>{select('#message');context('#text');pin();});
  assert.match(await page.evaluate(()=>panelText()), /silver fox/);
  assert.match(await page.evaluate(()=>panelText()), /forward/);
  assert.match(await page.evaluate(()=>panelText()), /نهاية النص/);
  assert.equal(await page.locator('#cdc-floating-panel').count(),1);
  const before=await page.locator('#cdc-floating-panel').boundingBox();
  await page.evaluate(()=>scrollTo(0,700));
  const after=await page.locator('#cdc-floating-panel').boundingBox();
  assert.equal(before.y,after.y);
  await page.mouse.move(after.x+80,after.y+20);await page.mouse.down();await page.mouse.move(after.x-150,after.y+80);await page.mouse.up();
  const dragged=await page.locator('#cdc-floating-panel').boundingBox();
  assert(dragged.x<after.x);assert(dragged.y>after.y);
  await page.mouse.move(dragged.x+dragged.width-8,dragged.y+dragged.height-8);await page.mouse.down();await page.mouse.move(dragged.x+dragged.width+50,dragged.y+dragged.height+40);await page.mouse.up();
  const resized=await page.locator('#cdc-floating-panel').boundingBox();assert(resized.width>dragged.width);assert(resized.height>dragged.height);
  await page.evaluate(()=>panelRoot().querySelector('.collapse').click());
  assert.equal((await page.locator('#cdc-floating-panel').boundingBox()).height,40);
  await page.evaluate(()=>{getSelection().removeAllRanges();context('#image');pin();});
  assert.equal(await page.evaluate(()=>panelRoot().querySelector('.content img').alt),'Sample');
  await page.waitForFunction(()=>{const image=panelRoot().querySelector('.content img');return image.complete&&image.naturalWidth===72;});
  assert.equal(await page.evaluate(()=>panelRoot().querySelector('.content img').style.width),'64px');
  assert.equal(await page.evaluate(()=>panelRoot().querySelector('.collapse').getAttribute('aria-expanded')),'true');
  await page.setViewportSize({width:320,height:240});
  await page.waitForFunction(()=>{const box=document.getElementById('cdc-floating-panel').getBoundingClientRect();return box.right<=innerWidth&&box.bottom<=innerHeight;});
  const small=await page.locator('#cdc-floating-panel').boundingBox();assert(small.x>=0&&small.y>=0&&small.x+small.width<=320&&small.y+small.height<=240);
  await page.evaluate(()=>{select('#unsafe');context('#unsafe');pin();});
  assert.equal(await page.evaluate(()=>panelRoot().querySelector('.content').querySelectorAll('[onclick],script,iframe,button,[href],[id]').length),0);
  assert.equal(await page.evaluate(()=>window.failed),undefined);
  await page.evaluate(()=>{select('#text');context('#text');document.querySelector('#text').remove();pin();});
  assert.match(await page.evaluate(()=>panelText()),/silver fox/);
  await page.evaluate(()=>{featureEnabled=false;subscribers.forEach(fn=>fn());});
  assert.equal(await page.locator('#cdc-floating-panel').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: rendered KaTeX, partial/mixed selection, text slicing, sanitization, fixed scrolling, drag, resize, collapse/replacement, images, small viewport, source rerender, disable cleanup');
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
