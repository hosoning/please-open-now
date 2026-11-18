const DB_NAME = 'PleaseOpenNowDB';
const DB_VERSION = 1;
const STORE_NAME = 'letters';

let db;
let lettersData = null;
let currentUserName = localStorage.getItem('userName') || '你';
let currentTaName = localStorage.getItem('taName') || 'TA';
let recentLetterIds = JSON.parse(localStorage.getItem('recentIds') || '[]');

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function loadLetters() {
  const res = await fetch('letters.json');
  lettersData = await res.json();
  renderMoods();
  renderEnvelopeStack();
}

function renderMoods() {
  const grid = document.getElementById('mood-grid');
  grid.innerHTML = lettersData.themes.map(theme => `
    <button class="mood-btn" data-theme="${theme.id}">
      <div class="icon">${theme.icon}</div>
      <div class="name">${theme.name}</div>
    </button>
  `).join('');
  grid.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => openLetterForTheme(btn.dataset.theme));
  });
}

function renderEnvelopeStack() {
  const stack = document.getElementById('envelope-stack');
  stack.innerHTML = `
    <div class="envelope-preview"></div>
    <div class="envelope-preview"></div>
    <div class="envelope-preview"></div>
  `;
}

function updateNameDisplay() {
  document.getElementById('user-name-display').textContent = currentUserName;
  document.getElementById('ta-name-display').textContent = currentTaName;
  document.getElementById('input-user-name').value = currentUserName;
  document.getElementById('input-ta-name').value = currentTaName;
}

async function openLetterForTheme(themeId) {
  const theme = lettersData.themes.find(t => t.id === themeId);
  if (!theme) return;

  // Prefer unread recent
  let available = theme.letters.filter(l => !recentLetterIds.includes(l.id));
  if (available.length === 0) available = theme.letters;
  const letter = available[Math.floor(Math.random() * available.length)];

  // Update recent
  recentLetterIds = [letter.id, ...recentLetterIds.filter(id => id !== letter.id)].slice(0, 30);
  localStorage.setItem('recentIds', JSON.stringify(recentLetterIds));

  showLetter(letter, theme);
}

function showLetter(letter, theme) {
  document.getElementById('letter-title').textContent = letter.title;
  document.getElementById('letter-body').textContent = letter.body.replace(/TA/g, currentTaName).replace(/你/g, currentUserName);
  document.getElementById('letter-meta').textContent = theme.name;

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('letter').classList.add('active');

  const envelope = document.getElementById('envelope-closed');
  const paper = document.getElementById('letter-paper');
  envelope.classList.remove('open');
  paper.classList.remove('show');

  setTimeout(() => {
    envelope.classList.add('open');
    setTimeout(() => paper.classList.add('show'), 400);
  }, 100);

  // Save snapshot
  saveLetterSnapshot(letter, theme);
}

async function saveLetterSnapshot(letter, theme) {
  const snapshot = {
    id: Date.now().toString(),
    time: new Date().toISOString(),
    userName: currentUserName,
    taName: currentTaName,
    themeId: theme.id,
    themeName: theme.name,
    letterId: letter.id,
    title: letter.title,
    body: letter.body,
    style: letter.style,
    favorite: false
  };
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(snapshot);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'history') loadHistory();
}

async function loadHistory() {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.getAll();
  request.onsuccess = () => {
    const items = request.result.sort((a, b) => new Date(b.time) - new Date(a.time));
    renderHistory(items);
  };
}

function renderHistory(items) {
  const list = document.getElementById('history-list');
  const search = document.getElementById('search-input').value.toLowerCase();
  const filtered = items.filter(item => 
    item.title.toLowerCase().includes(search) || 
    item.themeName.toLowerCase().includes(search) ||
    item.body.toLowerCase().includes(search)
  );
  list.innerHTML = filtered.map(item => `
    <div class="history-card" data-id="${item.id}">
      <div class="title">${item.title}</div>
      <div class="meta">${item.themeName} · ${new Date(item.time).toLocaleDateString('zh-CN')}</div>
    </div>
  `).join('') || '<p style="text-align:center;color:#7a6a5f;padding:40px;">还没有信件</p>';

  list.querySelectorAll('.history-card').forEach(card => {
    card.addEventListener('click', () => reopenLetter(card.dataset.id));
  });
}

async function reopenLetter(id) {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const request = store.get(id);
  request.onsuccess = () => {
    const item = request.result;
    if (!item) return;
    document.getElementById('letter-title').textContent = item.title;
    document.getElementById('letter-body').textContent = item.body;
    document.getElementById('letter-meta').textContent = item.themeName + ' · 历史';
    showScreen('letter');
    document.getElementById('envelope-closed').style.display = 'none';
    document.getElementById('letter-paper').classList.add('show');
  };
}

// Navigation
document.querySelectorAll('[data-screen]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.screen));
});

document.getElementById('back-from-letter').addEventListener('click', () => showScreen('home'));
document.getElementById('close-letter').addEventListener('click', () => showScreen('home'));

document.getElementById('edit-names-btn').addEventListener('click', () => showScreen('settings'));
document.getElementById('save-names').addEventListener('click', () => {
  currentUserName = document.getElementById('input-user-name').value.trim() || '你';
  currentTaName = document.getElementById('input-ta-name').value.trim() || 'TA';
  localStorage.setItem('userName', currentUserName);
  localStorage.setItem('taName', currentTaName);
  updateNameDisplay();
  showScreen('home');
});

document.getElementById('search-input').addEventListener('input', loadHistory);

document.getElementById('export-btn').addEventListener('click', async () => {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const request = tx.objectStore(STORE_NAME).getAll();
  request.onsuccess = () => {
    const blob = new Blob([JSON.stringify(request.result, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `请在这时打开-备份-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };
});

document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const items = JSON.parse(text);
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  for (const item of items) {
    store.put(item);
  }
  alert('导入完成');
  loadHistory();
});

document.getElementById('clear-btn').addEventListener('click', () => {
  if (confirm('确定清空所有信件记录？此操作不可恢复。')) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    loadHistory();
  }
});

// Favorite & Share placeholders (可扩展)
document.getElementById('favorite-btn').addEventListener('click', () => alert('已收藏（功能可继续完善）'));
document.getElementById('share-btn').addEventListener('click', () => alert('分享图片功能可继续完善（可使用 html2canvas）'));

// Init
(async () => {
  await initDB();
  await loadLetters();
  updateNameDisplay();
})();
