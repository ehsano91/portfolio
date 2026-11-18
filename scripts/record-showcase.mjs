// Records the fplwire showcase for the portfolio: one desktop clip (blog, then
// the app's example team) and one iPhone clip (the app's example team).
// Dark theme, never signs in. League names are hidden on the desktop sidebar.
//
//   node scripts/record-showcase.mjs [desktop|phone]   (default: both)
//
// Needs Google Chrome, ffmpeg (brew) and the Playwright that fpl-assistant
// already installs. Frames come from CDP Page.startScreencast at 2x, because
// Playwright's own recordVideo is 1x only. Output: fplwire/videos/showcase-*.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire('/Users/ehsanfazlhashemi/fpl-assistant/fpl-help-main/package.json');
const { chromium } = require('playwright');

const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../fplwire/videos');
const which = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A visible pointer (desktop) or tap dot (phone), drawn in the page so it ends up in the frames.
const POINTER = (touch) => `(() => {
  const add = () => {
    if (document.getElementById('__ptr')) return;
    const d = document.createElement('div'); d.id = '__ptr';
    d.style.cssText = ${JSON.stringify(
      'position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;'
    )} + (${touch}
      ? 'width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,255,255,.45);border:2px solid rgba(255,255,255,.85);opacity:0;transition:opacity .25s'
      : 'width:20px;height:20px;background:no-repeat url("data:image/svg+xml,' +
        encodeURIComponent('<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'20\\' height=\\'20\\'><path d=\\'M2 1l14 9-6 1.2 3.6 6.6-2.4 1.3-3.6-6.6L3 17z\\' fill=\\'white\\' stroke=\\'black\\' stroke-width=\\'1.2\\'/></svg>') + '")');
    document.documentElement.appendChild(d);
  };
  document.addEventListener('DOMContentLoaded', add); add();
  addEventListener('mousemove', (e) => { const d = document.getElementById('__ptr'); if (d) { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; } }, true);
  if (${touch}) {
    addEventListener('pointerdown', (e) => { const d = document.getElementById('__ptr'); if (d) { d.style.left = e.clientX + 'px'; d.style.top = e.clientY + 'px'; d.style.opacity = 1; } }, true);
    addEventListener('pointerup', () => { const d = document.getElementById('__ptr'); if (d) setTimeout(() => d.style.opacity = 0, 250); }, true);
  }
})();`;

// Hides the "Leagues" block in the desktop sidebar (other people's league names).
const HIDE_LEAGUES = `(() => {
  const hide = () => {
    // Sidebar: <section> "My rankings" > heading "Leagues" + <ul> of league buttons.
    for (const sec of document.querySelectorAll('section')) {
      if (!/^My rankings/.test(sec.textContent)) continue;
      for (const ul of sec.querySelectorAll('ul')) {
        ul.style.visibility = 'hidden';
        const h = ul.previousElementSibling;
        if (h) h.style.visibility = 'hidden';
      }
    }
  };
  new MutationObserver(hide).observe(document, { childList: true, subtree: true }); hide();
})();`;

async function smoothScroll(page, dy, ms) {
  await page.evaluate(([dy, ms]) => new Promise((done) => {
    const start = scrollY, t0 = performance.now();
    const ease = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const step = (now) => { const t = Math.min(1, (now - t0) / ms); scrollTo(0, start + dy * ease(t)); t < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), [dy, ms]);
}

// Moves the pointer smoothly to an element, then clicks it.
async function glideClick(page, locator, { touch = false } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (touch) { await page.mouse.move(x, y); await page.mouse.down(); await wait(120); await page.mouse.up(); return; }
  await page.mouse.move(x, y, { steps: 28 });
  await wait(250);
  await page.mouse.down(); await wait(80); await page.mouse.up();
}

async function record(name, { width, height, touch }, script) {
  // The screencast captures the whole window, so the window must match the viewport.
  const browser = await chromium.launch({ channel: 'chrome', args: [`--window-size=${width},${height}`, '--force-device-scale-factor=2'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'dark', hasTouch: false });
  await ctx.addInitScript(POINTER(touch));
  if (!touch) await ctx.addInitScript(HIDE_LEAGUES);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  let recording = false, offset = 0, pausedAt = 0;
  // pause()/resume() cut a stretch (a loading spinner) out of the clip.
  const ctl = {
    start: () => { recording = true; },
    pause: () => { recording = false; pausedAt = Date.now() / 1000; },
    resume: () => { offset += Date.now() / 1000 - pausedAt; recording = true; },
  };
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    if (recording) frames.push({ data, t: metadata.timestamp - offset });
    try { await cdp.send('Page.screencastFrameAck', { sessionId }); } catch {}
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width * 2, maxHeight: height * 2, everyNthFrame: 1 });
  await script(page, ctl);
  await wait(600);
  recording = false;
  await cdp.send('Page.stopScreencast');
  await browser.close();

  // Screencast only sends a frame when something changes, so hold each frame until the next one.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `showcase-${name}-`));
  let list = 'ffconcat version 1.0\n';
  frames.forEach((f, i) => {
    const file = path.join(dir, `f${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    const dur = i < frames.length - 1 ? frames[i + 1].t - f.t : 0.6;
    list += `file '${file}'\nduration ${Math.max(dur, 0.001).toFixed(4)}\n`;
  });
  list += `file '${path.join(dir, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'\n`;
  const listFile = path.join(dir, 'list.txt');
  fs.writeFileSync(listFile, list);

  const outW = touch ? 400 : 1280, outH = touch ? 866 : 764;
  const vf = `scale=${outW}:${outH}:flags=lanczos,fps=30,setsar=1,format=yuv420p`;
  const base = path.join(OUT, `showcase-${name}`);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', touch ? '28' : '30', '-profile:v', 'high', '-movflags', '+faststart', '-an', `${base}.mp4`]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', `${base}.mp4`, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-an', `${base}.webm`]);
  const secs = (frames.at(-1).t - frames[0].t).toFixed(1);
  console.log(`${name}: ${frames.length} frames, ${secs} s ->`, ['mp4', 'webm'].map((e) => `${e} ${(fs.statSync(`${base}.${e}`).size / 1e6).toFixed(2)} MB`).join(', '));
  fs.rmSync(dir, { recursive: true, force: true });
}

const desktop = async (page, ctl) => {
  await page.goto('https://www.fplwire.com/', { waitUntil: 'networkidle' });
  await page.mouse.move(900, 300);
  await wait(800);
  ctl.start();
  await wait(1800);
  await smoothScroll(page, 520, 2600);
  await wait(1200);
  await smoothScroll(page, -520, 1400);
  await wait(400);
  await glideClick(page, page.getByRole('link', { name: 'Open the app' }).first()).catch(() => {});
  // The button may open a new tab; keep the recording in this one.
  await page.goto('https://app.fplwire.com/', { waitUntil: 'networkidle' });
  await wait(1800);
  await glideClick(page, page.getByText('Look around', { exact: false }).first());
  await wait(150);
  ctl.pause();
  await page.waitForURL(/example=1/);
  await page.waitForLoadState('networkidle');
  await page.getByText('Why this?').first().waitFor();
  await wait(400);
  ctl.resume();
  // The screencast only sends a frame when the page changes: nudge the pointer
  // so the loaded team replaces the last frame from before the cut.
  await page.mouse.move(700, 420, { steps: 4 });
  await wait(2200);
  await glideClick(page, page.getByText('Why this?').first());
  await wait(3200);
  await glideClick(page, page.getByRole('button', { name: 'Recs' }).or(page.getByRole('link', { name: 'Recs' })).or(page.getByRole('tab', { name: 'Recs' })).first());
  await wait(2000);
  await smoothScroll(page, 360, 2200);
  await wait(1500);
  await glideClick(page, page.getByText('Transfers', { exact: true }).first());
  await wait(1500);
  const search = page.getByPlaceholder('Search players or teams...');
  await glideClick(page, search);
  await search.pressSequentially('Arsenal', { delay: 170 });
  await wait(2600);
  await glideClick(page, page.getByText('Briefing', { exact: true }).first());
  await wait(2000);
  await smoothScroll(page, 420, 2800);
  await wait(1800);
};

const phone = async (page, ctl) => {
  await page.goto('https://app.fplwire.com/?example=1', { waitUntil: 'networkidle' });
  await wait(1200);
  ctl.start();
  await wait(2000);
  await smoothScroll(page, 300, 2000);
  await wait(900);
  await smoothScroll(page, -300, 1400);
  await wait(500);
  const tab = (n) => page.getByRole('button', { name: n, exact: true }).or(page.getByRole('link', { name: n, exact: true })).or(page.getByRole('tab', { name: n, exact: true })).last();
  await glideClick(page, tab('Recs'), { touch: true });
  await wait(2200);
  await smoothScroll(page, 260, 1800);
  await wait(900);
  await glideClick(page, page.getByText('See it on your pitch').first(), { touch: true });
  await wait(3000);
  await glideClick(page, tab('More'), { touch: true });
  await wait(1200);
  await glideClick(page, page.getByText('Briefing', { exact: true }).last(), { touch: true });
  await wait(2000);
  await smoothScroll(page, 380, 2600);
  await wait(1800);
};

if (!which || which === 'desktop') await record('desktop', { width: 1280, height: 764, touch: false }, desktop);
if (!which || which === 'phone') await record('phone', { width: 390, height: 844, touch: true }, phone);
