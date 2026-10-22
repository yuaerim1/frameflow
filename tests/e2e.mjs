// FrameFlow E2E 테스트.  사용법: node e2e.mjs <앱 디렉터리> [서브패스]
// 주의: 이 샌드박스의 Chromium은 H.264 인코더가 없어 VideoEncoder를 VP9로 대체(shim)해 실행합니다.
//       => 타임스탬프/duration/MP4 박스/UI 로직은 검증되지만 H.264 자체는 검증되지 않습니다.
import { launch } from './harness.mjs';
import { parseMp4 } from './mp4parse.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs'; import path from 'path';

const dir = process.argv[2], base = process.argv[3] || '/repo/';
const FX = '/home/claude/work/fixtures/';
const OUT = '/home/claude/work/test-out/'; fs.mkdirSync(OUT, { recursive: true });
const results = [];
const rec = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const h = await launch(dir, { base });
const { page } = h;
async function fresh() { await page.goto(h.url); await page.waitForSelector('#frames'); }
const names = () => page.$$eval('.frame .name', e => e.map(x => x.textContent));
const msVals = () => page.$$eval('.frame input', e => e.map(x => x.value));
const add = async list => { await page.setInputFiles('#files', list.map(n => (n.startsWith('/') ? n : FX + n))); await page.waitForTimeout(400); };
async function setMs(arr) { const ins = await page.$$('.frame input'); for (let i = 0; i < arr.length; i++) { await ins[i].fill(String(arr[i])); await ins[i].dispatchEvent('change'); } }
async function doExport(tag, { expectFail = false } = {}) {
  const p = page.waitForEvent('download', { timeout: expectFail ? 3000 : 120000 }).catch(() => null);
  await page.click('#export');
  const dl = await p;
  if (!dl) { await page.waitForTimeout(500); return { fail: true, status: await page.textContent('#status') }; }
  const out = OUT + tag + '.mp4'; await dl.saveAs(out);
  await page.waitForFunction(() => /완료|실패/.test(document.getElementById('status').textContent));
  return { file: out, name: dl.suggestedFilename(), status: await page.textContent('#status'), mp4: parseMp4(out) };
}
const frameCache = {};
function pixelAt(file, idx, x, y) {   // idx: 영상 내 프레임 번호(0부터). 전체 프레임을 한 번 PNG로 추출해 캐시
  if (!frameCache[file]) { const d = OUT + 'frames_' + path.basename(file, '.mp4') + '/'; fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vsync', '0', d + 'f%04d.png']); frameCache[file] = d; }
  const png = frameCache[file] + 'f' + String(idx + 1).padStart(4, '0') + '.png';
  const py = `from PIL import Image;im=Image.open('${png}').convert('RGB');print(*im.getpixel((${x},${y})))`;
  return execFileSync('python3', ['-I', '-c', py]).toString().trim().split(' ').map(Number);
}
const colorNear = (a, b, t = 40) => a.every((v, i) => Math.abs(v - b[i]) <= t);

// ---------- 1. 로드 / 서브패스 ----------
await fresh();
rec('1.1 서브패스(' + base + ')에서 로드, 콘솔 에러 없음', !h.logs.some(l => /error|PAGEERROR/i.test(l)), h.logs.join(' | '));
rec('1.2 초기 빈 상태 문구/요약', (await page.textContent('#frames')).includes('이미지를 추가하면') && (await page.textContent('#summary')) === '0장 · 0ms');

// ---------- 2. 업로드 / 자연 정렬 / 불량 파일 ----------
await add(['10.png', '2.png', '1.png', '3.png']);
rec('2.1 다중 업로드 + 자연 정렬 (1,2,3,10)', eq(await names(), ['1.png', '2.png', '3.png', '10.png']), (await names()).join(','));
await add(['bad.png', 'note.txt']);
rec('2.2 손상/비이미지 파일 무시 + 안내 표시', (await names()).length === 4 && !(await page.$eval('#notice', e => e.hidden)), await page.textContent('#notice'));
rec('2.3 기본 시간 60ms 적용', eq(await msVals(), ['60', '60', '60', '60']));
await page.selectOption('#defaultDuration', '100');
await add(['11.png']);
rec('2.4 기본 100ms 선택 후 추가분 100ms', eq(await msVals(), ['60', '60', '60', '60', '100']) && eq(await names(), ['1.png', '2.png', '3.png', '10.png', '11.png']));
await page.click('#applyAll');
rec('2.5 전체 적용', eq(await msVals(), ['100', '100', '100', '100', '100']));
rec('2.6 요약(장수·총 ms)', (await page.textContent('#summary')) === '5장 · 500ms');

// ---------- 3. ms 입력 검증 ----------
await setMs([60, 250, 33]);
rec('3.1 프레임별 ms 입력 → 요약 갱신', (await page.textContent('#summary')) === '5장 · 543ms', await page.textContent('#summary'));
const ins = await page.$$('.frame input');
const tryVal = async (i, v) => { await ins[i].fill(v); await ins[i].dispatchEvent('change'); return (await page.$$eval('.frame input', e => e.map(x => x.value)))[i]; };
rec('3.2 빈 값 → 이전 값 유지(250)', (await tryVal(1, '')) === '250');
rec('3.3 0 / 음수 → 1ms', (await tryVal(2, '0')) === '1' && (await tryVal(2, '-5')) === '1');
rec('3.4 소수 → 반올림', (await tryVal(2, '60.4')) === '60');
// 입력 중(change 전) 값도 요약에 즉시 반영
await ins[0].fill('77');
rec('3.5 입력 즉시(change 전) 요약 반영', (await page.textContent('#summary')).startsWith('5장 · ' + (77 + 250 + 60 + 100 + 100)), await page.textContent('#summary'));
await ins[0].dispatchEvent('change');

// ---------- 4. 순서 변경 / 삭제 ----------
await fresh(); await add(['3.png', '2.png', '1.png']);
await page.click('.frame:nth-child(1) button[title="아래로 이동"]');
rec('4.1 ↓ 버튼 이동', eq(await names(), ['2.png', '1.png', '3.png']));
await page.click('.frame:nth-child(3) button[title="위로 이동"]');
rec('4.2 ↑ 버튼 이동', eq(await names(), ['2.png', '3.png', '1.png']));
await page.dragAndDrop('.frame:nth-child(3)', '.frame:nth-child(1)');
rec('4.3 드래그&드롭 순서 변경 (3번째→1번째)', eq(await names(), ['1.png', '2.png', '3.png']), (await names()).join(','));
await page.dragAndDrop('.frame:nth-child(1) .name', '.frame:nth-child(3)');
rec('4.4 드래그&드롭 (1번째→3번째)', eq(await names(), ['2.png', '3.png', '1.png']), (await names()).join(','));
// 외부 파일을 프레임 행 위에 드롭 → 순서 불변 + 파일 추가
await page.evaluate(async () => {
  const bytes = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([bytes], '0-ext.png', { type: 'image/png' }));
  const row = document.querySelectorAll('.frame')[2];
  row.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  row.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(400);
rec('4.5 외부 파일을 행 위에 드롭: 기존 순서 보존 + 새 파일 뒤에 추가(수동 정렬 상태)', eq(await names(), ['2.png', '3.png', '1.png', '0-ext.png']), (await names()).join(','));
await page.click('#sort');
rec('4.6 파일명 재정렬 버튼', eq(await names(), ['0-ext.png', '1.png', '2.png', '3.png']));
await add(['10.png']);
rec('4.7 수동 정렬 해제 상태에서는 추가 시 전체 자연 정렬', eq(await names(), ['0-ext.png', '1.png', '2.png', '3.png', '10.png']));
await page.click('.frame:nth-child(2) button[title="프레임 삭제"]');
rec('4.8 삭제', eq(await names(), ['0-ext.png', '2.png', '3.png', '10.png']));
await page.click('#clear');
rec('4.9 모두 삭제', (await names()).length === 0 && (await page.textContent('#summary')) === '0장 · 0ms');

// ---------- 5. 붙여넣기 / 드래그 앤 드롭(영역) ----------
await fresh();
await page.evaluate(async () => {
  const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(300);
rec('5.1 클립보드 붙여넣기', eq(await names(), ['image.png']));
await page.evaluate(async () => {
  const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
  const z = document.getElementById('drop');
  z.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  z.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(300);
rec('5.2 드롭 영역에 파일 드롭(중복 추가 없음)', eq(await names(), ['dropped.png', 'image.png']), (await names()).join(','));
await page.evaluate(async () => {
  const blob = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')).blob();
  const dt = new DataTransfer(); dt.items.add(new File([blob], 'elsewhere.png', { type: 'image/png' }));
  document.querySelector('h1').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(300);
rec('5.3 페이지 다른 곳에 드롭해도 추가됨', (await names()).includes('elsewhere.png'));

// ---------- 6. 미리보기 재생 타이밍 ----------
await fresh(); await add(['1.png', '2.png', '3.png']); await setMs([60, 100, 200]);
const trace = async ms => page.evaluate(async total => {
  const log = []; const el = document.getElementById('current');
  const mo = new MutationObserver(() => log.push([el.textContent, performance.now()])); mo.observe(el, { childList: true, characterData: true, subtree: true });
  document.getElementById('play').click(); await new Promise(r => setTimeout(r, total)); document.getElementById('play').click(); mo.disconnect(); return log;
}, ms);
const lg = await trace(2200);
const seq = lg.map(x => x[0]); const gaps = lg.slice(1).map((x, i) => x[1] - lg[i][1]);
rec('6.1 재생 순서 1→2→3 반복(루프)', seq.length >= 9 && seq.slice(0, 6).join() === '1.png,2.png,3.png,1.png,2.png,3.png', seq.slice(0, 7).join());
const exp = [60, 100, 200]; const cyc = Math.floor(gaps.length / 3);
let tot = 0, expTot = 0; for (let i = 0; i < cyc * 3; i++) { tot += gaps[i]; expTot += exp[i % 3]; }
rec('6.2 미리보기 누적 시간 오차 ≤ 3% (프레임 간격은 rAF 16.7ms 양자화)', Math.abs(tot - expTot) / expTot <= 0.03, `측정 ${tot.toFixed(0)}ms / 기대 ${expTot}ms (${cyc}주기)`);
const after = await page.textContent('#current');
await page.click('#play'); await page.waitForTimeout(120); await page.click('#play');
await page.click('#stop'); await setMs([2000, 2000, 2000]);
await page.click('#play'); await page.waitForTimeout(2300); await page.click('#play');
const pausedAt = await page.textContent('#current'); await page.click('#play'); await page.waitForTimeout(150); const resumedAt = await page.textContent('#current'); await page.click('#play');
rec('6.3 일시정지 → 재개 시 처음(1.png)으로 돌아가지 않고 이어서 재생', pausedAt === '2.png' && resumedAt === '3.png', `정지 시 ${pausedAt} → 재개 후 ${resumedAt}`);
await setMs([60, 100, 200]);
await page.click('#stop');
rec('6.4 정지 → 첫 프레임', (await page.textContent('#current')) === '1.png' && (await page.textContent('#play')).includes('재생'));
await page.uncheck('#loop'); await page.click('#play'); await page.waitForTimeout(800);
rec('6.5 반복 해제 시 마지막에 자동 정지', (await page.textContent('#play')).includes('재생'), await page.textContent('#play'));
await page.check('#loop');

// ---------- 7. 내보내기: 프레임별 ms 정확도 ----------
async function scenario(tag, files, msArr, opts = {}) {
  await fresh(); await add(files); if (opts.res) await page.selectOption('#resolution', opts.res); if (opts.bg) await page.fill('#bg', opts.bg).catch(async () => page.$eval('#bg', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, opts.bg));
  if (opts.bg) await page.$eval('#bg', (e, v) => { e.value = v; e.dispatchEvent(new Event('input')); }, opts.bg);
  if (opts.filename !== undefined) await page.fill('#filename', opts.filename);
  if (msArr) await setMs(msArr);
  return doExport(tag);
}
const checkDur = (r, msArr, label) => {
  const v = r.mp4.video; const d = v.durMs.map(x => +x.toFixed(2));
  const maxErr = Math.max(...d.map((x, i) => Math.abs(x - msArr[i])));
  const sum = msArr.reduce((a, b) => a + b, 0);
  rec(label + ' — 프레임별 duration(stts) == 입력 ms', v.durMs.length === msArr.length && maxErr < 0.05, `기대 [${msArr}] / 실제 [${d}]`);
  rec(label + ' — 총 길이 == 합계, PTS 0 시작', near(v.totalMs, sum, 0.1) && v.ptsMs[0] === 0, `합계 ${sum}ms / 실제 ${v.totalMs.toFixed(2)}ms`);
};
let r = await scenario('s1', ['1.png', '2.png', '3.png', '10.png'], [60, 100, 250, 33]); checkDur(r, [60, 100, 250, 33], '7.1 혼합(마지막이 짧음)');
rec('7.1b 상태 메시지/파일명', /완료/.test(r.status) && r.name === 'animation.mp4', r.status + ' / ' + r.name);
const ffp = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=nb_frames,width,height', '-of', 'json', r.file]).toString());
rec('7.1c ffprobe: 총 길이 0.443s, 4프레임', near(+ffp.format.duration, 0.443, 0.002) && ffp.streams[0].nb_frames === '4', JSON.stringify(ffp.format) + JSON.stringify(ffp.streams[0]));
r = await scenario('s2', ['1.png', '2.png', '3.png'], [60, 60, 60]); checkDur(r, [60, 60, 60], '7.2 전부 60ms');
r = await scenario('s3', ['1.png', '2.png', '3.png'], [100, 100, 100]); checkDur(r, [100, 100, 100], '7.3 전부 100ms');
r = await scenario('s4', ['1.png', '2.png', '3.png', '10.png', '11.png'], [1, 5000, 17, 333, 61]); checkDur(r, [1, 5000, 17, 333, 61], '7.4 극단값(1ms, 5000ms, 소수 tick 값)');
r = await scenario('s5', ['1.png'], [250]); checkDur(r, [250], '7.5 프레임 1장');
r = await scenario('s6', ['1.png', '2.png'], [100, 40]); checkDur(r, [100, 40], '7.6 2장(마지막이 더 짧음)');
r = await scenario('s7', ['1.png', '2.png'], [40, 100]); checkDur(r, [40, 100], '7.7 2장(마지막이 더 김)');
// 프레임 순서가 영상 내용에 반영되는지: 색상 확인
r = await scenario('s8', ['1.png', '2.png', '3.png'], [100, 100, 100]);
const cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
const px = [0, 1, 2].map(t => pixelAt(r.file, t, 150, 80));
rec('7.8 영상 프레임 내용·순서 = 빨강→초록→파랑', px.every((p, i) => colorNear(p, cols[i], 45)), JSON.stringify(px));
// 수동 순서변경 후 내보내기
await fresh(); await add(['1.png', '2.png', '3.png']); await page.click('.frame:nth-child(1) button[title="아래로 이동"]'); await setMs([100, 100, 100]);
r = await doExport('s9'); const px2 = [0, 1, 2].map(t => pixelAt(r.file, t, 150, 80));
rec('7.9 수동 순서 변경 후 내보내기 반영 (초록→빨강→파랑)', [cols[1], cols[0], cols[2]].every((c, i) => colorNear(px2[i], c, 45)), JSON.stringify(px2));
// 재생시간 변경이 export 직전 값(포커스 유지 상태)에도 반영
await fresh(); await add(['1.png', '2.png']); const i2 = await page.$$('.frame input'); await i2[0].fill('333'); await i2[1].fill('77');
r = await doExport('s10'); checkDur(r, [333, 77], '7.10 입력 직후(change 전) 바로 내보내기');

// ---------- 8. 해상도 / 배경 / 크기 / 파일명 ----------
r = await scenario('r1', ['odd.jpg'], [100]); rec('8.1 홀수 크기(161×91) → 짝수(160×90)', JSON.stringify(await page.evaluate(() => window.__cfgs.slice(-1)[0] && [window.__cfgs.slice(-1)[0].width, window.__cfgs.slice(-1)[0].height])) === '[160,90]');
r = await scenario('r2', ['1.png', 'tall.png'], [100, 100], { res: '1280x720' });
const ff2 = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', r.file]).toString()).streams[0];
rec('8.2 1280×720 출력 크기', ff2.width === 1280 && ff2.height === 720, JSON.stringify(ff2));
const pl = pixelAt(r.file, 1, 5, 360), pc = pixelAt(r.file, 1, 640, 360);
rec('8.3 비율 불일치 이미지: 레터박스(배경 흰색) + 중앙 이미지', colorNear(pl, [255, 255, 255], 12) && colorNear(pc, [250, 120, 0], 40), JSON.stringify([pl, pc]));
r = await scenario('r3', ['t.png'], [100], { bg: '#ff0000' });
const pb = pixelAt(r.file, 0, 3, 3), pe = pixelAt(r.file, 0, 80, 45);
rec('8.4 투명 PNG → 선택한 배경색(빨강) 합성', colorNear(pb, [255, 0, 0], 30), JSON.stringify([pb, pe]));
r = await scenario('r5', ['1.png'], [100], { filename: 'my:video?.mp4 ' }); rec('8.6 파일명 정리(금지문자/.mp4 중복)', r.name === 'my_video_.mp4', r.name);
r = await scenario('r6', ['1.png'], [100], { filename: '' }); rec('8.7 빈 파일명 → animation.mp4', r.name === 'animation.mp4', r.name);
r = await scenario('r7', ['big4k.png', 'hd.png'], [100, 100], { res: 'original' });
const cfg4k = await page.evaluate(() => window.__cfgs.slice(-1)[0]);
rec('8.8 3840×2160 출력 + H.264 레벨 5.1 선택(avc1.420033)', cfg4k.width === 3840 && cfg4k.height === 2160 && cfg4k.codec === 'avc1.420033', JSON.stringify({ c: cfg4k.codec, w: cfg4k.width, h: cfg4k.height, br: cfg4k.bitrate }));
r = await scenario('r8', ['1.png'], [100], { res: '1920x1080' }); const c1080 = await page.evaluate(() => window.__cfgs.slice(-1)[0]);
rec('8.9 1080p 레벨 4.0(avc1.420028), 지원 조회 호출', c1080.codec === 'avc1.420028' && (await page.evaluate(() => window.__supportCalls.length)) >= 1, c1080.codec);
await fresh(); await add(['over4k.png']); await page.click('#export'); await page.waitForTimeout(800);
rec('8.10 4K 초과 → 오류 메시지, 버튼 복구', /3840×2160/.test(await page.textContent('#status')) && !(await page.$eval('#export', e => e.disabled)), await page.textContent('#status'));

// ---------- 9. 대량 프레임 / 내보내기 중 잠금 ----------
await fresh();
const many = fs.readdirSync(FX + 'many').map(n => FX + 'many/' + n);
await add(many); await page.waitForTimeout(1500);
rec('9.1 200장 업로드 + 자연 정렬', (await names()).length === 200 && (await names())[0] === 'f1.png' && (await names())[199] === 'f200.png' && (await names())[9] === 'f10.png');
await page.$$eval('.frame input', els => els.forEach((e, i) => { e.value = String(30 + (i % 7) * 11); e.dispatchEvent(new Event('change')); }));
const expected = Array.from({ length: 200 }, (_, i) => 30 + (i % 7) * 11);
const t0 = Date.now();
const pDl = page.waitForEvent('download', { timeout: 120000 });
await page.click('#export');
await page.waitForTimeout(150);
const lockInfo = await page.evaluate(() => ({ inert: document.getElementById('frames').inert, clearDis: document.getElementById('clear').disabled, pickDis: document.getElementById('pick').disabled }));
await page.evaluate(() => { document.getElementById('clear').click(); const b = document.querySelector('.frame button[title="프레임 삭제"]'); b && b.click(); });
const dl9 = await pDl; await dl9.saveAs(OUT + 'many.mp4'); await page.waitForFunction(() => /완료|실패/.test(document.getElementById('status').textContent));
const m9 = parseMp4(OUT + 'many.mp4');
rec('9.2 내보내기 중 편집 잠금(inert/disabled) 및 clear·삭제 시도 무시', lockInfo.inert && lockInfo.clearDis && (await names()).length === 200, JSON.stringify(lockInfo));
rec('9.3 200프레임 export 성공 + 프레임별 duration 일치', m9.video.durMs.length === 200 && Math.max(...m9.video.durMs.map((x, i) => Math.abs(x - expected[i]))) < 0.05, `소요 ${(Date.now() - t0) / 1000}s / ${await page.textContent('#status')}`);
rec('9.4 30프레임마다 키프레임 요청(1,31,61,91 포함; 인코더 자체 추가 키프레임 허용)', [1, 31, 61, 91].every(k => m9.video.stss.includes(k)), JSON.stringify(m9.video.stss.slice(0, 8)));
rec('9.5 export 후 UI 잠금 해제', !(await page.$eval('#frames', e => e.inert)) && !(await page.$eval('#clear', e => e.disabled)));

// ---------- 10. 오류 처리 ----------
await fresh(); await page.evaluate(() => { window.VideoEncoder = undefined; delete window.VideoEncoder; });
await add(['1.png']); let dialog = ''; page.once('dialog', d => { dialog = d.message(); d.dismiss(); });
await page.evaluate(() => { Object.defineProperty(window, 'VideoEncoder', { value: undefined, configurable: true }); delete window.VideoEncoder; });
await page.click('#export'); await page.waitForTimeout(400);
rec('10.1 WebCodecs 미지원 시 안내 알림', /WebCodecs/.test(dialog), dialog);
await fresh(); await add(['1.png']);
await page.evaluate(() => { const O = window.VideoEncoder; window.VideoEncoder = class extends O { static async isConfigSupported() { return { supported: false }; } }; });
await page.click('#export'); await page.waitForTimeout(500);
rec('10.2 H.264 미지원 시 오류 메시지 + 버튼 복구(Baseline/Main/High 모두 시도)', /H\.264/.test(await page.textContent('#status')) && !(await page.$eval('#export', e => e.disabled)), await page.textContent('#status'));
await fresh(); await add(['1.png']);
await page.evaluate(() => { const O = window.VideoEncoder; const tried = []; window.__tried = tried; window.VideoEncoder = class extends O { static async isConfigSupported(c) { tried.push(c.codec); return { supported: c.codec.startsWith('avc1.4d') }; } configure(c) { super.configure({ ...c, codec: c.codec }); } }; });
await page.click('#export'); await page.waitForTimeout(800);
rec('10.3 Baseline 미지원 시 Main 프로파일로 폴백', eq(await page.evaluate(() => window.__tried), ['avc1.420028', 'avc1.4d0028']), JSON.stringify(await page.evaluate(() => window.__tried)));

// ---------- 11. 레이아웃(시각) ----------
await fresh(); await add(['1.png', '2.png', '3.png', 't.png']); await page.screenshot({ path: OUT + 'desktop.png', fullPage: true });
await page.setViewportSize({ width: 375, height: 800 }); await page.waitForTimeout(200);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.screenshot({ path: OUT + 'mobile.png', fullPage: true });
rec('11.1 모바일(375px) 가로 스크롤 없음', overflow <= 0, 'overflow=' + overflow);

rec('0. 콘솔/페이지 에러 총괄(의도한 실패 테스트 제외)', !h.logs.some(l => /PAGEERROR/.test(l)), h.logs.filter(l => /PAGEERROR/.test(l)).join(' | '));
await h.close();
const failed = results.filter(x => !x.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} passed ==`);
fs.writeFileSync(OUT + 'results-' + path.basename(path.dirname(dir + '/')) + '.json', JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
