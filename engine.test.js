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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
