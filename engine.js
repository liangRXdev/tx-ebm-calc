/* tx-ebm-calc 計算引擎（純函式，無 DOM 依賴）
 *
 * 同時支援瀏覽器（掛在 window.TxEbm）與 Node（module.exports）以便測試。
 * 統計方法與來源：
 *   - 風險差 ARR 之 95% CI：Newcombe-Wilson hybrid score（Newcombe, Stat Med 1998, method 10）
 *   - NNT 之 95% CI：Altman 法（BMJ 1998;317:1309）— CI 跨 0 時表為「NNTB…∞…NNTH」
 *   - RR 之 CI：Katz log 法；OR 之 CI：Woolf log 法
 *   - 比率(rate)：Wald（rate difference）/ log（rate ratio），以 Poisson 變異為基礎
 *   - 零格自動 +0.5 連續性校正（Haldane-Anscombe，僅作用於比值型指標）
 *
 * 輸入不合法（n≤0、事件數>n、負值、非整數人數、非數值…）一律丟 RangeError（訊息為繁中，
 * 可直接顯示），保證回傳物件不含 NaN。
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

  // ── 輸入驗證 ──
  function fail(msg) { throw new RangeError(msg); }
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  function needInt(x, what) {
    if (!isNum(x) || x < 0 || !Number.isInteger(x)) fail(`${what}需為非負整數。`);
  }

  // 浮點雜訊：CER−EER 在數學上為 0 時，浮點運算可能留下 ~1e-17 的殘差，
  // 會被 1/ARR 放大成 1e17 的 NNT。低於此門檻一律視為 0（無差異）。
  const ARR_EPS = 1e-12;
  const snapZero = (x) => (Math.abs(x) < ARR_EPS ? 0 : x);

  // ── NNT 取整（無條件進位）──
  // 1/ARR 的浮點誤差會把整數 NNT 推到 10.000000000000002，直接 ceil 會多 1 人。
  // 先取 12 位有效數字去除雜訊再進位。
  function ceilNNT(arrAbs) {
    if (!(arrAbs > 0)) return Infinity;
    return Math.ceil(+(1 / arrAbs).toPrecision(12));
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
  // arr 為 CER−EER 的 CI。outcomeIsGood=true 時效益側為 CER−EER<0，故先翻轉成
  // 「效益方向的 ARR」再取倒數，NNTB／NNTH 才不會對調。
  // 回傳 type：
  //   'finite'   → {low, high}     ARR 不跨 0，NNT 為有限區間
  //   'infinity' → {benefit, harm} ARR 跨 0，NNT 經過 ∞（NNTB…∞…NNTH）
  function nntCI(arr, outcomeIsGood) {
    const s = outcomeIsGood ? -1 : 1;
    const lower = Math.min(s * arr.lower, s * arr.upper);
    const upper = Math.max(s * arr.lower, s * arr.upper);
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

  // ── NNT CI 文字（畫面、白話、列印共用，避免三處格式分歧）──
  // 跨 0 時不可塌縮成單一有限值；CI 端點恰為 0 時該側為 ∞，只列有限的一側。
  // 端點與點估計（ceilNNT）同樣無條件進位：NNT 隨 ARR 單調，兩端同法取整才保證區間含點估計。
  function formatNntCI(ci) {
    const r = (v) => String(Math.ceil(+v.toPrecision(12)));
    if (ci.type === 'finite') return `${r(ci.low)}–${r(ci.high)}`;
    const parts = [];
    if (isFinite(ci.benefit)) parts.push(`NNTB ${r(ci.benefit)}`);
    parts.push('∞');
    if (isFinite(ci.harm)) parts.push(`NNTH ${r(ci.harm)}`);
    return parts.join(' … ');
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
  // ARR=0：無差異（neutral），NNT=∞，既非效益也非危害；標籤沿用 NNT（Altman：NNT=∞ 即無差異）
  function direction(arrSigned, outcomeIsGood) {
    const neutral = arrSigned === 0;
    const benefit = outcomeIsGood ? arrSigned < 0 : arrSigned > 0;
    return { benefit, neutral, label: benefit || neutral ? 'NNT' : 'NNH' };
  }

  // ── 百人效益圖資料（Cates plot，以 100 人為單位）──
  // 對稱定義（效益與危害皆成立）：
  //   green  在較高風險情境下都不會發生事件 = (1 − max(EER,CER))·100
  //   change 因治療而改變（避免或多出）     = |CER−EER|·100
  //   red    在較低風險情境下仍發生事件     = min(EER,CER)·100（不論治療都會發生）
  // 三群以最大餘數法取整，總和恆為 100；同餘數時優先給 changed（不讓 ≥0.5 人的效果被吃掉）。
  // changedType 依效益/危害（隨 outcomeIsGood）；eventChange 為事件本身變少(fewer)或變多(more)。
  function catesData(eer, cer, outcomeIsGood) {
    const arr = snapZero(cer - eer);
    const hi = Math.max(eer, cer), lo = Math.min(eer, cer);
    const keys = ['changed', 'good', 'bad'];
    const raw = { good: (1 - hi) * 100, changed: Math.abs(arr) * 100, bad: lo * 100 };
    const out = {};
    let used = 0;
    keys.forEach((k) => {
      raw[k] = Math.max(0, +raw[k].toFixed(9)); // 去浮點雜訊（14.999999999999998 → 15）
      out[k] = Math.floor(raw[k]); used += out[k];
    });
    keys.slice().sort((x, y) => (raw[y] - out[y]) - (raw[x] - out[x]))
      .slice(0, 100 - used).forEach((k) => { out[k]++; });
    const dir = direction(arr, !!outcomeIsGood);
    return {
      good: out.good, bad: out.bad, changed: out.changed,
      changedType: dir.benefit ? 'helped' : 'harmed', // helped=因治療得益；harmed=因治療受害
      eventChange: arr > 0 ? 'fewer' : (arr < 0 ? 'more' : 'none'),
      outcomeIsGood: !!outcomeIsGood,
      controlEvents: Math.round(cer * 100),
      expEvents: Math.round(eer * 100),
    };
  }

  // ── 個別化外推：把試驗的相對風險(RR) 套到病人個別基線風險(PEER) ──
  // 假設相對效果可外推（RRR 固定，Sackett/CEBM 法）：
  //   病人 EER = PEER × RR；個別化 ARR = |PEER − EER|；NNT = 1/ARR。
  // PEER×RR > 1 時以 1 為上限並標 capped=true（此時 RR 固定假設已不成立，需在畫面提示）。
  function applyToBaseline(rr, peer, outcomeIsGood) {
    if (!isNum(rr) || rr < 0) fail('相對風險 (RR) 需為非負數。');
    if (!isNum(peer) || peer < 0 || peer > 1) fail('病人基線風險 PEER 需介於 0–100%。');
    const rawEer = peer * rr;
    const capped = rawEer > 1;
    const eer = capped ? 1 : rawEer;
    const arrSigned = snapZero(peer - eer);
    const arrAbs = Math.abs(arrSigned);
    const dir = direction(arrSigned, !!outcomeIsGood);
    return {
      rr, peer, eer, capped,
      arrSigned, arrAbs,
      benefit: dir.benefit,
      neutral: dir.neutral,
      effectLabel: dir.label,
      nnt: arrAbs > 0 ? 1 / arrAbs : Infinity,
      nntCeil: ceilNNT(arrAbs),
      cates: catesData(eer, peer, outcomeIsGood),
    };
  }

  // ── 每預防 1 事件成本 = 每人成本 ÷ ARR（= 未取整 NNT × 成本）──
  // 成本空白(''/null/undefined)、非效益、NNT 非有限 → null；負值或非數值 → RangeError
  function costPerEvent(nnt, cost, benefit) {
    if (cost === '' || cost == null) return null;
    const c = +cost;
    if (!isNum(c) || c < 0) fail('每人成本需為 ≥ 0 的數值。');
    if (!benefit || !isFinite(nnt)) return null;
    return nnt * c;
  }

  // ── 主入口：二元結果（counts / risk 模式共用）──
  // 參數物件：{ rE, nE, rC, nC, outcomeIsGood=false, conf=0.95 }
  //   rE/rC 可為非整數（risk 模式由百分比×樣本數推得）
  function computeBinary(opts) {
    const { rE, nE, rC, nC } = opts;
    [[nE, '介入組'], [nC, '對照組']].forEach(([n, g]) => {
      if (!isNum(n) || n <= 0) fail(`${g}人數需大於 0。`);
    });
    [[rE, nE, '介入組'], [rC, nC, '對照組']].forEach(([r, n, g]) => {
      if (!isNum(r) || r < 0) fail(`${g}事件數需為非負數。`);
      if (r > n) fail(`${g}事件數不可大於該組人數。`);
    });
    const outcomeIsGood = !!opts.outcomeIsGood;
    const conf = opts.conf || 0.95;
    const z = zFor(conf);

    const eer = rE / nE, cer = rC / nC;
    const arrSigned = snapZero(cer - eer); // >0：介入降低事件
    const arrAbs = Math.abs(arrSigned);
    const dir = direction(arrSigned, outcomeIsGood);

    const arrCI = newcombeRD(rE, nE, rC, nC, z);
    const ratios = ratioMeasures(rE, nE, rC, nC, z);

    return {
      conf,
      eer, cer,
      arrSigned, arrAbs,
      benefit: dir.benefit,
      neutral: dir.neutral,
      effectLabel: dir.label,
      nnt: arrAbs > 0 ? 1 / arrAbs : Infinity,
      nntCeil: ceilNNT(arrAbs),
      rr: ratios.rr,
      rrr: snapZero(ratios.rrr), // 去浮點殘差，避免顯示 −0.0%
      or: ratios.or,
      corrected: ratios.corrected,
      transportRR: ratios.rr, // 個別化外推用（零格時為校正後 RR）
      noCI: false,
      ci: {
        arr: { lower: arrCI.lower, upper: arrCI.upper },
        // 與畫面上 |ARR|（ARR 或 ARI）同向的 CI：CER−EER<0 時取負並對調端點
        arrAbs: arrSigned < 0
          ? { lower: -arrCI.upper, upper: -arrCI.lower }
          : { lower: arrCI.lower, upper: arrCI.upper },
        nnt: nntCI(arrCI, outcomeIsGood),
        rr: ratios.rrCI,
        or: ratios.orCI,
      },
      cates: catesData(eer, cer, outcomeIsGood),
    };
  }

  // ── 比率模式（Patient-Years）──
  // 參數：{ eE, pyE, eC, pyC, horizon, outcomeIsGood=false, conf=0.95 }
  //   eE/eC 事件數、pyE/pyC 人年、horizon 時間框架（年）。
  //   累積風險採 1−exp(−rate·t)，再導出該時間框架下的 ARR / NNT。
  function computeRate(opts) {
    const { eE, pyE, eC, pyC, horizon } = opts;
    needInt(eE, '介入組事件數'); needInt(eC, '對照組事件數');
    if (!isNum(pyE) || pyE <= 0 || !isNum(pyC) || pyC <= 0) fail('人年需大於 0。');
    if (!isNum(horizon) || horizon <= 0) fail('時間框架需大於 0。');
    if (eE <= 0 || eC <= 0) fail('人年模式需兩組皆有事件數（>0）才能算比率 CI。');
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
    const arrSigned = snapZero(riskC - riskE);
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
      eer: riskE, cer: riskC, // 與 binary 結果同名，供白話/圖表共用
      arrSigned, arrAbs: Math.abs(arrSigned),
      benefit: dir.benefit,
      neutral: dir.neutral,
      effectLabel: dir.label,
      nnt: arrSigned !== 0 ? 1 / Math.abs(arrSigned) : Infinity,
      nntCeil: ceilNNT(Math.abs(arrSigned)),
      transportRR: riskE / riskC, // horizon 期間累積風險比，供個別化外推
      cates: catesData(riskE, riskC, outcomeIsGood),
    };
  }

  // ── 輸入轉接器 ──
  function fromCounts(a, b, c, d, opts) {
    needInt(a, '人數 a'); needInt(b, '人數 b'); needInt(c, '人數 c'); needInt(d, '人數 d');
    return computeBinary(Object.assign({ rE: a, nE: a + b, rC: c, nC: c + d }, opts));
  }
  // eer/cer 為比例(0–1)，nE/nC 為樣本數（CI 需要）
  // nE、nC 皆為 null/undefined → 只算點估計，noCI=true、ci=null（不輸出由假樣本數算出的 CI）
  function fromRisks(eer, cer, nE, nC, opts) {
    if (!isNum(eer) || eer < 0 || eer > 1 || !isNum(cer) || cer < 0 || cer > 1) fail('風險需介於 0–100%。');
    if (nE == null && nC == null) {
      const PLACEHOLDER_N = 1e6; // 僅供點估計（RR/OR 零格校正幾乎不影響）；CI 一律不輸出
      const r = computeBinary(Object.assign({}, opts,
        { rE: eer * PLACEHOLDER_N, nE: PLACEHOLDER_N, rC: cer * PLACEHOLDER_N, nC: PLACEHOLDER_N }));
      r.noCI = true; r.ci = null;
      return r;
    }
    [[nE, '介入組'], [nC, '對照組']].forEach(([n, g]) => {
      if (!isNum(n) || n <= 0 || !Number.isInteger(n)) fail(`${g}樣本數需為正整數（或兩組皆留空）。`);
    });
    return computeBinary(Object.assign({}, opts, { rE: eer * nE, nE, rC: cer * nC, nC }));
  }

  return {
    zFor, wilson, newcombeRD, nntCI, formatNntCI, ratioMeasures, direction, catesData,
    ceilNNT, costPerEvent,
    applyToBaseline, computeBinary, computeRate, fromCounts, fromRisks,
  };
});
