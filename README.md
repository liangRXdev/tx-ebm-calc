# 治療效益 EBM 計算器（tx-ebm-calc）

互動式治療效益實證計算器：輸入兩組結果，產生 **ARR / NNT / NNH / RRR / RR / OR**、可複製的**白話說明**，以及**百人效益圖（Cates plot）/ 長條圖**，並可列印單頁總表。為 [dx-ebm-calc](https://github.com/liangRXdev/dx-ebm-calc)（診斷端）的姊妹作。

> 教學／實證練習用，**非臨床決策依據**。

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Click%20Here-blue?style=for-the-badge)](https://liangrxdev.github.io/tx-ebm-calc/)

![百人效益圖（Cates plot 人偶）與事件率長條圖併呈](docs/screenshot-charts.png)

## 功能

### 輸入
- **三種輸入模式**
  - 四宮格（人數）：介入／對照 × 事件／無事件
  - 百分比（風險）：EER / CER（可附樣本數以算 CI）
  - 人年（Patient-Years）：事件數 + 人年 + 時間框架，累積風險採 `1 − e^(−rate·t)`
- **內建教學範例**：一鍵載入示意情境（二級預防、戒菸介入、人年中風），快速上手
- **結果事件性質切換**：依「不良事件（要減少）／有益事件（要增加）」**自動判定**產出 NNT（效益）或 NNH（危害），白話與圖示方向同步調整

### 效益指標
- **白話核心**：ARR/ARI、NNT/NNH、RRR、CER、EER
- **進階指標（可收合）**：RR、OR
- **NNT 信賴區間**：採 Altman 法；跨「無差異」時清楚表為 `NNTB … ∞ … NNTH`，不會誤導為單一有限值
- **零格自動校正**：任一格為 0 時對比值型指標 (RR/OR) 套 +0.5 連續性校正並於畫面標示
- **人年模式專屬**：累積風險換算、比率差／比率比（每 1000 人年）含 CI

### 個別化與成本（臨床決策輔助）
- **個別化外推**：輸入病人個別基線風險 PEER，套用試驗相對風險 (RR) 重算**個別化 NNT / ARR / 預估 EER**（Sackett/CEBM 法，假設 RRR 固定）
- **每預防 1 事件成本**：填入每人介入成本即算 `NNT × 成本`；個別化情境另給對應成本

### 白話說明
- **一鍵複製**：適合貼入病歷／教學講義
- 自動帶入介入／對照／結果／族群用詞，並附上 NNT CI、成本、個別化外推等補述

### 視覺化（圖一律唯讀，手機友善）
- **百人效益圖 (Cates plot)**：以 100 名相似病人呈現「不論治療都不發生／因治療避免事件／不論治療都發生」三類
  - 圖示可切換 **圓點 / 人偶**
  - 排列可切換 **群聚 / 隨機散布**（同組資料版面穩定）
- **長條圖**：CER vs EER 並標註 **Δ（ARR 落差）**
- **併呈模式**：Cates plot + 長條圖同時顯示
- **色盲友善配色**：Okabe-Ito 安全色，並以斜線圖樣為關鍵類別加上「形狀」冗餘編碼（不只靠顏色）

### 輸出與體驗
- **列印說明總表**：將情境、原始輸入、核心指標、個別化外推、白話結論、百人圖與免責聲明整理為**單頁匯總報告**，可送印 / 另存 PDF
- **PWA**：可安裝、離線可用
- **手機友善**：數字鍵盤 (`inputmode`)、圖表唯讀避免誤觸

## 統計方法

| 指標 | 95% CI 方法 | 來源 |
|---|---|---|
| ARR（風險差） | Newcombe-Wilson hybrid score | Newcombe, Stat Med 1998 |
| NNT | 由 ARR 的 CI 取倒數；跨 0 時表為「NNTB…∞…NNTH」 | Altman, BMJ 1998;317:1309 |
| RR | Katz log | |
| OR | Woolf log | |
| 比率（rate） | Wald（rate difference）/ log（rate ratio） | Poisson |

零格自動 +0.5 連續性校正（Haldane-Anscombe，作用於比值型指標）。

## 開發

- 純前端、單檔 `index.html` + `engine.js`（計算引擎，無 DOM 依賴）
- 引擎測試：`node engine.test.js`
- 圖示產生：`node tools/gen-icons.js`
- 本機預覽：`node .serve.js` 後開 <http://localhost:8732/>

## 結構

```
index.html              UI（載入 engine.js）
engine.js               計算引擎（瀏覽器 + Node 共用）
engine.test.js          引擎測試
manifest.webmanifest    PWA manifest
sw.js                   Service Worker（快取 shell）
icons/                  PWA 圖示
tools/gen-icons.js      圖示產生器
```
