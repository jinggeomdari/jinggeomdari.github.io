// build.mjs가 만든 웹판(dist/site/units/)의 단원 파일을 Chrome으로 열어 스크립트 오류가 있는지 본다.
//   실행: node check.mjs   (build.mjs 다음에. Chrome이 없으면 건너뜀)
// 오류가 있어도 배포는 막지 않고 "확인할 것"으로 알려 주기만 한다. (단원 파일 담당자가 고칠 일)
// 각 단원을 열고 퀴즈·게임 탭을 한 번씩 눌러 본다. 게임 진행 중에만 나는 오류는 잡지 못한다.
import { readFileSync, appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(here, 'dist', 'site');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROMES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const chrome = CHROMES.find((p) => p && existsSync(p));
if (!chrome) { console.log('브라우저 검사: Chrome을 찾지 못해 건너뜀'); process.exit(0); }
if (!existsSync(path.join(SITE_DIR, 'index.html'))) { console.error('dist/site가 없음 — build.mjs를 먼저 실행'); process.exit(1); }

const data = JSON.parse(/<script id="unit-data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(path.join(SITE_DIR, 'index.html'), 'utf8'))[1]);

// Chrome을 화면 없이 띄우고 DevTools 프로토콜로 조종한다
const profile = mkdtempSync(path.join(tmpdir(), 'jg-check-'));
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  try { port = readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {}
}
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0, problems = [], onLoad = null;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); return; }
  if (m.method === 'Page.loadEventFired') onLoad?.();
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push(`스크립트 오류 ${d.lineNumber + 1}행: ${(d.exception?.description || d.text).split('\n')[0]}`);
  }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    problems.push(`콘솔 ${m.params.type === 'error' ? '오류' : '경고'}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable');
await send('Runtime.enable');

const report = [];
for (const u of data.units) {
  problems = [];
  const loaded = new Promise((r) => { onLoad = r; setTimeout(r, 15000); });
  await send('Page.navigate', { url: pathToFileURL(path.join(SITE_DIR, u.src)).href });
  await loaded;
  await sleep(800);
  for (const tab of ['tab-quiz', 'tab-game', 'tab-study']) {
    await send('Runtime.evaluate', { expression: `document.getElementById('${tab}')?.click()` });
    await sleep(300);
  }
  // 같은 경고가 여러 번 나오면 하나로 묶는다 (예: 빈칸을 찾을 수 없음 q71, q72 …)
  const grouped = {};
  problems.forEach((p) => { const key = p.replace(/[:\s]+\S+$/, ''); (grouped[key] ||= []).push(p); });
  const lines = Object.entries(grouped).map(([k, v]) => v.length > 1 ? `${k}: ${v.map((p) => p.slice(k.length).replace(/^[:\s]+/, '')).join(', ')}` : v[0]);
  console.log(`${u.no}단원 ${lines.length ? '⚠ ' + lines.length + '건' : '✓'}`);
  lines.forEach((l) => console.log('    ' + l));
  if (process.env.GITHUB_ACTIONS) lines.forEach((l) => console.log(`::warning title=브라우저 검사::${u.no}단원 ${l.replace(/%/g, '%25')}`));
  report.push({ no: u.no, lines });
}
ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['## 브라우저 검사', '', '각 단원을 열고 퀴즈·게임 탭을 눌러 본 결과입니다. 오류가 있어도 배포는 됩니다 — 해당 단원 담당자가 확인해 주세요.', ''];
  report.forEach((r) => {
    md.push(`- **${r.no}단원** ${r.lines.length ? '⚠' : '✓ 오류 없음'}`);
    r.lines.forEach((l) => md.push(`  - ${l.replace(/[<>|]/g, (c) => '\\' + c)}`));
  });
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}
