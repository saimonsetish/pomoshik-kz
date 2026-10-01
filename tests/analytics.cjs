const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function checkAnalytics(browser, root) {
  const context = await browser.newContext();
  const base = 'https://saimonsetish.github.io/pomoshik-kz/';
  const tag = 'https://mc.yandex.ru/metrika/tag.js?id=113258894';
  const endpoint = 'https://pomoshnik.adilzharas505.workers.dev/';
  const errors = [];
  const unexpected = [];
  let tagRequests = 0;
  let tagBlocked = false;
  let formStatus = 503;
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(base)) {
      const relative = new URL(url).pathname.slice('/pomoshik-kz/'.length) || 'index.html';
      return route.fulfill({path:path.join(root, relative)});
    }
    if (url === tag) {
      tagRequests++;
      if (tagBlocked) return route.abort('blockedbyclient');
      return route.fulfill({contentType:'application/javascript',body:
        'window.__metrikaCalls = (window.ym.a || []).map(args => Array.from(args)); window.ym = (...args) => window.__metrikaCalls.push(args);'});
    }
    if (url === endpoint) return route.fulfill({status:formStatus,contentType:'application/json',body:'{"ok":true}'});
    unexpected.push(url);
    return route.abort();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '?utm_source=threads');
    await page.waitForFunction(() => Array.isArray(window.__metrikaCalls));
    const calls = () => page.evaluate(() => window.__metrikaCalls);
    const goals = async () => (await calls()).filter(call => call[1] === 'reachGoal');
    const init = (await calls())[0];
    assert.deepEqual(init.slice(0, 2), [113258894, 'init']);
    for (const setting of ['webvisor','clickmap','ecommerce','trackLinks','trackHash']) assert.equal(init[2][setting], false);
    assert.equal(new URL(init[2].url).searchParams.get('utm_source'), 'threads');
    assert.equal(tagRequests, 1);
    // A duplicate inclusion must not count a second pageview or register handlers twice.
    await page.addScriptTag({content:await fs.readFile(path.join(root,'analytics.js'),'utf8')});
    assert.equal((await calls()).length, 1);
    assert.equal(tagRequests, 1);
    // Prevent navigation only in the test; production links remain normal links.
    await page.evaluate(() => document.addEventListener('click', event => {
      if (event.target.closest('a[href^="tel:"], a[href^="https://wa.me/"]')) event.preventDefault();
    }));
    await page.locator('a[href^="https://wa.me/"]').first().click();
    await page.locator('a[href^="tel:"]').first().click();
    assert.deepEqual(await goals(), [[113258894,'reachGoal','whatsapp_click'],[113258894,'reachGoal','phone_click']]);
    const fill = async () => {
      await page.locator('#description').fill('Тест: личный текст заявки');
      await page.locator('#clientName').fill('Тестовый Клиент');
      await page.locator('#phone').fill('8 707 123 45 67');
      await page.locator('#privacy').check();
    };
    await page.locator('#submitBtn').click(); // Invalid form is not a conversion.
    assert.equal((await goals()).length, 2);
    await fill();
    await page.locator('#submitBtn').click();
    await page.locator('#formStatus.error').waitFor();
    assert.equal((await goals()).length, 2); // HTTP error is not a conversion.
    formStatus = 200;
    await page.locator('#submitBtn').click();
    await page.locator('#newOrder').waitFor();
    await page.locator('#orderForm').evaluate(form => form.dispatchEvent(new Event('submit',{cancelable:true})));
    assert.deepEqual((await goals()).slice(2), [[113258894,'reachGoal','order_received']]);
    // The complete recorded goal payloads above contain no customer fields.
    assert.equal(await page.locator('#orderForm input:not(.ym-disable-keys), #orderForm textarea:not(.ym-disable-keys)').count(), 0);
    // A broken analytics API cannot turn an accepted request into a form error.
    await page.locator('#newOrder').click();
    await fill();
    await page.evaluate(() => { window.ym = () => { throw new Error('Tracker failed'); }; });
    await page.locator('#submitBtn').click();
    await page.locator('#newOrder').waitFor();
    assert.equal(await page.locator('#formStatus.error').count(), 0);
    // Blocking the tracker itself also leaves the form usable.
    tagBlocked = true;
    await page.reload();
    await fill();
    await page.locator('#submitBtn').click();
    await page.locator('#newOrder').waitFor();
    assert.equal(await page.locator('#formStatus.error').count(), 0);
    tagBlocked = false;
    for (const file of ['offer.html','privacy.html']) {
      await page.goto(base + file);
      await page.waitForFunction(() => Array.isArray(window.__metrikaCalls));
      assert.equal((await calls()).filter(call => call[1] === 'init').length, 1);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
  } finally {
    await context.close();
  }
};
