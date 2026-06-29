/* tx-ebm-calc 計算引擎（純函式，無 DOM 依賴）
 *
 * 同時支援瀏覽器（掛在 window.TxEbm）與 Node（module.exports）以便測試。
 * 統計方法與來源：
 *   - 風險差 ARR 之 95% CI：Newcombe-Wilson hybrid score（Newcombe, Stat Med 1998, method 10）
 *   - NNT 之 95% CI：Altman 法（BMJ 1998;317:1309）— CI 跨 0 時表為「NNTB…∞…NNTH」
 *   - RR 之 CI：Katz log 法；OR 之 CI：Woolf log 法
 *   - 比率(rate)：Wald（rate difference）/ log（rate ratio），以 Poisson 變異為基礎
 *   - 零格自動 +0.5 連續性校正（Haldane-Anscombe，僅作用於比值型指標）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TxEbm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 95% → 1.959964；保留可調的信賴水準
  function zFor(conf) {
    const table = { 0.9: 1.6448536, 0.95: 1.959964, 0.99: 2.5758293 };
    return table[conf] || 1.959964;
  }

  // ── Wilson score 區間（單一比例）──
  function wilson(r, n, z) {
    if (!(n > 0)) return { p: NaN, lower: NaN, upper: NaN };
    const p = r / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denom;
    const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
    return { p, lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
  }

  // ── ARR(=CER−EER) 的 Newcombe-Wilson 區間 ──
  // 參數：實驗組 rE/nE、對照組 rC/nC。差值定義為 pC − pE（>0 代表降低事件）。
  function newcombeRD(rE, nE, rC, nC, z) {
    const wE = wilson(rE, nE, z);
    const wC = wilson(rC, nC, z);
    const d = wC.p - wE.p;
    const lower = d - Math.sqrt((wC.p - wC.lower) ** 2 + (wE.upper - wE.p) ** 2);
    const upper = d + Math.sqrt((wC.upper - wC.p) ** 2 + (wE.p - wE.lower) ** 2);
    return { point: d, lower, upper };
  }

  // ── NNT 區間（Altman）：由 ARR 的 CI 取倒數 ──
  // 回傳 type：
  //   'finite'   → {low, high}     ARR 不跨 0，NNT 為有限區間
  //   'infinity' → {benefit, harm} ARR 跨 0，NNT 經過 ∞（NNTB…∞…NNTH）
  function nntCI(arr) {
    const { lower, upper } = arr;
    if (lower > 0 || upper < 0) {
      // 同號：NNT 與 ARR 反向，較大 ARR → 較小 NNT
      const a = 1 / Math.abs(upper), b = 1 / Math.abs(lower);
      return { type: 'finite', low: Math.min(a, b), high: Math.max(a, b) };
    }
    // 跨 0（含端點為 0）：經過無限大
    return {
      type: 'infinity',
      benefit: upper > 0 ? 1 / upper : Infinity, // NNTB 側
      harm: lower < 0 ? 1 / Math.abs(lower) : Infinity, // NNTH 側
    };
  }

  // ── 比值型指標（RR/OR）含零格 +0.5 校正 ──
  function ratioMeasures(a, nE, c, nC, z) {
    let b = nE - a, d = nC - c, corrected = false;
    if (a <= 0 || b <= 0 || c <= 0 || d <= 0) {
      a += 0.5; b += 0.5; c += 0.5; d += 0.5; corrected = true;
    }
    const n1 = a + b, n2 = c + d;
    const eer = a / n1, cer = c / n2;
    const rr = eer / cer;
    const seLnRR = Math.sqrt(1 / a - 1 / n1 + 1 / c - 1 / n2);
    const or = (a * d) / (b * c);
    const seLnOR = Math.sqrt(1 / a + 1 / b + 1 / c + 1 / d);
    return {
      corrected,
      rr,
      rrCI: { lower: rr * Math.exp(-z * seLnRR), upper: rr * Math.exp(z * seLnRR) },
      rrr: 1 - rr,
      or,
      orCI: { lower: or * Math.exp(-z * seLnOR), upper: or * Math.exp(z * seLnOR) },
    };
  }

  // ── 方向判定 ──
  // outcomeIsGood=false（不良事件，預設）：ARR>0（降低事件）為效益→NNT
  // outcomeIsGood=true （有益事件）       ：EER>CER（提高事件）為效益→NNT
  function direction(arrSigned, outcomeIsGood) {
    const benefit = outcomeIsGood ? arrSigned < 0 : arrSigned > 0;
    return { benefit, label: benefit ? 'NNT' : 'NNH' };
  }

  // ── 百人效益圖資料（Cates plot，以 100 人為單位）──
  // 對稱定義（效益與危害皆成立）：
  //   green  在較高風險情境下都不會發生事件 = (1 − max(EER,CER))·100
  //   change 因治療而改變（避免或多出）     = |CER−EER|·100
  //   red    在較低風險情境下仍發生事件     = min(EER,CER)·100（不論治療都會發生）
  function catesData(eer, cer) {
    const arr = cer - eer;
    const hi = Math.max(eer, cer);
    const good = Math.round((1 - hi) * 100);
    const changed = Math.round(Math.abs(arr) * 100);
    let bad = 100 - good - changed; // = round(min(EER,CER)·100)，並吸收捨入誤差
    if (bad < 0) bad = 0;
    return {
      good, bad, changed,
      changedType: arr >= 0 ? 'helped' : 'harmed', // helped=避免事件；harmed=多出事件
      controlEvents: Math.round(cer * 100),
      expEvents: Math.round(eer * 100),
    };
  }

  // ── 個別化外推：把試驗的相對風險(RR) 套到病人個別基線風險(PEER) ──
  // 假設相對效果可外推（RRR 固定，Sackett/CEBM 法）：
  //   病人 EER = PEER × RR；個別化 ARR = |PEER − EER|；NNT = 1/ARR。
  function applyToBaseline(rr, peer, outcomeIsGood) {
    const eer = Math.min(0.999999, Math.max(0, peer * rr));
    const arrSigned = peer - eer;
    const arrAbs = Math.abs(arrSigned);
    const dir = direction(arrSigned, !!outcomeIsGood);
    return {
      rr, peer, eer,
      arrSigned, arrAbs,
      benefit: dir.benefit,
      effectLabel: dir.label,
      nnt: arrAbs > 0 ? 1 / arrAbs : Infinity,
      nntCeil: arrAbs > 0 ? Math.ceil(1 / arrAbs) : Infinity,
      cates: catesData(eer, peer),
    };
  }

  // ── 主入口：二元結果（counts / risk 模式共用）──
  // 參數物件：{ rE, nE, rC, nC, outcomeIsGood=false, conf=0.95 }
  //   rE/rC 可為非整數（risk 模式由百分比×樣本數推得）
  function computeBinary(opts) {
    const { rE, nE, rC, nC } = opts;
    const outcomeIsGood = !!opts.outcomeIsGood;
    const conf = opts.conf || 0.95;
    const z = zFor(conf);

    const eer = rE / nE, cer = rC / nC;
    const arrSigned = cer - eer; // >0：介入降低事件
    const arrAbs = Math.abs(arrSigned);
    const dir = direction(arrSigned, outcomeIsGood);

    const arrCI = newcombeRD(rE, nE, rC, nC, z);
    const ratios = ratioMeasures(rE, nE, rC, nC, z);

    return {
      conf,
      eer, cer,
      arrSigned, arrAbs,
      benefit: dir.benefit,
      effectLabel: dir.label,
      nnt: arrAbs > 0 ? 1 / arrAbs : Infinity,
      nntCeil: arrAbs > 0 ? Math.ceil(1 / arrAbs) : Infinity,
      rr: ratios.rr,
      rrr: ratios.rrr,
      or: ratios.or,
      corrected: ratios.corrected,
      ci: {
        arr: { lower: arrCI.lower, upper: arrCI.upper },
        nnt: nntCI(arrCI),
        rr: ratios.rrCI,
        or: ratios.orCI,
      },
      cates: catesData(eer, cer),
    };
  }

  // ── 比率模式（Patient-Years）──
  // 參數：{ eE, pyE, eC, pyC, horizon, outcomeIsGood=false, conf=0.95 }
  //   eE/eC 事件數、pyE/pyC 人年、horizon 時間框架（年）。
  //   累積風險採 1−exp(−rate·t)，再導出該時間框架下的 ARR / NNT。
  function computeRate(opts) {
    const { eE, pyE, eC, pyC, horizon } = opts;
    const conf = opts.conf || 0.95;
    const z = zFor(conf);
    const t = horizon;

    const rateE = eE / pyE, rateC = eC / pyC; // 每人年
    const rateDiff = rateC - rateE;
    const seRD = Math.sqrt(eE / (pyE * pyE) + eC / (pyC * pyC));
    const rateRatio = rateE / rateC;
    const seLnRR = Math.sqrt(1 / eE + 1 / eC);

    // 轉成 horizon 期間之累積風險
    const riskE = 1 - Math.exp(-rateE * t);
    const riskC = 1 - Math.exp(-rateC * t);
    const arrSigned = riskC - riskE;
    const outcomeIsGood = !!opts.outcomeIsGood;
    const dir = direction(arrSigned, outcomeIsGood);

    return {
      conf, horizon: t,
      rateE, rateC,
      rateDiff,
      rateDiffCI: { lower: rateDiff - z * seRD, upper: rateDiff + z * seRD },
      rateRatio,
      rateRatioCI: { lower: rateRatio * Math.exp(-z * seLnRR), upper: rateRatio * Math.exp(z * seLnRR) },
      riskE, riskC,
      arrSigned, arrAbs: Math.abs(arrSigned),
      benefit: dir.benefit,
      effectLabel: dir.label,
      nnt: arrSigned !== 0 ? 1 / Math.abs(arrSigned) : Infinity,
      nntCeil: arrSigned !== 0 ? Math.ceil(1 / Math.abs(arrSigned)) : Infinity,
      cates: catesData(riskE, riskC),
    };
  }

  // ── 輸入轉接器 ──
  function fromCounts(a, b, c, d, opts) {
    return computeBinary(Object.assign({ rE: a, nE: a + b, rC: c, nC: c + d }, opts));
  }
  // eer/cer 為比例(0–1)，nE/nC 為樣本數（CI 需要）
  function fromRisks(eer, cer, nE, nC, opts) {
    return computeBinary(Object.assign({ rE: eer * nE, nE, rC: cer * nC, nC }, opts));
  }

  return {
    zFor, wilson, newcombeRD, nntCI, ratioMeasures, direction, catesData,
    applyToBaseline, computeBinary, computeRate, fromCounts, fromRisks,
  };
});
