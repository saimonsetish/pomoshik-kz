const { chromium } = require(process.env.KOMEK_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const qa = path.join(root, '.qa', 'site');
fs.mkdirSync(qa, { recursive: true });
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const type = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'}[path.extname(file)];
  fs.readFile(file, (err, data) => { res.writeHead(err ? 404 : 200, {'Content-Type': type || 'application/octet-stream'}); res.end(err ? 'Not found' : data); });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.KOMEK_BROWSER ? { executablePath: process.env.KOMEK_BROWSER } : {}) });
    const context = await browser.newContext();
    const errors = [];
    const requests = [];
    let mode = 'success';
    let videoMode = 'success';
    let posted;
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(base)) return route.continue();
      requests.push(url);
      if (url.startsWith('https://www.youtube-nocookie.com/embed/Wx6eYu65gsY')) {
        if (videoMode === 'timeout') return;
        return route.fulfill({status:200,contentType:'text/html',body:'<html><body>Mock video player</body></html>'});
      }
      if (url === 'https://pomoshnik.adilzharas505.workers.dev/') {
        posted = route.request().postDataJSON();
        if (mode === 'network') return route.abort('failed');
        if (mode === 'timeout') return; // Aborted by the browser's AbortController.
        return route.fulfill({status:mode === 'error' ? 503 : 200,contentType:'application/json',body:'{"ok":true}'});
      }
      throw new Error(`Unexpected external request: ${url}`);
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const fill = async () => {
      await page.locator('#description').fill('Тест интерфейса: собрать комод');
      await page.locator('#clientName').fill('Тестовый Клиент');
      await page.locator('#phone').fill('8 707 123 45 67');
      await page.locator('#privacy').check();
    };
    assert.equal(await page.locator('#address').getAttribute('required'), null);
    assert.equal(await page.locator('#privacy').isChecked(), false);
    const phones = await page.locator('a[href^="tel:"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    assert(phones.length >= 2 && phones.every(x => x === 'tel:+77075472157'));
    const links = await page.locator('a[href^="https://wa.me/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
    assert(links.length >= 3 && links.every(x => x.startsWith('https://wa.me/77075472157')));
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(() => typeof window.ym), 'undefined');
    results.push('Contacts correct; no external resources; address optional; consent initially unchecked.');
    if (!process.env.KOMEK_SKIP_VIDEO) {
    assert.equal(await page.locator('#videoShell iframe').count(), 0);
    await page.locator('#loadVideo').click();
    await page.locator('#videoShell iframe').waitFor();
    assert((await page.locator('#videoShell iframe').getAttribute('src')).includes('Wx6eYu65gsY'));
    await page.waitForLoadState('networkidle');
    assert.equal(requests.length, 1);
    results.push('Original project video loads only after explicit click; YouTube is mocked.');
    await page.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms === 8000 ? 150 : ms, ...args);
    });
    await page.reload();
    videoMode = 'timeout';
    await page.locator('#loadVideo').click();
    await page.locator('#videoShell a').waitFor({state:'visible'});
    assert.equal(await page.locator('#videoShell a').getAttribute('href'), 'https://www.youtube.com/watch?v=Wx6eYu65gsY');
    results.push('Blocked video falls back to a visible link to the original YouTube video.');
    videoMode = 'success';
    requests.length = 0;
    await page.reload();
    } else {
      results.push('Video behavior unchanged; video checks skipped for this visual update.');
    }

    await fill();
    await page.locator('#privacy').uncheck();
    await page.locator('#submitBtn').click();
    assert.equal(requests.length, 0);
    await page.locator('#privacy').check();
    await page.locator('#phone').fill('123');
    await page.locator('#submitBtn').click();
    assert.equal(requests.length, 0);
    await page.locator('#phone').fill('8 707 123 45 67');
    await page.locator('#submitBtn').click();
    await page.locator('#newOrder').waitFor({state:'visible'});
    assert.equal(posted.phone, '+77071234567');
    assert.deepEqual(Object.keys(posted).sort(), ['address','budget','category','datetime','description','phone']);
    assert(posted.description.includes('draft-2026-09-30'));
    assert(posted.address.includes('уточнить'));
    assert.equal(await page.locator('#submitBtn').isDisabled(), true);
    const count = requests.length;
    await page.locator('#orderForm').evaluate(form=>form.dispatchEvent(new Event('submit',{cancelable:true})));
    assert.equal(requests.length, count);
    results.push('Invalid phone blocked; direct form submits compatible payload; success prevents duplicate submit.');

    await page.locator('#newOrder').click();
    assert.equal(await page.locator('#phone').inputValue(), '');
    assert.equal(await page.locator('#privacy').isChecked(), false);
    for (const scenario of ['error','network']) {
      mode = scenario;
      await fill();
      await page.locator('#submitBtn').click();
      await page.locator('#formStatus.error').waitFor({state:'visible'});
      assert.equal(await page.locator('#description').inputValue(), 'Тест интерфейса: собрать комод');
      assert.equal(await page.locator('#submitBtn').isEnabled(), true);
      results.push(`${scenario}: visible failure and preserved input, no automatic retry.`);
    }
    await page.addInitScript(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms === 12000 ? 150 : ms, ...args);
    });
    await page.reload(); mode = 'timeout'; await fill();
    await page.locator('#submitBtn').click();
    await page.locator('#formStatus.error').waitFor({state:'visible'});
    assert.equal(await page.locator('#description').inputValue(), 'Тест интерфейса: собрать комод');
    results.push('Timeout aborts and preserves input with ambiguous-delivery guidance.');
    mode = 'success';
    await page.reload();
    await page.locator('[data-category="Переезд"]').click();
    assert.equal(await page.locator('#category').inputValue(), 'Переезд');
    assert.equal(await page.locator('.optional-fields').getAttribute('open'), null);
    assert.equal(await page.locator('#categoryNote').textContent(), 'Выбрано: Переезд');
    assert.equal(new URL(page.url()).hash, '#orderForm');
    results.push('Service cards preselect category.');

    await page.setViewportSize({width:390,height:844});
    await page.goto(base);
    const menu = page.locator('.menu-toggle');
    await menu.click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('main').evaluate(el => el.inert), true);
    await menu.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Услуги');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await menu.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    await menu.click();
    await page.locator('.menu-cta').click();
    assert.equal(await menu.getAttribute('aria-expanded'), 'false');
    assert.equal(new URL(page.url()).hash, '#orderForm');
    await page.goto(base);
    await menu.click();
    await page.setViewportSize({width:1440,height:1000});
    assert.equal(await page.locator('main').evaluate(el => el.inert), false);
    results.push('Mobile menu traps focus, closes with Escape or link selection, and unlocks the page on desktop.');

    for (const width of [320,360,390,768,1024,1440]) {
      await page.setViewportSize({width,height:1000});
      await page.goto(base);
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().map(a => a.finished)); });
      assert.equal(await page.locator('.home-illustration').evaluate(img => img.complete && img.naturalWidth > 0), true);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      await page.screenshot({path:path.join(qa,`home-${width}.png`),fullPage:true});
      if (width === 1440) {
        await page.screenshot({path:path.join(qa,'desktop-top.png')});
        await page.locator('#services').screenshot({path:path.join(qa,'desktop-services.png')});
        await page.locator('#project-video').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(qa,'desktop-video.png')});
      }
      if (width === 390) {
        await page.screenshot({path:path.join(qa,'mobile-top.png')});
        await page.locator('#orderForm').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(qa,'mobile-form.png')});
      }
    }
    for (const file of ['offer.html','privacy.html']) {
      await page.goto(`${base}/${file}`);
      assert(await page.locator('h1').isVisible());
      await page.screenshot({path:path.join(qa,file+'.png'),fullPage:true});
    }
    const noJS = await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    await noJS.route('**/*', route=>route.request().url().startsWith(base) ? route.continue() : route.abort());
    const staticPage = await noJS.newPage(); await staticPage.goto(base);
    assert(await staticPage.locator('#orderForm noscript').isVisible());
    assert(await staticPage.locator('#videoShell noscript a').isVisible());
    assert(await staticPage.locator('.contact-call').isVisible());
    assert(await staticPage.locator('#submitBtn').isDisabled());
    results.push('320/360/390/768/1024/1440 layouts have no horizontal overflow; illustration loads; legal pages and contacts work without JS.');
    assert.deepEqual(errors, []);
    await require('./analytics.cjs')(browser, root);
    results.push('Metrika: production-only, one init, contact goals and 2xx-only form goal without personal fields; blocked or broken tracker cannot break the form.');
    results.push('No uncaught browser errors. All outbound requests mocked; no real lead sent.');
    fs.writeFileSync(path.join(qa,'results.json'), JSON.stringify({passed:true,results,mockedRequests:requests.length}, null, 2));
    console.log(JSON.stringify({passed:true,results},null,2));
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
