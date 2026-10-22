// mp4-muxer는 CDN(esm.sh) 대신 저장소에 포함된 vendor 사본을 사용합니다.
// (CDN 장애·차단 시 앱 전체가 죽는 문제 방지, 마지막 프레임 duration 패치 포함)
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.esm.js';

const $ = id => document.getElementById(id);
$('tabMp4').onclick=()=>switchTab('mp4');
$('tabPng').onclick=()=>switchTab('png');
function switchTab(tab){$('mp4Panel').hidden=tab!=='mp4';$('pngPanel').hidden=tab!=='png';for(const id of ['Mp4','Png']){$('tab'+id).classList.toggle('active',id.toLowerCase()===tab);$('tab'+id).setAttribute('aria-selected',String(id.toLowerCase()===tab));}if(tab==='png')stop();}
let frames = [], playing = false, playToken = 0, playIndex = 0, exporting = false;
let userOrdered = false;      // 사용자가 수동으로 순서를 바꿨는지(이후 추가 파일은 뒤에 붙임)
let dragFrom = null;          // 목록 내부 드래그 중인 프레임 인덱스

const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

/* ---------- 시간(ms) ---------- */
function parseMs(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(1, n) : fallback;
}
function duration(f) { return parseMs(f.ms, 60); }

/* ---------- 알림 / 잠금 ---------- */
function notice(msg) {
  const el = $('notice');
  el.textContent = msg || '';
  el.hidden = !msg;
}
function setLocked(on) {
  exporting = on;
  ['pick', 'applyAll', 'sort', 'clear', 'defaultDuration'].forEach(id => { $(id).disabled = on; });
  $('frames').inert = on;
  $('frames').classList.toggle('locked', on);
}

/* ---------- 프레임 목록 ---------- */
function disposeFrame(f) {
  URL.revokeObjectURL(f.url);
  try { f.bitmap.close(); } catch (e) { /* 이미 해제됨 */ }
}
function moveFrame(from, to) {
  if (exporting || from === to || from < 0 || to < 0 || from >= frames.length || to >= frames.length) return;
  const [item] = frames.splice(from, 1);
  frames.splice(to, 0, item);
  userOrdered = true;
  update();
}
function update() {
  const list = $('frames');
  list.replaceChildren();
  frames.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'frame';
    row.draggable = true;
    row.dataset.index = i;
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(i + 1).padStart(2, '0');
    const img = document.createElement('img');
    img.src = f.url;
    img.alt = '';
    img.decoding = 'async';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name;
    name.title = f.name;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = f.ms;
    input.setAttribute('aria-label', `${f.name} 재생시간 (ms)`);
    // 입력 즉시 반영(내보내기 직전 값이 누락되지 않도록), 포커스를 잃거나 Enter 시 값 정규화
    input.addEventListener('input', () => { f.ms = parseMs(input.value, f.ms); summary(); });
    input.addEventListener('change', () => { f.ms = parseMs(input.value, f.ms); input.value = f.ms; summary(); });
    // Firefox: draggable 요소 안의 input은 클릭/커서 이동이 안 되므로 입력 중에는 드래그를 끔
    input.addEventListener('focus', () => { row.draggable = false; });
    input.addEventListener('blur', () => { row.draggable = true; });
    const unit = document.createElement('span');
    unit.className = 'unit';
    unit.textContent = 'ms';
    const up = document.createElement('button');
    up.textContent = '↑'; up.title = '위로 이동'; up.setAttribute('aria-label', `${f.name} 위로 이동`);
    up.disabled = i === 0;
    up.onclick = () => moveFrame(i, i - 1);
    const down = document.createElement('button');
    down.textContent = '↓'; down.title = '아래로 이동'; down.setAttribute('aria-label', `${f.name} 아래로 이동`);
    down.disabled = i === frames.length - 1;
    down.onclick = () => moveFrame(i, i + 1);
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = '프레임 삭제';
    del.setAttribute('aria-label', `${f.name} 삭제`);
    del.onclick = () => {
      if (exporting) return;
      const [removed] = frames.splice(i, 1);
      disposeFrame(removed);
      update();
    };
    row.append(idx, img, name, input, unit, up, down, del);
    row.addEventListener('dragstart', e => {
      if (e.target !== row) return;
      dragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      dragFrom = null;
      row.classList.remove('dragging');
      document.querySelectorAll('.frame.dropTarget').forEach(el => el.classList.remove('dropTarget'));
    });
    row.addEventListener('dragover', e => {
      if (dragFrom === null) return;        // 외부 파일 드래그는 window 핸들러가 처리
      e.preventDefault();
      row.classList.add('dropTarget');
    });
    row.addEventListener('dragleave', () => row.classList.remove('dropTarget'));
    row.addEventListener('drop', e => {
      if (dragFrom === null) return;        // 외부 파일 드롭: 프레임 순서를 건드리지 않고 window 핸들러로 전달
      e.preventDefault();
      e.stopPropagation();
      const from = dragFrom;
      dragFrom = null;
      moveFrame(from, i);
    });
    list.append(row);
  });
  if (!frames.length) list.innerHTML = '<div class="empty">이미지를 추가하면 이곳에 프레임이 표시됩니다.</div>';
  summary();
  applyPreviewSize();
  if (!playing) drawPreview(currentFrame());
}
function currentFrame() {
  return frames[Math.max(0, Math.min(playIndex - 1, frames.length - 1))];
}
function summary() {
  $('summary').textContent = `${frames.length}장 · ${frames.reduce((a, f) => a + duration(f), 0)}ms`;
}

/* ---------- 이미지 추가 ---------- */
function isImageFile(f) {
  return f.type ? f.type.startsWith('image/') : IMG_EXT.test(f.name);
}
async function decodeImage(file) {
  try {
    return await createImageBitmap(file);
  } catch (e) {
    // SVG 등 createImageBitmap(Blob)이 거부하는 형식은 <img> 경유로 재시도
    const u = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = u;
      await im.decode();
      return await createImageBitmap(im);
    } finally { URL.revokeObjectURL(u); }
  }
}
async function addFiles(files) {
  if (exporting) { notice('MP4 변환 중에는 이미지를 추가할 수 없습니다.'); return; }
  const all = [...files];
  const incoming = all.filter(isImageFile);
  const skipped = all.filter(f => !isImageFile(f)).map(f => f.name);
  const ms = parseMs($('defaultDuration').value, 60);
  const prepared = await Promise.all(incoming.map(async file => {
    try {
      const bitmap = await decodeImage(file);
      return { name: file.name, ms, url: URL.createObjectURL(file), bitmap };
    } catch (e) {
      skipped.push(file.name);
      return null;
    }
  }));
  if (exporting) { prepared.filter(Boolean).forEach(disposeFrame); notice('MP4 변환 중에는 이미지를 추가할 수 없습니다.'); return; }
  const batch = prepared.filter(Boolean).sort(natural);
  notice(skipped.length ? `${skipped.length}개 파일은 이미지로 읽을 수 없어 제외했습니다: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ' 외' : ''}` : '');
  if (!batch.length) return;
  frames.push(...batch);
  if (!userOrdered) frames.sort(natural);   // 수동 정렬 전에는 전체를 파일명 순으로 유지
  stop();
  playIndex = 0;
  update();
}
$('pick').onclick = () => $('files').click();
$('files').onchange = e => { addFiles(e.target.files); e.target.value = ''; };

const drop = $('drop');
const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
// 페이지 어디에 놓아도 파일이 추가되도록 하고(브라우저가 이미지를 열어버리는 것 방지) 드롭 영역을 강조
window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); drop.classList.add('over'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  drop.classList.remove('over');
  addFiles(e.dataTransfer.files);
});
const openPicker = e => {
  if (e.target !== drop) return;
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('files').click(); }
};
drop.addEventListener('keydown', openPicker);
document.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const files = items.filter(x => x.kind === 'file').map(x => x.getAsFile()).filter(Boolean);
  if (!files.length) return;
  // 텍스트 입력 중 텍스트를 붙여넣는 경우만 건드리지 않음 (이미지만 있는 클립보드는 입력창 포커스여도 처리)
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && items.some(x => x.type === 'text/plain');
  if (typing) return;
  e.preventDefault();
  addFiles(files);
});

$('applyAll').onclick = () => {
  if (exporting) return;
  const ms = parseMs($('defaultDuration').value, 60);
  frames.forEach(f => { f.ms = ms; });
  update();
};
$('sort').onclick = () => { if (exporting) return; userOrdered = false; frames.sort(natural); update(); };
$('clear').onclick = () => {
  if (exporting) return;
  stop();
  frames.forEach(disposeFrame);
  frames = [];
  userOrdered = false;
  playIndex = 0;
  notice('');
  update();
};

/* ---------- 그리기 / 미리보기 ---------- */
function paint(ctx, f, w, h, bg) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (!f) return;
  const iw = f.bitmap.width, ih = f.bitmap.height;
  const scale = Math.min(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f.bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
function dimensions() {
  const v = $('resolution').value;
  if (v !== 'original') return v.split('x').map(Number);
  const f = frames[0];
  return f ? [f.bitmap.width, f.bitmap.height] : [640, 360];
}
// 미리보기 캔버스 비율을 실제 출력 해상도와 같게 맞춤 (최대 640px)
function applyPreviewSize() {
  const [w, h] = dimensions();
  const s = Math.min(1, 640 / Math.max(w, h));
  const pw = Math.max(2, Math.round(w * s)), ph = Math.max(2, Math.round(h * s));
  const c = $('preview');
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
}
function drawPreview(f) {
  const c = $('preview');
  paint(c.getContext('2d'), f, c.width, c.height, $('bg').value);
  $('current').textContent = f?.name || '—';
}
function stop() {
  playing = false;
  playToken++;
  $('play').textContent = '▶ 재생';
}
$('stop').onclick = () => { stop(); playIndex = 0; drawPreview(frames[0]); };
$('play').onclick = () => {
  if (playing) { stop(); return; }          // 일시정지: 현재 위치 유지
  if (!frames.length) return;
  if (playIndex >= frames.length) playIndex = 0;
  playing = true;
  $('play').textContent = 'Ⅱ 일시정지';
  const token = ++playToken;
  let due = 0;                              // 다음 프레임을 보여줄 시각 (누적 방식이라 setTimeout 오차가 쌓이지 않음)
  const tick = now => {
    if (!playing || token !== playToken) return;
    if (now >= due) {
      if (playIndex >= frames.length) {
        if (!$('loop').checked) { stop(); playIndex = 0; return; }
        playIndex = 0;
      }
      const f = frames[playIndex++];
      drawPreview(f);
      if (now - due > 250) due = now;       // 탭 비활성 등으로 크게 밀리면 재동기화
      due += duration(f);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
$('bg').oninput = () => { if (!playing) drawPreview(currentFrame()); };
$('resolution').onchange = () => { applyPreviewSize(); if (!playing) drawPreview(currentFrame()); };

/* ---------- MP4 내보내기 ---------- */
// 백그라운드 탭에서도 throttle 되지 않는 양보(setTimeout(0)은 비활성 탭에서 초당 1회로 제한됨)
const yieldToUI = () => new Promise(resolve => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
  ch.port2.postMessage(0);
});
// 해상도에 맞는 H.264 레벨 선택 (3840×2160은 레벨 5.1 필요)
function avcLevel(w, h) {
  const mb = Math.ceil(w / 16) * Math.ceil(h / 16);
  return mb <= 8192 ? 0x28 : mb <= 8704 ? 0x2a : mb <= 22080 ? 0x32 : 0x33;
}
async function pickConfig(w, h) {
  const lv = avcLevel(w, h).toString(16).padStart(2, '0');
  const base = {
    width: w, height: h,
    bitrate: Math.min(16000000, Math.max(1500000, w * h * 5)),
    framerate: 100, avc: { format: 'avc' }
  };
  // Baseline → Main → High 순으로 시도 (브라우저/하드웨어 인코더마다 지원 프로파일이 다름)
  for (const profile of ['4200', '4d00', '6400']) {
    const config = { ...base, codec: `avc1.${profile}${lv}` };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return config;
    } catch (e) { /* 다음 후보 */ }
  }
  return null;
}
$('export').onclick = async () => {
  if (exporting || !frames.length) return;
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    alert('이 브라우저는 WebCodecs(VideoEncoder)를 지원하지 않거나 보안 연결(HTTPS)이 아닙니다. 최신 Chrome 또는 Edge를 사용하고 https 주소로 접속하세요.');
    return;
  }
  stop();
  setLocked(true);
  const list = frames.map(f => ({ bitmap: f.bitmap, ms: duration(f) }));   // 내보내기 시점 스냅샷
  $('export').disabled = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  $('status').textContent = '인코더 준비 중…';
  let encoder;
  try {
    let [w, h] = dimensions();
    w = Math.max(2, Math.floor(w / 2) * 2);
    h = Math.max(2, Math.floor(h / 2) * 2);
    if (w * h > 3840 * 2160) throw new Error('최대 3840×2160 해상도까지 지원합니다.');
    const config = await pickConfig(w, h);
    if (!config) throw new Error('현재 브라우저에서 선택한 해상도의 H.264 인코딩을 지원하지 않습니다.');
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: w, height: h },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    let encodingError = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: e => { encodingError = e; }
    });
    encoder.configure(config);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    const bg = $('bg').value;
    let t = 0;                                   // 누적 타임스탬프(µs): 프레임별 ms가 그대로 PTS/duration이 됨
    for (let i = 0; i < list.length; i++) {
      if (encodingError) throw encodingError;
      const f = list[i], d = f.ms * 1000;
      paint(ctx, f, w, h, bg);
      const vf = new VideoFrame(canvas, { timestamp: t, duration: d });
      encoder.encode(vf, { keyFrame: i % 30 === 0 });
      vf.close();
      t += d;
      while (encoder.encodeQueueSize > 8) {
        if (encodingError) throw encodingError;
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 50);
          encoder.addEventListener('dequeue', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      $('progress').value = Math.round((i + 1) / list.length * 95);
      $('status').textContent = `인코딩 ${i + 1}/${list.length} 프레임`;
      await yieldToUI();
    }
    await encoder.flush();
    if (encodingError) throw encodingError;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const base = $('filename').value.trim().replace(/\.mp4$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
    a.href = url;
    a.download = (base || 'animation') + '.mp4';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('progress').value = 100;
    $('status').textContent = `완료 · ${(blob.size / 1048576).toFixed(2)} MB · ${(t / 1e6).toFixed(2)}초`;
  } catch (e) {
    console.error(e);
    $('status').textContent = `변환 실패: ${e.message || e}`;
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    setLocked(false);
    $('export').disabled = false;
  }
};
update();
