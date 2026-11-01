const test = require('node:test');
const assert = require('node:assert');
const core = require('../core.js');

function year(entriesByRound, members, extra) {
  const ms = {};
  members.forEach(([id, startHc], i) => { ms[id] = { name: id, order: i + 1, startHc, lifetimePrev: 0 }; });
  const rounds = {};
  entriesByRound.forEach((entries, i) => {
    rounds['r' + (i + 1)] = Object.assign({ date: `2026-0${i + 1}-01`, title: 't', entries }, (extra || [])[i] || {});
  });
  return { settings: {}, members: ms, rounds };
}

test('順位はNET順、同NETはGROSSの良い方が上', () => {
  const y = year([{ a: { score: 100 }, b: { score: 90 }, c: { score: 95 }, d: { score: 110 } }],
    [['a', 20], ['b', 10], ['c', 15], ['d', 20]]);
  const rows = core.computeYear(y).rounds[0].rows;
  const rank = Object.fromEntries(rows.map((r) => [r.mid, r.rank]));
  // NET: a80 b80 c80 d90 → GROSS順 b(90) c(95) a(100)
  assert.deepStrictEqual(rank, { b: 1, c: 2, a: 3, d: 4 });
});

test('賞金：優勝=参加費合計−準優勝、準優勝は人数で1000/2000/3000', () => {
  const mk = (n) => {
    const e = {}; const m = [];
    for (let i = 0; i < n; i++) { e['p' + i] = { score: 80 + i }; m.push(['p' + i, 0]); }
    return core.computeYear(year([e], m)).rounds[0];
  };
  for (const [n, second] of [[3, 1000], [5, 1000], [6, 2000], [10, 2000], [11, 3000], [17, 3000]]) {
    const r = mk(n);
    assert.strictEqual(r.rows[1].prize, second, `n=${n}`);
    assert.strictEqual(r.rows[0].prize, n * 1000 - second, `n=${n}`);
  }
});

test('賞金総額の調整', () => {
  const e = {}; const m = [];
  for (let i = 0; i < 17; i++) { e['p' + i] = { score: 80 + i }; m.push(['p' + i, 0]); }
  const r = core.computeYear(year([e], m, [{ poolAdjust: -1000 }])).rounds[0];
  assert.strictEqual(r.rows[0].prize, 13000);
});

test('次回HC：優勝2割・準優勝1割カット、4人未満はカット無し', () => {
  const y = year([
    { a: { score: 110 }, b: { score: 111 }, c: { score: 130 }, d: { score: 130 } },
    { a: { score: 110 }, b: { score: 111 }, c: { score: 130 } },
  ], [['a', 32], ['b', 32], ['c', 10], ['d', 10]]);
  const res = core.computeYear(y);
  assert.strictEqual(res.rounds[1].hcBefore.a, 25); // 32*0.8=25.6→25
  assert.strictEqual(res.rounds[1].hcBefore.b, 28); // 32*0.9=28.8→28
  assert.strictEqual(res.stats.a.currentHc, 25);   // 3人の回はカット無し
});

test('NETが72未満ならアンダー分を引いてからカット', () => {
  const s = core.settingsOf({});
  assert.strictEqual(core.nextHc(28, 97, 1, 10, s), 20); // NET69 → (28-3)*0.8=20
  assert.strictEqual(core.nextHc(10, 80, 2, 10, s), 7);  // NET70 → (10-2)*0.9=7.2
  assert.strictEqual(core.nextHc(28, 100, 1, 10, s), 22); // NET72 → 引かない
});

test('HC手修正は次の計算の基準になる', () => {
  const y = year([
    { a: { score: 100, hc: 20 }, b: { score: 120 }, c: { score: 120 }, d: { score: 120 } },
  ], [['a', 30], ['b', 10], ['c', 10], ['d', 10]]);
  const res = core.computeYear(y);
  assert.strictEqual(res.rounds[0].rows[0].hcOverridden, true);
  assert.strictEqual(res.stats.a.currentHc, 16);
});

test('年間平均：初参加以降の不参加回はベストで補完、翌年HCと賞金王カット', () => {
  const y = year([
    { b: { score: 120 }, c: { score: 130 }, d: { score: 130 }, e: { score: 130 } },
    { a: { score: 100 }, b: { score: 120 }, c: { score: 130 }, d: { score: 130 } },
    { b: { score: 110 }, c: { score: 130 }, d: { score: 130 }, e: { score: 130 } },
  ], [['a', 36], ['b', 0], ['c', 36], ['d', 36], ['e', 36]]);
  const res = core.computeYear(y);
  assert.strictEqual(res.stats.a.avg, 100);           // 2回目から：100, 補完100
  assert.strictEqual(res.stats.a.scores.r3.filled, true);
  assert.strictEqual(res.stats.a.scores.r1, undefined);
  assert.strictEqual(res.stats.b.avg, 116);           // (120+120+110)/3=116.6→116
  const king = Object.values(res.stats).filter((s) => s.isKing);
  assert.strictEqual(king.length, 1);
  assert.strictEqual(res.stats.c.nextYearHc, 36);     // 上限36
});

test('翌年度データの引継ぎ', () => {
  const y = year([{ a: { score: 100 }, b: { score: 110 }, c: { score: 120 }, d: { score: 120 } }],
    [['a', 20], ['b', 20], ['c', 20], ['d', 20]]);
  y.members.a.lifetimePrev = 5000;
  const next = core.makeNextYear(y);
  assert.strictEqual(next.members.a.prevAvg, 100);
  assert.strictEqual(next.members.a.lifetimePrev, 5000 + 3000);
  assert.strictEqual(next.members.a.startHc, 19); // (100-72)*0.8=22.4→22、賞金王で×0.9=19.8→19
  assert.deepStrictEqual(next.rounds, {});
});

test('翌年HCの手修正は計算値より優先され、翌年度に引き継がれる', () => {
  const y = year([{ a: { score: 100 }, b: { score: 110 }, c: { score: 120 }, d: { score: 120 } }],
    [['a', 20], ['b', 20], ['c', 20], ['d', 20]]);
  y.members.b.nextYearHc = 15;
  const res = core.computeYear(y);
  assert.strictEqual(res.stats.b.nextYearHc, 15);
  assert.strictEqual(res.stats.b.nextYearHcOverridden, true);
  assert.strictEqual(res.stats.b.nextYearHcComputed, 30); // (110-72)*0.8=30.4
  assert.strictEqual(core.makeNextYear(y).members.b.startHc, 15);
});
