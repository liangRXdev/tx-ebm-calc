# tx-ebm-calc — 專案規則

治療效益 EBM 計算器（ARR / NNT / NNH / RRR / RR / OR + Cates plot）。vanilla JS，無框架、無相依套件，部署於 GitHub Pages。`dx-ebm-calc` 是診斷端姊妹作。

**定位：教學／實證練習用，非臨床決策依據。**

---

## 架構

- `engine.js` — **全部計算邏輯**。UMD 包裝，瀏覽器掛 `window.TxEbm`、Node 走 `module.exports`，就是為了能純 Node 測試
- `engine.test.js` — 引擎測試，**這份就是規格**（期望值為手算／教科書值）
- `index.html` — 只做 UI 與繪圖，**不要在這裡放計算邏輯**
- `sw.js` — PWA shell 快取（`CACHE = 'tx-ebm-calc-v5'`，SHELL 含 `engine.js`）
- `tools/gen-icons.js` — 產生 PWA 圖示
- 無 `_headers`、無 CSP（GH Pages 不控標頭），改行內 script 不需重算 hash

## 改動流程

1. **動 `engine.js` 前先看 `engine.test.js`** — 各項期望值有註解說明來源（如「ARR=0.05、NNT=20、RR=0.75、OR=0.7059」），比任何 prose 描述精確。
2. 改完跑 `node engine.test.js`（純 Node，無外部依賴），**須全綠**。新增計算行為一併補測試。
3. **改動 shell 檔案（index.html / engine.js / manifest / icons）→ 升 `sw.js` 的 `CACHE` 版本號**（`-v5` → `-v6`），否則使用者拿到舊快取。
4. 需在瀏覽器實測時用本機靜態伺服器跑 `localhost:8732`（dx-ebm-calc 用 8731，刻意區隔避免 SW scope 打架）。作者本機有 `.serve.js`，已 gitignore、不在 repo 內。

## 引擎 API 表面

`zFor` / `wilson` / `newcombeRD` / `nntCI` / `ratioMeasures` / `direction` / `catesData` / `applyToBaseline` / `computeBinary` / `computeRate` / `fromCounts` / `fromRisks`

三種輸入模式都收斂到 `computeBinary`：`fromCounts`（四宮格）、`fromRisks`（EER/CER + 樣本數）、`computeRate`（人年，累積風險 `1 − e^(−rate·t)`）。新增輸入模式請照這個轉接器模式，不要另開計算路徑。

## 統計上不可退讓的幾點

- **NNT 信賴區間跨「無差異」時**，必須表為 `NNTB … ∞ … NNTH`，不可塌縮成單一有限值——這是 Altman 法的重點，塌縮就是誤導
- **零格處理**：任一格為 0 時，RR/OR 套 +0.5 連續性校正，且**畫面上要標示已校正**
- **NNT/NNH 方向由結果事件性質自動判定**（不良事件要減少 vs 有益事件要增加），白話文字與圖示方向必須同步，不可只改其一
- **個別化外推**採 Sackett/CEBM 法，假設 RRR 固定——這個假設要維持在畫面上可見

## 列印

`@media print` 單頁總表；用 `no-print` / `no-print-controls` class 標記列印時隱藏的元素。新增互動控制項記得加上。

## 樣式慣例

- 字型：`Noto Sans TC` 內文、`JetBrains Mono` 等寬（CSS 變數 `--mono`，用 `var(--mono)` 引用）
- CSS class 用 kebab-case + 空格分隔 modifier（`card no-print`、`btn solid`、`cell-evt`），非 BEM
- 圖表配色須對色盲友善（已做，改色前先確認）
