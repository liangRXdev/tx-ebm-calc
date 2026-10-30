/* tx-ebm-calc 引擎測試（純 Node，無外部依賴）
 * 執行：node engine.test.js
 * 期望值為手算 / 教科書值，容差 tol。
 */
const E = require('./engine.js');

let pass = 0, fail = 0;
function approx(name, got, want, tol) {
  tol = tol == null ? 1e-3 : tol;
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${fmt(got)} want=${fmt(want)}`);
  ok ? pass++ : fail++;
}
function eq(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${String(got)} want=${String(want)}`);
  ok ? pass++ : fail++;
}
function fmt(x) { return typeof x === 'number' ? (isFinite(x) ? x.toFixed(4) : String(x)) : String(x); }
// 預期丟出 RangeError（輸入驗證）；未丟或丟出其他型別皆判 FAIL
function throws(name, fn) {
  let got = 'no throw';
  try { fn(); } catch (e) { got = e instanceof RangeError ? 'RangeError' : (e && e.name) || String(e); }
  eq(name, got, 'RangeError');
}
// 區塊內未預期例外（如函式不存在）記為 FAIL 並繼續，避免一處崩潰掩蓋其他結果
function block(fn) {
  try { fn(); } catch (e) { console.log(`FAIL  (block threw) ${e && e.message}`); fail++; }
}
// 物件內不得有 NaN（遞迴檢查數值欄位）
function noNaN(name, obj) {
  const bad = [];
  (function walk(o, path) {
    if (typeof o === 'number') { if (Number.isNaN(o)) bad.push(path); return; }
    if (o && typeof o === 'object') Object.keys(o).forEach((k) => walk(o[k], path + '.' + k));
  })(obj, '');
  eq(name, bad.join(',') || 'none', 'none');
}

// ── 1. 經典點估計：EER 0.15 / CER 0.20（counts 100 vs 100）──
// ARR=0.05、NNT=20、RR=0.75、RRR=0.25、OR=(15·80)/(85·20)=0.7059
(() => {
  const r = E.fromCounts(15, 85, 20, 80);
  approx('1 EER', r.eer, 0.15);
  approx('1 CER', r.cer, 0.20);
  approx('1 ARR', r.arrAbs, 0.05);
  approx('1 RR', r.rr, 0.75);
  approx('1 RRR', r.rrr, 0.25);
  approx('1 OR', r.or, 0.705882, 1e-4);
  approx('1 NNT', r.nnt, 20, 1e-6);
  eq('1 NNT ceil', r.nntCeil, 20);
  eq('1 effectLabel', r.effectLabel, 'NNT');
  eq('1 benefit', r.benefit, true);
})();

// ── 2. Newcombe ARR CI 與 Altman NNT CI（n=100，CI 應跨 0）──
// 手算 Newcombe：ARR 95% CI ≈ (−0.0563, 0.1555)
// → NNT 為 infinity 型：NNTB≈6.43、NNTH≈17.76
(() => {
  const r = E.fromCounts(15, 85, 20, 80);
  approx('2 ARR CI lower', r.ci.arr.lower, -0.05631, 5e-4);
  approx('2 ARR CI upper', r.ci.arr.upper, 0.15552, 5e-4);
  eq('2 NNT CI type', r.ci.nnt.type, 'infinity');
  approx('2 NNTB', r.ci.nnt.benefit, 6.43, 0.05);
  approx('2 NNTH', r.ci.nnt.harm, 17.76, 0.2);
})();

// ── 3. 大樣本顯著：n=1000，ARR=0.05，NNT CI 應為有限區間 ──
(() => {
  const r = E.fromCounts(150, 850, 200, 800);
  approx('3 ARR', r.arrAbs, 0.05);
  approx('3 NNT', r.nnt, 20, 1e-6);
  eq('3 NNT CI type', r.ci.nnt.type, 'finite');
  // ARR 不跨 0
  eq('3 ARR lower>0', r.ci.arr.lower > 0, true);
})();

// ── 4. 危害情境（不良事件，介入反而增加）→ NNH ──
// EER 0.25 > CER 0.20 → ARI=0.05、NNH=20
(() => {
  const r = E.fromCounts(25, 75, 20, 80);
  approx('4 ARI', r.arrAbs, 0.05);
  eq('4 effectLabel', r.effectLabel, 'NNH');
  eq('4 benefit', r.benefit, false);
  eq('4 cates changedType', r.cates.changedType, 'harmed');
  // 危害：green=(1−EER)·100=75、changed=5、red=CER·100=20，總和=100
  eq('4 cates good', r.cates.good, 75);
  eq('4 cates changed', r.cates.changed, 5);
  eq('4 cates bad', r.cates.bad, 20);
  eq('4 cates 總和=100', r.cates.good + r.cates.bad + r.cates.changed, 100);
})();

// ── 5. 有益事件方向（outcomeIsGood）──
// 戒菸成功率 EER 0.30 > CER 0.20 → 提高好結果為效益 → NNT
(() => {
  const r = E.fromCounts(30, 70, 20, 80, { outcomeIsGood: true });
  eq('5 effectLabel', r.effectLabel, 'NNT');
  eq('5 benefit', r.benefit, true);
  approx('5 ARR (增益)', r.arrAbs, 0.10);
})();

// ── 6. 零格 +0.5 校正 ──
(() => {
  const r = E.fromCounts(0, 100, 10, 90);
  eq('6 corrected', r.corrected, true);
  eq('6 OR finite', isFinite(r.or), true);
  eq('6 RR finite', isFinite(r.rr), true);
})();

// ── 7. risk 模式（百分比 + 樣本數）應等同 counts ──
(() => {
  const r = E.fromRisks(0.15, 0.20, 100, 100);
  approx('7 ARR', r.arrAbs, 0.05);
  approx('7 NNT', r.nnt, 20, 1e-6);
})();

// ── 8. Cates plot 三類總和=100 ──
(() => {
  const r = E.fromCounts(15, 85, 20, 80);
  const c = r.cates;
  eq('8 cates 總和=100', c.good + c.bad + c.changed, 100);
  eq('8 cates good', c.good, 80);   // (1−0.20)·100
  eq('8 cates changed', c.changed, 5); // ARR·100
  eq('8 cates changedType', c.changedType, 'helped');
})();

// ── 9. 比率模式（Patient-Years）──
// 介入 50 事件/2000 人年=0.025/年；對照 80/2000=0.040/年
// rateRatio=0.625；horizon=5 年：riskC=1−e^(−0.2)=0.1813、riskE=1−e^(−0.125)=0.1175
// ARR≈0.0638、NNT≈15.7
(() => {
  const r = E.computeRate({ eE: 50, pyE: 2000, eC: 80, pyC: 2000, horizon: 5 });
  approx('9 rateE', r.rateE, 0.025);
  approx('9 rateC', r.rateC, 0.040);
  approx('9 rateRatio', r.rateRatio, 0.625, 1e-3);
  approx('9 riskC(5y)', r.riskC, 0.18127, 1e-4);
  approx('9 riskE(5y)', r.riskE, 0.11750, 1e-4);
  approx('9 ARR(5y)', r.arrAbs, 0.06377, 1e-4);
  approx('9 NNT(5y)', r.nnt, 15.68, 0.05);
  eq('9 effectLabel', r.effectLabel, 'NNT');
})();

// ── 10. Wilson 區間 sanity（20/100）──
(() => {
  const w = E.wilson(20, 100, E.zFor(0.95));
  approx('10 wilson lower', w.lower, 0.13337, 1e-4);
  approx('10 wilson upper', w.upper, 0.28883, 1e-4);
})();

// ── 11. 個別化外推 applyToBaseline ──
// 試驗 RR=0.75；病人基線 PEER=40% → EER=30%、ARR=10%、NNT=10
(() => {
  const p = E.applyToBaseline(0.75, 0.40, false);
  approx('11 EER', p.eer, 0.30);
  approx('11 ARR', p.arrAbs, 0.10);
  approx('11 NNT', p.nnt, 10, 1e-6);
  eq('11 label', p.effectLabel, 'NNT');
  // RRR 固定：低基線 10% → ARR=2.5%、NNT=40
  const lo = E.applyToBaseline(0.75, 0.10, false);
  approx('11 低基線 NNT', lo.nnt, 40, 1e-6);
})();

// ── 12. 個別化外推：危害方向（RR>1）→ NNH ──
(() => {
  const p = E.applyToBaseline(1.5, 0.10, false);
  approx('12 EER', p.eer, 0.15);
  approx('12 ARI', p.arrAbs, 0.05);
  approx('12 NNH', p.nnt, 20, 1e-6);
  eq('12 label', p.effectLabel, 'NNH');
})();

// ════════ 2026-10 審查補測（13 起）════════

// ── 13. NNT 取整不得受浮點誤差影響 ──
// 2/10 vs 7/10：ARR=0.5 → NNT=2（浮點 1/0.49999… =2.0000000000000004，ceil 會錯成 3）
// 4/10 vs 5/10：ARR=0.1 → NNT=10；Sackett 例 RR 0.75、PEER 40% → NNT=10（非 11）
block(() => {
  eq('13 counts ARR .5 nntCeil', E.fromCounts(2, 8, 7, 3).nntCeil, 2);
  eq('13 counts ARR .1 nntCeil', E.fromCounts(4, 6, 5, 5).nntCeil, 10);
  eq('13 個別化 PEER40 nntCeil', E.applyToBaseline(0.75, 0.40, false).nntCeil, 10);
  eq('13 rate nntCeil 有限', isFinite(E.computeRate({ eE: 50, pyE: 2000, eC: 80, pyC: 2000, horizon: 5 }).nntCeil), true);
  eq('13 ceilNNT(0.2)', E.ceilNNT(1 - 0.8), 5);
  eq('13 ceilNNT(0)', E.ceilNNT(0), Infinity);
});

// ── 14. EER = CER（含浮點近似相等）→ ARR 0、NNT ∞、不判為 NNT 或 NNH 方向 ──
// fromRisks(3%,3%, n 70/30)：0.03·70/70 與 0.03·30/30 相差 7e-18，不得產生 NNT≈1.4e17
block(() => {
  const r = E.fromRisks(0.03, 0.03, 70, 30);
  eq('14 risk 近似相等 arrSigned', r.arrSigned, 0);
  eq('14 risk 近似相等 nnt', r.nnt, Infinity);
  eq('14 risk 近似相等 neutral', r.neutral, true);
  const z = E.fromCounts(0, 100, 0, 100);
  eq('14 兩組全 0 neutral', z.neutral, true);
  eq('14 兩組全 0 nnt', z.nnt, Infinity);
  eq('14 兩組全 0 corrected', z.corrected, true);
  approx('14 兩組全 0 RR', z.rr, 1);
  noNaN('14 兩組全 0 無 NaN', z);
  const all = E.fromCounts(100, 0, 100, 0);
  eq('14 兩組全事件 neutral', all.neutral, true);
  approx('14 兩組全事件 OR', all.or, 1);
  noNaN('14 兩組全事件 無 NaN', all);
  const rt = E.computeRate({ eE: 7, pyE: 100, eC: 21, pyC: 300, horizon: 5 });
  eq('14 rate 相同比率 neutral', rt.neutral, true);
  eq('14 rate 相同比率 nnt', rt.nnt, Infinity);
  eq('14 direction(0) neutral', E.direction(0, false).neutral, true);
  eq('14 direction(0) benefit', E.direction(0, false).benefit, false);
  eq('14 個別化 RR=1 neutral', E.applyToBaseline(1, 0.3, false).neutral, true);
  eq('14 個別化 PEER=0 neutral', E.applyToBaseline(0.75, 0, false).neutral, true);
});

// ── 15. 有益事件（outcomeIsGood）下 NNTB / NNTH 側別 ──
// 30/100 vs 20/100：ARR(CER−EER) CI ≈ (−0.2167, 0.0202)。好結果增加為效益 →
// NNTB = 1/0.2167 ≈ 4.61、NNTH = 1/0.0202 ≈ 49.4（原本兩側對調）
block(() => {
  const r = E.fromCounts(30, 70, 20, 80, { outcomeIsGood: true });
  eq('15 good NNT CI type', r.ci.nnt.type, 'infinity');
  approx('15 good NNTB', r.ci.nnt.benefit, 4.614, 0.01);
  approx('15 good NNTH', r.ci.nnt.harm, 49.38, 0.05);
  // 不良事件預設行為不變（同測試 2）
  const b = E.nntCI({ lower: -0.05631, upper: 0.15552 });
  approx('15 harm 預設 NNTB', b.benefit, 6.43, 0.05);
});

// ── 16. ARR CI 方向須與畫面上的 |ARR| 同向（CI 須包含點估計）──
// 4：EER 25% > CER 20%，ARI=+5%；CER−EER CI ≈ (−0.1644, 0.0660) → ARI CI ≈ (−0.0660, 0.1644)
block(() => {
  const h = E.fromCounts(25, 75, 20, 80);
  approx('16 ARI CI lower', h.ci.arrAbs.lower, -0.06597, 5e-4);
  approx('16 ARI CI upper', h.ci.arrAbs.upper, 0.16444, 5e-4);
  const g = E.fromCounts(30, 70, 20, 80, { outcomeIsGood: true });
  eq('16 good CI 含點估計', g.ci.arrAbs.lower <= g.arrAbs && g.arrAbs <= g.ci.arrAbs.upper, true);
  const b = E.fromCounts(15, 85, 20, 80);
  approx('16 benefit CI 不變 lower', b.ci.arrAbs.lower, -0.05631, 5e-4);
});

// ── 17. NNT CI 端點恰為 0、兩端同號順序 ──
block(() => {
  const z = E.nntCI({ lower: 0, upper: 0.1 });
  eq('17 端點=0 type', z.type, 'infinity');
  approx('17 端點=0 NNTB', z.benefit, 10, 1e-9);
  eq('17 端點=0 NNTH', z.harm, Infinity);
  eq('17 端點=0 文字', E.formatNntCI(z), 'NNTB 10 … ∞');
  eq('17 端點=0（危害側）文字', E.formatNntCI(E.nntCI({ lower: -0.05, upper: 0 })), '∞ … NNTH 20');
  eq('17 兩端皆 0 文字', E.formatNntCI(E.nntCI({ lower: 0, upper: 0 })), '∞');
  eq('17 跨 0 文字', E.formatNntCI(E.nntCI({ lower: -0.05631, upper: 0.15552 })), 'NNTB 6 … ∞ … NNTH 18');
  const pos = E.nntCI({ lower: 0.02, upper: 0.1 });
  eq('17 正同號 low<high', pos.low < pos.high, true);
  approx('17 正同號 low', pos.low, 10, 1e-9);
  approx('17 正同號 high', pos.high, 50, 1e-9);
  const neg = E.nntCI({ lower: -0.1, upper: -0.02 });
  approx('17 負同號 low', neg.low, 10, 1e-9);
  approx('17 負同號 high', neg.high, 50, 1e-9);
  eq('17 有限文字', E.formatNntCI(pos), '10–50');
});

// ── 18. Cates 三群加總恆為 100（最大餘數法）──
// EER 0、CER 99.5%：原本 good=round(0.5)=1、changed=round(99.5)=100 → 101
block(() => {
  const k1 = E.catesData(0, 0.995);
  eq('18 EER0/CER99.5 總和', k1.good + k1.bad + k1.changed, 100);
  const k2 = E.catesData(0.005, 0);
  eq('18 EER0.5/CER0 總和', k2.good + k2.bad + k2.changed, 100);
  let bad = 0;
  for (let e = 0; e <= 1000; e += 7) for (let c = 0; c <= 1000; c += 3) {
    const k = E.catesData(e / 1000, c / 1000);
    if (k.good + k.bad + k.changed !== 100 || k.good < 0 || k.bad < 0 || k.changed < 0) bad++;
  }
  eq('18 掃描 0–100% 總和皆 100', bad, 0);
  // 0% / 100% 端點
  const k3 = E.catesData(0, 1);
  eq('18 EER0/CER100 changed', k3.changed, 100);
});

// ── 19. Cates 方向與 outcomeIsGood 同步 ──
// 有益事件且 EER>CER（效益）→ changedType 應為 helped、eventChange=more
block(() => {
  const g = E.fromCounts(30, 70, 20, 80, { outcomeIsGood: true });
  eq('19 good 效益 changedType', g.cates.changedType, 'helped');
  eq('19 good 效益 eventChange', g.cates.eventChange, 'more');
  const gh = E.fromCounts(20, 80, 30, 70, { outcomeIsGood: true });
  eq('19 good 危害 changedType', gh.cates.changedType, 'harmed');
  eq('19 good 危害 eventChange', gh.cates.eventChange, 'fewer');
  eq('19 個別化 good 效益', E.applyToBaseline(1.5, 0.2, true).cates.changedType, 'helped');
  eq('19 rate good 效益', E.computeRate({ eE: 80, pyE: 2000, eC: 50, pyC: 2000, horizon: 5, outcomeIsGood: true }).cates.changedType, 'helped');
});

// ── 20. 個別化：PEER×RR >1 時上限為 1 並標示，NNH 不因 0.999999 截斷而 +1 ──
// RR 1.5、PEER 80% → EER 截為 100%、ARI 20%、NNH 5（原本 6）
block(() => {
  const p = E.applyToBaseline(1.5, 0.8, false);
  approx('20 capped EER', p.eer, 1, 1e-12);
  eq('20 capped nntCeil', p.nntCeil, 5);
  eq('20 capped flag', p.capped, true);
  eq('20 未截斷 flag', E.applyToBaseline(0.75, 0.4, false).capped, false);
  const one = E.applyToBaseline(0.75, 1, false);
  approx('20 PEER=1 EER', one.eer, 0.75);
  eq('20 PEER=1 nntCeil', one.nntCeil, 4);
  throws('20 PEER<0', () => E.applyToBaseline(0.75, -0.1, false));
  throws('20 PEER>1', () => E.applyToBaseline(0.75, 1.1, false));
  throws('20 RR NaN', () => E.applyToBaseline(NaN, 0.3, false));
  throws('20 RR 負', () => E.applyToBaseline(-1, 0.3, false));
});

// ── 21. 輸入驗證（engine 層）：不得回傳 NaN ──
block(() => {
  throws('21 counts 組別 n=0', () => E.fromCounts(0, 0, 1, 1));
  throws('21 counts 負值', () => E.fromCounts(5, -2, 1, 1));
  throws('21 counts 小數', () => E.fromCounts(1.5, 8, 2, 8));
  throws('21 counts NaN（空白）', () => E.fromCounts(NaN, 8, 2, 8));
  throws('21 binary 事件數>n', () => E.computeBinary({ rE: 12, nE: 10, rC: 1, nC: 10 }));
  throws('21 binary n=0', () => E.computeBinary({ rE: 0, nE: 0, rC: 1, nC: 10 }));
  throws('21 risks >1', () => E.fromRisks(1.2, 0.2, 100, 100));
  throws('21 risks 負', () => E.fromRisks(-0.1, 0.2, 100, 100));
  throws('21 risks n=0', () => E.fromRisks(0.1, 0.2, 0, 100));
  throws('21 risks n 小數', () => E.fromRisks(0.1, 0.2, 10.5, 100));
  throws('21 risks 只給一組 n', () => E.fromRisks(0.1, 0.2, 100, null));
  throws('21 rate t=0', () => E.computeRate({ eE: 5, pyE: 100, eC: 8, pyC: 100, horizon: 0 }));
  throws('21 rate t 負', () => E.computeRate({ eE: 5, pyE: 100, eC: 8, pyC: 100, horizon: -1 }));
  throws('21 rate 人年 0', () => E.computeRate({ eE: 5, pyE: 0, eC: 8, pyC: 100, horizon: 5 }));
  throws('21 rate 事件 0', () => E.computeRate({ eE: 0, pyE: 100, eC: 8, pyC: 100, horizon: 5 }));
  throws('21 rate 事件小數', () => E.computeRate({ eE: 2.5, pyE: 100, eC: 8, pyC: 100, horizon: 5 }));
});

// ── 22. 風險 0% / 100% 與無樣本數 ──
block(() => {
  const r = E.fromCounts(0, 100, 100, 0);
  approx('22 EER0/CER100 ARR', r.arrAbs, 1);
  eq('22 EER0/CER100 nntCeil', r.nntCeil, 1);
  eq('22 EER0/CER100 corrected', r.corrected, true);
  noNaN('22 EER0/CER100 無 NaN', r);
  // risk 模式未給樣本數 → 不得輸出由假樣本數算出的 CI
  const n = E.fromRisks(0.15, 0.20, null, null);
  eq('22 無 n noCI', n.noCI, true);
  eq('22 無 n ci', n.ci, null);
  approx('22 無 n ARR', n.arrAbs, 0.05);
  eq('22 無 n nntCeil', n.nntCeil, 20);
  eq('22 有 n noCI', E.fromRisks(0.15, 0.20, 100, 100).noCI, false);
});

// ── 23. 每預防 1 事件成本 ──
// 成本 ÷ ARR（= 未取整 NNT × 成本）；空白/危害/無差異 → null；負值/非數 → RangeError
block(() => {
  approx('23 cost', E.costPerEvent(20, 1000, true), 20000, 1e-6);
  eq('23 cost 空白', E.costPerEvent(20, '', true), null);
  eq('23 cost null', E.costPerEvent(20, null, true), null);
  eq('23 cost 危害', E.costPerEvent(20, 1000, false), null);
  eq('23 cost NNT ∞', E.costPerEvent(Infinity, 1000, true), null);
  eq('23 cost 0', E.costPerEvent(20, 0, true), 0);
  throws('23 cost 負', () => E.costPerEvent(20, -5, true));
  throws('23 cost NaN', () => E.costPerEvent(20, NaN, true));
});

// ── 24. 個別化外推用的 RR（transportRR）由引擎提供 ──
block(() => {
  approx('24 binary transportRR', E.fromCounts(15, 85, 20, 80).transportRR, 0.75);
  const rt = E.computeRate({ eE: 50, pyE: 2000, eC: 80, pyC: 2000, horizon: 5 });
  approx('24 rate transportRR = riskE/riskC', rt.transportRR, 0.11750 / 0.18127, 1e-3);
});

// ── 25. rate 結果提供 eer/cer（= horizon 累積風險），白話文字才不會印出「由 — 維持在 —」──
block(() => {
  const rt = E.computeRate({ eE: 50, pyE: 2000, eC: 80, pyC: 2000, horizon: 5 });
  approx('25 rate cer = riskC', rt.cer, 0.18127, 1e-4);
  approx('25 rate eer = riskE', rt.eer, 0.11750, 1e-4);
});

// ── 26. EER=CER（浮點近似）時 RRR 為 0，不得出現 −0.0% ──
block(() => {
  eq('26 RRR 近似相等 = 0', E.fromRisks(0.03, 0.03, 70, 30).rrr, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
