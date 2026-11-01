// 裏雄J会 成績管理 — 計算ロジック（画面に依存しない純粋関数）
// Excel「2026年裏雄J会.xlsx」の式と規定を移植したもの。
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    fee: 1000,              // 参加費（円）
    hcMax: 36,              // HC上限
    cutMinPlayers: 4,       // 参加人数がこれ未満ならHCカット無し
    winnerCut: 0.8,         // 優勝者 2割カット
    runnerUpCut: 0.9,       // 準優勝者 1割カット
    kingCut: 0.9,           // 年間賞金王は翌年HC 1割カット
    fillAbsentWithBest: true, // 年間平均で不参加回をベストスコアで補完
    // 準優勝賞金：参加人数が min 以上なら amount（該当する最後の行を採用）
    runnerUp: [
      { min: 0, amount: 1000 },
      { min: 6, amount: 2000 },
      { min: 11, amount: 3000 },
    ],
  };

  // Excel の ROUNDDOWN と同じく 0 方向へ切り捨て
  const rounddown = (x) => Math.trunc(x);

  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function settingsOf(year) {
    const s = Object.assign({}, DEFAULT_SETTINGS, (year && year.settings) || {});
    if (!Array.isArray(s.runnerUp) || !s.runnerUp.length) s.runnerUp = DEFAULT_SETTINGS.runnerUp;
    return s;
  }

  function sortedMembers(year) {
    return Object.entries((year && year.members) || {})
      .map(([id, m]) => Object.assign({ id }, m))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  }

  function sortedRounds(year) {
    return Object.entries((year && year.rounds) || {})
      .map(([id, r]) => Object.assign({ id }, r))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.id.localeCompare(b.id));
  }

  function runnerUpAmount(n, s) {
    let amount = 0;
    for (const row of s.runnerUp) if (n >= row.min) amount = row.amount;
    return amount;
  }

  // 順位：NET の小さい順。NET 同点は GROSS の良い方が上（Excel の COUNTIF + COUNTIFS と同じ）
  function rankRows(rows) {
    for (const r of rows) {
      r.rank = rows.filter((x) => x.net < r.net).length + 1
        + rows.filter((x) => x.net === r.net && x.score < r.score).length;
    }
  }

  // 賞金：1位・2位の枠の金額を、その枠に入った人（同順位）で等分
  // poolAdjust：大会ごとの賞金総額の増減（例：-1000）
  function assignPrizes(rows, n, s, poolAdjust) {
    const pool = Math.max(0, s.fee * n + (isNum(poolAdjust) ? poolAdjust : 0));
    const second = n >= 2 ? Math.min(runnerUpAmount(n, s), pool) : 0;
    const slot = [pool - second, second];
    for (const r of rows) {
      const tied = rows.filter((x) => x.rank === r.rank).length;
      let sum = 0;
      for (let p = r.rank; p < r.rank + tied; p++) if (p <= 2) sum += slot[p - 1];
      r.prize = Math.floor(sum / tied);
    }
    return { pool, winner: slot[0], second };
  }

  // NET が 72 を切った分（アンダー分）を HC から引いてからカット
  function nextHc(hc, score, rank, n, s) {
    if (n < s.cutMinPlayers) return hc;
    const net = score - hc;
    const base = hc - (net < 72 ? 72 - net : 0);
    if (rank === 1) return rounddown(base * s.winnerCut);
    if (rank === 2) return rounddown(base * s.runnerUpCut);
    return hc;
  }

  // 1年分の全計算
  function computeYear(year) {
    const s = settingsOf(year);
    const members = sortedMembers(year);
    const rounds = sortedRounds(year);
    const current = {};
    for (const m of members) current[m.id] = isNum(m.startHc) ? m.startHc : s.hcMax;

    const roundResults = rounds.map((rd) => {
      const hcBefore = Object.assign({}, current);
      const rows = [];
      const entries = rd.entries || {};
      for (const m of members) {
        const e = entries[m.id];
        if (!e) continue;
        const overridden = isNum(e.hc);
        const hc = overridden ? e.hc : hcBefore[m.id];
        rows.push({
          mid: m.id, name: m.name, hc, hcOverridden: overridden, computedHc: hcBefore[m.id],
          score: isNum(e.score) ? e.score : null, paid: !!e.paid,
          net: null, rank: null, prize: 0, nextHc: hc,
        });
      }
      const scored = rows.filter((r) => r.score !== null);
      for (const r of scored) r.net = r.score - r.hc;
      rankRows(scored);
      const n = scored.length;
      const money = assignPrizes(scored, n, s, rd.poolAdjust);
      for (const r of scored) {
        r.nextHc = nextHc(r.hc, r.score, r.rank, n, s);
        current[r.mid] = r.nextHc;
      }
      // 未スコアの参加者も HC 手修正があればそれを引き継ぐ
      for (const r of rows) if (r.score === null && r.hcOverridden) current[r.mid] = r.hc;
      rows.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || members.findIndex((m) => m.id === a.mid) - members.findIndex((m) => m.id === b.mid));
      return Object.assign({ id: rd.id, date: rd.date, title: rd.title, memo: rd.memo || '', poolAdjust: rd.poolAdjust || 0, rows, n, entrants: rows.length, hcBefore }, money);
    });

    const stats = {};
    for (const m of members) {
      const played = [];
      roundResults.forEach((rr, i) => {
        const row = rr.rows.find((r) => r.mid === m.id && r.score !== null);
        if (row) played.push({ i, score: row.score });
      });
      const best = played.length ? Math.min(...played.map((p) => p.score)) : null;
      const scores = {};   // roundId -> { score, filled }
      const values = [];
      if (played.length) {
        for (let i = played[0].i; i < roundResults.length; i++) {
          const p = played.find((x) => x.i === i);
          if (p) { scores[roundResults[i].id] = { score: p.score, filled: false }; values.push(p.score); }
          else if (s.fillAbsentWithBest) { scores[roundResults[i].id] = { score: best, filled: true }; values.push(best); }
        }
      }
      const avg = values.length ? rounddown(values.reduce((a, b) => a + b, 0) / values.length) : null;
      const totalPrize = roundResults.reduce((sum, rr) => sum + (rr.rows.find((r) => r.mid === m.id)?.prize || 0), 0);
      const paidTotal = roundResults.reduce((sum, rr) => sum + (rr.rows.some((r) => r.mid === m.id && r.score !== null) ? s.fee : 0), 0);
      stats[m.id] = {
        played: played.length, best, avg, scores, totalPrize, paidTotal,
        balance: totalPrize - paidTotal,
        lifetime: (isNum(m.lifetimePrev) ? m.lifetimePrev : 0) + totalPrize,
        currentHc: current[m.id],
      };
    }

    const maxPrize = Math.max(0, ...Object.values(stats).map((x) => x.totalPrize));
    const prizeOrder = members.map((m) => stats[m.id].totalPrize);
    for (const m of members) {
      const st = stats[m.id];
      st.prizeRank = prizeOrder.filter((p) => p > st.totalPrize).length + 1;
      st.isKing = maxPrize > 0 && st.totalPrize === maxPrize;
      let hc = null;
      if (st.avg !== null) {
        hc = Math.min(s.hcMax, Math.max(0, rounddown((st.avg - 72) * 0.8)));
        if (st.isKing) hc = rounddown(hc * s.kingCut);
      }
      // 幹事が翌年HCを手修正していればそれを優先
      st.nextYearHcComputed = hc;
      st.nextYearHcOverridden = isNum(m.nextYearHc);
      st.nextYearHc = st.nextYearHcOverridden ? m.nextYearHc : hc;
    }

    return { settings: s, members, rounds: roundResults, stats };
  }

  // 翌年度の初期データ（HC・昨年平均・生涯獲得額を引き継ぐ）
  function makeNextYear(year, result) {
    const r = result || computeYear(year);
    const members = {};
    for (const m of r.members) {
      const st = r.stats[m.id];
      members[m.id] = {
        name: m.name, order: m.order ?? 0,
        startHc: st.nextYearHc ?? st.currentHc,
        prevAvg: st.avg ?? '',
        lifetimePrev: st.lifetime,
      };
    }
    return { settings: Object.assign({}, year.settings || {}), members, rounds: {} };
  }

  const api = { DEFAULT_SETTINGS, settingsOf, sortedMembers, sortedRounds, runnerUpAmount, nextHc, computeYear, makeNextYear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UrajCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
