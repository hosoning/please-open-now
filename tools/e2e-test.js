const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || './screens/';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const shot = async (n, full = false) => { await page.waitForTimeout(450); return page.screenshot({ path: SHOTS + `02-${n}.png`, fullPage: full }); };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mood-btn');
  ok('home renders 12 moods', (await page.locator('.mood-btn').count()) === 12);
  await shot('home', true);

  // SW + manifest
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
  ok('service worker registered & active', sw.active && sw.scope === BASE, sw.scope);
  const mf = await page.evaluate(async () => {
    const href = document.querySelector('link[rel=manifest]').href;
    const m = await (await fetch(href)).json();
    const icons = [];
    for (const i of m.icons) {
      const url = new URL(i.src, href).href;
      const blob = await (await fetch(url)).blob();
      const bmp = await createImageBitmap(blob);
      icons.push({ src: i.src, sizes: i.sizes, real: `${bmp.width}x${bmp.height}`, purpose: i.purpose });
    }
    return { m, icons };
  });
  const m = mf.m;
  ok('manifest fields', m.name && m.short_name && m.start_url === './' && m.scope === './' && m.display === 'standalone' && m.theme_color && m.background_color);
  ok('manifest icon sizes match files', mf.icons.every((i) => i.sizes === i.real), JSON.stringify(mf.icons.map(i => i.real + '/' + i.purpose)));
  ok('maskable icon present', mf.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  ok('apple-touch-icon link', await page.locator('link[rel=apple-touch-icon]').count() === 1);
  const cacheKeys = await page.evaluate(async () => { const k = await caches.keys(); const c = await caches.open(k[0]); return { k, n: (await c.keys()).length }; });
  ok('precache populated', cacheKeys.n >= 12, JSON.stringify(cacheKeys));

  // open a letter with animation
  await page.click('.mood-btn[data-theme="miss"]');
  await page.waitForSelector('#letter.active');
  ok('envelope shown before opening', await page.isVisible('#envelope-closed'));
  ok('skip button visible', await page.isVisible('#skip-anim'));
  ok('bottom nav hidden on letter', !(await page.isVisible('#bottom-nav')));
  await shot('envelope');
  await page.click('#envelope-closed', { force: true });
  await page.waitForTimeout(700);
  await shot('opening');
  await page.waitForSelector('#letter-paper.show', { timeout: 4000 });
  await page.waitForTimeout(800);
  ok('paper shown after opening animation', await page.isVisible('#letter-paper'));
  await shot('letter', true);

  // favorite
  await page.click('#favorite-btn');
  await page.waitForTimeout(200);
  ok('favorite toggles on', (await page.getAttribute('#favorite-btn', 'aria-pressed')) === 'true' && (await page.getAttribute('#favorite-top', 'aria-pressed')) === 'true');
  const favDb = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('PleaseOpenNowDB'); r.onsuccess = () => { const q = r.result.transaction('letters').objectStore('letters').getAll(); q.onsuccess = () => res(q.result.filter(i => i.favorite).length); }; }));
  ok('favorite persisted in IndexedDB', favDb === 1);

  // share image
  await page.click('#share-btn');
  await page.waitForSelector('#share-preview img', { timeout: 8000 });
  await page.waitForTimeout(400);
  await shot('share-sheet');
  const b64 = await page.evaluate(async () => {
    const img = document.querySelector('#share-preview img');
    const blob = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { data: btoa(s), w: img.naturalWidth, h: img.naturalHeight };
  });
  fs.writeFileSync(SHOTS + '02-share-image.png', Buffer.from(b64.data, 'base64'));
  ok('share image generated', b64.w === 1080 && b64.h > 1200, `${b64.w}x${b64.h}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#share-download')]);
  ok('share image download', dl.suggestedFilename().endsWith('.png'), dl.suggestedFilename());
  await page.click('#share-close');

  // back button (history API)
  await page.goBack();
  await page.waitForSelector('#home.active');
  ok('browser/Android back returns home', true);

  // skip animation
  await page.click('.mood-btn[data-theme="tired"]');
  await page.waitForSelector('#skip-anim', { state: 'visible' });
  await page.click('#skip-anim');
  await page.waitForTimeout(100);
  ok('skip button reveals paper instantly', await page.isVisible('#letter-paper') && !(await page.isVisible('#envelope-closed')));
  // another letter
  const t1 = await page.textContent('#letter-title');
  await page.click('#another-btn');
  await page.click('#skip-anim');
  const t2 = await page.textContent('#letter-title');
  ok('"再拆一封" opens a different letter', t1 !== t2, `${t1} → ${t2}`);
  await page.click('#close-letter');
  await page.waitForSelector('#home.active');

  // settings: names
  await page.click('.nav-btn[data-screen="settings"]');
  await page.fill('#input-user-name', '小雨');
  await page.fill('#input-ta-name', '阿哲');
  await page.check('input[name="call-mode"][value="name"]');
  await shot('settings', true);
  await page.click('#save-names');
  await page.waitForTimeout(200);
  ok('names shown in header', (await page.textContent('#user-name-display')) === '小雨' && (await page.textContent('#ta-name-display')) === '阿哲');

  // history
  await page.click('.nav-btn[data-screen="history"]');
  await page.waitForSelector('.history-card');
  const n = await page.locator('.history-card').count();
  ok('history lists 3 letters', n === 3, String(n));
  await shot('history', true);
  await page.click('.tab[data-filter="fav"]');
  ok('favorites filter shows 1', (await page.locator('.history-card').count()) === 1);
  await shot('favorites', true);
  // reopen favorite -> personalization reapplied
  await page.click('.history-card [data-act="open"]');
  await page.waitForSelector('#letter-paper.show');
  const body = await page.textContent('#letter-body');
  const sal = await page.textContent('#letter-salutation');
  const sign = await page.textContent('#letter-sign');
  ok('reopened letter re-applies names', !/TA/.test(body) && !/你/.test(body) && sal.includes('小雨') && sign.includes('阿哲'), body.slice(0, 40));
  ok('reopened letter keeps favorite state', (await page.getAttribute('#favorite-top', 'aria-pressed')) === 'true');
  await shot('letter-reopened', true);
  await page.click('#back-from-letter');
  await page.waitForSelector('#history.active');
  ok('back from reopened letter returns to history', true);
  // unfavorite from list
  await page.click('.history-card [data-act="fav"]');
  await page.waitForTimeout(200);
  ok('unfavorite from list empties fav view', (await page.locator('.history-card').count()) === 0 && await page.isVisible('.empty'));
  await page.click('.tab[data-filter="all"]');
  // search
  await page.fill('#search-input', '累');
  await page.waitForTimeout(300);
  const sn = await page.locator('.history-card').count();
  ok('search filters', sn >= 1 && sn < 3, String(sn));
  await page.fill('#search-input', '');
  await page.waitForTimeout(300);

  // export
  const [exp] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  const expPath = '/tmp/02-backup.json';
  await exp.saveAs(expPath);
  const expData = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  ok('export produces JSON array', Array.isArray(expData) && expData.length === 3);

  // delete one + undo
  await page.click('.history-card >> nth=0 >> [data-act="del"]');
  await page.waitForTimeout(400);
  ok('single delete', (await page.locator('.history-card').count()) === 2);
  await shot('deleted-undo-toast');
  await page.click('#toast-action');
  await page.waitForTimeout(300);
  ok('undo delete restores', (await page.locator('.history-card').count()) === 3);

  // clear + import
  await page.click('#clear-btn');
  await page.waitForSelector('#confirm-dialog[open]');
  await shot('confirm-clear');
  await page.click('#confirm-ok');
  await page.waitForTimeout(300);
  ok('clear all', (await page.locator('.history-card').count()) === 0);
  await page.setInputFiles('#import-file', expPath);
  await page.waitForTimeout(500);
  ok('import restores 3 letters', (await page.locator('.history-card').count()) === 3, await page.textContent('#toast-text'));
  // bad import
  fs.writeFileSync('/tmp/bad.json', '{"nope":1}');
  await page.setInputFiles('#import-file', '/tmp/bad.json');
  await page.waitForTimeout(300);
  ok('bad import handled gracefully', (await page.textContent('#toast-text')).includes('不是有效'));

  // XSS-safe import
  fs.writeFileSync('/tmp/xss.json', JSON.stringify([{ id: 'x1', time: new Date().toISOString(), title: '<img src=x onerror=window.__xss=1>', body: 'b', themeName: 't' }]));
  await page.setInputFiles('#import-file', '/tmp/xss.json');
  await page.waitForTimeout(400);
  ok('imported HTML is escaped', !(await page.evaluate(() => window.__xss)));

  // keyboard focus visible screenshot
  await page.keyboard.press('Tab');

  // offline
  await ctx.setOffline(true);
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mood-btn', { timeout: 8000 });
  ok('offline: app shell + letters load', (await page.locator('.mood-btn').count()) === 12);
  await page.click('.mood-btn[data-theme="sleepless"]');
  await page.click('#skip-anim');
  ok('offline: can open a letter', await page.isVisible('#letter-paper'));
  await shot('offline-letter', true);
  await ctx.setOffline(false);

  // reduced motion
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('pageerror(rm): ' + e.message));
  p2.on('console', (msg) => { if (msg.type() === 'error') errors.push('console(rm): ' + msg.text()); });
  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.click('.mood-btn >> nth=0'); await p2.waitForTimeout(300);
  ok('reduced motion skips envelope animation', await p2.isVisible('#letter-paper') && !(await p2.isVisible('#envelope-closed')));
  // desktop
  await p2.setViewportSize({ width: 1280, height: 860 });
  await p2.click('#close-letter');
  await p2.waitForSelector('#home.active');
  await p2.screenshot({ path: SHOTS + '02-desktop.png' });
  // a11y: buttons without accessible names
  const unnamed = await p2.evaluate(() => [...document.querySelectorAll('button')].filter(b => !b.hidden && !(b.getAttribute('aria-label') || b.textContent.trim())).map(b => b.id || b.className));
  ok('all buttons have accessible names', unnamed.length === 0, unnamed.join(','));
  await ctx2.close();

  ok('no console errors / page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  console.log(`\n${results.filter(r => r.startsWith('PASS')).length}/${results.length} passed`);
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
