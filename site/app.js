(function () {
  'use strict';
  const D = window.VP_DATA;
  const F = window.VPForum;
  const app = document.getElementById('app');
  if (!D) { app.innerHTML = '<div class="empty">No data yet — run <code>refresh.bat</code> first.</div>'; return; }

  // ---------------------------------------------------------------- formatting
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '–');
  const ago = (iso) => { if (!iso) return ''; const d = (Date.now() - new Date(iso)) / 864e5; if (d < 1) return 'today'; if (d < 2) return '1 day ago'; if (d < 60) return Math.floor(d) + ' days ago'; if (d < 365) return Math.floor(d / 30.4) + ' mo ago'; return (d / 365).toFixed(1) + ' yrs ago'; };
  const pct = (x, d = 1) => (isNum(x) ? (x > 0 ? '+' : '') + x.toFixed(d) + '%' : '–');
  const pctCls = (x) => (isNum(x) ? (x >= 0 ? 'pos' : 'neg') : 'dim');
  const inr = (x) => (isNum(x) ? '₹' + (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('en-IN') : x.toFixed(Math.abs(x) < 10 ? 2 : 1)) : '–');
  const n1 = (x) => (isNum(x) ? x.toFixed(1) : '–');
  const k = (x) => (isNum(x) ? (x >= 1e5 ? (x / 1e5).toFixed(1) + 'L' : x >= 1000 ? (x / 1000).toFixed(1) + 'k' : String(x)) : '–');
  const RANK = { buy: 3, watch: 2, reject: 1 };
  const MBRANK = { High: 3, Medium: 2, Low: 1 };

  // ---------------------------------------------------------------- state
  const LS = 'vp_radar_v2';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { saved = {}; }
  const st = Object.assign({
    tab: 'latest',
    latest: { sort: 'created', dir: 'desc', q: '', from: '', to: '', labels: [] },
    track: { sort: 'ret', dir: 'desc', q: '', outcomes: [], minYears: 1 },
    authors: { sort: 'hits', dir: 'desc', q: '', minCalls: 1 },
    winners: { sort: 'rank', dir: 'desc', q: '' },
  }, saved.st || {});
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify({ st })); } catch (e) { /* storage unavailable */ } };

  // ---------------------------------------------------------------- data prep
  const topics = D.topics || [];
  const byId = new Map(topics.map((t) => [t.id, t]));
  const stocks = D.stocks || {};
  const latest = (D.latestIds || []).map((id) => byId.get(id)).filter(Boolean);
  const tracked = (D.trackIds || []).map((id) => byId.get(id)).filter(Boolean);
  const minAgeYears = ((D.params && D.params.minTrackAgeDays) || 365) / 365.25;
  const pxOf = (t) => (t && t.stock && stocks[t.stock] ? stocks[t.stock].px : null);

  function outcome(t) {
    const tr = t.track;
    if (!tr || !isNum(tr.ret) || tr.years < minAgeYears) return null;
    const beat = isNum(tr.niftyRet) ? tr.ret > tr.niftyRet : tr.ret > 0;
    if (tr.ret >= 100 && (tr.cagr || 0) >= 18) return 'Multibagger';
    if ((tr.cagr || 0) >= 18 && beat) return 'Spot on';
    if (beat) return 'Beat Nifty';
    if (tr.ret >= 0) return 'Lagged Nifty';
    return 'Loss';
  }
  const outBadge = (o) => (o ? `<span class="badge b-out-${o.split(' ')[0]}">${o}</span>` : '<span class="dim">–</span>');

  // author track records (threads they started, ≥ 1 yr old, priced)
  const authorStats = new Map();
  for (const t of tracked.concat(latest)) {
    if (!t.author) continue;
    const o = outcome(t);
    if (!o) continue;
    const a = authorStats.get(t.author) || { username: t.author, name: t.authorName, calls: [], seen: new Set() };
    if (a.seen.has(t.id)) continue;
    a.seen.add(t.id); a.calls.push({ t, o });
    authorStats.set(t.author, a);
  }
  for (const a of authorStats.values()) {
    a.judged = a.calls.length;
    a.hits = a.calls.filter((c) => c.o === 'Multibagger' || c.o === 'Spot on').length;
    a.mb = a.calls.filter((c) => c.o === 'Multibagger').length;
    a.beat = a.calls.filter((c) => c.o !== 'Lagged Nifty' && c.o !== 'Loss').length;
    a.hitRate = a.hits / a.judged;
    const cg = a.calls.map((c) => c.t.track.cagr).filter(isNum).sort((x, y) => x - y);
    a.medCagr = cg.length ? cg[cg.length >> 1] : null;
    a.best = a.calls.slice().sort((x, y) => y.t.track.ret - x.t.track.ret)[0];
  }
  const postsBy = new Map();
  for (const t of topics) { if (!t.author) continue; if (!postsBy.has(t.author)) postsBy.set(t.author, []); postsBy.get(t.author).push(t); }
  for (const arr of postsBy.values()) arr.sort((x, y) => (x.created < y.created ? 1 : -1));
  const authorBadge = (u) => { const a = authorStats.get(u); return a ? `<span class="auth-badge" title="Past calls by ${esc(u)}: ${a.hits} spot-on/multibagger of ${a.judged} judged">${a.hits}/${a.judged} hits</span>` : ''; };

  const sigCache = new Map();
  const sigOf = (t) => { if (!t.body && !(t.comments || []).length) return null; if (!sigCache.has(t.id)) sigCache.set(t.id, F.signal(t, authorStats.get(t.author), pxOf(t))); return sigCache.get(t.id); };
  const sumCache = new Map();
  const summaryOf = (t) => { if (!sumCache.has(t.id)) sumCache.set(t.id, F.summarize(t.body)); return sumCache.get(t.id); };
  const sigBadge = (s) => (s ? `<span class="badge b-${s.cls}">${esc(s.label)}</span>` : '<span class="badge b-none">Not fetched</span>');
  const mbCell = (s) => (s ? `<span class="badge b-mb mb-${s.mbLevel}">${s.mbLevel}</span> <span class="dim">${s.mbScore}</span>` : '–');
  const moodCell = (s) => { const m = s && (s.recent || null); return m ? `<span class="mood-${m.label}">${m.label}</span>` : '<span class="dim">No replies</span>'; };

  // ---------------------------------------------------------------- header stats
  document.getElementById('stats').innerHTML = [
    [topics.length.toLocaleString('en-IN'), 'threads in category'],
    [latest.length, 'latest analysed'],
    [topics.filter((t) => outcome(t)).length, 'older calls judged'],
    [[...authorStats.values()].length, 'authors with a record'],
    [new Date(D.generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), 'data as of'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');

  // ---------------------------------------------------------------- generic sortable table
  function cmp(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    return a - b;
  }
  function table(el, cols, rows, s, onRow, after) {
    const col = cols.find((c) => c.key === s.sort) || cols[0];
    const withVal = rows.filter((r) => col.val(r) != null && !(typeof col.val(r) === 'number' && !isFinite(col.val(r))));
    const noVal = rows.filter((r) => !withVal.includes(r));
    withVal.sort((a, b) => (s.dir === 'asc' ? 1 : -1) * cmp(col.val(a), col.val(b)));
    const sorted = withVal.concat(noVal);   // blanks always last
    el.innerHTML = `<div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th class="${c.cls || ''} ${c.val ? 'sortable' : ''} ${c.key === s.sort ? 'sorted ' + s.dir : ''}" data-k="${c.key}" ${c.val ? 'tabindex="0"' : ''} title="${esc(c.tip || 'Click to sort')}">${c.label}</th>`).join('')}</tr></thead><tbody>${
      sorted.length ? sorted.map((r, i) => `<tr data-i="${i}" tabindex="0">${cols.map((c) => `<td class="${c.cls || ''}">${c.html(r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty">Nothing matches these filters.</td></tr>`
    }</tbody></table></div>`;
    el.querySelectorAll('th.sortable').forEach((th) => {
      const go = () => {
        const key = th.dataset.k;
        if (s.sort === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
        else { s.sort = key; s.dir = cols.find((c) => c.key === key).dir || 'desc'; }
        persist(); table(el, cols, rows, s, onRow, after);
      };
      th.onclick = go; th.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
    if (onRow) el.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
      const r = sorted[+tr.dataset.i];
      tr.onclick = (e) => { if (!e.target.closest('a')) onRow(r); };
      tr.onkeydown = (e) => { if (e.key === 'Enter') onRow(r); };
    });
    if (after) after(s);
  }
  function chips(container, options, selected, onChange) {
    container.innerHTML = options.map(([v, l]) => `<button class="chip ${selected.includes(v) ? 'on' : ''}" data-v="${esc(v)}">${l}</button>`).join('');
    container.querySelectorAll('.chip').forEach((b) => b.onclick = () => {
      const v = b.dataset.v, i = selected.indexOf(v);
      if (i >= 0) selected.splice(i, 1); else selected.push(v);
      b.classList.toggle('on'); onChange();
    });
  }
  const matchQ = (q, ...fields) => !q || fields.some((f) => (f || '').toLowerCase().includes(q.toLowerCase()));

  // ---------------------------------------------------------------- shared columns
  const colPosted = { key: 'created', label: 'Posted', val: (r) => r.t.created, html: (r) => `<div class="nowrap">${fmtDate(r.t.created)}</div><div class="t-meta">${ago(r.t.created)}</div>` };
  const colTopic = { key: 'title', label: 'Thread', dir: 'asc', val: (r) => r.t.title.toLowerCase(), html: (r) => `<div class="t-title">${esc(r.t.title)}</div><div class="t-meta">by <b>${esc(r.t.authorName || r.t.author || '?')}</b>${authorBadge(r.t.author)}${pxOf(r.t) ? ` · <span class="dim">${esc(pxOf(r.t).sym)}</span>` : ''}</div>` };
  const colSignal = { key: 'signal', label: 'Forum verdict', tip: 'Buy-side / Watch / Sell-side — from the post, latest comments, multibagger talk and author record', val: (r) => (r.s ? RANK[r.s.cls] * 1000 + r.s.score : null), html: (r) => sigBadge(r.s) + (r.s ? ` <span class="dim">${r.s.score}</span>` : '') };
  const colMB = { key: 'mb', label: 'Multibagger potential', tip: 'Forum-based: multibagger language in post + comments, engagement, author record, current mood', val: (r) => (r.s ? r.s.mbScore : null), html: (r) => mbCell(r.s) };
  const colMood = { key: 'mood', label: 'Latest comments', val: (r) => (r.s && r.s.recent ? r.s.recent.score : null), html: (r) => moodCell(r.s) };

  // ================================================================= TAB: latest
  function renderLatest() {
    const s = st.latest;
    app.innerHTML = `
      <p class="intro">Newest threads in <a href="${D.category.url}" target="_blank" rel="noopener">Stock Opportunities</a>, sortable by <b>post date</b> (the forum itself only sorts by activity). The verdict is built only from ValuePickr: the original post's case, how the latest comments read, multibagger talk in the thread, likes/views, and the author's past hit rate. Click a row for the summary and comments.</p>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search thread, author, ticker…" value="${esc(s.q)}">
        <label>Sort <select id="sortSel">
          <option value="created">Post date</option><option value="last">Last activity</option><option value="signal">Forum verdict</option>
          <option value="mb">Multibagger potential</option><option value="likes">Likes</option><option value="posts">Replies</option>
          <option value="views">Views</option><option value="since">Price since post</option><option value="mood">Latest comments mood</option></select></label>
        <button class="btn" id="dirBtn"></button>
        <label>From <input type="date" id="from" value="${s.from}"></label>
        <label>To <input type="date" id="to" value="${s.to}"></label>
        <div class="chips" id="lchips"></div>
        <span class="spacer"></span><span class="count" id="cnt"></span>
      </div>
      <div id="tbl"></div>`;
    const rows = latest.map((t) => ({ t, s: sigOf(t) }));
    const cols = [
      colPosted, colTopic, colSignal, colMB, colMood,
      { key: 'since', label: 'Price since post', cls: 'num', val: (r) => r.t.track && r.t.track.ret, html: (r) => (r.t.track ? `<span class="${pctCls(r.t.track.ret)}">${pct(r.t.track.ret)}</span>` : '<span class="dim">–</span>') },
      { key: 'last', label: 'Last activity', val: (r) => r.t.last, html: (r) => `<span class="nowrap dim">${ago(r.t.last)}</span>` },
      { key: 'posts', label: 'Replies', cls: 'num', val: (r) => r.t.posts, html: (r) => r.t.posts - 1 },
      { key: 'likes', label: 'Likes', cls: 'num', val: (r) => r.t.likes, html: (r) => r.t.likes },
      { key: 'views', label: 'Views', cls: 'num', val: (r) => r.t.views, html: (r) => k(r.t.views) },
    ];
    const draw = () => {
      const f = rows.filter((r) => matchQ(s.q, r.t.title, r.t.author, r.t.authorName, r.t.stock)
        && (!s.from || r.t.created >= s.from) && (!s.to || r.t.created.slice(0, 10) <= s.to)
        && (!s.labels.length || s.labels.includes(r.s ? r.s.cls : 'none')));
      document.getElementById('cnt').textContent = `${f.length} of ${rows.length} threads`;
      table(document.getElementById('tbl'), cols, f, s, (r) => openTopic(r.t), () => {
        document.getElementById('sortSel').value = s.sort;
        document.getElementById('dirBtn').textContent = s.dir === 'asc' ? '↑ Oldest / lowest first' : '↓ Newest / highest first';
      });
    };
    document.getElementById('q').oninput = (e) => { s.q = e.target.value; persist(); draw(); };
    document.getElementById('sortSel').onchange = (e) => { s.sort = e.target.value; s.dir = 'desc'; persist(); draw(); };
    document.getElementById('dirBtn').onclick = () => { s.dir = s.dir === 'asc' ? 'desc' : 'asc'; persist(); draw(); };
    document.getElementById('from').onchange = (e) => { s.from = e.target.value; persist(); draw(); };
    document.getElementById('to').onchange = (e) => { s.to = e.target.value; persist(); draw(); };
    chips(document.getElementById('lchips'), [['buy', 'Buy-side'], ['watch', 'Watch'], ['reject', 'Sell-side']], s.labels, () => { persist(); draw(); });
    draw();
  }

  // ================================================================= TAB: track record
  const trackRows = () => tracked.map((t) => ({ t, o: outcome(t), s: sigOf(t), px: pxOf(t) })).filter((r) => r.o);
  function renderTrack() {
    const s = st.track;
    const all = trackRows();
    const med = (a) => { a = a.filter(isNum).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
    app.innerHTML = `
      <p class="intro">Older Stock Opportunities threads (≥ ${Math.round(minAgeYears * 12)} months old): the price on the day the thread was started vs today, against the Nifty 50 over the same window. <b>Spot on</b> = CAGR ≥ 18% <i>and</i> beat Nifty; <b>Multibagger</b> = also ≥ 2×. Returns are dividend/split-adjusted.</p>
      <div class="summary-stats" id="sstats"></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search thread / author…" value="${esc(s.q)}">
        <label>Min age <select id="my"><option value="1">1 yr</option><option value="2">2 yrs</option><option value="3">3 yrs</option><option value="5">5 yrs</option></select></label>
        <div class="chips" id="ochips"></div>
        <span class="spacer"></span><span class="count" id="cnt"></span>
      </div>
      <div id="tbl"></div>`;
    document.getElementById('my').value = String(s.minYears);
    const cols = [
      colPosted, colTopic,
      { key: 'p0', label: 'Price then', cls: 'num', val: (r) => r.t.track.priceAtPost, html: (r) => inr(r.t.track.priceAtPost) + (r.t.track.listedLater ? ' <span class="dim" title="Listed after the thread started — priced from listing">*</span>' : '') },
      { key: 'p1', label: 'Now', cls: 'num', val: (r) => r.px && r.px.price, html: (r) => inr(r.px && r.px.price) },
      { key: 'ret', label: 'Return', cls: 'num', val: (r) => r.t.track.ret, html: (r) => `<span class="${pctCls(r.t.track.ret)}">${pct(r.t.track.ret, 0)}</span>` },
      { key: 'cagr', label: 'CAGR', cls: 'num', val: (r) => r.t.track.cagr, html: (r) => `<span class="${pctCls(r.t.track.cagr)}">${pct(r.t.track.cagr)}</span>` },
      { key: 'nifty', label: 'Nifty same period', cls: 'num', val: (r) => r.t.track.niftyRet, html: (r) => `<span class="dim">${pct(r.t.track.niftyRet, 0)}</span>` },
      { key: 'out', label: 'Outcome', val: (r) => ({ Multibagger: 5, 'Spot on': 4, 'Beat Nifty': 3, 'Lagged Nifty': 2, Loss: 1 }[r.o]), html: (r) => outBadge(r.o) },
      Object.assign({}, colSignal, { label: 'Forum says now' }),
      colMood,
    ];
    const draw = () => {
      const f = all.filter((r) => r.t.track.years >= s.minYears && matchQ(s.q, r.t.title, r.t.author, r.t.authorName, r.t.stock) && (!s.outcomes.length || s.outcomes.includes(r.o)));
      const hits = f.filter((r) => r.o === 'Multibagger' || r.o === 'Spot on').length;
      document.getElementById('sstats').innerHTML = [
        [f.length, 'calls judged'], [f.length ? Math.round((hits / f.length) * 100) + '%' : '–', 'spot-on or multibagger'],
        [f.filter((r) => r.o === 'Multibagger').length, 'multibaggers'],
        [f.length ? Math.round((f.filter((r) => !['Lagged Nifty', 'Loss'].includes(r.o)).length / f.length) * 100) + '%' : '–', 'beat Nifty'],
        [pct(med(f.map((r) => r.t.track.cagr))), 'median CAGR'],
      ].map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join('');
      document.getElementById('cnt').textContent = `${f.length} calls`;
      table(document.getElementById('tbl'), cols, f, s, (r) => openTopic(r.t));
    };
    document.getElementById('q').oninput = (e) => { s.q = e.target.value; persist(); draw(); };
    document.getElementById('my').onchange = (e) => { s.minYears = +e.target.value; persist(); draw(); };
    chips(document.getElementById('ochips'), ['Multibagger', 'Spot on', 'Beat Nifty', 'Lagged Nifty', 'Loss'].map((x) => [x, x]), s.outcomes, () => { persist(); draw(); });
    draw();
  }

  // ================================================================= TAB: authors
  function renderAuthors() {
    const s = st.authors;
    app.innerHTML = `
      <p class="intro">Who has been right before? Each author's judged calls (threads they <i>started</i>, ≥ 1 yr old, priced vs Nifty). Click an author for every call and their <b>latest threads</b>, so you can follow the people with a record.</p>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search author…" value="${esc(s.q)}">
        <label>Min judged calls <select id="mc"><option>1</option><option>2</option><option>3</option><option>5</option></select></label>
        <span class="spacer"></span><span class="count" id="cnt"></span>
      </div><div id="tbl"></div>`;
    document.getElementById('mc').value = String(s.minCalls);
    const rows = [...authorStats.values()].map((a) => ({ a, latestPost: (postsBy.get(a.username) || [])[0] }));
    const cols = [
      { key: 'name', label: 'Author', dir: 'asc', val: (r) => (r.a.name || r.a.username).toLowerCase(), html: (r) => `<div class="t-title">${esc(r.a.name || r.a.username)}</div><div class="t-meta">@${esc(r.a.username)}</div>` },
      { key: 'judged', label: 'Calls judged', cls: 'num', val: (r) => r.a.judged, html: (r) => r.a.judged },
      { key: 'hits', label: 'Spot-on hits', cls: 'num', val: (r) => r.a.hits * 100 + r.a.hitRate, html: (r) => `${r.a.hits} <span class="dim">(${Math.round(r.a.hitRate * 100)}%)</span>` },
      { key: 'mb', label: 'Multibaggers', cls: 'num', val: (r) => r.a.mb, html: (r) => r.a.mb },
      { key: 'beat', label: 'Beat Nifty', cls: 'num', val: (r) => r.a.beat / r.a.judged, html: (r) => `${r.a.beat}/${r.a.judged}` },
      { key: 'med', label: 'Median CAGR', cls: 'num', val: (r) => r.a.medCagr, html: (r) => `<span class="${pctCls(r.a.medCagr)}">${pct(r.a.medCagr)}</span>` },
      { key: 'best', label: 'Best call', val: (r) => r.a.best && r.a.best.t.track.ret, html: (r) => (r.a.best ? `${esc(r.a.best.t.title.split(/\s[-–—:]\s|\(|:/)[0])} <span class="pos">${pct(r.a.best.t.track.ret, 0)}</span>` : '–') },
      { key: 'latest', label: 'Latest thread started', val: (r) => (r.latestPost ? r.latestPost.created : null), html: (r) => (r.latestPost ? `<div class="nowrap">${fmtDate(r.latestPost.created)}</div><div class="t-meta">${esc(r.latestPost.title.slice(0, 60))}</div>` : '–') },
    ];
    const draw = () => {
      const f = rows.filter((r) => r.a.judged >= s.minCalls && matchQ(s.q, r.a.username, r.a.name));
      document.getElementById('cnt').textContent = `${f.length} authors`;
      table(document.getElementById('tbl'), cols, f, s, (r) => openAuthor(r.a.username));
    };
    document.getElementById('q').oninput = (e) => { s.q = e.target.value; persist(); draw(); };
    document.getElementById('mc').onchange = (e) => { s.minCalls = +e.target.value; persist(); draw(); };
    draw();
  }

  // ================================================================= TAB: winners
  function renderWinners() {
    const s = st.winners;
    const rows = trackRows().filter((r) => (r.o === 'Multibagger' || r.o === 'Spot on') && r.s && r.px);
    app.innerHTML = `
      <p class="intro">Calls that <b>already worked</b> (spot-on or multibagger). What is the thread saying <i>now</i>, and where is the price relative to its highs? That gives a forum-based read for <b>new money</b> and for <b>holders</b>. It's a pointer for your own research, not advice.</p>
      <div class="toolbar"><input type="search" id="q" placeholder="Search…" value="${esc(s.q)}"><span class="spacer"></span><span class="count" id="cnt"></span></div>
      <div id="tbl"></div>`;
    const PR = { buy: 4, watch: 3, expensive: 2, reject: 1, hold: 2 };
    const cols = [
      { key: 'rank', label: 'For new money', val: (r) => PR[r.s.posCls] * 1000 + r.s.score, html: (r) => `<span class="badge b-${r.s.posCls}">${esc(r.s.position)}</span>` },
      colTopic,
      { key: 'ret', label: 'Since post', cls: 'num', val: (r) => r.t.track.ret, html: (r) => `<span class="pos">${pct(r.t.track.ret, 0)}</span><div class="t-meta">${n1(r.t.track.years)} yrs · ${pct(r.t.track.cagr)} CAGR</div>` },
      Object.assign({}, colSignal, { label: 'Forum says now' }),
      colMood,
      { key: 'hold', label: 'If you hold it', val: (r) => r.s.holder, html: (r) => `<span class="dim">${esc(r.s.holder)}</span>` },
      { key: 'price', label: 'Price', cls: 'num', val: (r) => r.px.price, html: (r) => inr(r.px.price) },
      { key: 'off52', label: 'vs 52-wk high', cls: 'num', val: (r) => r.s.off52, html: (r) => `<span class="${isNum(r.s.off52) && r.s.off52 <= -25 ? 'pos' : 'dim'}">${pct(r.s.off52, 0)}</span>` },
      { key: '5d', label: '5-day', cls: 'num', val: (r) => r.s.chg5d, html: (r) => `<span class="${isNum(r.s.chg5d) && r.s.chg5d > 15 ? 'neg' : 'dim'}">${pct(r.s.chg5d)}</span>` },
      { key: 'last', label: 'Last comment', val: (r) => r.t.last, html: (r) => `<span class="nowrap dim">${ago(r.t.last)}</span>` },
    ];
    const draw = () => {
      const f = rows.filter((r) => matchQ(s.q, r.t.title, r.t.author, r.t.stock));
      document.getElementById('cnt').textContent = `${f.length} winning calls`;
      table(document.getElementById('tbl'), cols, f, s, (r) => openTopic(r.t));
    };
    document.getElementById('q').oninput = (e) => { s.q = e.target.value; persist(); draw(); };
    draw();
  }

  // ================================================================= drawer
  const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim'), body = document.getElementById('drawerBody');
  let lastFocus = null;
  function openDrawer(html) {
    lastFocus = document.activeElement;
    body.innerHTML = html; drawer.scrollTop = 0;
    scrim.hidden = false; requestAnimationFrame(() => { scrim.classList.add('show'); drawer.classList.add('open'); });
    drawer.setAttribute('aria-hidden', 'false'); drawer.focus();
    body.querySelectorAll('[data-author]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openAuthor(a.dataset.author); }));
    body.querySelectorAll('[data-topic]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openTopic(byId.get(+a.dataset.topic)); }));
  }
  function closeDrawer() {
    scrim.classList.remove('show'); drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    setTimeout(() => (scrim.hidden = true), 250); if (lastFocus) lastFocus.focus();
  }
  scrim.onclick = closeDrawer; document.getElementById('drawerClose').onclick = closeDrawer;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer(); });
  const bar = (label, v, max) => `<div><div class="kv" style="border:0"><span>${label}</span><span>${n1(v)} / ${max}</span></div><div class="bar"><i style="width:${Math.max(2, Math.min(100, ((v || 0) / max) * 100))}%"></i></div></div>`;
  const list = (arr, empty) => `<ul class="clean">${arr.map((p) => `<li>${esc(p)}</li>`).join('') || `<li class="dim">${empty || '–'}</li>`}</ul>`;

  function openTopic(t) {
    if (!t) return;
    const s = sigOf(t), px = pxOf(t), sum = summaryOf(t), o = outcome(t), a = authorStats.get(t.author);
    const others = (postsBy.get(t.author) || []).filter((x) => x.id !== t.id).slice(0, 8);
    const recentMood = s && s.recent;
    openDrawer(`
      <h2 class="d-title">${esc(t.title)}</h2>
      <div class="d-meta"><span>Posted <b>${fmtDate(t.created)}</b> (${ago(t.created)})</span>
        <span>by <a href="#" data-author="${esc(t.author)}">${esc(t.authorName || t.author)}</a>${authorBadge(t.author)}</span>
        <span>${t.posts - 1} replies · ${t.likes} likes · ${k(t.views)} views · last activity ${ago(t.last)}</span>
        <a href="${esc(t.url)}" target="_blank" rel="noopener">Open thread on ValuePickr ↗</a></div>

      ${s ? `<div class="verdict"><span class="badge b-${s.cls}">${esc(s.label)}</span>
          <div><div class="label-s">Forum score</div><div class="big">${s.score}</div></div>
          <div><div class="label-s">Multibagger potential</div><div class="big">${s.mbLevel}</div></div>
          <div><div class="label-s">Latest comments</div><div class="big mood-${recentMood ? recentMood.label : 'Quiet'}" style="font-size:22px">${recentMood ? recentMood.label : 'No replies'}</div></div></div>
        ${s.position ? `<div class="note">Price position: <b>${esc(s.position)}</b>${t.track && o ? ` · If you hold: ${esc(s.holder)}` : ''}</div>` : ''}
        <div class="grid g4" style="margin-top:12px">
          <div class="card">${bar('Multibagger talk', s.buzz.parts.lang, 40)}</div>
          <div class="card">${bar('Engagement', s.buzz.parts.engagement, 25)}</div>
          <div class="card">${bar('Author record', s.buzz.parts.record, 20)}</div>
          <div class="card">${bar('Comment mood', s.recent ? ((s.recent.score + 1) / 2) * 15 : ((s.op.score * 0.5 + 1) / 2) * 15, 15)}</div>
        </div>
        <div class="grid g2" style="margin-top:12px">
          <div class="card"><div class="label-s">Multibagger themes in the thread</div>${s.buzz.themes.length ? `<ul class="clean">${s.buzz.themes.map(([n, c]) => `<li>${esc(n)} <span class="dim">×${c}</span></li>`).join('')}</ul>` : '<p class="dim">None detected</p>'}</div>
          <div class="card"><div class="label-s">Tone</div>
            <p style="margin:4px 0">Original post: <span class="mood-${s.op.label}">${s.op.label}</span>${s.op.bullWords.length ? ` <span class="dim">(${esc(s.op.bullWords.slice(0, 4).join(', '))})</span>` : ''}</p>
            <p style="margin:4px 0">Latest comments: ${s.recent ? `<span class="mood-${s.recent.label}">${s.recent.label}</span>` : '<span class="dim">no replies</span>'}</p>
            ${s.recent && (s.recent.bullWords.length || s.recent.bearWords.length) ? `<p class="dim" style="font-size:12px;margin:4px 0">Bullish words: ${esc(s.recent.bullWords.join(', ') || '–')}<br>Bearish words: ${esc(s.recent.bearWords.join(', ') || '–')}</p>` : ''}</div>
        </div>` : '<div class="note" style="margin-top:16px">This thread\'s posts weren\'t fetched (it is outside the latest / tracked set). Open it on ValuePickr, or raise -Latest / -TrackTopics in the scraper.</div>'}

      ${t.track ? `<div class="grid g4" style="margin-top:16px">
        <div class="card"><div class="label-s">Price when posted</div><div class="big">${inr(t.track.priceAtPost)}</div></div>
        <div class="card"><div class="label-s">Price now</div><div class="big">${inr(px && px.price)}</div><div class="t-meta">52-wk ${inr(px && px.low52)} – ${inr(px && px.high52)}</div></div>
        <div class="card"><div class="label-s">Return since post</div><div class="big ${pctCls(t.track.ret)}">${pct(t.track.ret, 0)}</div><div class="t-meta">Nifty ${pct(t.track.niftyRet, 0)} · ${n1(t.track.years)} yrs</div></div>
        <div class="card"><div class="label-s">Outcome</div><div style="margin-top:6px">${o ? outBadge(o) : '<span class="dim">Too recent to judge</span>'}</div>${isNum(t.track.cagr) ? `<div class="t-meta">${pct(t.track.cagr)} CAGR</div>` : ''}</div></div>` : ''}

      ${t.body ? `
        <h3>What the post says (summary)</h3>
        <div class="grid g2">
          <div class="card"><div class="label-s">Key points</div>${list(sum.points)}</div>
          <div class="card"><div class="label-s">Numbers quoted</div>${list(sum.numbers)}</div>
          ${sum.triggers.length ? `<div class="card"><div class="label-s">Triggers / outlook</div>${list(sum.triggers)}</div>` : ''}
          <div class="card"><div class="label-s">Risks mentioned</div>${list(sum.risks, 'None called out')}</div>
        </div>
        <details><summary>Read the full original post</summary><div class="fulltext">${esc(t.body)}</div></details>` : ''}

      ${t.comments ? `<h3>Latest comments</h3>
        ${t.comments.length ? t.comments.map((c) => `<div class="comment"><div class="who"><b>${esc(c.name || c.user)}</b>${authorBadge(c.user)} · ${fmtDate(c.date)} (${ago(c.date)}) · ♥ ${c.likes} · <a href="${esc(t.url)}/${c.n}" target="_blank" rel="noopener">#${c.n}</a></div><p>${esc(c.text)}</p></div>`).join('') : '<p class="dim">No replies yet.</p>'}` : ''}

      <h3>More from ${esc(t.authorName || t.author)}</h3>
      ${a ? `<p class="dim">Track record: ${a.hits} spot-on of ${a.judged} judged calls · ${a.mb} multibagger(s) · median CAGR ${pct(a.medCagr)} · <a href="#" data-author="${esc(t.author)}">see all</a></p>` : '<p class="dim">No judged calls yet for this author.</p>'}
      <ul class="clean">${others.map((x) => `<li><a href="#" data-topic="${x.id}">${esc(x.title)}</a> <span class="dim">· ${fmtDate(x.created)}</span>${outcome(x) ? ' ' + outBadge(outcome(x)) : ''}</li>`).join('') || '<li class="dim">No other threads started in this category.</li>'}</ul>`);
  }

  function openAuthor(u) {
    const a = authorStats.get(u);
    const posts = postsBy.get(u) || [];
    const name = (posts[0] && posts[0].authorName) || u;
    openDrawer(`
      <h2 class="d-title">${esc(name)}</h2>
      <div class="d-meta"><span>@${esc(u)}</span><span>${posts.length} threads started in Stock Opportunities</span><a href="https://forum.valuepickr.com/u/${encodeURIComponent(u)}/activity/topics" target="_blank" rel="noopener">ValuePickr profile ↗</a></div>
      ${a ? `<div class="summary-stats" style="margin-top:16px">${[[a.judged, 'calls judged'], [`${a.hits} (${Math.round(a.hitRate * 100)}%)`, 'spot-on hits'], [a.mb, 'multibaggers'], [`${a.beat}/${a.judged}`, 'beat Nifty'], [pct(a.medCagr), 'median CAGR']].map(([b, l]) => `<div class="stat"><b>${b}</b><span>${l}</span></div>`).join('')}</div>`
        : '<p class="dim" style="margin-top:16px">No judged calls yet (threads must be ≥ 1 yr old and in the tracked set; raise -PerAuthor / -TrackTopics in the scraper).</p>'}
      <h3>Latest threads (newest first)</h3>
      <ul class="clean">${posts.slice(0, 15).map((t) => { const s = sigOf(t); return `<li><a href="#" data-topic="${t.id}">${esc(t.title)}</a> <span class="dim">· ${fmtDate(t.created)} (${ago(t.created)})</span> ${s ? sigBadge(s) : ''}</li>`; }).join('')}</ul>
      ${a ? `<h3>Judged calls (best first)</h3><ul class="clean">${a.calls.slice().sort((x, y) => y.t.track.ret - x.t.track.ret).map((c) => `<li><a href="#" data-topic="${c.t.id}">${esc(c.t.title)}</a> <span class="dim">· ${fmtDate(c.t.created)}</span> · <span class="${pctCls(c.t.track.ret)}">${pct(c.t.track.ret, 0)}</span> <span class="dim">(Nifty ${pct(c.t.track.niftyRet, 0)})</span> ${outBadge(c.o)}</li>`).join('')}</ul>` : ''}`);
  }

  // ================================================================= router
  const TABS = { latest: renderLatest, track: renderTrack, authors: renderAuthors, winners: renderWinners };
  function go(tab) {
    if (!TABS[tab]) tab = 'latest';
    st.tab = tab; persist();
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
    TABS[tab]();
  }
  document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  function route() {
    const h = location.hash.slice(1);
    const m = h.match(/^topic-(\d+)$/);
    if (m) { if (!app.innerHTML) go(st.tab); openTopic(byId.get(+m[1])); return; }
    go(h || st.tab);
  }
  window.addEventListener('hashchange', route);
  route();
})();
