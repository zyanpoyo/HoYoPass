import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const iconsDir = path.resolve('icons');

function findBrowserPath() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWin) {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
  } else if (isMac) {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    const candidates = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
    for (const c of candidates) {
      try {
        const res = spawnSync('which', [c]);
        if (res.status === 0) return c;
      } catch (e) {}
    }
  }
  return null;
}

async function convertSvgToPngWithBrowser(browserPath, sizes) {
  const tmpDir = path.join(os.tmpdir(), `browser_icon_gen_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const port = 9224;
  const browserProcess = spawn(browserPath, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    `--user-data-dir=${tmpDir}`,
    'about:blank'
  ]);

  try {
    let wsUrl = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const list = await res.json();
          const page = list.find(item => item.type === 'page');
          if (page && page.webSocketDebuggerUrl) {
            wsUrl = page.webSocketDebuggerUrl;
            break;
          }
        }
      } catch (e) {}
    }

    if (!wsUrl) {
      throw new Error('Failed to connect to browser CDP');
    }

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    let msgId = 1;
    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        const handler = (evt) => {
          const res = JSON.parse(evt.data);
          if (res.id === id) {
            ws.removeEventListener('message', handler);
            if (res.error) reject(new Error(res.error.message));
            else resolve(res.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    for (const size of sizes) {
      let svgPath = path.join(iconsDir, `icon${size}.svg`);
      if (!fs.existsSync(svgPath)) {
        svgPath = path.join(iconsDir, 'icon128.svg');
      }
      if (!fs.existsSync(svgPath)) {
        console.warn(`[WARN] SVG source not found for size ${size}: ${svgPath}`);
        continue;
      }

      const svgContent = fs.readFileSync(svgPath, 'utf-8');
      const code = `
        (async () => {
          const svgStr = ${JSON.stringify(svgContent)};
          const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });
          const canvas = document.createElement('canvas');
          canvas.width = ${size};
          canvas.height = ${size};
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, ${size}, ${size});
          URL.revokeObjectURL(url);
          return canvas.toDataURL('image/png');
        })()
      `;

      const result = await sendCommand('Runtime.evaluate', {
        expression: code,
        awaitPromise: true,
        returnByValue: true
      });

      const dataUrl = result.result.value;
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      const pngBuffer = Buffer.from(base64Data, 'base64');
      const outPath = path.join(iconsDir, `icon${size}.png`);
      fs.writeFileSync(outPath, pngBuffer);
      console.log(`[SUCCESS] Generated ${outPath} (${size}x${size}, ${pngBuffer.length} bytes)`);
    }

    ws.close();
  } finally {
    browserProcess.kill();
    setTimeout(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {}
    }, 1000);
  }
}

async function main() {
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  const sizes = [16, 48, 128];
  const browserPath = findBrowserPath();

  if (browserPath) {
    console.log(`Using browser for SVG rendering: ${browserPath}`);
    await convertSvgToPngWithBrowser(browserPath, sizes);
  } else {
    console.warn('[WARN] Headless browser not found. Keeping existing PNG files if present.');
    for (const size of sizes) {
      const outPath = path.join(iconsDir, `icon${size}.png`);
      if (fs.existsSync(outPath)) {
        console.log(`[INFO] Existing icon found: ${outPath}`);
      } else {
        console.error(`[ERROR] Missing icon: ${outPath}`);
      }
    }
  }
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
