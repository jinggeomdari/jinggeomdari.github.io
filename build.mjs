// 징검다리 단원 파일들을 모아 통합본을 만든다.
//   실행: node build.mjs [단원 폴더]   (단원 폴더를 안 적으면 units)
//   결과: dist/징검다리_통합_개념확인.html   한 파일판 (카톡·USB로 나눠 주기, 오프라인)
//         dist/site/                        웹 배포판 (index.html + units/ + 한 파일판 내려받기)
// 단원 파일은 고치지 않고 그대로 넣는다. 표지 카드의 색·차례·빈칸 수도 단원 파일에서 읽어 오므로
// 단원 파일을 새 버전으로 바꾼 뒤 이 스크립트를 다시 실행하기만 하면 된다.
// GitHub에서는 파일이 올라올 때마다 .github/workflows/deploy.yml이 이 스크립트를 실행해 사이트에 올린다.
import { readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(process.argv[2] || path.join(here, 'units'));
const OUT_DIR = path.join(here, 'dist');
const ONE_FILE = path.join(OUT_DIR, '징검다리_통합_개념확인.html');
const SITE_DIR = path.join(OUT_DIR, 'site');
const SITE_ONE_FILE = 'jinggeomdari-offline.html';

// 고등 수학 단원 이름 (표지 카드 제목). 여기에 없는 번호는 파일 이름에서 가져온다.
const NAMES = { 1: '다항식', 2: '방정식과 부등식', 3: '경우의 수', 4: '도형의 방정식 (1)', 5: '도형의 방정식 (2)', 6: '행렬' };

const warnings = [], errors = [];
const warn = (msg) => warnings.push(msg);
const plain = (html) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

// 파일이 바뀐 때: git에 올라간 파일은 마지막으로 올린 시각, 아니면 파일 수정 시각.
// (GitHub에서 내려받은 파일은 수정 시각이 모두 같아지므로 올린 시각을 써야 최신 파일을 고를 수 있다)
function changedAt(full) {
  try {
    const t = execFileSync('git', ['log', '-1', '--format=%ct', '--', path.basename(full)], { cwd: path.dirname(full), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (t) return Number(t) * 1000;
  } catch {}
  return statSync(full).mtimeMs;
}

// 1) 단원 파일 찾기: 이름이 "3단원…html"인 파일. 같은 번호가 여럿이면 가장 최근에 바뀐 파일을 쓴다.
const found = {};
for (const file of readdirSync(SRC_DIR)) {
  const m = /^(\d+)\s*단원.*\.html?$/i.exec(file.normalize('NFC'));
  if (!m) continue;
  const full = path.join(SRC_DIR, file);
  (found[Number(m[1])] ||= []).push({ file, full, time: changedAt(full) });
}
const nos = Object.keys(found).map(Number).sort((a, b) => a - b);
if (!nos.length) {
  console.error(`단원 파일이 없음: ${SRC_DIR} (이름이 "1단원_….html" 꼴이어야 함)`);
  process.exit(1);
}

// 2) 단원 파일에서 표지에 쓸 정보 읽기
const units = nos.map((no) => {
  const list = found[no].sort((a, b) => b.time - a.time);
  const pick = list[0];
  if (list.length > 1) warn(`${no}단원 파일이 ${list.length}개 → 가장 최근 것 사용: ${pick.file}  (안 쓴 파일: ${list.slice(1).map((f) => f.file).join(', ')})`);
  const html = readFileSync(pick.full, 'utf8');
  // 잘렸거나 엉뚱한 파일이면 배포하지 않는다 (지금 올라가 있는 사이트가 그대로 남음)
  if (!/<\/html>\s*$/i.test(html)) errors.push(`${no}단원 ${pick.file}: 파일 끝에 </html>이 없음 — 파일이 잘렸거나 HTML이 아님`);
  if (!/role="tab"/.test(html)) errors.push(`${no}단원 ${pick.file}: 정리·퀴즈·게임 탭이 없음 — 개념확인 파일이 맞는지 확인`);

  const color = (/--main:\s*(#[0-9a-f]{3,8})\b/i.exec(html) || [])[1];
  if (!color) warn(`${no}단원: 테마 색(--main)을 찾지 못함 → 회색으로 표시`);
  const banner = /<header class="banner">([\s\S]*?)(?:<small>|<\/header>)/.exec(html);
  const title = plain(banner ? banner[1] : (/<title>([\s\S]*?)<\/title>/i.exec(html) || [, ''])[1]);
  if (!banner) warn(`${no}단원: 배너 제목을 찾지 못해 <title>을 사용`);
  // 차례: 정리 탭의 소단원 띠(zone). 짧은 이름(data-toc)이 있으면 그것을 쓴다.
  const sections = [];
  for (const z of html.matchAll(/<div class="zone"([^>]*)>\s*<b>([\s\S]*?)<\/b>/g)) {
    const toc = /data-toc="([^"]*)"/.exec(z[1]);
    const name = toc ? toc[1] : plain(z[2]);
    if (name && !sections.includes(name)) sections.push(name);
  }
  if (!sections.length) warn(`${no}단원: 소단원 띠(class="zone")를 찾지 못함 → 카드에 차례 없이 표시`);
  // 빈칸 수: 퀴즈 빈칸 표시(data-q="…")의 종류 수 (스크립트 속 `${…}` 틀은 빼고)
  const blanks = new Set([...html.matchAll(/data-q="([^"$]+)"/g)].map((m) => m[1])).size;
  const name = NAMES[no] || pick.file.replace(/^\d+\s*단원_?/, '').replace(/_?개념확인.*$/, '').replace(/_/g, ' ').trim() || title;
  // 카드 부제: 단원 화면의 배너 제목. 고등 단원 이름과 같으면("도형의 방정식 (1)"과 "도형의 방정식"도) 생략
  const sub = name.replace(/\s*\(\d+\)$/, '') === title ? '' : title;
  return { no, name, sub, color: color || '#6b7280', sections, blanks, file: pick.file, html, time: pick.time };
});

const colors = {};
units.forEach((u) => (colors[u.color.toLowerCase()] ||= []).push(u.no));
Object.entries(colors).filter(([, n]) => n.length > 1).forEach(([c, n]) => warn(`${n.join('·')}단원의 테마 색이 같음(${c}) — 표지에서 구분이 안 되니 한쪽 파일의 --main을 바꾸는 것을 권장`));

// 3) 결과 보고 (GitHub에서는 실행 결과 화면에도 표로 남긴다)
const latest = new Date(Math.max(...units.map((u) => u.time)));
const built = `${latest.getFullYear()}. ${latest.getMonth() + 1}. ${latest.getDate()}. 단원 파일`;
console.log('단원  색        빈칸  차례 / 사용한 파일');
units.forEach((u) => console.log(`${String(u.no).padStart(2)}    ${u.color.padEnd(8)}  ${String(u.blanks).padStart(3)}   ${u.sections.join(' · ')}\n                      ${u.file}`));
if (errors.length) console.log('\n배포할 수 없음:\n' + errors.map((e) => '  - ' + e).join('\n'));
if (warnings.length) console.log('\n확인할 것:\n' + warnings.map((w) => '  - ' + w).join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = ['## 단원 파일', '', '| 단원 | 사용한 파일 | 빈칸 | 차례 |', '|---|---|---|---|',
    ...units.map((u) => `| ${u.no} | ${u.file} | ${u.blanks} | ${u.sections.join(' · ')} |`), ''];
  if (errors.length) md.push('### ❌ 배포할 수 없음 (지금 사이트는 그대로)', ...errors.map((e) => '- ' + e), '');
  if (warnings.length) md.push('### 확인할 것', ...warnings.map((w) => '- ' + w), '');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
}
if (errors.length) process.exit(1);

// 4) 템플릿 채우기
const template = readFileSync(path.join(here, 'hub.html'), 'utf8');
// <script> 안에 넣어도 HTML 해석이 끊기지 않도록 </script, <!--, <script 를 <로 바꾼다 (JSON에서는 같은 글자)
const safeJson = (v) => JSON.stringify(v).replace(/<(\/|!|script)/gi, '\\u003c$1');
function fill(sources, srcOf, offline) {
  const data = { built, offline, units: units.map(({ no, name, sub, color, sections, blanks }) => ({ no, name, sub, color, sections, blanks, src: srcOf(no) })) };
  let s = template;
  for (const [mark, value] of [['__UNITS__', safeJson(data)], ['<!--__SOURCES__-->', sources]]) {
    if (s.split(mark).length !== 2) throw new Error(`hub.html에 ${mark} 표시가 정확히 한 군데 있어야 함`);
    s = s.split(mark).join(value);
  }
  return s;
}

mkdirSync(OUT_DIR, { recursive: true });
// 한 파일판: 단원 원본을 JSON 문자열로 넣어 두고, 열 때 iframe에 그대로 띄운다
writeFileSync(ONE_FILE, fill(units.map((u) => `<script type="application/json" data-unit="${u.no}">${safeJson(u.html)}</script>`).join('\n'), () => null, null));
// 웹 배포판: 단원 파일을 units/unitN.html로 복사하고 표지에서 불러온다. 한 파일판도 내려받을 수 있게 같이 둔다.
rmSync(SITE_DIR, { recursive: true, force: true });
mkdirSync(path.join(SITE_DIR, 'units'), { recursive: true });
units.forEach((u) => writeFileSync(path.join(SITE_DIR, 'units', `unit${u.no}.html`), u.html));
copyFileSync(ONE_FILE, path.join(SITE_DIR, SITE_ONE_FILE));
writeFileSync(path.join(SITE_DIR, 'index.html'), fill('', (no) => `units/unit${no}.html`, SITE_ONE_FILE));

const kb = (f) => `${Math.round(statSync(f).size / 1024).toLocaleString()} KB`;
console.log(`\n한 파일판  ${path.relative(process.cwd(), ONE_FILE)}  (${kb(ONE_FILE)})`);
console.log(`웹 배포판  ${path.relative(process.cwd(), SITE_DIR)}${path.sep}  (index.html + units/ ${units.length}개)`);
