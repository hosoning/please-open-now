# 請在這時打開 · Please Open Now

> 一個只屬於你的私人信箱：選擇今天的心情，拆開一封來自 TA 的信。
> 奶油白 × 霧粉信紙風，手機優先，可安裝到主畫面、離線也能讀信。

純靜態網站（HTML + CSS + 原生 JavaScript），**沒有任何外部依賴、不需要後端、不需要建置步驟**。把資料夾丟上任何靜態主機就能用。

---

## ✨ 功能

| 功能 | 說明 |
| --- | --- |
| 12 種心情 × 10 封信 | 共 120 封人工撰寫的信，存在 `letters.json`，會優先挑最近沒讀過的信 |
| 拆信儀式 | 輕觸火漆 → 信封打開 → 信紙滑出；隨時可按「跳過動畫」，設定裡也能永久關閉；系統開啟「減少動態效果」時自動跳過 |
| 名字客製 | 設定「你的名字」與「TA 的名字」；可選擇只在開頭稱呼，或把正文的「你」也換成名字。歷史信件重新打開時也會套用最新名字 |
| 收藏 | 信紙上或歷史列表一鍵收藏／取消，存在 IndexedDB；歷史頁可切換「全部／收藏」 |
| 生成圖片 | 把信件排版成 1080×1350（IG 4:5）的信紙 PNG，含火漆、橫線、品牌落款；支援系統分享（Web Share API），或直接儲存 |
| 我們的信箱 | 完整信件快照、關鍵字搜尋（含高亮）、單封刪除（可復原）、清空（可復原） |
| 備份 | 匯出／匯入 JSON 備份，匯入會驗證格式並合併 |
| PWA | 可安裝到手機主畫面、獨立視窗開啟、離線可用、有新版本時會提示「刷新」 |
| 無障礙 | 鍵盤可操作、焦點樣式、ARIA 標籤、手機返回鍵可正確返回上一頁 |

## 📁 檔案結構

```
index.html              主頁面
styles.css              所有樣式（顏色變數在最上方 :root）
app.js                  所有互動邏輯
letters.json            信件內容 ← 買家最常改的檔案
manifest.webmanifest    PWA 設定（名稱、顏色、圖示）
sw.js                   Service Worker（離線快取）
icons/                  App 圖示（由 tools/make_icons.py 產生）
tools/make_icons.py     重新產生圖示的腳本（Python + Pillow）
tools/e2e-test.js       自動化測試（Playwright，可選）
```

## 🚀 本機預覽

Service Worker 與 IndexedDB 需要透過 http 開啟（直接雙擊 `index.html` 也能看，但不會有離線功能）：

```bash
cd 02-please-open-now
python3 -m http.server 8080
# 打開 http://localhost:8080/
```

## 🌐 部署

所有路徑都是相對路徑，可以放在網域根目錄，也可以放在子路徑（例如 GitHub Pages 的 `https://帳號.github.io/專案名/`）。**必須是 HTTPS**（PWA 安裝與離線功能的要求，以下平台都預設提供）。

**GitHub Pages**
1. 建立一個 repository，把本資料夾內的所有檔案上傳到根目錄。
2. Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`，儲存。
3. 約一分鐘後即可在 `https://帳號.github.io/專案名/` 開啟。

**Cloudflare Pages / Netlify / Vercel**
直接把資料夾拖進後台（或連結 repo），Build command 留空，Output directory 填 `/`（或 `.`）即可。

### ⚠️ 每次修改後要做的事

修改任何檔案（包含 `letters.json`）後，打開 `sw.js` 把第一行的版本號加一：

```js
const CACHE_VERSION = 'v1.1.1';   // 例如 v1.1.0 → v1.1.1
```

這樣已安裝的使用者下次打開時，會看到「信箱有新版本 · 刷新」的提示。（`letters.json` 本身採「網路優先」，有網路時就會抓最新版，但仍建議一起改版本號。）

## ✍️ 買家客製化指南

### 1. 修改信件內容（`letters.json`）

```json
{
  "themes": [
    {
      "id": "happy",              // 英文代號，不要重複；歷史紀錄靠它對應
      "name": "今天很开心",        // 心情按鈕上的文字，可寫「TA」，會自動換成 TA 的名字
      "icon": "☀️",               // 一個 emoji
      "letters": [
        {
          "id": "happy_001",       // 每封信唯一的代號，不要重複
          "title": "把今天好好存起来",
          "style": "温柔",          // 小標籤，顯示在信紙上方
          "body": "信的正文……"      // 可用 \n 換段
        }
      ]
    }
  ]
}
```

- **名字替換規則**：正文、標題、心情名稱裡的 `TA` 會換成使用者設定的 TA 名字；使用者若選「正文的『你』也換成名字」，所有的 `你` 會換成使用者名字。撰寫時請以「你」稱呼讀者、以「TA」稱呼寫信的人。
- 心情數量、每個心情的信件數量都可以自由增減（首頁按鈕會自動排版）。
- 改完可以用 <https://jsonlint.com> 檢查格式是否正確，格式錯誤時網站會顯示「信件暫時取不到」。

### 2. 修改網站名稱

- `index.html`：`<title>`、`apple-mobile-web-app-title`、首頁 `<h1>`、`og:title`
- `manifest.webmanifest`：`name`、`short_name`（短名稱建議 ≤ 6 個字，主畫面才不會被截斷）
- `app.js`：搜尋 `请在这时打开`（分享圖片落款、備份檔名）

### 3. 修改配色

`styles.css` 最上方的 `:root` 變數：`--cream`（底色）、`--blush` / `--rose` / `--rose-deep`（粉色系與主按鈕）、`--ink`（文字）。同時記得改 `manifest.webmanifest` 與 `index.html` 裡的 `theme_color` / `theme-color`。

### 4. 重新產生 App 圖示

```bash
pip install pillow
python3 tools/make_icons.py
```

調色盤寫在腳本最上方（`CREAM`、`ROSE` 等），改完重跑即可覆寫 `icons/` 內所有圖示。

### 5. 免責聲明文字

在 `index.html` 的設定頁（搜尋 `disclaimer`）。

## 🧪 自動化測試（可選）

```bash
npm i -D playwright && npx playwright install chromium
python3 -m http.server 8080 &
BASE=http://localhost:8080/ node tools/e2e-test.js
```

會以手機尺寸跑完：首頁、拆信動畫、跳過動畫、收藏、生成圖片、名字替換、歷史搜尋／刪除／復原、匯出匯入、離線、減少動態效果、主控台錯誤檢查，並把截圖存到 `screens/`。

## 🔒 資料與隱私

所有資料只存在使用者自己的瀏覽器（IndexedDB + localStorage），不會上傳到任何伺服器。清除瀏覽器資料、無痕模式或更換裝置會遺失紀錄，請提醒使用者定期「匯出備份」。

所有內容均為虛構的角色代入式互動，並非來自真實人物。

## 📝 版本

- **1.1.0**：完整 PWA（可安裝、離線）、收藏、生成信紙圖片、跳過動畫、單封刪除與復原、歷史信件套用最新名字、無障礙與手機返回鍵支援、全新圖示。
- 1.0.0：初版。
