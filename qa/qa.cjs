const { chromium } = require('/home/hatch/workspace/custom-skills/guizang-social-card-skill/node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 800, height: 500 } })).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await page.goto('http://127.0.0.1:8979/index.html?day=400&qa=1');
  await page.waitForTimeout(1800);
  console.log('THREE loaded:', await page.evaluate(() => typeof THREE !== 'undefined'));
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__DS3 && window.__DS3.orders > 0, null, { timeout: 20000 });
  // 等一单总路程（取餐+送餐）较短的再抢，最多等 25 秒
  let grabbedOk = false;
  for (let w = 0; w < 55 && !grabbedOk; w++) {
    grabbedOk = await page.evaluate(() => {
      let best = null, bd = 1e9;
      document.querySelectorAll('[data-grab]').forEach(b => {
        const t = b.parentElement.textContent;
        const m1 = /取餐 ([0-9.]+)km/.exec(t), m2 = /送餐 ([0-9.]+)km/.exec(t);
        if (m1 && m2) { const tot = parseFloat(m1[1]) + parseFloat(m2[1]); if (tot < bd) { bd = tot; best = b; } }
      });
      if (best && bd < 1.3) { best.click(); return true; }
      return false;
    });
    if (!grabbedOk) await page.waitForTimeout(1000);
  }
  if (!grabbedOk) await page.evaluate(() => document.querySelector('[data-grab]') && document.querySelector('[data-grab]').click());
  await page.waitForFunction(() => window.__DS3.active === 1, null, { timeout: 5000 });
  console.log('grabbed ok');
  const held = new Set();
  async function setKeys(want) {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  }
  const nearRoad = c => Math.round((c - 32) / 300) * 300 + 32;
  let wps = [], wpIdx = 0, lastTargetKey = '';
  let recovering = 0, shotDeli = false, pb = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 420000) {
    const s = await page.evaluate(() => window.__DS3);
    if (s.done >= 1) break;
    if (!shotDeli && s.phase === 'deli') { shotDeli = true; await page.screenshot({ path: 'qa/shot-deliver.png' }); }
    if (recovering > 0) { // 脱困两段：倒车打方向 -> 前进同向摆正
      await setKeys(recovering > 900 ? new Set(['s', 'd']) : new Set(['w', 'd']));
      recovering -= 60; await page.waitForTimeout(60); continue;
    }
    { // 进度型卡死检测：7 秒内没向目标靠近 25px 就脱困
      const tdNow = Math.hypot(s.tx - s.px, s.tz - s.py);
      if (!pb || tdNow < pb.d - 25) pb = { d: tdNow, t: Date.now() };
      if (s.active > 0 && Date.now() - pb.t > 7000) { pb = { d: tdNow, t: Date.now() }; recovering = 1600; wps = []; lastTargetKey = ''; continue; }
    }
    const tKey = s.tx + ',' + s.tz + ',' + s.phase;
    if (tKey !== lastTargetKey) {
      lastTargetKey = tKey;
      const rx = nearRoad(s.px);
      if (s.phase === 'deli') {
        // 顾客门在楼南侧：绕到目标南边的路上，再从南面接近
        const ryS = (Math.floor((s.tz - 32) / 300) + 1) * 300 + 32;
        if (ryS <= 1832) {
          wps = [[rx, s.py], [rx, ryS], [s.tx, ryS], [s.tx, s.tz + 62], [s.tx, s.tz]];
        } else {
          // 最南排：南边没有路，沿地图底边空带（y≈2062）绕过去
          wps = [[rx, s.py], [rx, 2062], [s.tx, 2062], [s.tx, s.tz]];
        }
      } else {
        const ryT = nearRoad(s.tz);
        wps = [[rx, s.py], [rx, ryT], [s.tx, ryT], [s.tx, s.tz]];
      }
      wpIdx = 0;
    }
    while (wpIdx < wps.length - 1 && Math.hypot(wps[wpIdx][0] - s.px, wps[wpIdx][1] - s.py) < 48) wpIdx++;
    const wp = wps[Math.min(wpIdx, wps.length - 1)] || [s.tx, s.tz];
    const dx = wp[0] - s.px, dy = wp[1] - s.py, dist = Math.hypot(dx, dy);
    const tdx = s.tx - s.px, tdy = s.tz - s.py, tdist = Math.hypot(tdx, tdy);
    let rel = Math.atan2(dx, -dy) - s.heading; while (rel > Math.PI) rel -= 2 * Math.PI; while (rel < -Math.PI) rel += 2 * Math.PI;
    const want = new Set();
    if (tdist > 34) want.add('w');
    if (rel > 0.13) want.add('d'); else if (rel < -0.13) want.add('a');
    if (Math.abs(rel) > 1.3) want.delete('w');
    await setKeys(want);
    await page.waitForTimeout(25);
  }
  await setKeys(new Set());
  const end = await page.evaluate(() => window.__DS3);
  console.log('after drive:', JSON.stringify(end));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'qa/shot-after.png' });
  console.log('JS errors:', errs.length ? errs : 'none');
  await browser.close();
  if (errs.length) process.exit(2);
  if (!(end.done >= 1 && end.money > 0)) { console.log('FAIL: no completed delivery'); process.exit(3); }
  console.log('QA PASS');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
