// 裏雄J会 成績表 — 画面とデータ保存（Firebase Realtime Database の REST、未設定なら端末内保存）
(function () {
  'use strict';
  const C = window.UrajCore;
  const ADMIN_PASSWORD = 'uraj';
  const LS_FB_URL = 'uraj-firebase-url';
  const LS_LOCAL = 'uraj-local-data';
  const SS_ADMIN = 'uraj-admin';
  const ROOT = 'uraj';
  const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = (n) => (n || 0).toLocaleString('ja-JP');
  const WD = '日月火水木金土';
  const dt = (d) => new Date(d + 'T00:00');
  const md = (d) => { if (!d) return ''; const t = dt(d); return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`; };
  const numOrEmpty = (v) => { const s = String(v).trim(); if (s === '') return ''; const n = Number(s); return isFinite(n) ? n : ''; };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // ストレージは使えない環境（非公開ウィンドウ等）もあるので、失敗しても止まらないようにする
  const st = (kind) => { try { return window[kind]; } catch { return null; } };
  const sget = (kind, k) => { try { return st(kind).getItem(k); } catch { return null; } };
  const sset = (kind, k, v) => { try { if (v === null) st(kind).removeItem(k); else st(kind).setItem(k, v); } catch { /* 保存できなくても続ける */ } };
  const badge = (rank) => `<span class="badge${rank <= 3 ? ' r' + rank : ''}">${rank ?? '-'}</span>`;

  let fbUrl = sget('localStorage', LS_FB_URL) || '';
  {
    const q = new URLSearchParams(location.search).get('db');
    if (q) { fbUrl = q; sset('localStorage', LS_FB_URL, q); }
  }
  let data = { years: {} };
  let yearKey = '';
  let tab = 'rounds';
  let roundId = '';
  let roundView = 'edit';     // 幹事：edit=入力 / result=結果
  let entryFilter = 'all';    // 幹事の入力：all=全員 / in=参加者だけ
  let scoreMode = 'gross';
  let isAdmin = sget('sessionStorage', SS_ADMIN) === '1';
  let pending = 0;
  const saveTimers = {};

  // ---------- 保存 ----------
  const fbPath = (path) => `${fbUrl.replace(/\/+$/, '')}/${[ROOT, ...path].map(encodeURIComponent).join('/')}.json`;

  async function load() {
    if (!fbUrl) {
      let saved = null;
      try { saved = JSON.parse(sget('localStorage', LS_LOCAL) || 'null'); } catch { saved = null; }
      // 試用版：端末にまだ何もなければ、ページに埋め込んだ初期データから始める
      data = saved || (window.URAJ_SEED ? JSON.parse(JSON.stringify(window.URAJ_SEED)) : null) || { years: {} };
      if (!data.years) data.years = {};
      return;
    }
    const res = await fetch(fbPath([]));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = (await res.json()) || { years: {} };
    if (!data.years) data.years = {};
  }

  function setLocal(path, value) {
    let o = data;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {};
    const k = path[path.length - 1];
    if (value === null) delete o[k]; else o[k] = value;
  }

  async function put(path, value) {
    setLocal(path, value);
    pending++; setSync('保存中…');
    try {
      if (!fbUrl) {
        try { localStorage.setItem(LS_LOCAL, JSON.stringify(data)); } catch { throw new Error('この端末に保存できません'); }
      } else {
        const res = await fetch(fbPath(path), value === null
          ? { method: 'DELETE' }
          : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      }
      pending--; setSync('保存済み ✓');
    } catch (e) {
      pending--; setSync('保存できませんでした', true);
      toast('保存に失敗しました：' + e.message);
      throw e;
    }
  }

  // 入力のたびに送らず、少し待ってからまとめて保存
  function saveLater(key, path, getValue) {
    clearTimeout(saveTimers[key]);
    setSync('未保存');
    saveTimers[key] = setTimeout(() => { delete saveTimers[key]; put(path, getValue()).catch(() => {}); }, 600);
  }

  function setSync(text, bad) {
    const mode = fbUrl ? '☁️' : '📱端末内';
    $('sync').textContent = `${mode} ${text || (fbUrl ? '共有' : '')}`;
    $('sync').title = fbUrl ? 'Firebaseで共有中' : 'この端末のブラウザ内だけに保存';
    $('sync').style.color = bad ? '#ffe0dc' : '';
  }

  async function refresh(force) {
    if (!force && (pending || Object.keys(saveTimers).length || (document.activeElement && $('main').contains(document.activeElement) && document.activeElement.tagName === 'INPUT'))) return;
    const before = JSON.stringify(data);
    try { await load(); setSync(''); } catch (e) { setSync('読込エラー', true); if (force) toast('読み込めませんでした：' + e.message); return; }
    const keys = Object.keys(data.years).sort();
    if (!data.years[yearKey]) yearKey = keys[keys.length - 1] || '';
    if (force || JSON.stringify(data) !== before) render();
  }

  // ---------- 共通 ----------
  // confirm/prompt の代わり（埋め込み表示では標準ダイアログが出ないため、ページ内のダイアログで聞く）
  // opts.input: 文字入力欄を出す / opts.text: コピー用の文字を表示する
  function ask(msg, opts) {
    const o = opts || {};
    const dlg = $('askDlg');
    $('askMsg').textContent = msg;
    $('askInput').classList.toggle('hidden', !o.input);
    $('askInput').value = o.value || '';
    $('askArea').classList.toggle('hidden', !o.text);
    $('askArea').value = o.text || '';
    $('askNo').classList.toggle('hidden', !!o.text);
    $('askOk').textContent = o.ok || 'OK';
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => {
        const ok = dlg.returnValue === 'ok';
        resolve(o.input ? (ok ? $('askInput').value.trim() : null) : ok);
      }, { once: true });
      dlg.returnValue = '';
      dlg.showModal();
      if (o.input) $('askInput').focus();
      if (o.text) { $('askArea').focus(); $('askArea').select(); }
    });
  }

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2500);
  }

  const Y = () => data.years[yearKey];
  const result = () => C.computeYear(Y());

  function render() {
    const keys = Object.keys(data.years).sort();
    $('yearSel').innerHTML = keys.map((k) => `<option value="${esc(k)}"${k === yearKey ? ' selected' : ''}>${esc(k)}年</option>`).join('');
    $('yearSel').classList.toggle('hidden', !keys.length);
    $('adminBtn').textContent = isAdmin ? '✏️幹事' : '幹事';
    $('adminBtn').classList.toggle('on', isAdmin);
    for (const b of $('tabs').querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
    const main = $('main');
    if (!Y() && tab !== 'settings') {
      main.innerHTML = `<div class="card" style="text-align:center;padding:32px 16px">
        <div style="font-size:48px">🏌️</div><h2 style="justify-content:center">まだデータがありません</h2>
        <p class="muted">${isAdmin ? '⚙️ 設定タブで年度を作るか、バックアップから復元してください。' : '幹事から共有リンクを受け取って開いてください。'}</p></div>`;
      return;
    }
    ({ rounds: renderRounds, scores: renderScores, hc: renderHc, money: renderMoney, settings: renderSettings })[tab](main);
  }

  function roundHead(rr) {
    return `<th title="${esc(rr.title)}">${md(rr.date)}<br>${esc(rr.title)}</th>`;
  }

  // ---------- 大会 ----------
  function renderRounds(main) {
    const res = result();
    if (roundId && res.rounds.some((r) => r.id === roundId)) return renderRound(main, res);
    roundId = '';
    const list = res.rounds.slice().reverse();
    main.innerHTML = `
      <h2>⛳ ${esc(yearKey)}年の大会 <span class="chip green">${list.length}回</span></h2>
      ${isAdmin ? '<div class="row"><button class="btn sun wide" id="newRound">＋ 新しい大会をつくる</button></div>' : ''}
      ${list.length ? '' : '<p class="muted">まだ大会がありません。</p>'}
      <div class="round-list">${list.map((rr, i) => {
        const win = rr.rows.filter((r) => r.rank === 1).map((r) => esc(r.name)).join('・');
        const second = rr.rows.filter((r) => r.rank === 2).map((r) => esc(r.name)).join('・');
        const d = rr.date ? dt(rr.date) : null;
        return `<button class="card round-card${i === 0 ? ' latest' : ''}" data-id="${esc(rr.id)}">
          <div class="date-bubble">${d ? `<b>${d.getMonth() + 1}/${d.getDate()}</b><span>${WD[d.getDay()]}曜</span>` : '<b>?</b>'}</div>
          <div style="flex:1;min-width:0">
            <div class="t">${esc(rr.title)} <span class="chip">${rr.n}名</span></div>
            <div class="w">${win ? `🥇 ${win}` : '<span class="muted">スコア未入力</span>'}</div>
            ${second ? `<div class="w second">🥈 ${second}</div>` : ''}
          </div>
          <span class="muted" style="font-size:20px">›</span>
        </button>`;
      }).join('')}</div>`;
    main.querySelectorAll('.round-card').forEach((b) => b.onclick = () => { roundId = b.dataset.id; roundView = 'edit'; render(); window.scrollTo(0, 0); });
    const nb = $('newRound');
    if (nb) nb.onclick = () => {
      const id = newId('r');
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      put(['years', yearKey, 'rounds', id], { date, title: '雄J会', entries: {} })
        .then(() => { roundId = id; roundView = 'edit'; entryFilter = 'all'; render(); }).catch(() => {});
    };
  }

  function renderRound(main, res) {
    const rr = res.rounds.find((r) => r.id === roundId);
    const editing = isAdmin && roundView === 'edit';
    let html = `<div class="row noprint" style="justify-content:space-between">
        <button class="btn small ghost" id="back">‹ 一覧へ</button>
        ${isAdmin ? `<div class="seg"><button data-view="edit" class="${editing ? 'on' : ''}">✏️ 入力</button><button data-view="result" class="${editing ? '' : 'on'}">🏆 結果</button></div>` : ''}
      </div>`;
    html += editing ? roundEditorHtml(res) : roundResultHtml(rr);
    main.innerHTML = html;
    $('back').onclick = () => { roundId = ''; render(); };
    main.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { roundView = b.dataset.view; render(); });
    if (editing) { bindRoundEditor(); updateRoundComputed(); }
    else {
      $('copyText').onclick = () => copyText(roundText(rr));
      $('sharePdf').onclick = (ev) => shareRoundPdf(rr, ev.currentTarget);
    }
  }

  function roundResultHtml(rr) {
    const p1 = rr.rows.filter((r) => r.rank === 1);
    const p2 = rr.rows.filter((r) => r.rank === 2);
    const pod = (r, cls) => `<div class="p ${cls}"><div class="medal">${MEDAL[r.rank]}</div><div class="nm">${esc(r.name)}</div>
      <div class="sub">${r.score} − ${r.hc} ＝ NET ${r.net}</div><div class="yen">${yen(r.prize)}円</div></div>`;
    const ranked = rr.rows.filter((r) => r.rank !== null);
    const waiting = rr.rows.filter((r) => r.rank === null);
    return `<h2>${md(rr.date)} ${esc(rr.title)}</h2>
      <div class="summary"><span class="chip green">👥 ${rr.n}名</span><span class="chip sun">💰 総額 ${yen(rr.pool)}円</span>
        ${rr.memo ? `<span class="chip">📝 ${esc(rr.memo)}</span>` : ''}</div>
      ${p1.length ? `<div class="podium">${p1.map((r) => pod(r, 'p1')).join('')}${p2.map((r) => pod(r, 'p2')).join('')}</div>` : '<div class="card muted">まだスコアが入っていません。</div>'}
      <div class="rank-list">${ranked.map((r) => `<div class="card rank-row">${badge(r.rank)}
        <div class="who"><div class="nm">${esc(r.name)}</div>
          <div class="sub">GROSS ${r.score}・HC <span class="${r.hcOverridden ? 'override' : ''}">${r.hc}</span>${r.nextHc !== r.hc ? ` <span class="chip pink">次回HC ${r.nextHc}</span>` : ''}</div></div>
        <div class="net"><b>${r.net}</b><small>NET</small></div></div>`).join('')}
        ${waiting.map((r) => `<div class="card rank-row">${badge(null)}<div class="who"><div class="nm">${esc(r.name)}</div><div class="sub">HC ${r.hc}・スコア未入力</div></div></div>`).join('')}
      </div>
      <div class="row noprint" style="margin-top:16px">
        <button class="btn primary wide" id="sharePdf"${ranked.length ? '' : ' disabled'}>📄 PDFで保存・共有（メール用）</button>
        <button class="btn wide" id="copyText">📋 結果をコピー（LINE用）</button>
      </div>`;
  }

  function roundEditorHtml(res) {
    const rd = Y().rounds[roundId];
    const titles = [...new Set(res.rounds.map((r) => r.title).filter(Boolean))];
    return `
      <div class="card meta">
        <label class="field wide">日付<input type="date" id="rDate" value="${esc(rd.date)}"></label>
        <label class="field wide">大会名<input type="text" id="rTitle" list="titleList" value="${esc(rd.title)}"></label>
        <datalist id="titleList">${titles.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <label class="field">賞金の調整(円)<input type="number" inputmode="numeric" id="rAdj" class="money" step="1000" value="${esc(rd.poolAdjust || '')}" placeholder="0"></label>
        <label class="field">メモ<input type="text" id="rMemo" value="${esc(rd.memo || '')}"></label>
      </div>
      <div class="summary" id="rSummary"></div>
      <div class="filter"><div class="seg"><button data-filter="all" class="${entryFilter === 'all' ? 'on' : ''}">全員</button><button data-filter="in" class="${entryFilter === 'in' ? 'on' : ''}">参加者だけ</button></div></div>
      <div class="entry-list" id="entryList">${res.members.map((m) => {
        const e = (rd.entries || {})[m.id];
        return `<div class="card entry${e ? ' on' : ''}" data-mid="${esc(m.id)}">
          <div class="top">
            <label class="toggle"><input type="checkbox" data-f="in"${e ? ' checked' : ''}><span>参加</span></label>
            <div class="nm">${esc(m.name)}</div>
            <div class="res" data-k="res"></div>
          </div>
          <div class="body">
            <label class="field">スコア<input type="number" inputmode="numeric" class="score" data-f="score" value="${e && typeof e.score === 'number' ? e.score : ''}"></label>
            <label class="field">HC<input type="number" inputmode="numeric" class="hc" data-f="hc"></label>
            <div class="calc">NET<b data-k="net">-</b></div>
            <div class="calc">次回HC<b data-k="next">-</b></div>
            <label class="toggle paid" style="margin-left:auto"><input type="checkbox" data-f="paid"${e && e.paid ? ' checked' : ''}><span>💴 支払済</span></label>
          </div>
        </div>`;
      }).join('')}</div>
      <p class="muted">「参加」を押すと入力欄が開きます。HCは計算値が入っています（変えると手修正としてピンク色に、空欄に戻すと計算値に戻ります）。</p>
      <div class="row"><button class="btn danger" id="delRound">🗑 この大会を削除</button></div>`;
  }

  function updateRoundComputed() {
    const rr = result().rounds.find((r) => r.id === roundId);
    if (!rr) return;
    $('rSummary').innerHTML = `<span class="chip green">👥 ${rr.n}名</span><span class="chip sun">💰 総額 ${yen(rr.pool)}円</span>
      <span class="chip">🥇 ${yen(rr.winner)}円</span><span class="chip">🥈 ${yen(rr.second)}円</span>`
      + (rr.poolAdjust ? `<span class="chip pink">調整 ${rr.poolAdjust > 0 ? '+' : ''}${yen(rr.poolAdjust)}円</span>` : '');
    for (const card of $('entryList').children) {
      const mid = card.dataset.mid;
      const r = rr.rows.find((x) => x.mid === mid);
      card.classList.toggle('on', !!r);
      card.classList.toggle('hidden', entryFilter === 'in' && !r);
      const hcIn = card.querySelector('input[data-f="hc"]');
      if (document.activeElement !== hcIn) hcIn.value = r ? r.hc : rr.hcBefore[mid] ?? '';
      hcIn.placeholder = rr.hcBefore[mid] ?? '';
      hcIn.classList.toggle('override', !!(r && r.hcOverridden));
      hcIn.title = r && r.hcOverridden ? `計算値は ${r.computedHc}` : '';
      card.querySelector('[data-k="net"]').textContent = r && r.net !== null ? r.net : '-';
      card.querySelector('[data-k="next"]').innerHTML = r && r.score !== null ? (r.nextHc !== r.hc ? `<span style="color:var(--minus)">${r.nextHc}</span>` : r.nextHc) : '-';
      card.querySelector('[data-k="res"]').innerHTML = r && r.rank
        ? `${r.prize ? `<span class="chip sun">${yen(r.prize)}円</span>` : ''}${badge(r.rank)}` : '';
    }
  }

  function bindRoundEditor() {
    const path = ['years', yearKey, 'rounds', roundId];
    const rd = () => Y().rounds[roundId];
    const save = () => saveLater('round:' + roundId, path, () => rd());
    $('rDate').onchange = (e) => { if (!e.target.value) return; rd().date = e.target.value; save(); updateRoundComputed(); };
    $('rTitle').onchange = (e) => { rd().title = e.target.value.trim(); save(); };
    $('rAdj').onchange = (e) => { const v = numOrEmpty(e.target.value); if (v === '' || v === 0) delete rd().poolAdjust; else rd().poolAdjust = v; save(); updateRoundComputed(); };
    $('rMemo').onchange = (e) => { const v = e.target.value.trim(); if (v) rd().memo = v; else delete rd().memo; save(); };
    document.querySelectorAll('[data-filter]').forEach((b) => b.onclick = () => {
      entryFilter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      updateRoundComputed();
    });
    $('delRound').onclick = async () => {
      if (!await ask(`${md(rd().date)} ${rd().title} を削除します。よろしいですか？`, { ok: '削除する' })) return;
      clearTimeout(saveTimers['round:' + roundId]); delete saveTimers['round:' + roundId];
      put(path, null).then(() => { roundId = ''; render(); }).catch(() => {});
    };
    $('entryList').addEventListener('change', async (ev) => {
      const input = ev.target;
      const card = input.closest('.entry');
      const mid = card.dataset.mid;
      const r = rd();
      r.entries = r.entries || {};
      const f = input.dataset.f;
      if (f === 'in') {
        if (input.checked) {
          r.entries[mid] = { paid: false };
          setTimeout(() => card.querySelector('input[data-f="score"]').focus(), 50);
        } else {
          const e = r.entries[mid];
          if (e && typeof e.score === 'number') {
            input.checked = true;
            if (!await ask('スコアが入っています。参加を外しますか？', { ok: '外す' })) return;
            input.checked = false;
          }
          delete r.entries[mid];
          card.querySelector('input[data-f="score"]').value = '';
          card.querySelector('input[data-f="paid"]').checked = false;
        }
      } else {
        const e = r.entries[mid];
        if (!e) return;
        if (f === 'paid') e.paid = input.checked;
        if (f === 'score') { const v = numOrEmpty(input.value); if (v === '') delete e.score; else e.score = v; }
        if (f === 'hc') {
          const v = numOrEmpty(input.value);
          const computed = result().rounds.find((x) => x.id === roundId).hcBefore[mid];
          if (v === '' || v === computed) delete e.hc; else e.hc = v;
        }
      }
      save();
      updateRoundComputed();
    });
  }

  function roundText(rr) {
    const lines = [`⛳【${yearKey}/${md(rr.date)} ${rr.title}】参加${rr.n}名`];
    for (const r of rr.rows) {
      if (r.rank === null) continue;
      lines.push(`${MEDAL[r.rank] || r.rank + '位'} ${r.name}　${r.score}-${r.hc}=${r.net}${r.prize ? `　${yen(r.prize)}円` : ''}${r.nextHc !== r.hc ? `　→次回HC${r.nextHc}` : ''}`);
    }
    return lines.join('\n');
  }

  function copyText(text) {
    const fallback = () => { ask('下の文字を長押ししてコピーしてください', { text, ok: '閉じる' }); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(() => toast('📋 コピーしました'), fallback);
    else fallback();
  }

  // ---------- PDF（大会結果をA4一枚に） ----------
  const LIBS = {
    html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  };
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('ライブラリを読み込めませんでした'));
      document.head.appendChild(s);
    });
    return loaded[src];
  }

  // PDF用の紙面（テーマに関係なく明るい配色で固定）
  function reportHtml(rr) {
    const p1 = rr.rows.filter((r) => r.rank === 1);
    const p2 = rr.rows.filter((r) => r.rank === 2);
    const ranked = rr.rows.filter((r) => r.rank !== null);
    const pod = (r, gold) => `<div class="rp-pod ${gold ? 'gold' : 'silver'}">
      <div class="rp-medal">${MEDAL[r.rank]}</div>
      <div class="rp-podname">${esc(r.name)}</div>
      <div class="rp-podsub">${r.score} − ${r.hc} ＝ NET <b>${r.net}</b></div>
      <div class="rp-podyen">${yen(r.prize)}<small>円</small></div></div>`;
    const now = new Date();
    return `<div class="rp-head">
        <div class="rp-club">${document.querySelector('header .logo') ? `<img class="rp-logo" src="${document.querySelector('header .logo').src}" alt="">` : '⛳ '}裏雄Ｊ会 ${esc(yearKey)}</div>
        <div class="rp-title">${md(rr.date)}　${esc(rr.title)}</div>
        <div class="rp-chips"><span>👥 参加 ${rr.n}名</span><span>💰 賞金総額 ${yen(rr.pool)}円</span></div>
      </div>
      <div class="rp-body">
        ${p1.length ? `<div class="rp-pods">${p1.map((r) => pod(r, true)).join('')}${p2.map((r) => pod(r, false)).join('')}</div>` : ''}
        <table class="rp-table"><thead><tr><th>順位</th><th class="l">氏名</th><th>GROSS</th><th>HC</th><th>NET</th><th>賞金</th><th>次回HC</th></tr></thead><tbody>
        ${ranked.map((r) => `<tr class="${r.rank === 1 ? 'g' : r.rank === 2 ? 's' : ''}">
          <td><span class="rp-badge r${Math.min(r.rank, 4)}">${r.rank}</span></td><td class="l nm">${esc(r.name)}</td>
          <td>${r.score}</td><td>${r.hc}</td><td class="net">${r.net}</td><td>${r.prize ? yen(r.prize) + '円' : ''}</td>
          <td>${r.nextHc !== r.hc ? `<span class="rp-down">${r.hc} → ${r.nextHc}</span>` : ''}</td></tr>`).join('')}
        </tbody></table>
        ${rr.memo ? `<div class="rp-memo">📝 ${esc(rr.memo)}</div>` : ''}
      </div>
      <div class="rp-foot">順位はNET順（同NETはGROSSの良い方が上）・作成 ${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}</div>`;
  }

  async function makeRoundPdf(rr) {
    await Promise.all([loadScript(LIBS.html2canvas), loadScript(LIBS.jspdf)]);
    const el = document.createElement('div');
    el.className = 'report';
    el.innerHTML = reportHtml(rr);
    document.body.appendChild(el);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const pw = 210, ph = 297;
      let w = pw, h = canvas.height * pw / canvas.width;
      if (h > ph) { w = w * ph / h; h = ph; }   // 参加者が多くても1枚に収める
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w) / 2, 0, w, h);
      return pdf.output('blob');
    } finally {
      el.remove();
    }
  }

  // ファイルを渡す：Claudeのページなら保存の仕組み、スマホなら共有メニュー、それ以外はダウンロード
  async function deliverFile(blob, filename, title) {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) {
        try { await dl.save({ filename, data: blob }); toast('保存しました'); }
        catch (e) { if (e && e.code !== 'declined') toast('保存できませんでした'); }
        return;
      }
    }
    const file = new File([blob], filename, { type: blob.type });
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); } catch (e) { if (e && e.name !== 'AbortError') toast('共有できませんでした'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function shareRoundPdf(rr, btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '📄 PDFを作成中…';
    try {
      const blob = await makeRoundPdf(rr);
      await deliverFile(blob, `裏雄J会_${rr.date}_${rr.title}.pdf`, `裏雄J会 ${md(rr.date)} ${rr.title} 結果`);
    } catch (e) {
      toast('PDFを作れませんでした：' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  // ---------- スコア ----------
  function renderScores(main) {
    const res = result();
    const modes = { gross: 'GROSS', net: 'NET', rank: '順位' };
    const top = res.members.filter((m) => res.stats[m.id].avg !== null)
      .sort((a, b) => res.stats[a.id].avg - res.stats[b.id].avg).slice(0, 3);
    main.innerHTML = `
      <h2>📊 スコアボード</h2>
      ${top.length ? `<div class="mini-rank">${top.map((m, i) => `<div class="card">${badge(i + 1)}<div><div class="nm">${esc(m.name)}</div><div class="yen">年間平均 ${res.stats[m.id].avg}</div></div></div>`).join('')}</div>` : ''}
      <div class="row"><div class="seg">${Object.entries(modes).map(([k, v]) => `<button data-mode="${k}" class="${scoreMode === k ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="scroll"><table><thead><tr><th class="name">氏名</th><th>昨年<br>平均</th>${res.rounds.map(roundHead).join('')}
        <th>参加</th><th>ベスト</th><th>年間<br>平均</th></tr></thead><tbody>
      ${res.members.map((m) => {
        const st = res.stats[m.id];
        return `<tr><td class="name">${esc(m.name)}</td><td class="muted">${m.prevAvg ?? ''}</td>${res.rounds.map((rr) => {
          const r = rr.rows.find((x) => x.mid === m.id);
          if (r && r.score !== null) {
            const v = scoreMode === 'gross' ? r.score : scoreMode === 'net' ? r.net : r.rank;
            return `<td class="${r.rank === 1 ? 'win' : r.rank === 2 ? 'second' : ''}">${scoreMode === 'rank' && MEDAL[r.rank] && r.rank <= 2 ? MEDAL[r.rank] : v}</td>`;
          }
          const f = st.scores[rr.id];
          return `<td>${scoreMode === 'gross' && f && f.filled ? `<span class="filled">${f.score}</span>` : ''}</td>`;
        }).join('')}<td class="c">${st.played}</td><td>${st.best ?? ''}</td><td><b>${st.avg ?? ''}</b></td></tr>`;
      }).join('')}
      </tbody></table></div>
      <p class="muted">黄色＝優勝、<span class="second">グレー</span>＝準優勝。${res.settings.fillAbsentWithBest ? '<span class="filled">ピンク斜体</span>＝不参加回（初参加以降）にその年のベストスコアを入れた値で、年間平均の計算に使います。' : ''}表は横にスクロールできます。</p>`;
    main.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { scoreMode = b.dataset.mode; render(); });
  }

  // ---------- HC ----------
  function renderHc(main) {
    const res = result();
    main.innerHTML = `
      <h2>🎯 HC推移</h2>
      <div class="scroll"><table id="hcTbl"><thead><tr><th class="name">氏名</th><th>現在</th><th>来年<br>(見込)</th><th>年初</th>${res.rounds.map(roundHead).join('')}
        </tr></thead><tbody>
      ${res.members.map((m) => {
        const st = res.stats[m.id];
        let prev = m.startHc;
        const next = isAdmin
          ? `<input type="number" inputmode="numeric" class="num${st.nextYearHcOverridden ? ' override' : ''}" data-mid="${esc(m.id)}" value="${st.nextYearHc ?? ''}" placeholder="${st.nextYearHcComputed ?? ''}" title="計算値 ${st.nextYearHcComputed ?? '-'}">`
          : `<span class="${st.nextYearHcOverridden ? 'override' : ''}">${st.nextYearHc ?? ''}</span>`;
        return `<tr><td class="name">${esc(m.name)}</td><td class="c"><span class="chip green" style="font-size:14px">${st.currentHc}</span></td>
          <td class="c">${next}${st.isKing ? ' <span class="king">👑</span>' : ''}</td>
          <td class="muted">${m.startHc ?? ''}</td>${res.rounds.map((rr) => {
          const r = rr.rows.find((x) => x.mid === m.id);
          const hc = r ? r.hc : rr.hcBefore[m.id];
          const changed = hc !== prev; prev = r && r.score !== null ? r.nextHc : hc;
          return `<td class="${r && r.hcOverridden ? 'override' : ''}" ${r && r.hcOverridden ? `title="手修正（計算値 ${r.computedHc}）"` : ''}>${changed ? `<b style="color:var(--minus)">${hc}</b>` : `<span class="${r ? '' : 'muted'}">${hc}</span>`}</td>`;
        }).join('')}</tr>`;
      }).join('')}
      </tbody></table></div>
      <p class="muted">各回の欄はその大会で使ったHC。赤字＝前回から変わった値、<span class="override">ピンク</span>＝手修正、薄字＝不参加。
        ${isAdmin ? '来年HCは直接書き換えられます（空欄に戻すと計算値に戻ります）。' : ''}</p>
      ${rulesHtml(res.settings)}`;
    if (!isAdmin) return;
    // 幹事：来年HCの手修正（計算値と同じ・空欄なら手修正を外す）
    $('hcTbl').addEventListener('change', (ev) => {
      const mid = ev.target.dataset.mid;
      if (!mid) return;
      const m = Y().members[mid];
      const v = numOrEmpty(ev.target.value);
      const computed = result().stats[mid].nextYearHcComputed;
      if (v === '' || v === computed) { delete m.nextYearHc; ev.target.value = computed ?? ''; }
      else m.nextYearHc = v;
      ev.target.classList.toggle('override', 'nextYearHc' in m);
      saveLater('member:' + mid, ['years', yearKey, 'members', mid], () => Y().members[mid]);
    });
  }

  function rulesHtml(s) {
    const ru = s.runnerUp.map((r, i, a) => {
      const next = a[i + 1];
      const range = !next ? `${r.min}人以上` : i === 0 && r.min <= 1 ? `${next.min - 1}人以下` : `${r.min}〜${next.min - 1}人`;
      return `${range} ${yen(r.amount)}円`;
    }).join('、');
    return `<h3>📖 規定</h3><div class="card rules">
      <p class="rule">💴 参加費 ${yen(s.fee)}円。全額を賞金に充てる。</p>
      <p class="rule">🥇 優勝：参加費合計−準優勝賞金。🥈 準優勝：${ru}。</p>
      <p class="rule">🏌️ 順位はNET順。NETが同じならGROSSの良い方が上。</p>
      <p class="rule">✂️ 優勝者は次回からHC2割カット、準優勝者は1割カット（参加${s.cutMinPlayers}人未満の大会はカット無し）。NETが72を切ったら、そのアンダー分をHCから引いてからカット。</p>
      <p class="rule">📅 翌年のHCは（年間平均−72）×0.8（上限${s.hcMax}）。${s.fillAbsentWithBest ? '不参加の回はベストスコアを入れて平均する。' : ''}</p>
      <p class="rule">👑 年間賞金王は翌年のHCから1割カット。</p></div>`;
  }

  // ---------- 賞金 ----------
  function renderMoney(main) {
    const res = result();
    const tot = (f) => res.members.reduce((a, m) => a + f(res.stats[m.id], m), 0);
    const ranking = res.members.filter((m) => res.stats[m.id].totalPrize > 0)
      .sort((a, b) => res.stats[b.id].totalPrize - res.stats[a.id].totalPrize);
    const kings = ranking.filter((m) => res.stats[m.id].isKing);
    main.innerHTML = `
      <h2>💰 賞金</h2>
      ${kings.length ? `<div class="card hero"><div class="big">👑</div><div><div class="muted" style="color:inherit;opacity:.8;font-weight:800">${esc(yearKey)}年 賞金王（暫定）</div>
        <div class="nm">${kings.map((m) => esc(m.name)).join('・')}</div><div class="yen">${yen(res.stats[kings[0].id].totalPrize)}円</div></div></div>` : ''}
      ${ranking.length > kings.length ? `<div class="mini-rank">${ranking.filter((m) => !res.stats[m.id].isKing).slice(0, 6).map((m) => `<div class="card">${badge(res.stats[m.id].prizeRank)}<div><div class="nm">${esc(m.name)}</div><div class="yen">${yen(res.stats[m.id].totalPrize)}円</div></div></div>`).join('')}</div>` : ''}
      <div class="scroll"><table><thead><tr><th class="name">氏名</th><th>年間<br>獲得</th><th>収支</th>${res.rounds.map(roundHead).join('')}
        <th>年間<br>支払</th><th>前年度<br>まで</th><th>生涯<br>獲得</th></tr></thead><tbody>
      ${res.members.map((m) => {
        const st = res.stats[m.id];
        return `<tr><td class="name">${esc(m.name)}${st.isKing ? ' <span class="king">👑</span>' : ''}</td>
          <td><b>${yen(st.totalPrize)}</b></td><td class="${st.balance < 0 ? 'minus' : ''}">${st.balance > 0 ? '+' : ''}${yen(st.balance)}</td>
          ${res.rounds.map((rr) => {
            const r = rr.rows.find((x) => x.mid === m.id && x.score !== null);
            return `<td class="${r && r.rank === 1 ? 'win' : r && r.rank === 2 ? 'second' : ''}">${r ? (r.prize ? yen(r.prize) : '<span class="muted">0</span>') : ''}</td>`;
          }).join('')}<td>${yen(st.paidTotal)}</td><td class="muted">${yen(m.lifetimePrev)}</td><td><b>${yen(st.lifetime)}</b></td></tr>`;
      }).join('')}
      <tr class="total"><td class="name">合計</td><td>${yen(tot((s) => s.totalPrize))}</td><td></td>
        ${res.rounds.map((rr) => `<td>${yen(rr.rows.reduce((a, r) => a + r.prize, 0))}</td>`).join('')}
        <td>${yen(tot((s) => s.paidTotal))}</td><td>${yen(tot((s, m) => m.lifetimePrev || 0))}</td><td>${yen(tot((s) => s.lifetime))}</td></tr>
      </tbody></table></div>
      <p class="muted">年間支払＝参加回数×参加費。黄色＝優勝賞金、グレー＝準優勝賞金。</p>
      ${isAdmin ? paidCheckHtml(res) : ''}`;
  }

  // 幹事用：支払チェックが付いていない参加者
  function paidCheckHtml(res) {
    const un = [];
    for (const rr of res.rounds) for (const r of rr.rows) if (!r.paid) un.push(`${md(rr.date)} ${esc(rr.title)}：<b>${esc(r.name)}</b>`);
    return `<h3>💴 参加費 未チェック <span class="chip">幹事のみ</span></h3>
      <div class="card">${un.length ? `<p class="muted" style="margin:0">${un.join('<br>')}</p>` : '<p class="muted" style="margin:0">ありません 🎉</p>'}</div>`;
  }

  // ---------- 設定 ----------
  function renderSettings(main) {
    let html = '<h2>⚙️ 設定</h2>';
    if (Y()) html += rulesHtml(C.settingsOf(Y()));
    if (isAdmin && Y()) html += membersHtml() + ruleEditHtml(C.settingsOf(Y()));
    // URLを人に見られないよう、データの共有欄はチェックを入れたときだけ開く（開いた状態は覚えない）
    html += `<h3>☁️ データの共有</h3><div class="card">
      <div class="row" style="margin:0;justify-content:space-between">
        <span class="muted">${fbUrl ? '☁️ 共有中（全員で同じデータ）' : '📱 この端末のみ'}</span>
        <label class="toggle"><input type="checkbox" id="shareOpen"><span>設定を表示</span></label>
      </div>
      <div id="shareBody" class="hidden">
      <div class="row"><input type="url" id="fbUrl" value="${esc(fbUrl)}" placeholder="https://xxxx-default-rtdb.firebaseio.com" style="flex:1;min-width:12em">
        <button class="btn primary small" id="fbSave">接続</button></div>
      <p class="muted" style="margin-bottom:0">${fbUrl ? 'Firebaseに保存しています（全員で同じデータを見られます）。' : '未接続のため、この端末のブラウザ内だけに保存しています。'}</p>
      ${fbUrl && isAdmin ? '<div class="row" style="margin-bottom:0"><button class="btn small" id="shareLink">🔗 メンバー用リンクをコピー</button></div>' : ''}
      <div class="warn">⚠️ データ共有のURLは他人に渡さないでください。このURLを知っている人は、成績データを見たり書き換えたりできます。
        メンバー用リンクにも同じURLが入っているので、送るのはメンバーだけにして、SNSや掲示板などには載せないでください。</div></div></div>`;
    if (isAdmin) {
      html += `<h3>💾 バックアップ・年度</h3><div class="card">
        <div class="row" style="margin-top:0"><button class="btn small" id="backup">バックアップを保存</button><button class="btn small" id="restoreBtn">バックアップから復元</button>
          <input type="file" id="restoreFile" accept=".json,application/json" class="hidden"></div>
        <div class="row" style="margin-bottom:0">${Y() ? `<button class="btn small sun" id="nextYear">${Number(yearKey) + 1}年度をつくる（HC・平均・生涯獲得を引き継ぐ）</button>` : ''}
          <button class="btn small ghost" id="emptyYear">空の年度をつくる</button></div>
        ${!fbUrl && window.URAJ_SEED ? '<div class="row" style="margin-bottom:0"><button class="btn small danger" id="resetSeed">試用データを初期状態に戻す</button></div>' : ''}</div>`;
    } else {
      html += `<p class="muted">入力・修正は幹事のみ（右上の「幹事」からログイン）。</p>`;
    }
    main.innerHTML = html;
    bindSettings();
  }

  function membersHtml() {
    const ms = C.sortedMembers(Y());
    const used = new Set(Object.values(Y().rounds || {}).flatMap((r) => Object.keys(r.entries || {})));
    return `<h3>👥 メンバー</h3>
      <div class="scroll"><table id="memTbl"><thead><tr><th class="name">氏名</th><th>順</th><th>年初HC</th><th>昨年平均</th><th>前年度までの<br>生涯獲得(円)</th><th></th></tr></thead><tbody>
      ${ms.map((m) => `<tr data-mid="${esc(m.id)}">
        <td class="name"><input type="text" data-f="name" value="${esc(m.name)}" style="width:7.5em"></td>
        <td><input type="number" inputmode="numeric" class="num" data-f="order" value="${m.order ?? ''}"></td>
        <td><input type="number" inputmode="numeric" class="num" data-f="startHc" value="${m.startHc ?? ''}"></td>
        <td><input type="number" inputmode="numeric" class="num" data-f="prevAvg" value="${m.prevAvg ?? ''}"></td>
        <td><input type="number" inputmode="numeric" class="money" data-f="lifetimePrev" value="${m.lifetimePrev ?? ''}" step="1000"></td>
        <td>${used.has(m.id) ? '' : '<button class="btn danger small" data-del="1">削除</button>'}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row"><button class="btn small" id="addMember">＋ メンバー追加</button><span class="muted">大会に参加した人は削除できません。</span></div>`;
  }

  function ruleEditHtml(s) {
    return `<h3>🔧 ルールの数値</h3><div class="card">
      <div class="row" style="margin-top:0"><label class="field">参加費(円)<input type="number" inputmode="numeric" class="money" id="sFee" value="${s.fee}"></label>
        <label class="field">HC上限<input type="number" inputmode="numeric" class="num" id="sMax" value="${s.hcMax}"></label>
        <label class="field">カットする最少人数<input type="number" inputmode="numeric" class="num" id="sCut" value="${s.cutMinPlayers}"></label></div>
      <div class="field" style="margin-top:8px">準優勝賞金</div>
      ${s.runnerUp.map((r, i) => `<div class="row" style="margin:4px 0"><input type="number" inputmode="numeric" class="num" data-ru="${i}" data-k="min" value="${r.min}">人以上 →
        <input type="number" inputmode="numeric" class="money" data-ru="${i}" data-k="amount" value="${r.amount}">円</div>`).join('')}
      <div class="row"><label class="toggle"><input type="checkbox" id="sFill"${s.fillAbsentWithBest ? ' checked' : ''}><span>年間平均で不参加回をベストスコアで補完</span></label></div>
      <div class="row" style="margin-bottom:0"><button class="btn primary" id="sSave">ルールを保存</button></div></div>`;
  }

  function bindSettings() {
    $('shareOpen').onchange = (ev) => { $('shareBody').classList.toggle('hidden', !ev.target.checked); };
    $('fbSave').onclick = () => {
      const v = $('fbUrl').value.trim();
      if (v && !/^https:\/\/.+/.test(v)) { toast('https:// で始まるURLを入れてください'); return; }
      fbUrl = v; sset('localStorage', LS_FB_URL, v || null);
      yearKey = ''; refresh(true);
    };
    const sl = $('shareLink');
    if (sl) sl.onclick = () => copyText(location.origin + location.pathname + '?db=' + encodeURIComponent(fbUrl));
    if (!isAdmin) return;

    const mt = $('memTbl');
    if (mt) {
      mt.addEventListener('change', (ev) => {
        const mid = ev.target.closest('tr').dataset.mid;
        const m = Y().members[mid];
        const f = ev.target.dataset.f;
        if (f === 'name') m.name = ev.target.value.trim();
        else { const v = numOrEmpty(ev.target.value); m[f] = f === 'prevAvg' ? v : v === '' ? 0 : v; }
        saveLater('member:' + mid, ['years', yearKey, 'members', mid], () => Y().members[mid]);
      });
      mt.addEventListener('click', async (ev) => {
        if (!ev.target.dataset.del) return;
        const mid = ev.target.closest('tr').dataset.mid;
        if (!await ask(`${Y().members[mid].name} を削除しますか？`, { ok: '削除する' })) return;
        put(['years', yearKey, 'members', mid], null).then(render).catch(() => {});
      });
      $('addMember').onclick = async () => {
        const name = await ask('追加するメンバーの氏名', { input: true, ok: '追加' }); if (!name) return;
        const order = Math.max(0, ...C.sortedMembers(Y()).map((m) => m.order || 0)) + 1;
        const s = C.settingsOf(Y());
        put(['years', yearKey, 'members', newId('m')], { name, order, startHc: s.hcMax, prevAvg: '', lifetimePrev: 0 }).then(render).catch(() => {});
      };
      $('sSave').onclick = () => {
        const s = C.settingsOf(Y());
        const runnerUp = s.runnerUp.map((r, i) => ({
          min: Number(document.querySelector(`[data-ru="${i}"][data-k="min"]`).value) || 0,
          amount: Number(document.querySelector(`[data-ru="${i}"][data-k="amount"]`).value) || 0,
        })).sort((a, b) => a.min - b.min);
        const ns = Object.assign({}, Y().settings || {}, {
          fee: Number($('sFee').value) || 0, hcMax: Number($('sMax').value) || 36,
          cutMinPlayers: Number($('sCut').value) || 0, runnerUp, fillAbsentWithBest: $('sFill').checked,
        });
        put(['years', yearKey, 'settings'], ns).then(() => { toast('保存しました'); render(); }).catch(() => {});
      };
    }

    $('backup').onclick = () => {
      const blob = new Blob([JSON.stringify(Object.assign({ app: 'uraj', version: 1 }, data), null, 1)], { type: 'application/json' });
      const d = new Date();
      deliverFile(blob, `uraj-backup_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`, '裏雄J会 バックアップ');
    };
    $('restoreBtn').onclick = () => $('restoreFile').click();
    $('restoreFile').onchange = async (ev) => {
      const file = ev.target.files[0]; ev.target.value = '';
      if (!file) return;
      let obj;
      try { obj = JSON.parse(await file.text()); } catch { toast('JSONを読めませんでした'); return; }
      if (!obj || obj.app !== 'uraj' || !obj.years) { toast('裏雄J会のバックアップではありません'); return; }
      const ys = Object.keys(obj.years).sort();
      const over = ys.filter((y) => data.years[y]);
      if (!await ask(`${ys.join('・')}年のデータを復元します。${over.length ? `${over.join('・')}年は今のデータが上書きされます。` : ''}よろしいですか？`, { ok: '復元する' })) return;
      try {
        for (const y of ys) await put(['years', y], obj.years[y]);
        yearKey = ys[ys.length - 1]; toast('復元しました'); render();
      } catch { /* put がトースト表示済み */ }
    };
    const ny = $('nextYear');
    if (ny) ny.onclick = async () => {
      const next = String(Number(yearKey) + 1);
      if (data.years[next]) { toast(`${next}年度はすでにあります`); return; }
      if (!await ask(`${next}年度を作成します。メンバー・来年HC・昨年平均・生涯獲得額を引き継ぎます。`, { ok: '作成する' })) return;
      put(['years', next], C.makeNextYear(Y())).then(() => { yearKey = next; tab = 'settings'; render(); toast(`${next}年度を作成しました`); }).catch(() => {});
    };
    const rs = $('resetSeed');
    if (rs) rs.onclick = async () => {
      if (!await ask('この端末で入力した内容を消して、最新の初期データに戻します。よろしいですか？', { ok: '戻す' })) return;
      sset('localStorage', LS_LOCAL, null);
      yearKey = ''; roundId = ''; tab = 'rounds';
      await refresh(true);
      toast('初期データに戻しました');
    };
    $('emptyYear').onclick = async () => {
      const y = await ask('つくる年度（西暦4桁）', { input: true, value: String(new Date().getFullYear()), ok: '作成する' });
      if (!y || !/^\d{4}$/.test(y)) return;
      if (data.years[y]) { toast(`${y}年度はすでにあります`); return; }
      put(['years', y], { settings: {}, members: {}, rounds: {} }).then(() => { yearKey = y; render(); }).catch(() => {});
    };
  }

  // ---------- 起動 ----------
  $('tabs').onclick = (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    tab = b.dataset.tab; if (tab !== 'rounds') roundId = '';
    render(); window.scrollTo(0, 0);
  };
  $('yearSel').onchange = (ev) => { yearKey = ev.target.value; roundId = ''; render(); };
  $('adminBtn').onclick = async () => {
    if (isAdmin) {
      if (!await ask('幹事モードを終了しますか？', { ok: '終了する' })) return;
      isAdmin = false; sset('sessionStorage', SS_ADMIN, null); render(); return;
    }
    $('loginPw').value = ''; $('loginDlg').showModal();
  };
  $('loginDlg').addEventListener('close', () => {
    if ($('loginDlg').returnValue !== 'ok') return;
    if ($('loginPw').value === ADMIN_PASSWORD) { isAdmin = true; sset('sessionStorage', SS_ADMIN, '1'); toast('✏️ 幹事モードです'); render(); }
    else toast('パスワードが違います');
  });
  window.addEventListener('focus', () => refresh(false));
  setInterval(() => { if (fbUrl && document.visibilityState === 'visible') refresh(false); }, 60000);
  setSync('');
  refresh(true);
})();
