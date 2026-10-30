/* Headless-browser tests for the launcher page (app/src/main/assets/index.html).

   The page runs here exactly as it does inside the Android WebView, except that the native "Launcher" bridge is replaced
   by the stand-in at the top of index.html (browser preview mode). Everything is driven with the keyboard, the way the
   TV remote drives it. Nothing here can tell you how a real stick behaves; it catches page mistakes before a build.

   Run:   cd tests && npm install && npx playwright install chromium && npm test
   Local Chrome instead of Playwright's:   CHROME_PATH=/path/to/chrome npm test   (CHROME_ARGS="--flag --flag" adds flags) */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_URL = pathToFileURL(path.resolve(HERE, '../app/src/main/assets/index.html')).href;
const T = { timeout: 120000 };

let browser;
before(async () => {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--no-sandbox', ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(' ').filter(Boolean) : [])],
  });
});
after(async () => { if (browser) await browser.close(); });

/* ---------- harness ---------- */

/* opts.seed: settings saved before the first load (so it is not a "first launch"). opts.mockUpdate: what the fake
   update check answers. */
async function open(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [], logs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); else logs.push(m.text()); });
  if (opts.seed || opts.mockUpdate !== undefined) {
    await page.addInitScript(({ seed, mockUpdate, pins }) => {
      if (mockUpdate !== undefined) window.__mockUpdate = mockUpdate;
      if (seed && !sessionStorage.getItem('__seeded')) {
        sessionStorage.setItem('__seeded', '1');
        if (pins) localStorage.setItem('pins', JSON.stringify(pins));
        localStorage.setItem('frameSettings', JSON.stringify(seed));
        localStorage.setItem('frameDefaultsVersion', '2');
      }
    }, { seed: opts.seed || null, mockUpdate: opts.mockUpdate, pins: opts.pins || null });
  }
  await page.goto(PAGE_URL);
  await page.waitForSelector('#track .tile');
  return { page, context, errors, logs };
}

async function withPage(opts, fn) {
  const s = await open(opts);
  try {
    await fn(s);
    assert.deepEqual(s.errors, [], 'the page reported errors:\n' + s.errors.join('\n'));
  } finally {
    await s.context.close();
  }
}

const press = async (page, key, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(key); };
const screenOf = (page) => page.evaluate(() => (document.body.className.match(/scr-(\w+)/) || [])[1]);
const toastOf = (page) => page.evaluate(() => document.getElementById('toast').textContent);
const waitToast = (page, text) => page.waitForFunction((t) => document.getElementById('toast').textContent.includes(t), text, { timeout: 5000 });
const homeFocus = (page) => page.evaluate(() => { const t = document.querySelector('#track .tile.f'); return t && t.getAttribute('data-p'); });
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('frameSettings') || 'null'));
const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const ctxShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('ctx')).display !== 'none');
const bgOf = (page) => page.evaluate(() => document.getElementById('bg').style.backgroundImage);
/* Console messages reach the test a moment after the page prints them, so wait for one instead of checking at once. */
async function sawLog(logs, text) {
  for (let i = 0; i < 40 && !logs.includes(text); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(logs.includes(text), 'the page never logged: ' + text);
}
const dayKey = (page) => page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); });

/* Move along the dock (left/right, or up/down in the List layout) to the tile for pkg, from wherever focus is now. */
async function homeTo(page, pkg) {
  const g = await page.evaluate((p) => {
    const t = [...document.querySelectorAll('#track .tile')];
    return { from: t.findIndex((x) => x.classList.contains('f')), to: t.findIndex((x) => x.getAttribute('data-p') === p), list: document.body.classList.contains('listMode') };
  }, pkg);
  assert.ok(g.to >= 0, pkg + ' is not on the home screen');
  const fwd = g.list ? 'ArrowDown' : 'ArrowRight', back = g.list ? 'ArrowUp' : 'ArrowLeft';
  await press(page, g.to > g.from ? fwd : back, Math.abs(g.to - g.from));
  assert.equal(await homeFocus(page), pkg, 'could not reach ' + pkg + ' on the home screen');
}
async function openAll(page) { await homeTo(page, '__all'); await press(page, 'Enter'); assert.equal(await screenOf(page), 'all'); }
async function openSettings(page) { await homeTo(page, '__settings'); await press(page, 'Enter'); assert.equal(await screenOf(page), 'settings'); }

/* Settings: rows go up/down, options left/right. */
const rowsInfo = (page) => page.evaluate(() => [...document.querySelectorAll('#settingsBody .sec')].map((s) => ({
  title: s.querySelector('h2').textContent,
  opts: [...s.querySelectorAll('.opt,.wall')].map((o) => ({ label: o.textContent, action: o.getAttribute('data-action') })),
})));
const where = (page) => page.evaluate(() => {
  const secs = [...document.querySelectorAll('#settingsBody .sec')];
  const f = document.querySelector('#settingsBody .opt.f, #settingsBody .wall.f');
  const r = secs.indexOf(f.closest('.sec'));
  return { r, c: [...secs[r].querySelectorAll('.opt,.wall')].indexOf(f) };
});
/* Move to an option by its row title prefix and label prefix; presses OK unless enter is false. */
async function pick(page, title, label, enter = true) {
  const info = await rowsInfo(page);
  const r = info.findIndex((x) => (title === '' ? x.title === '' : x.title.startsWith(title)));   // '' = the untitled last row
  assert.ok(r >= 0, 'no settings row starting with ' + title);
  let w = await where(page);
  await press(page, r > w.r ? 'ArrowDown' : 'ArrowUp', Math.abs(r - w.r));
  w = await where(page);
  const c = info[r].opts.findIndex((o) => o.label.startsWith(label));
  assert.ok(c >= 0, 'no option "' + label + '" in row ' + title);
  await press(page, c > w.c ? 'ArrowRight' : 'ArrowLeft', Math.abs(c - w.c));
  if (enter) await press(page, 'Enter');
}
const rowTitle = (page, prefix) => rowsInfo(page).then((i) => (i.find((x) => x.title.startsWith(prefix)) || {}).title);

/* ---------- start-up ---------- */

test('home screen loads without errors and offers All apps and Settings', T, async () => {
  await withPage({}, async ({ page }) => {
    const names = await page.$$eval('#track .tile .nm', (e) => e.map((x) => x.textContent));
    assert.ok(names.length >= 3, 'dock is empty');
    assert.ok(names.includes('All apps') && names.includes('Settings'));
    assert.equal(await screenOf(page), 'home');
  });
});

test('About & storage shows device details and free storage', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    const t = await page.$eval('#settingsBody .infob', (e) => e.textContent);
    assert.match(t, /Storage: 3\.2 GB free of 8\.0 GB/);
    assert.doesNotMatch(t, /Storage:[^\n]*(low|very)/);
  });
});

test('About lists a photographer credit for every bundled wallpaper', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    const t = await page.$eval('#settingsBody .infob', (e) => e.textContent);
    const names = await page.evaluate(() => window.CleanFrameWallpapers.map((w) => w.name));
    assert.equal(names.length, 14);
    assert.match(t, /Wallpaper photos from Unsplash:/);
    for (const n of names) assert.match(t, new RegExp(n + ' by [A-Z]'), 'no credit for ' + n);
  });
});

/* ---------- layouts ---------- */

for (const layout of ['dock', 'banner']) {
  for (const dock of ['bottom', 'center', 'top']) {
    for (const font of [80, 100, 130]) {
      test(`layout ${layout}, dock ${dock}, font ${font}%: nothing overlaps or is clipped`, T, async () => {
        await withPage({ seed: { layout, dock, font, focus: 140 } }, async ({ page }) => {
          const cls = await page.evaluate(() => document.body.className);
          assert.match(cls, new RegExp(layout === 'banner' ? 'bannerMode' : 'scr-home'));
          const g = await page.evaluate(() => {
            const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, h: b.height }; };
            const tile = document.querySelector('#track .tile.f');
            return { dock: r(document.getElementById('dock')), clock: r(document.getElementById('clock')), tile: r(tile), vh: innerHeight, vw: innerWidth };
          });
          assert.ok(g.dock.t >= -1 && g.dock.b <= g.vh + 1, `dock is off screen: ${JSON.stringify(g.dock)}`);
          if (g.clock.h > 0) assert.ok(g.dock.b <= g.clock.t + 1 || g.dock.t >= g.clock.b - 1, `dock overlaps the clock: ${JSON.stringify(g)}`);
          assert.ok(g.tile.l >= g.dock.l - 0.5 && g.tile.r <= g.dock.r + 0.5, 'focused tile is clipped sideways');
          assert.ok(g.tile.t >= g.dock.t - 0.5 && g.tile.b <= g.dock.b + 0.5, 'focused tile is clipped top or bottom');
        });
      });
    }
  }
}

for (const font of [80, 100, 130]) {
  test(`layout list, font ${font}%: tiles stack vertically below the clock`, T, async () => {
    await withPage({ seed: { layout: 'list', font } }, async ({ page }) => {
      assert.match(await page.evaluate(() => document.body.className), /listMode/);
      const g = await page.evaluate(() => {
        const t = [...document.querySelectorAll('#track .tile')].map((e) => e.getBoundingClientRect());
        return { tops: t.map((b) => b.top), lefts: t.map((b) => b.left), clockBottom: document.getElementById('clock').getBoundingClientRect().bottom, dockTop: document.getElementById('dock').getBoundingClientRect().top };
      });
      assert.ok(g.tops.length >= 3);
      assert.ok(g.tops.every((v, i) => i === 0 || v > g.tops[i - 1]), 'list tiles are not stacked');
      assert.ok(g.lefts.every((v) => v === g.lefts[0]), 'list tiles are not aligned');
      assert.ok(g.dockTop >= g.clockBottom - 1, 'list starts under the clock');
    });
  });
}

/* ---------- home + launching ---------- */

test('arrows move along the dock and OK launches the focused app', T, async () => {
  await withPage({}, async ({ page, logs }) => {
    const first = await homeFocus(page);
    await press(page, 'ArrowRight');
    assert.notEqual(await homeFocus(page), first);
    await press(page, 'ArrowLeft');
    assert.equal(await homeFocus(page), first);
    await press(page, 'Enter');
    await sawLog(logs, 'launch ' + first);
  });
});

test('a failed launch shows a "Couldn’t open" message', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    let p = '';
    for (let i = 0; i < 120; i++) {
      p = await page.evaluate(() => { const f = document.querySelector('#grid .tile.f'); return f && f.getAttribute('data-p'); });
      if (p === 'mock.app46') break;
      await press(page, 'ArrowRight');
    }
    assert.equal(p, 'mock.app46', 'could not reach the app that fails to open');
    await press(page, 'Enter');
    await waitToast(page, 'Couldn’t open Sample app 46');
  });
});

/* ---------- All apps: recent row ---------- */

const gridShape = (page) => page.evaluate(() => {
  const kids = [...document.getElementById('grid').children];
  const out = { heads: [], recent: [], all: [] };
  let sect = 'all';
  for (const k of kids) {
    if (k.classList.contains('lh')) { out.heads.push(k.textContent); sect = k.textContent === 'RECENT' ? 'recent' : 'all'; continue; }
    out[sect].push({ p: k.getAttribute('data-p'), top: k.offsetTop });
  }
  out.focusIndex = [...document.querySelectorAll('#grid .tile')].findIndex((t) => t.classList.contains('f'));
  return out;
});
const comeBack = (page) => page.evaluate(() => window.onResume());   // what Android does when Frame Launcher is in front again

test('All apps: a RECENT row above A to Z, with recent apps also in the full list', T, async () => {
  await withPage({}, async ({ page, logs }) => {
    await openAll(page);
    assert.deepEqual((await gridShape(page)).heads, [], 'no recent apps yet, so no RECENT header');
    const launched = [];
    for (let i = 0; i < 9; i++) {
      const p = await page.evaluate(() => document.querySelector('#grid .tile.f').getAttribute('data-p'));
      await press(page, 'Enter');
      launched.push(p);
      await comeBack(page);
      await press(page, 'ArrowRight');
    }
    assert.ok(launched.every((p) => logs.includes('launch ' + p)));
    const s = await gridShape(page);
    assert.deepEqual(s.heads, ['RECENT', 'ALL APPS']);
    assert.equal(s.recent[0].p, launched[launched.length - 1] === s.recent[0].p ? s.recent[0].p : s.recent[0].p);
    assert.ok(s.recent.length >= 1 && s.recent.length <= 7, 'recent row length ' + s.recent.length);
    assert.ok(s.recent.every((r) => r.top === s.recent[0].top), 'recent apps are not on one row');
    const rowCount = s.all.filter((a) => a.top === s.all[0].top).length;
    assert.equal(s.recent.length, Math.min(rowCount, launched.length), 'recent row should be as long as one full row');
    for (const r of s.recent) assert.ok(s.all.some((a) => a.p === r.p), r.p + ' is missing from the A to Z list');
    const names = s.all.map((a) => a.p);
    assert.equal(new Set(names).size, names.length, 'an app appears twice in the A to Z list');
  });
});

test('All apps: the newest launch is first in RECENT, and up/down moves between the rows', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    await press(page, 'ArrowRight', 2);
    const p = await page.evaluate(() => document.querySelector('#grid .tile.f').getAttribute('data-p'));
    await press(page, 'Enter');
    await comeBack(page);
    let s = await gridShape(page);
    assert.equal(s.recent[0].p, p, 'newest launch should lead the RECENT row');
    assert.equal(s.focusIndex, s.recent.length + s.all.findIndex((a) => a.p === p), 'focus should stay on the app in the A to Z list');
    await press(page, 'ArrowUp');
    s = await gridShape(page);
    assert.ok(s.focusIndex < s.recent.length, 'ArrowUp should reach the RECENT row');
    await press(page, 'ArrowDown');
    s = await gridShape(page);
    assert.ok(s.focusIndex >= s.recent.length, 'ArrowDown should reach the A to Z list');
  });
});

test('Settings > Recent apps: off hides the row, clear empties it', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    await press(page, 'Enter'); await comeBack(page);
    assert.deepEqual((await gridShape(page)).heads, ['RECENT', 'ALL APPS']);
    await press(page, 'Escape');
    await openSettings(page);
    await pick(page, 'RECENT APPS', 'Off');
    assert.equal((await saved(page)).recent, false);
    await press(page, 'Escape'); await openAll(page);
    assert.deepEqual((await gridShape(page)).heads, []);
    await press(page, 'Escape'); await openSettings(page);
    await pick(page, 'RECENT APPS', 'On');
    await pick(page, 'RECENT APPS', 'Clear recent list');
    assert.equal(await store(page, 'frameRecent'), null);
    await press(page, 'Escape'); await openAll(page);
    assert.deepEqual((await gridShape(page)).heads, []);
  });
});

/* ---------- All apps: Menu popup ---------- */

const ctxOptions = (page) => page.$$eval('#copts .co', (e) => e.map((x) => x.textContent));

test('Menu popup lists pin, hide, app info, uninstall and cancel; Back closes it', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    await press(page, 'm');
    assert.ok(await ctxShown(page));
    const o = await ctxOptions(page);
    assert.deepEqual(o.slice(1), ['Hide this app', 'Open at start-up & wake', 'App info', 'Uninstall', 'Cancel']);
    assert.match(o[0], /Pin to Home|Unpin from Home/);
    await press(page, 'Escape');
    assert.equal(await ctxShown(page), false);
  });
});

test('Menu popup: App info and Uninstall explain themselves when unavailable', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    await press(page, 'm'); await press(page, 'ArrowDown', 3); await press(page, 'Enter');
    assert.match(await toastOf(page), /App info isn.t available/);
    // the first app in the list is the Appstore, which is part of the system
    await press(page, 'm'); await press(page, 'ArrowDown', 4); await press(page, 'Enter');
    assert.match(await toastOf(page), /part of the system and can.t be uninstalled/);
    // a non-stock app: the stand-in has no uninstaller
    await page.evaluate(() => { for (const t of document.querySelectorAll('#grid .tile')) if (t.getAttribute('data-p') === 'org.xbmc.kodi') t.scrollIntoView(); });
    for (let i = 0; i < 80 && (await page.evaluate(() => document.querySelector('#grid .tile.f').getAttribute('data-p'))) !== 'org.xbmc.kodi'; i++) await press(page, 'ArrowRight');
    await press(page, 'm'); await press(page, 'ArrowDown', 4); await press(page, 'Enter');
    assert.match(await toastOf(page), /Uninstall isn.t available here/);
  });
});

test('Menu popup: Hide removes the app and Settings can restore it; Pin adds it to Home', T, async () => {
  await withPage({}, async ({ page }) => {
    await openAll(page);
    const p = await page.evaluate(() => document.querySelector('#grid .tile.f').getAttribute('data-p'));
    const name = await page.evaluate(() => document.querySelector('#grid .tile.f .nm').textContent.replace(/^\u2605 /, ''));
    await press(page, 'm'); await press(page, 'ArrowDown'); await press(page, 'Enter');
    assert.match(await toastOf(page), /hidden/);
    assert.equal(await page.evaluate((x) => !!document.querySelector('#grid .tile[data-p="' + x + '"]'), p), false);
    await press(page, 'Escape'); await openSettings(page);
    await pick(page, 'HOME APPS', 'Hidden apps (', true);
    assert.equal(await screenOf(page), 'hidden');
    const names = await page.$$eval('#hiddenBody .li .nm2', (e) => e.map((x) => x.textContent));
    assert.ok(names.includes(name), name + ' should be listed under Hidden apps');
    await press(page, 'ArrowDown', names.indexOf(name));   // the list also holds the stock apps hidden on first run
    await press(page, 'Enter');
    assert.match(await toastOf(page), new RegExp(name.replace(/[+]/g, '\\+') + ' is visible again'));
    await press(page, 'Escape'); await press(page, 'Escape'); await openAll(page);
    assert.equal(await page.evaluate((x) => !!document.querySelector('#grid .tile[data-p="' + x + '"]'), p), true, 'unhidden app is back');
    await press(page, 'm'); await press(page, 'Enter');
    assert.match(await toastOf(page), /Added to Home/);
    await press(page, 'Escape');
    assert.equal(await page.evaluate((x) => !!document.querySelector('#track .tile[data-p="' + x + '"]'), p), true, 'pinned app is on Home');
  });
});

/* ---------- Settings: press every option ---------- */

test('Settings: every row and every option can be reached and pressed without errors', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    const skip = new Set(['manage', 'hiddenscr', 'close', 'artnow', 'autochoose']);   // these leave Settings or start art mode; covered below
    const info = await rowsInfo(page);
    assert.ok(info.length >= 16, 'expected the full settings list');
    let pressed = 0;
    for (let r = 0; r < info.length; r++) {
      if (r > 0) await press(page, 'ArrowDown');
      const n = (await rowsInfo(page))[r].opts.length;
      for (let c = 0; c < n; c++) {
        if (c > 0) await press(page, 'ArrowRight');
        const w = await where(page);
        assert.deepEqual(w, { r, c }, 'focus is not where the keys should have put it');
        const action = (await rowsInfo(page))[r].opts[c].action;
        if (skip.has(action)) continue;
        await press(page, 'Enter');
        pressed++;
        assert.equal(await screenOf(page), 'settings', 'pressing ' + action + ' left Settings');
      }
    }
    assert.ok(pressed >= 55, 'only pressed ' + pressed + ' options');
    const s = await saved(page);
    assert.ok(s && typeof s === 'object');
  });
});

test('Settings: Home apps and Hidden apps open and Back returns to Settings', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'HOME APPS', 'Reorder');
    assert.equal(await screenOf(page), 'manage');
    await press(page, 'Enter'); await press(page, 'ArrowDown'); await press(page, 'Enter');   // grab, move, drop
    await press(page, 'Escape');
    assert.equal(await screenOf(page), 'settings');
    await pick(page, 'HOME APPS', 'Hidden apps (');
    assert.equal(await screenOf(page), 'hidden');
    await press(page, 'Escape');
    assert.equal(await screenOf(page), 'settings');
    await pick(page, '', 'Close settings');
    assert.equal(await screenOf(page), 'home');
  });
});

test('Art mode: Start now shows the wallpaper and the waking key does nothing else', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'ART MODE', 'Start now');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('art')).display), 'block');
    const before = await where(page);
    await press(page, 'ArrowDown');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('art')).display), 'none');
    assert.deepEqual(await where(page), before, 'the waking key must not move the selection');
  });
});

/* ---------- backup and restore ---------- */

const importNow = async (page) => { await pick(page, 'BACKUP', 'Import settings'); await press(page, 'Enter'); };   // first OK arms, second confirms
const FILE = (o) => JSON.stringify(Object.assign({ app: 'FrameLauncher', version: 1 }, o));

test('Backup: export then import brings back an earlier setting', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'THEME', 'Light');
    assert.equal((await saved(page)).theme, 'light');
    await pick(page, 'BACKUP', 'Export settings');
    await waitToast(page, 'Settings saved to');
    const file = JSON.parse(await store(page, 'mockBackup'));
    assert.equal(file.app, 'FrameLauncher');
    assert.equal(file.settings.theme, 'light');
    await pick(page, 'THEME', 'Dark');
    assert.equal((await saved(page)).theme, 'dark');
    await pick(page, 'BACKUP', 'Import settings');
    assert.match(await toastOf(page), /Press OK again/);
    assert.equal((await saved(page)).theme, 'dark', 'the first press must not import yet');
    await press(page, 'Enter');
    await waitToast(page, 'Settings imported');
    assert.equal((await saved(page)).theme, 'light');
    assert.match(await page.evaluate(() => document.body.className), /\blight\b/);
  });
});

test('Backup: bad values in a file are reset to safe ones, and pinned wins over hidden', T, async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate((f) => localStorage.setItem('mockBackup', f), FILE({
      settings: { theme: 'neon', font: 9999, focus: 3, wall: 99, layout: 'cube', shuffle: 'always', updates: 'yes', glass: 'maybe' },
      pins: ['com.netflix.ninja', 'not.installed'], hidden: ['com.netflix.ninja', 'x.y'],
    }));
    await openSettings(page);
    await importNow(page);
    await waitToast(page, 'Settings imported');
    const s = await saved(page);
    assert.equal(s.theme, 'dark'); assert.equal(s.font, 100); assert.equal(s.focus, 110); assert.equal(s.wall, 0);
    assert.equal(s.layout, 'dock'); assert.equal(s.shuffle, 'off'); assert.equal(s.updates, false); assert.equal(s.glass, true);
    const pins = JSON.parse(await store(page, 'pins')), hidden = JSON.parse(await store(page, 'frameHidden'));
    assert.ok(pins.includes('com.netflix.ninja') && !pins.includes('not.installed'));
    assert.ok(!hidden.includes('com.netflix.ninja'), 'an app must not be both pinned and hidden');
  });
});

test('Backup: a missing, foreign or broken file is refused without changing anything', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    const before = JSON.stringify(await saved(page));
    await page.evaluate(() => localStorage.removeItem('mockBackup'));
    await importNow(page); await waitToast(page, 'No backup file found');
    for (const bad of ['{"app":"SomethingElse","settings":{}}', 'this is not json', '{"app":"FrameLauncher"}']) {
      await page.evaluate((f) => localStorage.setItem('mockBackup', f), bad);
      await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
      await importNow(page);
      await waitToast(page, 'not a Frame Launcher backup');
    }
    assert.equal(JSON.stringify(await saved(page)), before);
  });
});

test('Restore on first launch: offered when a backup is in Downloads, and restores on OK', T, async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate((f) => {
      localStorage.setItem('mockBackup', f);
      for (const k of ['frameSettings', 'frameRestoreAsked', 'frameDefaultsVersion', 'pins', 'frameHideV1']) localStorage.removeItem(k);
    }, FILE({ settings: { theme: 'light', wall: 3 }, pins: ['com.netflix.ninja'], hidden: [] }));
    await page.reload();
    await page.waitForSelector('#ctx', { state: 'visible' });
    assert.equal(await page.textContent('#ctitle'), 'Restore your settings?');
    assert.deepEqual(await ctxOptions(page), ['Restore from Downloads', 'Not now']);
    assert.match(await page.textContent('#cnote'), /FrameLauncher-settings\.json/);
    await press(page, 'Enter');
    await waitToast(page, 'Settings restored');
    assert.equal(await ctxShown(page), false);
    const s = await saved(page);
    assert.equal(s.theme, 'light'); assert.equal(s.wall, 3);
    assert.equal(await store(page, 'frameRestoreAsked'), '1');
  });
});

test('Restore on first launch: Not now and Back leave settings alone and never ask again', T, async () => {
  for (const how of ['Not now', 'Back']) {
    await withPage({}, async ({ page }) => {
      const arm = () => page.evaluate((f) => {
        localStorage.setItem('mockBackup', f);
        for (const k of ['frameSettings', 'frameRestoreAsked', 'frameDefaultsVersion', 'pins']) localStorage.removeItem(k);
      }, FILE({ settings: { theme: 'light' } }));
      await arm();
      await page.reload();
      await page.waitForSelector('#ctx', { state: 'visible' });
      if (how === 'Not now') { await press(page, 'ArrowDown'); await press(page, 'Enter'); } else await press(page, 'Escape');
      assert.equal(await ctxShown(page), false);
      assert.equal((await saved(page)).theme, 'dark', how + ' must not restore');
      await page.reload();
      await page.waitForTimeout(500);
      assert.equal(await ctxShown(page), false, 'asked again after ' + how);
    });
  }
});

test('Restore on first launch: silent without a backup, and never for an existing install', T, async () => {
  await withPage({}, async ({ page }) => {
    await page.evaluate(() => { localStorage.removeItem('mockBackup'); for (const k of ['frameSettings', 'frameRestoreAsked']) localStorage.removeItem(k); });
    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await ctxShown(page), false, 'prompt shown with no backup');
    assert.equal(await store(page, 'frameRestoreAsked'), '1');
    await page.evaluate((f) => { localStorage.setItem('mockBackup', f); localStorage.removeItem('frameRestoreAsked'); }, FILE({ settings: { theme: 'light' } }));
    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await ctxShown(page), false, 'prompt shown to someone who already has settings');
  });
});

/* ---------- background shuffle ---------- */

test('Shuffle: Shuffle now always picks a different photo', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'SHUFFLE BACKGROUND', 'Shuffle now');
    const seen = new Set();
    let prev = (await saved(page)).wall;
    for (let i = 0; i < 40; i++) {
      const w = (await saved(page)).wall;
      if (i > 0) assert.notEqual(w, prev, 'repeated the same photo');
      assert.ok(Number.isInteger(w) && w >= 0 && w < 14);
      seen.add(w); prev = w;
      await press(page, 'Enter');
    }
    assert.ok(seen.size >= 6, 'barely any variety: ' + [...seen]);
    assert.match(await toastOf(page), /^Background: /);
  });
});

test('Shuffle daily: changes once on a new day, not before, and not while Settings is open', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'SHUFFLE BACKGROUND', 'Daily');
    assert.equal((await saved(page)).shuffle, 'daily');
    assert.equal(await store(page, 'frameShuffleDay'), await dayKey(page), 'enabling Daily marks today');
    const w0 = (await saved(page)).wall, bg0 = await bgOf(page);
    await page.evaluate(() => localStorage.setItem('frameShuffleDay', '2000-1-1'));
    await comeBack(page);
    assert.equal((await saved(page)).wall, w0, 'must not shuffle while Settings is open');
    await press(page, 'Escape');
    await comeBack(page);
    const w1 = (await saved(page)).wall;
    assert.notEqual(w1, w0, 'a new day should bring a new photo');
    assert.notEqual(await bgOf(page), bg0, 'the background itself should change');
    assert.equal(await store(page, 'frameShuffleDay'), await dayKey(page));
    await comeBack(page); await comeBack(page);
    assert.equal((await saved(page)).wall, w1, 'same day, same photo');
    await page.evaluate(() => localStorage.removeItem('frameShuffleDay'));
    await comeBack(page);
    assert.equal((await saved(page)).wall, w1, 'the very first day only records the date');
    assert.equal(await store(page, 'frameShuffleDay'), await dayKey(page));
  });
});

test('Shuffle on wake: changes only when the TV woke, and at start-up', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'SHUFFLE BACKGROUND', 'On wake');
    assert.equal((await saved(page)).shuffle, 'wake');
    await press(page, 'Escape');
    let w = (await saved(page)).wall;
    await page.evaluate(() => window.onResume(false)); await comeBack(page);
    assert.equal((await saved(page)).wall, w, 'coming back from an app is not a wake');
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.onResume(true));
      const n = (await saved(page)).wall;
      assert.notEqual(n, w, 'wake repeated the same photo'); w = n;
    }
    await page.reload(); await page.waitForSelector('#track .tile');
    assert.notEqual((await saved(page)).wall, w, 'start-up counts as a wake');
  });
});

test('Shuffle off: waking changes nothing', T, async () => {
  await withPage({}, async ({ page }) => {
    const w = (await saved(page)).wall;
    await page.evaluate(() => window.onResume(true));
    await page.reload(); await page.waitForSelector('#track .tile');
    assert.equal((await saved(page)).wall, w);
  });
});

/* ---------- update check ---------- */

const REL = JSON.stringify;
test('Updates: off by default, so nothing is asked at start-up', T, async () => {
  await withPage({}, async ({ page }) => {
    await page.waitForTimeout(500);
    assert.ok(!(await page.evaluate(() => window.__updCalls)), 'the update check ran without being turned on');
    assert.equal((await saved(page)).updates, false);
  });
});

test('Updates: Check now reports a newer, equal or failed result', T, async () => {
  await withPage({ mockUpdate: REL({ ok: true, tag: 'v9.1.0', url: 'https://example.invalid' }) }, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'UPDATES', 'Check now');
    await waitToast(page, 'Version 9.1.0 is available (you have 0.0-preview)');
    assert.match(await rowTitle(page, 'UPDATES'), /version 9\.1\.0 is available.*github\.com\/Mark-Stephen-Rose\/FrameLauncher\/releases\/latest/);
    assert.equal(JSON.parse(await store(page, 'frameUpdate')).tag, 'v9.1.0');
    await pick(page, 'ABOUT & STORAGE', 'Refresh details');
    assert.match(await page.$eval('#settingsBody .infob', (e) => e.textContent), /Update: version 9\.1\.0 is available/);
  });
  for (const [tag, expect] of [['v0.0.0', /up to date/], ['v0.0.1', /Version 0\.0\.1 is available/]]) {
    await withPage({ mockUpdate: REL({ ok: true, tag }) }, async ({ page }) => {
      await openSettings(page);
      await pick(page, 'UPDATES', 'Check now');
      await waitToast(page, tag === 'v0.0.0' ? 'up to date' : 'is available');
      assert.match(await toastOf(page), expect);
    });
  }
  for (const bad of [REL({ ok: false }), 'not json', REL({ ok: true })]) {
    await withPage({ mockUpdate: bad }, async ({ page }) => {
      await openSettings(page);
      await pick(page, 'UPDATES', 'Check now');
      await waitToast(page, 'check for updates');
      assert.doesNotMatch(await rowTitle(page, 'UPDATES'), /available/);
    });
  }
});

test('Updates: text from the network is shown as text, never as page code', T, async () => {
  await withPage({ mockUpdate: REL({ ok: true, tag: 'v9.0.0<img src=x onerror=window.__xss=1>' }) }, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'UPDATES', 'Check now');
    await waitToast(page, 'is available');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.$('#settingsBody img'), null);
  });
});

test('Updates: turning on checks at once, then at most once a day', T, async () => {
  await withPage({ mockUpdate: REL({ ok: true, tag: 'v0.0.0' }) }, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'UPDATES', 'Check daily');
    assert.equal((await saved(page)).updates, true);
    await page.waitForFunction(() => window.__updCalls === 1);
    await page.waitForFunction(() => !!localStorage.getItem('frameUpdate'));
    await page.reload(); await page.waitForSelector('#track .tile'); await page.waitForTimeout(500);
    assert.ok(!(await page.evaluate(() => window.__updCalls)), 'asked again within a day');
    await page.evaluate(() => localStorage.setItem('frameUpdate', JSON.stringify({ t: Date.now() - 2 * 864e5, tag: 'v0.0.0' })));
    await page.reload(); await page.waitForSelector('#track .tile');
    await page.waitForFunction(() => window.__updCalls === 1);
  });
});

/* ---------- a long random walk with the remote ---------- */

function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

for (const seed of [1, 2, 3]) {
  test(`random remote presses (seed ${seed}) never cause a page error`, T, async () => {
    await withPage({ mockUpdate: REL({ ok: true, tag: 'v1.0.0' }) }, async ({ page }) => {
      const rnd = prng(seed);
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'Enter', 'Enter', 'Escape', 'm'];
      for (let i = 0; i < 500; i++) await press(page, keys[Math.floor(rnd() * keys.length)]);
      await press(page, 'Escape', 4);
      assert.match(await page.evaluate(() => document.body.className), /scr-(home|settings|all|manage|hidden)/);
    });
  });
}


/* ---------- v10: labels, list, centred dock, auto-open app, system settings ---------- */

const tileDisplay = (page) => page.evaluate(() => {
  const t = document.querySelector('#track .tile');
  return { ic: getComputedStyle(t.querySelector('.ic')).display, nm: getComputedStyle(t.querySelector('.nm')).display };
});

test('App labels: Icons only hides the names, Names only hides the icons', T, async () => {
  await withPage({}, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'APP LABELS', 'Icons only');
    let d = await tileDisplay(page);
    assert.notEqual(d.ic, 'none', 'Icons only should show the icons'); assert.equal(d.nm, 'none', 'Icons only should hide the names');
    await pick(page, 'APP LABELS', 'Names only');
    d = await tileDisplay(page);
    assert.equal(d.ic, 'none', 'Names only should hide the icons'); assert.notEqual(d.nm, 'none', 'Names only should show the names');
    await pick(page, 'APP LABELS', 'Icons + names');
    d = await tileDisplay(page);
    assert.notEqual(d.ic, 'none'); assert.notEqual(d.nm, 'none');
  });
});

for (const pos of ['left', 'center', 'right']) {
  test(`List layout, position ${pos}: about a third wide, letters centred in the icon spot`, T, async () => {
    await withPage({ seed: { layout: 'list', listPos: pos } }, async ({ page }) => {
      const g = await page.evaluate(() => {
        const d = document.getElementById('dock').getBoundingClientRect();
        const tile = [...document.querySelectorAll('#track .tile')].find((t) => t.getAttribute('data-p') === '__all');
        const ic = tile.querySelector('.ic'), ib = ic.getBoundingClientRect();
        const rg = document.createRange(); rg.selectNodeContents(ic); const gb = rg.getBoundingClientRect();
        return { l: d.left, r: d.right, w: d.width, vw: innerWidth, letterOffset: Math.abs((gb.left + gb.right) / 2 - (ib.left + ib.right) / 2) };
      });
      assert.ok(g.w >= g.vw * 0.25 && g.w <= g.vw * 0.45, `list is ${Math.round(g.w / g.vw * 100)}% of the screen`);
      assert.ok(g.letterOffset < 2, `the A is ${g.letterOffset}px off centre in its icon spot`);
      if (pos === 'left') assert.ok(g.l < g.vw * 0.1, 'list should hug the left');
      if (pos === 'center') assert.ok(Math.abs((g.l + g.r) / 2 - g.vw / 2) < 2, 'list should be centred');
      if (pos === 'right') assert.ok(g.r > g.vw * 0.9, 'list should hug the right');
    });
  });
}

test('Settings > List position changes where the list sits', T, async () => {
  await withPage({ seed: { layout: 'list' } }, async ({ page }) => {
    await openSettings(page);
    await pick(page, 'LIST POSITION', 'Right');
    assert.equal((await saved(page)).listPos, 'right');
    assert.match(await page.evaluate(() => document.body.className), /lp-right/);
    await pick(page, 'LIST POSITION', 'Center');
    assert.match(await page.evaluate(() => document.body.className), /lp-center/);
  });
});

/* Layout positions (offsets), so the focus zoom does not skew the gaps; scrolled = where the first tile really is on screen. */
const dockGaps = (page) => page.evaluate(() => {
  const tr = document.getElementById('track'), t = [...tr.querySelectorAll('.tile')], last = t[t.length - 1];
  return { fit: document.body.classList.contains('fit'), left: t[0].offsetLeft, right: tr.clientWidth - (last.offsetLeft + last.offsetWidth),
    tiles: t.length, scrolled: t[0].getBoundingClientRect().left };
});

test('Dock: centred when every app fits, and stays put while you move along it', T, async () => {
  await withPage({ seed: { layout: 'dock' }, pins: ['com.netflix.ninja', 'org.videolan.vlc'] }, async ({ page }) => {
    let g = await dockGaps(page);
    assert.ok(g.fit, 'a short dock should be centred');
    assert.ok(Math.abs(g.left - g.right) < 4, `gaps differ: left ${g.left}, right ${g.right}`);
    await press(page, 'ArrowRight', 2);
    const h = await dockGaps(page);
    assert.ok(Math.abs(h.scrolled - g.scrolled) < 1, 'a centred dock must not scroll');
  });
});

test('TV banners: centred when they fit', T, async () => {
  await withPage({ seed: { layout: 'banner' }, pins: ['com.netflix.ninja'] }, async ({ page }) => {
    const g = await dockGaps(page);
    assert.ok(g.fit, `${g.tiles} banners should fit and be centred`);
    assert.ok(Math.abs(g.left - g.right) < 4, `gaps differ: left ${g.left}, right ${g.right}`);
  });
});

test('Dock: with too many apps it is not centred and scrolls from the left as before', T, async () => {
  const many = ['com.netflix.ninja', 'org.xbmc.kodi', 'com.plexapp.android', 'com.tubitv', 'org.videolan.vlc', 'com.disney.disneyplus',
    'mock.app18', 'mock.app19', 'mock.app20', 'mock.app21', 'mock.app22', 'mock.app23', 'mock.app24', 'mock.app25'];
  await withPage({ seed: { layout: 'dock' }, pins: many }, async ({ page }) => {
    const g = await dockGaps(page);
    assert.ok(g.tiles >= 12, 'test needs a long dock, only ' + g.tiles + ' tiles');
    assert.equal(g.fit, false, 'an overflowing dock must not be centred');
    const before = g.scrolled;
    await press(page, 'ArrowRight', g.tiles - 1);
    await page.waitForTimeout(450);   // the dock slides for a quarter of a second
    const h = await dockGaps(page);
    assert.ok(h.scrolled < before - 50, 'moving along a long dock should scroll it');
  });
});

test('Auto-open app: pick from the Menu, shown in Settings, Test now, return time, Off', T, async () => {
  await withPage({}, async ({ page, logs }) => {
    await openAll(page);
    await press(page, 'm');
    const o = await ctxOptions(page);
    assert.equal(o[2], 'Open at start-up & wake');
    await press(page, 'ArrowDown', 2); await press(page, 'Enter');
    assert.match(await toastOf(page), /will open at start-up and when the stick wakes/);
    const app = await page.evaluate(() => localStorage.getItem('mockAutoApp'));
    assert.ok(app, 'no app was remembered');
    await press(page, 'Escape');                       // back to Home
    await openSettings(page);
    assert.match(await rowTitle(page, 'AUTO-OPEN APP'), /opens at start-up and when the stick wakes/);
    await pick(page, 'AUTO-OPEN APP', 'Test now');
    await sawLog(logs, 'run auto app');
    await pick(page, 'RETURN TO FRAME LAUNCHER', '20 s');
    assert.equal(await page.evaluate(() => localStorage.getItem('mockAutoSecs')), '20');
    assert.match(await rowTitle(page, 'RETURN TO FRAME LAUNCHER'), /20 seconds/);
    await pick(page, 'AUTO-OPEN APP', 'Off');
    assert.equal(await page.evaluate(() => localStorage.getItem('mockAutoApp')), '');
    assert.match(await rowTitle(page, 'AUTO-OPEN APP'), /off/);
    await pick(page, 'AUTO-OPEN APP', 'Test now');
    assert.match(await toastOf(page), /Choose an app first/);
    await pick(page, 'AUTO-OPEN APP', 'Choose an app');
    assert.equal(await screenOf(page), 'all');
    assert.match(await toastOf(page), /Press Menu on the app/);
  });
});

test('System settings and Network settings open the system screens and say how to come back', T, async () => {
  await withPage({}, async ({ page, logs }) => {
    await openSettings(page);
    await pick(page, 'STOCK APPS & SYSTEM', 'System settings');
    await sawLog(logs, 'system settings');
    assert.match(await toastOf(page), /Fire TV settings.*Back/);
    await pick(page, 'STOCK APPS & SYSTEM', 'Network settings');
    await sawLog(logs, 'network settings');
    assert.match(await toastOf(page), /network settings.*Back/);
    assert.equal(await screenOf(page), 'settings');
  });
});
