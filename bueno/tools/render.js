// Renders the scene in headless Chromium.
//   node tools/render.js stills 0.5 12.9 ...      -> out/stills/t_<time>.png
//   node tools/render.js video [from] [to]         -> out/video.mp4 (no audio)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out');
const FPS = 30;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.webp': 'image/webp' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function openPage(port) {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exit(2); });
  await page.goto(`http://127.0.0.1:${port}/src/index.html`);
  await page.waitForFunction(() => window.__ready === true || window.__initError, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__initError);
  if (err) throw new Error(err);
  return { browser, page };
}

const shot = (page) => page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920 } });

(async () => {
  const [mode, ...rest] = process.argv.slice(2);
  const server = await serve();
  const { browser, page } = await openPage(server.address().port);
  const T = await page.evaluate(() => window.TIMELINE);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(await page.evaluate(() => window.EVENTS), null, 1));
  try {
    if (mode === 'stills') {
      fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true });
      for (const s of rest) {
        const t = parseFloat(s);
        await page.evaluate((tt) => window.renderAt(tt), t);
        const file = path.join(OUT, 'stills', `t_${t.toFixed(2)}.png`);
        fs.writeFileSync(file, await shot(page));
        console.log('wrote', file);
      }
    } else if (mode === 'video') {
      const from = rest[0] !== undefined ? parseFloat(rest[0]) : 0;
      const to = rest[1] !== undefined ? parseFloat(rest[1]) : T.end;
      const outFile = rest[2] || path.join(OUT, 'video.mp4');
      fs.mkdirSync(OUT, { recursive: true });
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: ['pipe', 'inherit', 'inherit'] });
      const f0 = Math.round(from * FPS), f1 = Math.round(to * FPS);
      const t0 = Date.now();
      for (let f = f0; f < f1; f++) {
        await page.evaluate((tt) => window.renderAt(tt), f / FPS);
        const buf = await shot(page);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        if ((f - f0) % 60 === 0) {
          const el = (Date.now() - t0) / 1000, done = f - f0 + 1;
          console.log(`frame ${f}/${f1}  ${(el / done).toFixed(3)} s/frame  eta ${((f1 - f) * el / done).toFixed(0)} s`);
        }
      }
      ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
      console.log('wrote', outFile);
    }
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
