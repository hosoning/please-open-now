/* 请在这时打开 · app.js
 * 纯原生 JS，无外部依赖。数据只存在浏览器本地（IndexedDB + localStorage）。
 */
'use strict';

const APP_VERSION = '1.3.0';
const DB_NAME = 'PleaseOpenNowDB';
const DB_VERSION = 1;
const STORE_NAME = 'letters';

const $ = (id) => document.getElementById(id);
const reduceMotionMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

let db = null;
let lettersData = null;
let allItems = [];              // 历史信件缓存
let currentSnapshot = null;     // 当前打开的信
let currentFilter = 'all';
let animTimers = [];

const prefs = {
  get userName() { return localStorage.getItem('userName') || '你'; },
  get taName() { return localStorage.getItem('taName') || 'TA'; },
  get callMode() { return localStorage.getItem('callMode') || 'you'; },
  get skipAnim() { return localStorage.getItem('skipAnim') === '1'; },
};
let recentLetterIds = safeJSON(localStorage.getItem('recentIds'), []);

function safeJSON(text, fallback) {
  try { const v = JSON.parse(text); return v ?? fallback; } catch { return fallback; }
}
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ---------- 名字替换 ---------- */
function personalize(text, opts = {}) {
  const ta = prefs.taName;
  const user = prefs.userName;
  let out = String(text ?? '').replace(/TA/g, ta);
  const mode = opts.mode || prefs.callMode;
  if (mode === 'name' && user !== '你') out = out.replace(/你/g, user);
  return out;
}
function salutation() {
  const user = prefs.userName;
  return user === '你' ? '给你：' : `亲爱的${user}：`;
}
function themeLabel(name) { return String(name ?? '').replace(/TA/g, prefs.taName); }
function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  return withTime ? `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : date;
}

/* ---------- IndexedDB ---------- */
function initDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
  });
}
function tx(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(mode === 'readonly' ? [] : undefined);
    const t = db.transaction(STORE_NAME, mode);
    const store = t.objectStore(STORE_NAME);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const dbAll = () => tx('readonly', (s) => s.getAll());
const dbGet = (id) => tx('readonly', (s) => s.get(id));
const dbPut = (item) => tx('readwrite', (s) => s.put(item));
const dbDelete = (id) => tx('readwrite', (s) => s.delete(id));
const dbClear = () => tx('readwrite', (s) => s.clear());
const dbPutMany = (items) => tx('readwrite', (s) => { items.forEach((i) => s.put(i)); });

async function refreshItems() {
  try {
    const items = await dbAll();
    allItems = (items || []).sort((a, b) => new Date(b.time) - new Date(a.time));
  } catch (err) {
    console.warn('读取历史失败', err);
    allItems = [];
  }
  return allItems;
}

/* ---------- 信件数据 ---------- */
async function loadLetters() {
  const grid = $('mood-grid');
  try {
    const res = await fetch('letters.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lettersData = await res.json();
    if (!Array.isArray(lettersData.themes)) throw new Error('letters.json 格式不正确');
    renderMoods();
  } catch (err) {
    console.warn('加载信件失败', err);
    grid.innerHTML = `<div class="loading">信件暂时取不到，请检查网络后再试。<br><button class="text-btn" id="retry-load" type="button">重新加载</button></div>`;
    $('retry-load').addEventListener('click', loadLetters);
  }
}

function renderMoods() {
  if (!lettersData) return;
  const grid = $('mood-grid');
  const readByTheme = {};
  allItems.forEach((i) => { (readByTheme[i.themeId] ||= new Set()).add(i.letterId); });
  grid.innerHTML = lettersData.themes.map((theme) => {
    const read = readByTheme[theme.id]?.size || 0;
    const total = theme.letters.length;
    const name = escapeHTML(themeLabel(theme.name));
    return `
    <button class="mood-btn" data-theme="${escapeHTML(theme.id)}" type="button" aria-label="${name}，已拆 ${read} / ${total} 封">
      <span class="icon" aria-hidden="true">${escapeHTML(theme.icon)}</span>
      <span class="name">${name}</span>
      ${read ? `<span class="read" aria-hidden="true">${read}/${total}</span>` : ''}
    </button>`;
  }).join('');
}

function updateGreeting() {
  const h = new Date().getHours();
  const ta = prefs.taName;
  let text;
  if (h < 5) text = `夜深了，${ta} 还给你留着一封信。`;
  else if (h < 11) text = '早安，今天的信已经送到了。';
  else if (h < 14) text = '中午好，歇一会儿再拆信吧。';
  else if (h < 18) text = '午后的信，适合慢慢读。';
  else if (h < 22) text = '晚上好，今天辛苦了。';
  else text = `睡前，读一封 ${ta} 的信吧。`;
  $('greeting').textContent = text;
}

function updateNameDisplay() {
  $('user-name-display').textContent = prefs.userName;
  $('ta-name-display').textContent = prefs.taName;
  $('input-user-name').value = prefs.userName === '你' ? '' : prefs.userName;
  $('input-ta-name').value = prefs.taName === 'TA' ? '' : prefs.taName;
  document.querySelectorAll('input[name="call-mode"]').forEach((r) => { r.checked = r.value === prefs.callMode; });
  $('skip-anim-pref').checked = prefs.skipAnim;
  updateGreeting();
}

/* ---------- 拆信 ---------- */
function pickLetter(theme) {
  let available = theme.letters.filter((l) => !recentLetterIds.includes(l.id));
  if (available.length === 0) available = theme.letters;
  if (currentSnapshot && available.length > 1) available = available.filter((l) => l.id !== currentSnapshot.letterId);
  return available[Math.floor(Math.random() * available.length)];
}

async function openLetterForTheme(themeId, { replace = false } = {}) {
  if (!lettersData) return;
  const theme = lettersData.themes.find((t) => t.id === themeId);
  if (!theme) return;
  const letter = pickLetter(theme);
  recentLetterIds = [letter.id, ...recentLetterIds.filter((id) => id !== letter.id)].slice(0, 30);
  localStorage.setItem('recentIds', JSON.stringify(recentLetterIds));

  const snapshot = {
    id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toISOString(),
    userName: prefs.userName,
    taName: prefs.taName,
    themeId: theme.id,
    themeName: theme.name,
    themeIcon: theme.icon,
    letterId: letter.id,
    title: letter.title,
    body: letter.body,
    style: letter.style,
    favorite: false,
  };
  try { await dbPut(snapshot); } catch (err) { console.warn('保存失败', err); toast('这封信没能存进信箱（浏览器存储不可用）'); }
  allItems.unshift(snapshot);
  showLetter(snapshot, { animate: true, replace });
}

function openRandom() {
  if (!lettersData) return;
  const themes = lettersData.themes;
  openLetterForTheme(themes[Math.floor(Math.random() * themes.length)].id);
}

function fillLetter(snapshot) {
  const icon = snapshot.themeIcon || lettersData?.themes.find((t) => t.id === snapshot.themeId)?.icon || '✉️';
  $('letter-meta').textContent = themeLabel(snapshot.themeName);
  $('letter-tag').innerHTML = `<span>${escapeHTML(icon)} ${escapeHTML(themeLabel(snapshot.themeName))}</span>` +
    (snapshot.style ? `<span>${escapeHTML(snapshot.style)}</span>` : '');
  $('letter-salutation').textContent = salutation();
  $('letter-title').textContent = personalize(snapshot.title);
  $('letter-body').textContent = personalize(snapshot.body);
  $('letter-sign').textContent = `—— ${prefs.taName}`;
  $('letter-date').textContent = formatDate(snapshot.time);
  updateFavButtons();
}

function clearAnimTimers() { animTimers.forEach(clearTimeout); animTimers = []; }

function showLetter(snapshot, { animate = false, replace = false } = {}) {
  currentSnapshot = snapshot;
  fillLetter(snapshot);
  clearAnimTimers();
  const wrap = $('envelope-wrap');
  const env = $('envelope-closed');
  const paper = $('letter-paper');
  env.classList.remove('opening', 'rising');
  wrap.classList.remove('leaving');
  paper.classList.remove('show');

  const skip = !animate || prefs.skipAnim || reduceMotionMQ.matches;
  wrap.hidden = skip;
  if (skip) revealPaper();
  navigate('letter', { replace: replace || currentScreen() === 'letter' });
  if (!skip) requestAnimationFrame(() => env.focus({ preventScroll: true }));
  window.scrollTo(0, 0);
}

function startOpening() {
  const env = $('envelope-closed');
  if (env.classList.contains('opening')) return;
  $('tap-hint').textContent = '正在拆信…';
  env.classList.add('opening');
  animTimers.push(setTimeout(() => env.classList.add('rising'), 550));
  animTimers.push(setTimeout(() => $('envelope-wrap').classList.add('leaving'), 1300));
  animTimers.push(setTimeout(revealPaper, 1700));
}

function revealPaper() {
  clearAnimTimers();
  $('envelope-wrap').hidden = true;
  $('tap-hint').textContent = '轻触火漆，拆开这封信';
  const paper = $('letter-paper');
  paper.classList.add('show');
  requestAnimationFrame(() => $('letter-title').focus({ preventScroll: true }));
}

/* ---------- 收藏 ---------- */
function updateFavButtons() {
  const on = !!currentSnapshot?.favorite;
  [$('favorite-btn'), $('favorite-top')].forEach((b) => {
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? '取消收藏' : '收藏这封信');
  });
  $('favorite-btn').querySelector('.lbl').textContent = on ? '已收藏' : '收藏';
}

async function toggleFavorite(id, sourceBtn) {
  const item = allItems.find((i) => i.id === id) || (await dbGet(id));
  if (!item) return;
  item.favorite = !item.favorite;
  try { await dbPut(item); } catch (err) { item.favorite = !item.favorite; toast('收藏没能保存，请再试一次'); return; }
  if (currentSnapshot && currentSnapshot.id === id) { currentSnapshot.favorite = item.favorite; updateFavButtons(); }
  if (sourceBtn) { sourceBtn.classList.remove('pop'); void sourceBtn.offsetWidth; sourceBtn.classList.add('pop'); }
  toast(item.favorite ? '已收进收藏夹' : '已取消收藏');
  if (currentScreen() === 'history') renderHistory();
}

/* ---------- 历史信箱 ---------- */
function highlight(text, q) {
  const safe = escapeHTML(text);
  if (!q) return safe;
  return safe.replace(new RegExp(escapeRegExp(escapeHTML(q)), 'gi'), (m) => `<mark>${m}</mark>`);
}

function renderHistory() {
  const list = $('history-list');
  const q = $('search-input').value.trim();
  const ql = q.toLowerCase();
  const favCount = allItems.filter((i) => i.favorite).length;
  $('n-all').textContent = allItems.length;
  $('n-fav').textContent = favCount;
  $('history-count').textContent = allItems.length ? `共 ${allItems.length} 封` : '';

  const filtered = allItems.filter((item) => {
    if (currentFilter === 'fav' && !item.favorite) return false;
    if (!ql) return true;
    return [item.title, item.body, item.themeName, themeLabel(item.themeName), personalize(item.title), personalize(item.body), item.style]
      .some((s) => String(s || '').toLowerCase().includes(ql));
  });

  if (!filtered.length) {
    let msg;
    if (!allItems.length) msg = '信箱还空着。<br>去拆第一封信吧。';
    else if (q) msg = `没有找到和「${escapeHTML(q)}」有关的信。`;
    else msg = '还没有收藏的信。<br>读到喜欢的，点一下 ♡ 就会留在这里。';
    list.innerHTML = `<li class="empty"><div class="empty-env" aria-hidden="true"></div><p>${msg}</p>${!allItems.length ? '<button class="pill-btn solid" type="button" data-go-home>去拆信</button>' : ''}</li>`;
    list.querySelector('[data-go-home]')?.addEventListener('click', () => navigate('home'));
    return;
  }

  list.innerHTML = filtered.map((item) => {
    const icon = item.themeIcon || lettersData?.themes.find((t) => t.id === item.themeId)?.icon || '✉️';
    const title = personalize(item.title);
    const body = personalize(item.body);
    let excerpt = body;
    if (ql) {
      const idx = body.toLowerCase().indexOf(ql);
      if (idx > 18) excerpt = '…' + body.slice(idx - 14);
    }
    return `
    <li class="history-card" data-id="${escapeHTML(item.id)}">
      <button class="hc-open" type="button" data-act="open" aria-label="打开《${escapeHTML(title)}》">
        <span class="hc-icon" aria-hidden="true">${escapeHTML(icon)}</span>
        <span class="hc-text">
          <span class="hc-title">${item.favorite ? '<svg class="ico" aria-label="已收藏"><use href="#i-heart"/></svg>' : ''}<span class="t">${highlight(title, q)}</span></span>
          <span class="hc-excerpt">${highlight(excerpt, q)}</span>
          <span class="hc-meta">${escapeHTML(themeLabel(item.themeName))} · ${formatDate(item.time, true)}</span>
        </span>
      </button>
      <span class="hc-tools">
        <button class="icon-btn fav-toggle" type="button" data-act="fav" aria-pressed="${!!item.favorite}" aria-label="${item.favorite ? '取消收藏' : '收藏'}《${escapeHTML(title)}》">
          <svg class="ico" aria-hidden="true"><use href="#i-heart"/></svg></button>
        <button class="icon-btn del" type="button" data-act="del" aria-label="删除《${escapeHTML(title)}》">
          <svg class="ico" aria-hidden="true"><use href="#i-trash"/></svg></button>
      </span>
    </li>`;
  }).join('');
}

async function deleteOne(id) {
  const item = allItems.find((i) => i.id === id);
  if (!item) return;
  const card = $('history-list').querySelector(`[data-id="${CSS.escape(id)}"]`);
  try { await dbDelete(id); } catch { toast('删除失败，请再试一次'); return; }
  allItems = allItems.filter((i) => i.id !== id);
  const finish = () => { renderHistory(); renderMoods(); };
  if (card && !reduceMotionMQ.matches) { card.classList.add('removing'); setTimeout(finish, 260); } else finish();
  toast('已删除这封信', '撤销', async () => {
    await dbPut(item);
    await refreshItems();
    renderHistory(); renderMoods();
    toast('已恢复');
  });
}

async function reopenLetter(id) {
  const item = allItems.find((i) => i.id === id) || (await dbGet(id));
  if (!item) { toast('找不到这封信了'); return; }
  showLetter(item, { animate: false });
}

/* ---------- 导入 / 导出 ---------- */
async function exportBackup() {
  await refreshItems();
  if (!allItems.length) { toast('信箱还是空的，暂时不用备份'); return; }
  const blob = new Blob([JSON.stringify(allItems, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `请在这时打开-备份-${new Date().toISOString().slice(0, 10)}.json`);
  toast(`已导出 ${allItems.length} 封信`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function isValidItem(i) {
  return i && typeof i === 'object' && (typeof i.id === 'string' || typeof i.id === 'number') &&
    typeof i.title === 'string' && typeof i.body === 'string';
}

async function importBackup(file) {
  try {
    const data = safeJSON(await file.text(), null);
    const raw = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
    if (!raw) throw new Error('format');
    const items = raw.filter(isValidItem).map((i) => ({
      ...i,
      id: String(i.id),
      time: i.time && !isNaN(new Date(i.time)) ? i.time : new Date().toISOString(),
      themeName: i.themeName || '',
      favorite: !!i.favorite,
    }));
    if (!items.length) throw new Error('empty');
    const existing = new Set(allItems.map((i) => i.id));
    const added = items.filter((i) => !existing.has(i.id)).length;
    await dbPutMany(items);
    await refreshItems();
    renderHistory(); renderMoods();
    toast(`导入完成：新增 ${added} 封，更新 ${items.length - added} 封`);
  } catch (err) {
    console.warn('导入失败', err);
    toast('这个文件不是有效的信箱备份');
  }
}

/* ---------- 弹窗 / 提示 ---------- */
let toastTimer;
function toast(text, actionLabel, action) {
  const el = $('toast');
  $('toast-text').textContent = text;
  const btn = $('toast-action');
  btn.hidden = !actionLabel;
  btn.onclick = null;
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.onclick = () => { el.hidden = true; action?.(); };
  }
  el.hidden = false;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, actionLabel ? 5000 : 2400);
}

function confirmDialog(title, text, okLabel = '确定') {
  const dlg = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    if (typeof dlg.showModal !== 'function') return resolve(window.confirm(`${title}\n${text}`));
    const done = (v) => { dlg.close(); cleanup(); resolve(v); };
    const ok = () => done(true);
    const cancel = () => done(false);
    const onCancel = (e) => { e.preventDefault(); done(false); };
    function cleanup() {
      $('confirm-ok').removeEventListener('click', ok);
      $('confirm-cancel').removeEventListener('click', cancel);
      dlg.removeEventListener('cancel', onCancel);
    }
    $('confirm-ok').addEventListener('click', ok);
    $('confirm-cancel').addEventListener('click', cancel);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
    $('confirm-cancel').focus();
  });
}

/* ---------- 生成信纸图片（Canvas，无外部库） ---------- */
const SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Noto Serif CJK SC", "Source Han Serif SC", "Noto Serif TC", "PMingLiU", "SimSun", serif';
const NO_LINE_START = '，。、；：？！）」』》〉”’…—,.;:?!)]}%·～~';

function wrapText(ctx, text, maxWidth, indentPx = 0) {
  const lines = [];
  String(text).split(/\n+/).forEach((para) => {
    const tokens = para.match(/[A-Za-z0-9'’\-]+|\s+|./gu) || [];
    let line = '';
    let limit = maxWidth - indentPx;
    let first = true;
    for (const tok of tokens) {
      const test = line + tok;
      if (ctx.measureText(test).width <= limit || !line) { line = test; continue; }
      if (NO_LINE_START.includes(tok[0])) { line = test; continue; } // 标点挂在行尾
      lines.push({ text: line.trimEnd(), indent: first ? indentPx : 0 });
      first = false; limit = maxWidth;
      line = tok.trimStart();
    }
    if (line) lines.push({ text: line, indent: first ? indentPx : 0 });
  });
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHeart(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + r * 0.9);
  ctx.bezierCurveTo(cx - r * 1.4, cy, cx - r * 0.9, cy - r * 1.1, cx, cy - r * 0.35);
  ctx.bezierCurveTo(cx + r * 0.9, cy - r * 1.1, cx + r * 1.4, cy, cx, cy + r * 0.9);
  ctx.fill();
}

async function renderShareImage(snapshot) {
  try { await document.fonts?.ready; } catch { /* ignore */ }
  const W = 1080, M = 70, PAD = 88;
  const textW = W - M * 2 - PAD * 2;
  const icon = snapshot.themeIcon || lettersData?.themes.find((t) => t.id === snapshot.themeId)?.icon || '✉️';
  const title = personalize(snapshot.title);
  const body = personalize(snapshot.body);
  const tag = `${icon} ${themeLabel(snapshot.themeName)}${snapshot.style ? ' · ' + snapshot.style : ''}`;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `600 54px ${SERIF}`;
  const titleLines = wrapText(measure, title, textW);
  measure.font = `40px ${SERIF}`;
  const bodyLines = wrapText(measure, body, textW, 80);

  const LH = 78, TLH = 80;
  const paperTop = 120;
  let y = paperTop + 120;                 // tag baseline
  const tagY = y; y += 92;
  const salY = y; y += 92;
  const titleY = y; y += titleLines.length * TLH + 36;
  const bodyY = y; y += bodyLines.length * LH + 40;
  const signY = y; y += 52;
  const dateY = y; y += 90;
  const paperBottom = Math.max(y, 1180);
  const H = paperBottom + 170;

  const scale = 1;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // 背景
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#fbf3ee'); bg.addColorStop(1, '#f1dfd9');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // 点点装饰
  ctx.fillStyle = 'rgba(212,165,165,0.18)';
  for (let i = 0; i < 26; i++) {
    const px = (i * 397) % W, py = (i * 613) % H;
    ctx.beginPath(); ctx.arc(px, py, 3 + (i % 4), 0, Math.PI * 2); ctx.fill();
  }

  // 信纸
  ctx.save();
  ctx.shadowColor = 'rgba(74,63,53,0.16)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  roundRect(ctx, M, paperTop, W - M * 2, paperBottom - paperTop, 14);
  ctx.fillStyle = '#fffaf5'; ctx.fill();
  ctx.restore();
  // 横线
  ctx.save();
  roundRect(ctx, M, paperTop, W - M * 2, paperBottom - paperTop, 14); ctx.clip();
  ctx.strokeStyle = 'rgba(212,165,165,0.22)'; ctx.lineWidth = 2;
  for (let ly = bodyY + 22; ly < signY - 30; ly += LH) {
    ctx.beginPath(); ctx.moveTo(M + PAD - 20, ly); ctx.lineTo(W - M - PAD + 20, ly); ctx.stroke();
  }
  // 左侧细边
  ctx.strokeStyle = 'rgba(212,165,165,0.35)';
  ctx.beginPath(); ctx.moveTo(M + 40, paperTop + 40); ctx.lineTo(M + 40, paperBottom - 40); ctx.stroke();
  ctx.restore();

  // 火漆
  const sx = W / 2, sy = paperTop;
  ctx.save();
  ctx.shadowColor = 'rgba(120,60,60,0.3)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  const wax = ctx.createRadialGradient(sx - 14, sy - 14, 4, sx, sy, 46);
  wax.addColorStop(0, '#e0b1b0'); wax.addColorStop(0.6, '#c98e8e'); wax.addColorStop(1, '#ad7273');
  ctx.fillStyle = wax; ctx.beginPath(); ctx.arc(sx, sy, 44, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,250,245,0.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(sx, sy, 33, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,250,245,0.92)'; drawHeart(ctx, sx, sy + 2, 15);

  // 文字
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#7a6a5f'; ctx.textAlign = 'center';
  ctx.font = `28px ${SERIF}`;
  ctx.fillText(tag, W / 2, tagY);

  ctx.textAlign = 'left'; ctx.fillStyle = '#7a6a5f';
  ctx.font = `36px ${SERIF}`;
  ctx.fillText(salutation(), M + PAD, salY);

  ctx.fillStyle = '#4a3f35'; ctx.textAlign = 'center';
  ctx.font = `600 54px ${SERIF}`;
  titleLines.forEach((l, i) => ctx.fillText(l.text, W / 2, titleY + i * TLH));

  ctx.textAlign = 'left'; ctx.font = `40px ${SERIF}`; ctx.fillStyle = '#4a3f35';
  bodyLines.forEach((l, i) => ctx.fillText(l.text, M + PAD + l.indent, bodyY + i * LH));

  ctx.textAlign = 'right';
  ctx.font = `38px ${SERIF}`; ctx.fillStyle = '#4a3f35';
  ctx.fillText(`—— ${prefs.taName}`, W - M - PAD, signY);
  ctx.font = `26px ${SERIF}`; ctx.fillStyle = '#a8988c';
  ctx.fillText(formatDate(snapshot.time), W - M - PAD, dateY);

  // 页脚品牌
  ctx.textAlign = 'center';
  const fy = paperBottom + 96;
  ctx.fillStyle = '#b77b7f';
  ctx.font = `600 32px ${SERIF}`;
  const brand = '请在这时打开';
  const bw = ctx.measureText(brand).width;
  // 小信封
  const ex = W / 2 - bw / 2 - 58, ey = fy - 28;
  ctx.strokeStyle = '#b77b7f'; ctx.lineWidth = 2.5;
  roundRect(ctx, ex, ey, 40, 28, 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(ex + 2, ey + 3); ctx.lineTo(ex + 20, ey + 16); ctx.lineTo(ex + 38, ey + 3); ctx.stroke();
  ctx.fillText(brand, W / 2 + 6, fy);
  ctx.font = `22px ${SERIF}`; ctx.fillStyle = '#a8988c';
  ctx.fillText('一封只属于你的信', W / 2, fy + 42);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

let shareBlob = null, shareURL = null;
async function openShare() {
  if (!currentSnapshot) return;
  const dlg = $('share-dialog');
  const preview = $('share-preview');
  preview.innerHTML = '<p class="loading">正在誊写…</p>';
  $('share-native').hidden = true;
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  try {
    shareBlob = await renderShareImage(currentSnapshot);
    if (shareURL) URL.revokeObjectURL(shareURL);
    shareURL = URL.createObjectURL(shareBlob);
    const img = new Image();
    img.alt = `信纸图片：${personalize(currentSnapshot.title)}`;
    img.src = shareURL;
    preview.replaceChildren(img);
    const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
    $('share-native').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
  } catch (err) {
    console.warn('生成图片失败', err);
    preview.innerHTML = '<p class="loading">图片生成失败，请再试一次</p>';
  }
}
function shareFileName() {
  const t = personalize(currentSnapshot?.title || '信').replace(/[\\/:*?"<>|\s]+/g, '');
  return `请在这时打开-${t}.png`;
}
function closeShare() {
  const dlg = $('share-dialog');
  if (dlg.open) (typeof dlg.close === 'function' ? dlg.close() : dlg.removeAttribute('open'));
}

/* ---------- 路由（支持手机返回键） ---------- */
function currentScreen() { return document.querySelector('.screen.active')?.id || 'home'; }

function render(id) {
  if (id === 'letter' && !currentSnapshot) id = 'home';
  if (id !== 'letter') clearAnimTimers();
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('on-letter', id === 'letter');
  document.querySelectorAll('.nav-btn').forEach((b) => {
    const on = b.dataset.screen === id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  if (id === 'history') renderHistory();
  if (id === 'home') { renderMoods(); updateGreeting(); }
  if (id !== 'letter') {
    window.scrollTo(0, 0);
    const h = document.querySelector(`#${id} h1`);
    if (h && document.activeElement && document.activeElement !== document.body) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
}

function navigate(id, { replace = false } = {}) {
  const st = history.state || { s: 'home', depth: 0 };
  if (id === 'home') {
    if (st.depth > 0) { history.go(-st.depth); return; }
    render('home'); return;
  }
  const from = currentScreen();
  const tabSwitch = from !== 'home' && from !== 'letter' && id !== 'letter';
  if (replace || tabSwitch) history.replaceState({ s: id, depth: st.depth }, '', '#' + id);
  else history.pushState({ s: id, depth: st.depth + 1 }, '', '#' + id);
  render(id);
}
function goBack() {
  const st = history.state;
  if (st && st.depth > 0) history.back(); else render('home');
}
window.addEventListener('popstate', (e) => {
  closeShare();
  render(e.state?.s || 'home');
});

/* ---------- 安装 ---------- */
let deferredPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function setupInstall() {
  const card = $('install-card');
  const btn = $('install-btn');
  if (isStandalone()) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) {
    card.hidden = false;
    $('install-text').textContent = '在 Safari 里点底部的「分享」按钮，再选「添加到主屏幕」，就能像 App 一样打开，没有网络也能读信。';
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    card.hidden = false; btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null; btn.hidden = true;
    if (outcome === 'accepted') { card.hidden = true; toast('已添加到主屏幕'); }
  });
  window.addEventListener('appinstalled', () => { card.hidden = true; });
}

/* ---------- Service Worker ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
      const promptUpdate = (worker) => toast('信箱有新版本', '刷新', () => worker.postMessage('SKIP_WAITING'));
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return; reloading = true; location.reload();
      });
    } catch (err) {
      console.warn('Service worker 注册失败', err);
    }
  });
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => navigate(btn.dataset.screen)));
  $('mood-grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.mood-btn');
    if (btn) openLetterForTheme(btn.dataset.theme);
  });
  $('envelope-stack').addEventListener('click', openRandom);
  $('random-btn').addEventListener('click', openRandom);
  $('edit-names-btn').addEventListener('click', () => { navigate('settings'); setTimeout(() => $('input-user-name').focus(), 50); });

  // 拆信
  $('envelope-closed').addEventListener('click', startOpening);
  $('skip-anim').addEventListener('click', revealPaper);
  $('back-from-letter').addEventListener('click', goBack);
  $('close-letter').addEventListener('click', () => navigate('home'));
  $('another-btn').addEventListener('click', () => currentSnapshot && openLetterForTheme(currentSnapshot.themeId, { replace: true }));
  $('favorite-btn').addEventListener('click', (e) => currentSnapshot && toggleFavorite(currentSnapshot.id, e.currentTarget));
  $('favorite-top').addEventListener('click', (e) => currentSnapshot && toggleFavorite(currentSnapshot.id, e.currentTarget));
  $('share-btn').addEventListener('click', openShare);

  // 分享图片
  $('share-close').addEventListener('click', closeShare);
  $('share-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeShare(); });
  $('share-download').addEventListener('click', () => {
    if (!shareBlob) return;
    downloadBlob(shareBlob, shareFileName());
    toast('图片已保存');
  });
  $('share-native').addEventListener('click', async () => {
    if (!shareBlob) return;
    const file = new File([shareBlob], shareFileName(), { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: '请在这时打开', text: personalize(currentSnapshot.title) });
    } catch (err) {
      if (err.name !== 'AbortError') toast('分享没有成功，可以先保存图片');
    }
  });

  // 历史
  let searchTimer;
  $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderHistory, 120); });
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
    currentFilter = tab.dataset.filter;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    renderHistory();
  }));
  $('history-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.history-card')?.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'open') reopenLetter(id);
    else if (btn.dataset.act === 'fav') toggleFavorite(id, btn);
    else if (btn.dataset.act === 'del') deleteOne(id);
  });
  $('export-btn').addEventListener('click', exportBackup);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  });
  $('clear-btn').addEventListener('click', async () => {
    if (!allItems.length) { toast('信箱已经是空的了'); return; }
    const ok = await confirmDialog('清空所有信件？', `${allItems.length} 封信和收藏都会被删除。建议先导出备份。`, '清空');
    if (!ok) return;
    const backup = allItems.slice();
    await dbClear();
    allItems = [];
    renderHistory(); renderMoods();
    toast('信箱已清空', '撤销', async () => {
      await dbPutMany(backup); await refreshItems(); renderHistory(); renderMoods(); toast('已恢复');
    });
  });

  // 设置
  $('names-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('input-user-name').value.trim();
    const t = $('input-ta-name').value.trim();
    if (u && u !== '你') localStorage.setItem('userName', u); else localStorage.removeItem('userName');
    if (t && t !== 'TA') localStorage.setItem('taName', t); else localStorage.removeItem('taName');
    const mode = document.querySelector('input[name="call-mode"]:checked')?.value || 'you';
    localStorage.setItem('callMode', mode);
    updateNameDisplay();
    renderMoods();
    toast('已保存称呼');
  });
  $('skip-anim-pref').addEventListener('change', (e) => {
    localStorage.setItem('skipAnim', e.target.checked ? '1' : '0');
    toast(e.target.checked ? '之后拆信会直接展开信纸' : '已恢复拆信动画');
  });
}

/* ---------- 启动 ---------- */
(async function init() {
  $('app-version').textContent = `版本 ${APP_VERSION}`;
  bindEvents();
  updateNameDisplay();
  setupInstall();
  registerSW();
  // 初始路由
  const initial = (location.hash || '').slice(1);
  history.replaceState({ s: 'home', depth: 0 }, '', location.pathname + location.search);
  try { await initDB(); } catch (err) {
    console.warn('IndexedDB 不可用', err);
    toast('当前浏览器无法保存信件记录（可能是无痕模式）');
  }
  await refreshItems();
  await loadLetters();
  if (initial === 'history' || initial === 'settings') navigate(initial);
})();
