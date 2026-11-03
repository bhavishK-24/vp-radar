/* ==========================================================================
   Forum signals — everything here is derived from ValuePickr content only:
   the original post, the latest comments, likes/views, and the author's
   past record in this category. Prices are used only for "where is it now".
   ========================================================================== */
(function (global) {
  'use strict';
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  const r1 = (x) => (isNum(x) ? Math.round(x * 10) / 10 : null);

  // ------------------------------------------------------------------ mood (bullish vs bearish language)
  const BULL = /\b(bullish|accumulat\w*|added|adding|buy(ing)?|strong|robust|good (results|numbers|quarter)|order (book|inflow)|undervalued|cheap|multibagger|outperform\w*|beat|re-?rating|tailwind|margin expansion|record|healthy|upgrade|guidance (raised|increase)|capacity expansion|compound\w*|promising|excellent|impressive|positive)\b/gi;
  const BEAR = /\b(bearish|sold|exit(ed)?|sell(ing)?|weak|disappoint\w*|miss(ed)?|concern\w*|red flag|overvalued|expensive|pledge\w*|fraud|declin\w*|slowdown|dilution|caution|avoid|governance|downgrade\w*|loss(es)?|degrowth|de-?rating|delay\w*|problem|worr\w*|stretched|negative|poor|scam|manipulat\w*)\b/gi;
  function mood(texts) {
    let bull = 0, bear = 0;
    const hb = {}, hs = {};
    for (const { text, weight } of texts) {
      const w = weight || 1;
      for (const x of (text || '').match(BULL) || []) { bull += w; hb[x.toLowerCase()] = (hb[x.toLowerCase()] || 0) + 1; }
      for (const x of (text || '').match(BEAR) || []) { bear += w; hs[x.toLowerCase()] = (hs[x.toLowerCase()] || 0) + 1; }
    }
    const tot = bull + bear;
    const score = tot ? (bull - bear) / tot : 0;
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    return { score: Math.round(score * 100) / 100, label: tot < 3 ? 'Quiet' : score > 0.25 ? 'Bullish' : score < -0.15 ? 'Bearish' : 'Mixed', bullWords: top(hb), bearWords: top(hs) };
  }

  // ------------------------------------------------------------------ multibagger talk in the thread
  const MB = [
    ['Multibagger talk', /multi-?bagger/gi],
    ['“N-x” / bagger targets', /\b\d{1,2}\s?x\b|\b\d{1,2}[- ]?bagger/gi],
    ['Re-rating', /re-?rat(ing|ed|e)\b/gi],
    ['Operating leverage', /operating leverage/gi],
    ['Capacity expansion / capex', /capacity (expansion|addition)|new plant|greenfield|brownfield|capex/gi],
    ['Order book / inflows', /order ?book|order inflow/gi],
    ['Leader / monopoly / niche', /market leader|monopoly|duopoly|dominant|niche|only listed|largest/gi],
    ['Small-cap with runway', /small ?cap|micro ?cap|runway|scalab/gi],
    ['Margin expansion', /margin expansion|margins? (to |will )?(improve|expand)/gi],
    ['Policy tailwind', /tailwind|china\s*\+\s*1|\bpli\b|government (push|support)|policy support|make in india|atmanirbhar/gi],
    ['Turnaround', /turn-?around/gi],
    ['Promoter buying', /promoter(s)? (buying|bought|increas)|creeping acquisition|preferential (issue )?to promoter/gi],
  ];
  function buzz(t, author) {
    const text = [t.body || '', ...(t.comments || []).map((c) => c.text)].join('\n');
    const themes = MB.map(([n, re]) => [n, (text.match(re) || []).length]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
    const mentions = themes.reduce((s, [, c]) => s + c, 0);
    const lang = Math.min(40, themes.length * 5 + Math.min(10, mentions / 2));
    const engagement = Math.min(25, Math.log10(1 + (t.likes || 0)) * 8 + Math.log10(1 + (t.views || 0)) * 2);
    let record = 6;   // unknown author: small neutral credit
    if (author && author.judged) record = 20 * author.hitRate * (Math.min(author.judged, 3) / 3) + (author.mb ? 3 : 0);
    record = Math.min(20, record);
    const parts = { lang: r1(lang), engagement: r1(engagement), record: r1(record) };
    return { themes, mentions, parts, raw: lang + engagement + record };   // max 85, mood adds 15 in signal()
  }

  // ------------------------------------------------------------------ overall forum signal
  function signal(t, author, px) {
    const op = mood([{ text: t.body || '' }]);
    // research write-ups always discuss risks; only call the original post bearish when it clearly is
    if (op.label === 'Bearish' && op.score > -0.4) op.label = 'Balanced';
    const cm = t.comments || [];
    const recent = cm.length ? mood(cm.map((c) => ({ text: c.text, weight: 1 + Math.log1p(c.likes || 0) }))) : null;
    const b = buzz(t, author);
    const recentScore = recent && recent.label !== 'Quiet' ? recent.score : op.score * 0.5;
    const moodPts = ((recentScore + 1) / 2) * 15;
    const mbScore = Math.round(b.raw + moodPts);
    const mbLevel = mbScore >= 60 ? 'High' : mbScore >= 42 ? 'Medium' : 'Low';

    // forum verdict: multibagger case (45%) + what people are saying now (35%) + OP conviction (20%)
    const score = Math.round(0.45 * mbScore + 0.35 * ((recentScore + 1) * 50) + 0.2 * ((op.score + 1) * 50));
    let label, cls;
    if (recent && recent.label === 'Bearish') { label = 'Sell-side · forum turned cautious'; cls = 'reject'; }
    else if (score >= 62) { label = 'Buy-side · forum bullish'; cls = 'buy'; }
    else if (score >= 46) { label = 'Watch · mixed views'; cls = 'watch'; }
    else { label = 'Sell-side · weak conviction'; cls = 'reject'; }

    // where the price is now (only meaningful with a ticker)
    let position = null, holder = null, posCls = 'hold';
    if (px && isNum(px.price)) {
      const off52 = isNum(px.high52) && px.high52 > 0 ? (px.price / px.high52 - 1) * 100 : null;
      const offAth = isNum(px.ath) && px.ath > 0 ? (px.price / px.ath - 1) * 100 : null;
      const chg = px.chg5d;
      if (cls === 'reject') { position = 'Avoid for now — forum is not backing it'; posCls = 'reject'; }
      else if (isNum(chg) && chg > 15) { position = `Wait — up ${r1(chg)}% in 5 sessions, don't chase`; posCls = 'expensive'; }
      else if (isNum(off52) && off52 <= -25) { position = `Accumulate zone — ${Math.round(-off52)}% below 52-wk high while forum still ${cls === 'buy' ? 'bullish' : 'interested'}`; posCls = 'buy'; }
      else if (isNum(off52) && off52 >= -5) { position = 'At / near highs — buy only on dips'; posCls = 'expensive'; }
      else { position = 'Middle of range — stagger buys if you like the thesis'; posCls = 'watch'; }
      if (cls === 'reject') holder = 'Review / consider booking — comments turned cautious';
      else if (isNum(offAth) && offAth >= -5 && t.track && t.track.ret >= 100) holder = 'Hold — at highs after a big run; trimming is an option';
      else if (cls === 'buy') holder = 'Hold — forum still bullish';
      else holder = 'Hold — keep watching the thread';
      return { score, label, cls, op, recent, buzz: b, mbScore, mbLevel, position, posCls, holder, off52: r1(off52), offAth: r1(offAth), chg5d: chg };
    }
    return { score, label, cls, op, recent, buzz: b, mbScore, mbLevel, position, posCls, holder, off52: null, offAth: null, chg5d: null };
  }

  // ------------------------------------------------------------------ extractive summary of the original post
  const METRIC = /(revenue|sales|turnover|profit|pat|ebitda|margin|opm|roce|roe|market cap|m-?cap|p\/?e\b|valuation|debt|order ?book|capacity|cagr|promoter|eps|guidance|utili[sz]ation|price|dividend|book value|cash)/i;
  const UNIT = /(₹|rs\.?\s?\d|\d\s?(cr|crore|crores|bn|mn|lakh|%|x\b|times|mt|tpa|mw))/i;
  const THESIS = /(moat|market share|leader|monopoly|largest|only|capacity|expansion|order|margin|demand|export|approval|guidance|target|opportunit|trigger|catalyst|growth|scale|operating leverage|tailwind|re-?rating|undervalued|cheap|niche|client|customer|new product|launch|backward integration|capex)/gi;
  const RISKW = /(risk|concern|however|challenge|threat|competition|competitive|dependen|pledge|debt|delay|slowdown|volatil|cyclical|regulator|litigation|working capital|receivable|customer concentration|raw material)/i;
  function summarize(body) {
    if (!body) return { points: [], numbers: [], risks: [], triggers: [] };
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const isHeading = (l) => l.startsWith('## ') || (l.length <= 60 && !/[.:;,]$/.test(l) && !l.startsWith('•') && /^[A-Z0-9]/.test(l) && l.split(' ').length <= 8 && !UNIT.test(l));
    const sections = [];
    let cur = { h: '', lines: [] };
    for (const l of lines) {
      if (isHeading(l)) { if (cur.lines.length || cur.h) sections.push(cur); cur = { h: l.replace(/^##\s*/, ''), lines: [] }; }
      else cur.lines.push(l.replace(/^•\s*/, ''));
    }
    sections.push(cur);
    const numbers = [], seen = new Set();
    for (const l of lines) {
      const t = l.replace(/^•\s*/, '');
      if (t.length < 8 || t.length > 220) continue;
      if (METRIC.test(t) && UNIT.test(t)) { const k = t.toLowerCase().slice(0, 40); if (!seen.has(k)) { seen.add(k); numbers.push(t); } }
      if (numbers.length >= 10) break;
    }
    const sentences = [];
    sections.forEach((s) => {
      const parts = s.lines.join(' ').match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [];
      parts.forEach((p) => { p = p.trim(); if (p.length >= 50 && p.length <= 320) sentences.push({ p, h: s.h }); });
    });
    const n = sentences.length || 1;
    sentences.forEach((s, i) => {
      let sc = (s.p.match(THESIS) || []).length * 1.2;
      if (UNIT.test(s.p)) sc += 1;
      if (i < n * 0.15) sc += 1;
      if (/thesis|why|summary|conclusion|investment case|key highlight|view/i.test(s.h)) sc += 2;
      if (/risk|concern/i.test(s.h)) sc -= 2;
      s.score = sc; s.i = i;
    });
    const points = sentences.slice().sort((a, b) => b.score - a.score).slice(0, 6).sort((a, b) => a.i - b.i).map((s) => s.p);
    let risks = [];
    for (const s of sections) if (/risk|concern|negative|bear|red flag|threat|challenge/i.test(s.h)) risks.push(...s.lines);
    if (!risks.length) risks = sentences.filter((s) => RISKW.test(s.p)).map((s) => s.p);
    risks = risks.filter((r) => r.length > 15).slice(0, 5).map((r) => (r.length > 260 ? r.slice(0, 257) + '…' : r));
    let triggers = [];
    for (const s of sections) if (/trigger|catalyst|outlook|guidance|future|growth driver|road ?map/i.test(s.h)) triggers.push(...s.lines);
    triggers = triggers.filter((r) => r.length > 15).slice(0, 5).map((r) => (r.length > 260 ? r.slice(0, 257) + '…' : r));
    return { points, numbers, risks, triggers };
  }

  global.VPForum = { mood, buzz, signal, summarize };
})(window);
