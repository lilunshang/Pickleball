/**
 * 理論上匹克球｜管理後台：排課看板 sched.js v2.6（2026/10/27：每格可排 專項／期制課程／球敘）
 * 版面：上方選月份、據點頁籤 → 據點卡（場租、專項價、分潤、本月格數）→ 每個時段一張「日期 × 球面」表 → 待處理清單；桌機右側本月統計、教練人力、各據點進度；下方工具列（專項／期制課程／球敘）
 *   所有球面預設為空（已有課程、已開放或有人報名的球敘鎖定）；主理人決定每一格放什麼：
 *     專項：單堂專項課
 *     期制：選課程模板（例：4 堂一期），這一面接下來的可用日自動預訂到滿堂數（跨月也算）
 *     球敘：同一天同時段的球敘格發布時合成一場；到開放報名時間自動開放
 *   沒人報名的舊球敘草稿當成空格：發布時，有排草稿的據點這個月的舊草稿一律取消
 *   草稿自動存到 2_排課草稿（停手 1.5 秒後送出，一次一個請求）
 * 看板不新增據點或時段（特助在「主檔與紀錄」維護）。
 */
(function () {
  'use strict';
  const { esc, str, split, num, money, today, addDays, fmtD, day, wd, sum, uniq, byKey, ui, m } = PB;
  const A = PB.acts;
  const T = '2_排課草稿';
  const S = { month: '', venue: '', placing: '', tray: 'spec', pending: {}, saving: false, timer: null, flash: '' };
  const WEEK = '一二三四五六日';
  const GAME_TYPES = [['不限', '一般球敘'], ['新手場', '新手場'], ['分級', '分級球敘'], ['DUPR', 'DUPR 球敘']];
  const gameName = (t) => (GAME_TYPES.find((x) => x[0] === (str(t) || '不限')) || [0, str(t) + '球敘'])[1];
  const KIND_LABEL = { 專項: '專項', 期制: '期制課程', 球敘: '球敘' };

  // ---------------- 小工具 ----------------
  const key = (slot, d, court) => slot + '|' + d + '|' + court;
  const mins = (t) => { const x = str(t).match(/(\d{1,2}):(\d{2})/); if (!x) return 0; const v = +x[1] * 60 + +x[2]; return v === 23 * 60 + 59 ? 1440 : v; };
  const overlap = (s1, e1, s2, e2) => mins(s1) < mins(e2) && mins(s2) < mins(e1);
  const monthsAhead = () => { const out = []; let y = +today().slice(0, 4); let mo = +today().slice(5, 7); for (let i = 0; i < 4; i++) { out.push(y + '-' + ('0' + mo).slice(-2)); mo += 1; if (mo > 12) { mo = 1; y += 1; } } return out; };
  const nextMonth = () => monthsAhead()[1];
  const venueKind = (vid) => { const v = PB.get('1_據點', vid) || {}; return str(v['據點類別']) || (/國小|國中|高中|大學|科大|學校|中學/.test(str(v['據點名稱'])) ? '學校' : '球館'); };
  const price = (vid, specId) => { const own = num((PB.get('0_專項', specId) || {})['費用']); if (own > 0) return own; const p = PB.cfg.specPrice || { 學校: 1000, 球館: 1200 }; return num(p[venueKind(vid)]) || 1000; };
  const specs = () => PB.rows('0_專項').filter((s) => s['是否啟用'] !== false).sort((a, b) => byKey(('000' + num((PB.get('0_程度', a['程度']) || {})['排序'])).slice(-3) + str(a['專項名稱']), ('000' + num((PB.get('0_程度', b['程度']) || {})['排序'])).slice(-3) + str(b['專項名稱'])));
  const singleType = () => str((PB.rows('0_課程類型').find((t) => str(t['課程類型']) === (PB.cfg.singleType || '單堂專項')) || {})['類型ID']);
  /** 期制課程模板（不含單堂專項；要有總堂數） */
  const templates = () => PB.rows('0_課程模板').filter((t) => num(t['總堂數']) > 0 && str(t['課程類型']) !== singleType()).sort((a, b) => byKey(m.typeName(a['課程類型']) + str(a['模板名稱']), m.typeName(b['課程類型']) + str(b['模板名稱'])));
  const lvIdx = (lv) => { const list = uniq(specs().map((s) => str(s['程度']))); const i = list.indexOf(str(lv)); return i < 0 ? 0 : i % 3; };
  const lvShort = (lv) => { const r = PB.get('0_程度', lv); if (!r) return '未分程度'; const nm = str(r['程度名稱']); return /^L\d/.test(nm) || !str(r['排序']) ? nm : 'L' + num(r['排序']) + ' ' + nm; };
  const coachList = () => PB.rows('1_人員_教練').filter((c) => ['在職', ''].indexOf(str((PB.get('1_人員', c['人員ID']) || {})['在職狀態'])) >= 0).map((c) => ({ v: str(c['人員ID']), l: m.staffName(c['人員ID']) })).sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));
  const kindOf = (x) => (['期制', '球敘'].indexOf(str(x && x.用途)) >= 0 ? str(x.用途) : '專項');
  const placingKind = () => (S.placing ? { spec: '專項', tpl: '期制', game: '球敘' }[S.placing.split(':')[0]] : '');
  const placingVal = () => S.placing.slice(S.placing.indexOf(':') + 1);
  const placingName = () => { const k = placingKind(); const v = placingVal(); return k === '專項' ? m.specName(v) : k === '期制' ? str((PB.get('0_課程模板', v) || {})['模板名稱']) : gameName(v); };

  /** 這個據點有可用的時段（使用中） */
  function venueSlots(vid) {
    return PB.rows('1_據點_時段').filter((s) => str(s['據點']) === vid && ['使用中', ''].indexOf(str(s['狀態'])) >= 0)
      .sort((a, b) => byKey(WEEK.indexOf(str(a['星期'])) + str(a['開始時間']), WEEK.indexOf(str(b['星期'])) + str(b['開始時間'])));
  }
  function venues() {
    return PB.rows('1_據點').filter((v) => ['合作中', '籌備中', ''].indexOf(str(v['狀態'])) >= 0 && venueSlots(str(v['據點ID'])).length)
      .sort((a, b) => byKey(str(a['據點名稱']), str(b['據點名稱'])));
  }
  /** 時段的可用日（可用＋待確認；今天以後）；month 空白＝不限月份 */
  function slotDates(slot, month) {
    return (PB.ix.availBySlot[str(slot['時段ID'])] || []).filter((a) => (!month || day(a['日期']).slice(0, 7) === month) && day(a['日期']) >= today() && ['可用', '待確認'].indexOf(str(a['狀態'])) >= 0)
      .map((a) => ({ d: day(a['日期']), ok: str(a['狀態']) === '可用' })).sort((a, b) => byKey(a.d, b.d));
  }
  /** 球面能不能放這一類（場地類型、時段用途；空白＝都可以） */
  function useOk(slot, cid, kind) {
    const use = kind === '球敘' ? '球敘' : '課程';
    const ct = split((PB.get('1_據點_場地', cid) || {})['類型']);
    const su = split(slot['用途']);
    return (!ct.length || ct.indexOf(use) >= 0) && (!su.length || su.indexOf(use) >= 0);
  }
  /** 同時段最近一場球敘（費用、類型預設值） */
  function gameTpl(slotId, d) {
    return PB.rows('2_球敘場次').filter((g) => str(g['時段']) === slotId && str(g['狀態']) !== '取消' && day(g['日期']) && day(g['日期']) < d)
      .sort((a, b) => byKey(day(b['日期']), day(a['日期'])))[0] || {};
  }
  const legacyDraft = (g) => { if (str(g['狀態']) !== '草稿' || str(g['開放報名時間'])) return false; const x = m.game(g); return !(x.active.length + x.wait.length + x.walkin.length); };

  // ---------------- 草稿（已存＋還沒存的變更；全部月份，期制會跨月） ----------------
  function savedDrafts(month) {
    return PB.rows(T).filter((r) => str(r['狀態']) === '草稿' && (!month || day(r['日期']).slice(0, 7) === month));
  }
  function draftsAll() {
    const out = {};
    savedDrafts().forEach((r) => { out[key(str(r['時段']), day(r['日期']), str(r['球面']))] = { id: str(r['排課ID']), 日期: day(r['日期']), 時段: str(r['時段']), 球面: str(r['球面']), 用途: str(r['用途']), 專項: str(r['專項']), 課程模板: str(r['課程模板']), 球敘類型: str(r['球敘類型']), 費用: r['費用'], 人數上限: r['人數上限'], 人數下限: r['人數下限'], 教練: str(r['教練']) }; });
    Object.keys(S.pending).forEach((k) => {
      const p = S.pending[k];
      if (p.del) delete out[k];
      else out[k] = Object.assign({}, out[k] || {}, p);
    });
    return out;
  }

  /** 已存在的資料佔用（不看草稿）：lock＝不能排；legacy＝沒人報名的舊球敘草稿（當空格） */
  function occ(slot, d, cid) {
    const st = str(slot['開始時間']);
    const en = str(slot['結束時間']);
    const sess = (PB.ix.sesByDay[d] || []).filter((s) => str(s['使用場地']) === cid && ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0 && overlap(st, en, s['開始時間'], s['結束時間']));
    if (sess.length) {
      const c = PB.get('2_課程班級', sess[0]['班級']);
      const single = m.isSingle(c);
      const total = num(c && c['總堂數']);
      const no = num(sess[0]['第幾堂']);
      const makeup = !single && total && no > total;
      return { lock: { course: true, single: single, label: c ? str(c['課程名稱']) : '課程', sub: single ? '專項・已發布' : makeup ? '期末補課堂' : (no ? '第 ' + no + '/' + total + ' 堂' : '期制 ' + str(c && c['期別'])), why: '已有課程「' + (c ? m.classLabel(c) : '') + '」' + (makeup ? '的期末補課堂' : '') + '，要調整請到營運工作台的課程處理。' } };
    }
    const games = (PB.ix.gameByDay[d] || []).filter((g) => str(g['狀態']) !== '取消' && split(g['使用場地']).indexOf(cid) >= 0 && overlap(st, en, g['開始時間'], g['結束時間']));
    const legacy = games.filter(legacyDraft);
    const hard = games.filter((g) => !legacyDraft(g));
    if (hard.length) {
      const g = hard[0];
      const x = m.game(g);
      const name = gameName(g['球敘類型']);
      const waiting = x.st === '草稿' && str(g['開放報名時間']);
      return { lock: { game: true, label: name, sub: waiting ? fmtD(g['開放報名時間']).replace(/（.）/, '') + ' 開放' : x.st === '草稿' ? '草稿・有人報名' : x.st + ' ' + x.active.length + ' 人', why: waiting ? '這場球敘已從看板發布，' + str(g['開放報名時間']).slice(0, 16) + ' 自動開放報名。要改請先到營運工作台「球敘」取消這場。' : x.st === '草稿' ? '這場球敘草稿已有人報名，不能改排。' : '這場球敘已開放報名（' + x.active.length + ' 人），不能改排。' } };
    }
    return { legacy: legacy };
  }

  /** 期制：從第一堂起，這一面接下來的可用日（略過已被課程／球敘佔用的日期）取滿堂數 */
  function seriesOf(k, x, D) {
    const slot = PB.get('1_據點_時段', x.時段);
    const tpl = PB.get('0_課程模板', x.課程模板) || {};
    const n = num(tpl['總堂數']) || 0;
    const out = { n: n, dates: [], short: 0, clash: '', pend: [] };
    if (!slot || !n) { out.short = n; return out; }
    const list = slotDates(slot, '').filter((o) => o.d >= x.日期);
    for (let i = 0; i < list.length && out.dates.length < n; i++) {
      const o = list[i];
      if (o.d !== x.日期 && occ(slot, o.d, x.球面).lock) continue;
      const k2 = key(x.時段, o.d, x.球面);
      if (k2 !== k && D[k2] && !out.clash) out.clash = fmtD(o.d) + ' 這一面已排「' + draftName(D[k2]) + '」';
      out.dates.push(o.d);
      if (!o.ok) out.pend.push(o.d);
    }
    out.short = n - out.dates.length;
    return out;
  }
  function draftName(x) {
    const kd = kindOf(x);
    if (kd === '期制') return str((PB.get('0_課程模板', x.課程模板) || {})['模板名稱']) || '（模板已刪除）';
    if (kd === '球敘') return gameName(x.球敘類型);
    return m.specName(x.專項) || '（專項已刪除）';
  }

  /** 看板模型：草稿、期制預訂格 */
  function model() {
    const D = draftsAll();
    const R = {};
    const series = {};
    Object.keys(D).forEach((k) => {
      const x = D[k];
      if (kindOf(x) !== '期制') return;
      const sr = (series[k] = seriesOf(k, x, D));
      sr.dates.forEach((d, i) => { if (i) R[key(x.時段, d, x.球面)] = { anchor: k, i: i + 1, n: sr.n }; });
    });
    return { D: D, R: R, series: series };
  }

  /** 一格目前的狀態：{ kind: empty|draft|resv|lock, … } */
  function cellState(slot, d, cid, M) {
    const k = key(str(slot['時段ID']), d, cid);
    const o = occ(slot, d, cid);
    if (o.lock) return Object.assign({ kind: 'lock' }, o.lock);
    if (M.D[k]) return { kind: 'draft', draft: M.D[k], dk: kindOf(M.D[k]), legacy: o.legacy };
    if (M.R[k]) return { kind: 'resv', resv: M.R[k], anchor: M.D[M.R[k].anchor], legacy: o.legacy };
    return { kind: 'empty', legacy: o.legacy, course: useOk(slot, cid, '專項'), game: useOk(slot, cid, '球敘') };
  }

  /** 教練在這一天這個時段能不能排：不可排日期、同時段已有課（含其他草稿與期制預訂） */
  function coachState(coachId, slot, d, k, M) {
    if (!coachId) return '';
    const un = PB.rows('2_教練不可排日期').find((r) => str(r['教練']) === coachId && day(r['開始日期']) && day(r['開始日期']) <= d && (day(r['結束日期']) || day(r['開始日期'])) >= d);
    if (un) return fmtD(d) + ' 登記不可排';
    const st = str(slot['開始時間']);
    const en = str(slot['結束時間']);
    const s = (PB.ix.sesByDay[d] || []).find((x) => str(x['授課教練']) === coachId && ['取消', '改期'].indexOf(str(x['場次狀態'])) < 0 && overlap(st, en, x['開始時間'], x['結束時間']));
    if (s) return fmtD(d) + ' 已排 ' + m.venueName(s['據點']);
    const D = M.D;
    const hit = Object.keys(D).find((k2) => {
      if (k2 === k) return false;
      const x = D[k2];
      if (x.教練 !== coachId || kindOf(x) === '球敘') return false;
      const dates = kindOf(x) === '期制' ? (M.series[k2] || { dates: [] }).dates : [x.日期];
      if (dates.indexOf(d) < 0) return false;
      const s2 = PB.get('1_據點_時段', x.時段);
      return s2 && overlap(st, en, s2['開始時間'], s2['結束時間']);
    });
    if (hit) { const x = D[hit]; return fmtD(d) + ' 已排 ' + m.venueName((PB.get('1_據點_時段', x.時段) || {})['據點']) + ' ' + m.courtName(x.球面); }
    return '';
  }
  /** 這格草稿的所有上課日（期制＝整期） */
  const datesOf = (k, x, M) => (kindOf(x) === '期制' ? (M.series[k] || { dates: [] }).dates : [x.日期]);
  const coachIssue = (coachId, slot, k, x, M) => { for (const d of datesOf(k, x, M)) { const w = coachState(coachId, slot, d, k, M); if (w) return w; } return ''; };

  // ---------------- 統計 ----------------
  function analyze() {
    const M = model();
    const D = M.D;
    const out = { M: M, D: D, spec: 0, tpl: 0, tplSes: 0, game: 0, min: 0, max: 0, revMin: 0, revMax: 0, issues: [], conf: {}, rows: {}, peak: 0, unnamed: 0, hard: 0, notReady: 0, sweep: 0 };
    const issue = (k, t, soft) => { out.issues.push({ k: k, t: t, soft: soft }); if (soft) return; out.hard += 1; out.conf[k] = 1; };
    Object.keys(D).forEach((k) => {
      const x = D[k];
      if (x.日期.slice(0, 7) !== S.month) return;
      const slot = PB.get('1_據點_時段', x.時段);
      if (!slot) return;
      const vid = str(slot['據點']);
      const kd = kindOf(x);
      const where = fmtD(x.日期) + ' ' + m.venueName(vid) + ' ' + m.hm(slot['開始時間']) + ' ' + m.courtName(x.球面);
      const c = cellState(slot, x.日期, x.球面, M);
      if (c.kind === 'lock') issue(k, where + '：' + c.why);
      if (!useOk(slot, x.球面, kd)) issue(k, where + '：這一面沒有登記「' + (kd === '球敘' ? '球敘' : '課程') + '」用途');
      if (kd === '專項') {
        out.spec += 1;
        const mn = num(x.人數下限) || 5;
        const mx = num(x.人數上限) || 6;
        out.min += mn; out.max += mx; out.revMin += mn * price(vid, x.專項); out.revMax += mx * price(vid, x.專項);
      }
      if (kd === '期制') {
        const sr = M.series[k];
        const tpl = PB.get('0_課程模板', x.課程模板) || {};
        out.tpl += 1; out.tplSes += sr.dates.length;
        const fee = str(x.費用) !== '' ? num(x.費用) : num(tpl['費用']);
        const mn = num(x.人數下限) || num(tpl['人數下限']) || 5;
        const mx = num(x.人數上限) || num(tpl['人數上限']) || 6;
        out.min += mn; out.max += mx; out.revMin += mn * fee; out.revMax += mx * fee;
        if (sr.short) issue(k, where + '「' + draftName(x) + '」可用日不足：需要 ' + sr.n + ' 堂，只排得到 ' + sr.dates.length + ' 堂');
        if (sr.clash) issue(k, where + '「' + draftName(x) + '」' + sr.clash);
        if (sr.pend.length) { out.notReady += 1; issue(k, where + '「' + draftName(x) + '」可用日還沒確認：' + sr.pend.map(fmtD).join('、'), true); }
      }
      if (kd === '球敘') {
        out.game += 1;
        if (str(x.費用) === '' && str(gameTpl(x.時段, x.日期)['費用']) === '') issue(k, where + '：球敘還沒填費用');
      }
      if (kd !== '期制') {
        const avail = (PB.ix.availBySlot[str(x.時段)] || []).find((a) => day(a['日期']) === x.日期);
        if (!avail || str(avail['狀態']) !== '可用') { out.notReady += 1; issue(k, where + '：這天的可用日還沒確認', true); }
      }
      if (kd !== '球敘') {
        if (!x.教練) { out.unnamed += 1; issue(k, where + '「' + draftName(x) + '」還沒指定教練', true); }
        else { const why = coachIssue(x.教練, slot, k, x, M); if (why) issue(k, where + '：' + m.staffName(x.教練) + ' ' + why); }
      }
    });
    // 各日期時段需要的人力（只看看板上的據點時段）
    venues().forEach((v) => venueSlots(str(v['據點ID'])).forEach((slot) => slotDates(slot, S.month).forEach((dd) => {
      const rk = dd.d + '|' + str(slot['時段ID']);
      const r = (out.rows[rk] = { d: dd.d, slot: slot, coach: 0, named: 0, host: 0 });
      split(slot['使用場地']).forEach((cid) => {
        const c = cellState(slot, dd.d, cid, M);
        if (c.kind === 'draft' && c.dk !== '球敘') { r.coach += 1; if (c.draft.教練) r.named += 1; }
        if (c.kind === 'resv') { r.coach += 1; if (c.anchor && c.anchor.教練) r.named += 1; }
        if (c.course) { r.coach += 1; r.named += 1; }
        if (c.game || (c.kind === 'draft' && c.dk === '球敘')) r.host = 1;
      });
      if (!r.coach && !r.host) delete out.rows[rk];
    })));
    const perDay = {};
    Object.keys(out.rows).forEach((k) => { const r = out.rows[k]; perDay[r.d] = (perDay[r.d] || 0) + r.coach; });
    out.peak = Math.max(0, ...Object.keys(perDay).map((d) => perDay[d]));
    // 各據點格數
    out.cnt = {};
    const planned = {};
    Object.keys(D).forEach((k) => { const x = D[k]; if (x.日期.slice(0, 7) === S.month) planned[str((PB.get('1_據點_時段', x.時段) || {})['據點'])] = 1; });
    venues().forEach((v) => {
      const vid = str(v['據點ID']);
      const c = (out.cnt[vid] = { spec: 0, tpl: 0, game: 0, empty: 0, lock: 0, issue: 0, legacy: 0 });
      const seen = {};
      venueSlots(vid).forEach((slot) => slotDates(slot, S.month).forEach((dd) => split(slot['使用場地']).forEach((cid) => {
        const st = cellState(slot, dd.d, cid, M);
        if (st.kind === 'draft') c[{ 專項: 'spec', 期制: 'tpl', 球敘: 'game' }[st.dk]] += 1;
        else if (st.kind === 'resv') c.tpl += 1;
        else if (st.kind === 'empty') c.empty += 1;
        else c.lock += 1;
        (st.legacy || []).forEach((g) => { seen[str(g['球敘ID'])] = 1; });
      })));
      c.legacy = Object.keys(seen).length;
      if (planned[vid]) out.sweep += c.legacy;
    });
    out.issues.forEach((i) => { const vid = str((PB.get('1_據點_時段', i.k.split('|')[0]) || {})['據點']); if (out.cnt[vid]) out.cnt[vid].issue += 1; });
    // 教練人力（本月草稿依教練彙整；期制算每一堂）
    out.coaches = {};
    Object.keys(D).forEach((k) => { const x = D[k]; if (!x.教練 || kindOf(x) === '球敘') return; datesOf(k, x, M).filter((d) => d.slice(0, 7) === S.month).forEach((d) => (out.coaches[x.教練] = out.coaches[x.教練] || []).push(d)); });
    out.n = out.spec + out.tpl + out.game;
    return out;
  }

  // ---------------- 畫面 ----------------
  const MD = (d) => (+d.slice(5, 7)) + '/' + (+d.slice(8, 10));

  function venueTerms(vid) {
    const out = { rent: '', rentL: '', share: '' };
    if (!PB.has('3_合作方案')) return out;
    const mStart = S.month + '-01';
    const mEnd = S.month + '-31';
    const plans = PB.rows('3_合作方案').filter((p) => str(p['合作對象類型']) === '據點' && str(p['據點']) === vid &&
      (!day(p['生效日期']) || day(p['生效日期']) <= mEnd) && (!day(p['失效日期']) || day(p['失效日期']) >= mStart));
    const rent = plans.find((p) => ['按次租用', '包場租約'].indexOf(str(p['合作模式'])) >= 0);
    if (rent) {
      if (str(rent['合作模式']) === '按次租用' && num(rent['每面每小時單價'])) { out.rent = money(rent['每面每小時單價']); out.rentL = '場租／面／小時'; }
      else if (num(rent['合約金額'])) { out.rent = money(rent['合約金額']); out.rentL = '包場租約'; }
    }
    const share = plans.find((p) => str(p['合作模式']) === '比例分潤' && ['球敘', '全部', ''].indexOf(str(p['適用範圍'])) >= 0);
    if (share && str(share['我方比例']) !== '') { const me = Math.round(num(share['我方比例']) * 100); out.share = me + '／' + (100 - me); }
    return out;
  }

  /** 放置中的這一格可以放嗎 */
  function canPlace(slot, cid, c) {
    const kd = placingKind();
    if (!kd || c.kind === 'lock' || c.kind === 'resv') return false;
    return useOk(slot, cid, kd);
  }

  function cellHtml(slot, d, cid, An) {
    const M = An.M;
    const k = key(str(slot['時段ID']), d, cid);
    const c = cellState(slot, d, cid, M);
    const cls = ['sb-cell'];
    let nm = '';
    let meta = '';
    let tag = '';
    if (c.kind === 'draft') {
      const x = c.draft;
      cls.push('new', 'k-' + { 專項: 'spec', 期制: 'tpl', 球敘: 'game' }[c.dk]);
      nm = esc(draftName(x));
      if (c.dk === '專項') {
        const sp = PB.get('0_專項', x.專項) || {};
        cls.push('lv' + lvIdx(sp['程度']));
        meta = (x.教練 ? esc(m.staffName(x.教練)) : '未排教練') + '・' + (num(x.人數下限) || 5) + '–' + (num(x.人數上限) || 6) + '人';
      } else if (c.dk === '期制') {
        const sr = M.series[k] || { n: 0, dates: [] };
        meta = '第 1/' + sr.n + ' 堂・' + (x.教練 ? esc(m.staffName(x.教練)) : '未排教練');
        if (sr.short) { tag = '可用日不足'; }
      } else {
        const fee = str(x.費用) !== '' ? num(x.費用) : num(gameTpl(x.時段, x.日期)['費用']);
        meta = (fee ? money(fee) + '／人' : '未填費用');
      }
      if (c.dk !== '球敘' && !x.教練) { cls.push('nocoach'); tag = tag || '未排教練'; }
      if (An.conf[k]) { cls.push('conf'); tag = tag && tag !== '未排教練' ? tag : '衝突'; }
      if (S.pending[k]) cls.push('dirty');
      if (c.legacy && c.legacy.length) meta += '<br>取代舊球敘草稿';
    } else if (c.kind === 'resv') {
      cls.push('resv');
      nm = esc(draftName(c.anchor || {}));
      meta = '第 ' + c.resv.i + '/' + c.resv.n + ' 堂・' + MD(c.anchor ? c.anchor.日期 : '') + ' 起';
      if (An.conf[c.resv.anchor]) cls.push('conf');
    } else if (c.kind === 'lock') {
      cls.push('lock');
      if (c.game) cls.push('gath');
      nm = esc(c.label.replace('一般球敘', '球敘'));
      meta = esc(c.sub);
    } else {
      cls.push('sb-empty');
      nm = '空';
      meta = c.course && c.game ? '可排' : c.course ? '只能排課' : c.game ? '只能球敘' : '不能排';
      if (c.legacy && c.legacy.length) meta += '・有舊草稿';
    }
    if (S.placing && canPlace(slot, cid, c)) {
      cls.push('can');
      if (c.kind !== 'draft') { nm = '＋ ' + esc(placingName()); meta = c.legacy && c.legacy.length ? '取代舊球敘草稿' : '點一下放上去'; }
    } else if (S.placing && c.kind === 'empty') cls.push('cant');
    if (S.flash === k) cls.push('flash');
    return '<button class="' + cls.join(' ') + '" data-act="sbCell" data-k="' + esc(k) + '" title="' + esc(m.courtName(cid)) + '">' +
      (tag ? '<span class="tag">' + tag + '</span>' : '') + (c.kind === 'lock' ? '<span class="lk">🔒</span>' : '') +
      '<span class="nm">' + nm + '</span><span class="meta">' + meta + '</span></button>';
  }

  function tableGroups(slots) {
    const byDay = {};
    slots.forEach((s) => { (byDay[str(s['星期'])] = byDay[str(s['星期'])] || []).push(s); });
    const out = [];
    Object.keys(byDay).sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b)).forEach((w) => {
      const ss = byDay[w];
      const total = sum(ss.map((s) => split(s['使用場地']).length));
      if (ss.every((s) => split(s['使用場地']).length === 1)) { for (let i = 0; i < ss.length; i += 4) out.push(ss.slice(i, i + 4)); }
      else if (total <= 4) out.push(ss);
      else ss.forEach((s) => out.push([s]));
    });
    return out;
  }

  function tableHtml(group, An) {
    const cols = [];
    group.forEach((s) => split(s['使用場地']).forEach((cid) => cols.push({ s: s, cid: cid })));
    const dates = uniq(group.reduce((a, s) => a.concat(slotDates(s, S.month).map((x) => x.d)), [])).sort();
    if (!dates.length) return '';
    const multi = group.length > 1;
    const one = !multi ? group[0] : null;
    const title = multi ? '週' + str(group[0]['星期']) + ' ' + group.map((s) => m.hm(s['開始時間'], s['結束時間'])).join('、') : '週' + str(one['星期']) + ' ' + m.hm(one['開始時間'], one['結束時間']);
    const uses = !multi ? uniq(split(one['使用場地']).map((cid) => split((PB.get('1_據點_場地', cid) || {})['類型']).join('・'))).filter(Boolean).join('／') : '';
    const colHead = (x) => multi ? (split(x.s['使用場地']).length === 1 ? esc(m.hm(x.s['開始時間'], x.s['結束時間']).replace(/:00/g, '')) : esc(m.hm(x.s['開始時間']) + ' ' + m.courtName(x.cid))) : esc(m.courtName(x.cid));
    const rows = dates.map((d) => {
      const pend = group.some((s) => { const o = slotDates(s, S.month).find((x) => x.d === d); return o && !o.ok; });
      return '<tr><th class="d"><b>' + MD(d) + '</b><small>週' + wd(d) + '</small>' + (pend ? '<span class="pend">可用日待確認</span>' : '') + '</th>' +
        cols.map((x) => slotDates(x.s, S.month).some((o) => o.d === d) ? '<td>' + cellHtml(x.s, d, x.cid, An) + '</td>' : '<td><span class="sb-na">—</span></td>').join('') + '</tr>';
    }).join('');
    return '<section class="sb-tblbox"><h3>' + esc(title) + (uses ? '<small>' + esc(uses) + '</small>' : '') + '</h3><div class="sb-tblwrap"><table class="sb-tbl" style="--cols:' + cols.length + '"><thead><tr><th class="d">' + (+S.month.slice(5, 7)) + ' 月</th>' + cols.map((x) => '<th>' + colHead(x) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>';
  }

  function sideHtml(An, vs) {
    const coachRows = Object.keys(An.coaches).map((id) => ({ id: id, ds: uniq(An.coaches[id]).sort() })).sort((a, b) => b.ds.length - a.ds.length)
      .map((o) => '<div class="sb-kv2"><span>' + esc(m.staffName(o.id)) + '</span><span>' + o.ds.length + ' 堂<small>' + esc(o.ds.slice(0, 4).map(MD).join('、') + (o.ds.length > 4 ? '…' : '')) + '</small></span></div>').join('');
    const prog = vs.map((v) => { const c = An.cnt[str(v['據點ID'])] || {}; const done = (c.spec || 0) + (c.tpl || 0) + (c.game || 0); const all = done + (c.empty || 0); return '<button class="sb-kv2 click" data-act="sbVenue" data-v="' + esc(v['據點ID']) + '"><span>' + esc(v['據點名稱']) + (c.issue ? ' <span class="badge bad">' + c.issue + '</span>' : '') + '</span><span class="num">' + done + '／' + all + '</span></button>'; }).join('');
    return '<aside class="sb-side">' +
      '<div class="card sb-sbox"><h4>' + esc(S.month) + ' 統計<small>全部據點</small></h4><div class="sb-kv">' +
      '<span>專項課</span><b>' + An.spec + ' 堂</b><span>期制課程</span><b>' + An.tpl + ' 班（' + An.tplSes + ' 堂）</b><span>球敘</span><b>' + An.game + ' 面</b><span>課程名額</span><b>' + An.min + '–' + An.max + '</b><span>預估課程收入</span><b>' + money(An.revMin) + (An.revMax !== An.revMin ? '–' + num(An.revMax).toLocaleString() : '') + '</b><span>單日最多教練</span><b>' + An.peak + '</b><span>待處理</span><b class="' + (An.hard ? 'bad' : An.unnamed ? 'warn' : '') + '">' + An.issues.length + '</b></div>' +
      '<button class="btn sm ghost" style="width:100%;margin-top:8px" data-act="sbStats">各時段人力與衝突</button></div>' +
      '<div class="card sb-sbox"><h4>教練人力<small>本月已指定</small></h4>' + (coachRows || '<p class="mut" style="margin:0;font-size:.85rem">還沒有指定教練</p>') + '</div>' +
      '<div class="card sb-sbox"><h4>各據點進度<small>已排／可排格數</small></h4>' + prog + '</div></aside>';
  }

  function trayHtml() {
    const tabs = [['spec', '專項'], ['tpl', '期制課程'], ['game', '球敘']];
    const head = '<div class="sb-trayh">' + (S.placing ? '<span><span class="sb-mode m-' + S.placing.split(':')[0] + '">放置中</span><b>' + esc(KIND_LABEL[placingKind()] + '｜' + placingName()) + '</b>｜點格子放上去</span><button class="btn sm pri" data-act="sbPlace" data-v="">完成</button>' :
      '<div class="sb-ttabs">' + tabs.map((t) => '<button class="' + (S.tray === t[0] ? 'on' : '') + '" data-act="sbTray" data-v="' + t[0] + '">' + t[1] + '</button>').join('') + '</div><span>選一個，再點格子放上去</span>') + '</div>';
    let chips = '';
    if (S.tray === 'spec') {
      const groups = [];
      specs().forEach((x) => { const lv = str(x['程度']); let g = groups.find((o) => o.lv === lv); if (!g) groups.push((g = { lv: lv, list: [] })); g.list.push(x); });
      chips = groups.length ? groups.map((g) => '<div class="sb-lv"><small>' + esc(lvShort(g.lv)) + '</small><div class="sb-lvrow">' + g.list.map((x) => '<button class="sb-chip lv' + lvIdx(x['程度']) + (S.placing === 'spec:' + str(x['專項ID']) ? ' on' : '') + '" data-act="sbPlace" data-v="spec:' + esc(x['專項ID']) + '"><span>' + esc(x['專項名稱']) + '</span><small>' + money(price(S.venue, str(x['專項ID']))) + '</small></button>').join('') + '</div></div>').join('') : '<span class="mut">還沒有專項：請到「主檔與紀錄 → 課程設定 → 專項」新增</span>';
    } else if (S.tray === 'tpl') {
      const list = templates();
      chips = list.length ? '<div class="sb-lvrow">' + list.map((t) => '<button class="sb-chip c-tpl' + (S.placing === 'tpl:' + str(t['模板ID']) ? ' on' : '') + '" data-act="sbPlace" data-v="tpl:' + esc(t['模板ID']) + '"><span>' + esc(t['模板名稱']) + '</span><small>' + num(t['總堂數']) + ' 堂一期' + (str(t['費用']) ? '・' + money(t['費用']) : '') + '</small></button>').join('') + '</div>' : '<span class="mut">還沒有期制課程模板：請到「主檔與紀錄 → 課程設定 → 課程模板」新增（要填總堂數）</span>';
    } else {
      chips = '<div class="sb-lvrow">' + GAME_TYPES.map((g) => '<button class="sb-chip c-game' + (S.placing === 'game:' + g[0] ? ' on' : '') + '" data-act="sbPlace" data-v="game:' + esc(g[0]) + '"><span>' + esc(g[1]) + '</span><small>費用沿用同時段上一場</small></button>').join('') + '</div>';
    }
    return '<div class="sb-tray">' + head + '<div class="sb-chips">' + chips + '</div></div>';
  }

  const Sched = {
    id: 'sched', label: '排課', icon: 'grid',
    show: () => PB.has(T),
    render(p) {
      if (!S.month) S.month = p.m || nextMonth();
      const vs = venues();
      if (!vs.length) return '<div class="ptop"><h1>排課</h1></div>' + '<div class="card">' + ui.empty('沒有可以排課的據點', '請先在主檔設定據點、時段與可用日') + '</div>';
      if (!S.venue || !vs.some((v) => str(v['據點ID']) === S.venue)) S.venue = str(vs[0]['據點ID']);
      const An = analyze();
      const v = PB.get('1_據點', S.venue) || {};
      const slots = venueSlots(S.venue);
      const dirty = Object.keys(S.pending).length;
      const head = '<div class="sb-head"><div class="ptop" style="margin-bottom:8px"><h1>排課</h1><select class="btn sm" data-input="sbMonth">' + monthsAhead().map((x) => '<option' + (x === S.month ? ' selected' : '') + '>' + x + '</option>').join('') + '</select><span class="sp"></span>' +
        '<span class="sb-save mut">' + (S.saving ? '儲存中…' : dirty ? dirty + ' 格待儲存' : '草稿已儲存') + '</span>' +
        ui.btn(An.n ? '發布 ' + An.n + ' 格' : '發布', 'sbPublish', {}, 'pri sm') + '</div>' +
        '<div class="sb-tabs">' + vs.map((x) => { const c = An.cnt[str(x['據點ID'])] || {}; const n = (c.spec || 0) + (c.tpl || 0) + (c.game || 0); return '<button class="chip' + (str(x['據點ID']) === S.venue ? ' on' : '') + '" data-act="sbVenue" data-v="' + esc(x['據點ID']) + '">' + esc(x['據點名稱']) + '<span class="c">' + n + '</span>' + (c.issue ? '<span class="ci">' + c.issue + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        '<button class="sb-strip" data-act="sbStats"><span>專項<b>' + An.spec + '</b></span><span>期制<b>' + An.tpl + '</b></span><span>球敘<b>' + An.game + '</b></span><span class="' + (An.hard ? 'bad' : An.unnamed ? 'warn' : '') + '">待處理<b>' + An.issues.length + '</b></span></button></div>';

      const tm = venueTerms(S.venue);
      const kind = venueKind(S.venue);
      const courts = uniq(slots.reduce((a, s) => a.concat(split(s['使用場地'])), []));
      const specPrices = uniq(specs().map((x) => price(S.venue, str(x['專項ID'])))).sort((a, b) => b - a);
      const pbox = (b, l) => '<div class="pbox"><b>' + b + '</b><small>' + l + '</small></div>';
      const c = An.cnt[S.venue] || {};
      const vIssues = An.issues.filter((i) => str((PB.get('1_據點_時段', i.k.split('|')[0]) || {})['據點']) === S.venue);
      let card = '<div class="sb-vcard card"><div class="sb-vhead"><div><h2>' + esc(v['據點名稱']) + '</h2><div class="meta">' + esc([kind, str(v['區域']), str(v['地點']), courts.length + ' 面'].filter(Boolean).join('｜')) + '</div></div>' +
        '<div class="prices">' + (tm.rent ? pbox(tm.rent, tm.rentL) : '') + pbox(money(specPrices[0] || price(S.venue)), '專項／人／堂' + (specPrices.length > 1 ? '（部分 ' + money(specPrices[specPrices.length - 1]) + '）' : '')) + (tm.share ? pbox(tm.share, '球敘分潤 我方／合作方') : '') + '</div></div>' +
        '<div class="sb-vbody"><div class="sb-counts">' +
        '<span class="sb-k k-spec">專項 ' + (c.spec || 0) + '</span><span class="sb-k k-tpl">期制 ' + (c.tpl || 0) + ' 格</span><span class="sb-k k-game">球敘 ' + (c.game || 0) + '</span><span class="sb-k k-empty">空 ' + (c.empty || 0) + '</span><span class="sb-k k-lock">鎖定 ' + (c.lock || 0) + '</span>' + (c.issue ? '<span class="sb-k k-bad">待處理 ' + c.issue + '</span>' : '') + '</div>';
      if (c.legacy) card += '<div class="note">這個月有 ' + c.legacy + ' 場沒人報名的舊球敘草稿（格子顯示為空）。發布時，有排草稿的據點，這些舊草稿會一起取消；要辦球敘請在格子排「球敘」。</div>';
      if (str(v['注意事項'])) card += '<div class="note">' + esc(v['注意事項']) + '</div>';
      const tables = tableGroups(slots).map((g) => tableHtml(g, An)).join('');
      card += tables ? '<div class="sb-tables">' + tables + '</div>' : ui.empty(S.month + ' 沒有可用日', '請先在主檔「時段」產生並確認可用日');
      card += '<div class="sb-legend"><span><i class="lg lg-new"></i>專項</span><span><i class="lg lg-tpl"></i>期制課程</span><span><i class="lg lg-resv"></i>期制預訂（後續堂次）</span><span><i class="lg lg-game"></i>球敘</span><span><i class="lg lg-empty"></i>空</span><span><i class="lg lg-glock"></i>球敘已發布／有人報名</span><span><i class="lg lg-lock"></i>已有課程</span><span><i class="lg lg-bad"></i>待處理</span></div>';
      if (vIssues.length) card += '<div class="sb-todo"><h4>待處理 ' + vIssues.length + '</h4>' + vIssues.map((i) => '<button class="sb-todoi' + (i.soft ? ' soft' : '') + '" data-act="sbTodo" data-k="' + esc(i.k) + '">' + (i.soft ? '' : '<b>衝突　</b>') + esc(i.t) + '</button>').join('') + '</div>';
      card += '</div></div>';
      return '<div class="sb' + (S.placing ? ' placing' : '') + '">' + head + '<div class="sb-grid"><div class="sb-board">' + card + '</div>' + sideHtml(An, vs) + '</div>' + trayHtml() + '</div>';
    },
    after() { S.flash = ''; },
  };
  PB.schedScreen = Sched;
  window.addEventListener('beforeunload', (e) => { if (Object.keys(S.pending).length) { e.preventDefault(); e.returnValue = ''; } });

  PB.inputs.sbMonth = (val) => { flush(); S.month = val; PB.render(); };
  A.sbVenue = (d) => { S.venue = d.v; PB.render(); document.getElementById('main').scrollTop = 0; };
  A.sbPlace = (d) => { S.placing = S.placing === d.v ? '' : d.v; PB.render(); };
  A.sbTray = (d) => { S.tray = d.v; PB.render(); };
  A.sbTodo = (d) => { S.placing = ''; return A.sbCell(d); };

  function setDraft(k, vals) {
    const [slot, d, court] = k.split('|');
    const base = draftsAll()[k] || {};
    S.pending[k] = Object.assign({ 日期: d, 時段: slot, 球面: court }, base, vals, { del: false });
    schedule();
  }
  function clearDraft(k) {
    const saved = savedDrafts().find((r) => key(str(r['時段']), day(r['日期']), str(r['球面'])) === k);
    if (saved) S.pending[k] = { del: true, id: str(saved['排課ID']) };
    else delete S.pending[k];
    schedule();
  }
  /** 放上去：kind＋值（專項ID／模板ID／球敘類型）；保留同類的教練與人數 */
  function place(k, kind, val) {
    const cur = draftsAll()[k];
    const same = cur && kindOf(cur) === kind;
    if (kind === '專項') {
      const sp = PB.get('0_專項', val) || {};
      setDraft(k, { 用途: '專項', 專項: val, 課程模板: '', 球敘類型: '', 費用: '', 人數上限: same ? cur.人數上限 : num(sp['人數上限']) || 6, 人數下限: same ? cur.人數下限 : num(sp['人數下限']) || 5, 教練: cur && kindOf(cur) !== '球敘' ? cur.教練 : '' });
    } else if (kind === '期制') {
      const t = PB.get('0_課程模板', val) || {};
      setDraft(k, { 用途: '期制', 專項: '', 課程模板: val, 球敘類型: '', 費用: same && cur.課程模板 === val ? cur.費用 : '', 人數上限: num(t['人數上限']) || 6, 人數下限: num(t['人數下限']) || 5, 教練: cur && kindOf(cur) !== '球敘' ? cur.教練 : '' });
    } else {
      setDraft(k, { 用途: '球敘', 專項: '', 課程模板: '', 球敘類型: val, 費用: same ? cur.費用 : '', 人數上限: '', 人數下限: '', 教練: '' });
    }
  }

  A.sbCell = async (d) => {
    const k = d.k;
    const [slotId, dd, court] = k.split('|');
    const slot = PB.get('1_據點_時段', slotId);
    const M = model();
    const c = cellState(slot, dd, court, M);
    const where = fmtD(dd) + '・' + m.venueName(slot['據點']) + '・' + m.hm(slot['開始時間'], slot['結束時間']) + '・' + m.courtName(court);
    if (c.kind === 'resv') return A.sbCell({ k: c.resv.anchor });
    if (S.placing) {
      if (c.kind === 'lock') return ui.toast(c.why, 'bad');
      const kd = placingKind();
      if (!useOk(slot, court, kd)) return ui.toast('這一面沒有登記「' + (kd === '球敘' ? '球敘' : '課程') + '」用途', 'bad');
      place(k, kd, placingVal());
      S.flash = k;
      return PB.render();
    }
    if (c.kind === 'lock') return ui.modal({ title: c.label, body: '<p class="mut">' + esc(where) + '</p><div class="note">' + esc(c.why) + '</div>', actions: [{ label: '知道了' }] });
    if (c.kind !== 'draft') {
      const opts = [];
      if (c.course) specs().forEach((x) => opts.push({ l: '專項｜' + lvShort(x['程度']) + '｜' + str(x['專項名稱']), kd: '專項', v: str(x['專項ID']) }));
      if (c.course) templates().forEach((t) => opts.push({ l: '期制｜' + str(t['模板名稱']) + '（' + num(t['總堂數']) + ' 堂）', kd: '期制', v: str(t['模板ID']) }));
      if (c.game) GAME_TYPES.forEach((g) => opts.push({ l: '球敘｜' + g[1], kd: '球敘', v: g[0] }));
      if (!opts.length) return ui.toast('這一面沒有可排的用途', 'bad');
      const v = await ui.ask('空的球面', esc(where) + (c.legacy && c.legacy.length ? '<br>這格原本有沒人報名的舊球敘草稿，發布時會取消。' : ''), { fields: [{ k: 'pick', label: '要排什麼', t: 'enum', req: true, opts: opts.map((o) => o.l) }], ok: '放上去' });
      if (!v) return;
      const o = opts.find((x) => x.l === v.pick);
      if (o) { place(k, o.kd, o.v); S.flash = k; PB.render(); if (o.kd !== '專項') setTimeout(() => A.sbCell({ k: k }), 50); }
      return;
    }
    const x = c.draft;
    if (c.dk === '球敘') return editGame(k, slot, dd, court, x, where);
    return editClass(k, slot, dd, court, x, where, c.dk, M);
  };

  async function editClass(k, slot, dd, court, x, where, kd, M) {
    const coaches = coachList().map((o) => { const why = coachIssue(o.v, slot, k, x, M); return Object.assign(o, { why: why }); });
    const sr = kd === '期制' ? M.series[k] : null;
    const tpl = kd === '期制' ? PB.get('0_課程模板', x.課程模板) || {} : null;
    const pick = kd === '專項'
      ? '<div class="fld"><label>專項</label><select name="sp">' + specs().map((o) => '<option value="' + esc(o['專項ID']) + '"' + (str(o['專項ID']) === x.專項 ? ' selected' : '') + '>' + esc(lvShort(o['程度']) + '｜' + o['專項名稱']) + '</option>').join('') + '</select></div>'
      : '<div class="fld"><label>課程模板</label><select name="tpl">' + templates().map((o) => '<option value="' + esc(o['模板ID']) + '"' + (str(o['模板ID']) === x.課程模板 ? ' selected' : '') + '>' + esc(o['模板名稱'] + '（' + num(o['總堂數']) + ' 堂）') + '</option>').join('') + '</select></div>' +
        '<div class="sb-series"><b>上課日（' + sr.dates.length + '／' + sr.n + ' 堂）</b>' + sr.dates.map((d, i) => '<span class="' + (sr.pend.indexOf(d) >= 0 ? 'pend' : '') + '">' + (i + 1) + '. ' + esc(fmtD(d)) + (sr.pend.indexOf(d) >= 0 ? '（可用日待確認）' : '') + '</span>').join('') +
        (sr.short ? '<span class="bad">還差 ' + sr.short + ' 堂：可用日不足，請先產生並確認可用日</span>' : '') + (sr.clash ? '<span class="bad">' + esc(sr.clash) + '</span>' : '') + '<small>這一面接下來的可用日會被預訂到滿堂數（已有課程、球敘的日期略過）；發布後照期制規則招生（籌備中、開課前 7 天決定是否成班）。學員請假時，系統會在期末自動加補課堂。</small></div>';
    const body = '<p class="mut" style="margin:0 0 8px">' + esc(where) + '</p>' + pick +
      '<div class="fld"><label>教練</label><div class="sb-opts">' + coaches.map((o) => '<label class="sb-opt' + (o.why ? ' busy' : '') + '"><input type="radio" name="coach" value="' + esc(o.v) + '"' + (o.v === x.教練 ? ' checked' : '') + (o.why && o.v !== x.教練 ? ' disabled' : '') + '><span>' + esc(o.l) + '<small>' + esc(o.why || '可排') + '</small></span></label>').join('') +
      '<label class="sb-opt"><input type="radio" name="coach" value=""' + (!x.教練 ? ' checked' : '') + '><span>之後再派<small>由行政安排</small></span></label></div></div>' +
      '<div class="fld-row"><div class="fld"><label>人數下限</label><input type="number" name="min" min="1" max="12" value="' + (num(x.人數下限) || 5) + '"></div><div class="fld"><label>人數上限</label><input type="number" name="max" min="1" max="12" value="' + (num(x.人數上限) || 6) + '"></div></div>' +
      (kd === '期制' ? '<div class="fld"><label>費用（整期）</label><input type="number" name="fee" min="0" placeholder="' + esc(str(tpl['費用']) ? '模板 ' + num(tpl['費用']) : '') + '" value="' + esc(str(x.費用)) + '"><span class="hint">空白＝依課程模板</span></div>' : '');
    const read = (el) => {
      const v = { 教練: (el.querySelector('[name=coach]:checked') || {}).value || '', 人數下限: num(el.querySelector('[name=min]').value) || 5, 人數上限: num(el.querySelector('[name=max]').value) || 6 };
      if (kd === '專項') v.專項 = el.querySelector('[name=sp]').value;
      else { v.課程模板 = el.querySelector('[name=tpl]').value; v.費用 = el.querySelector('[name=fee]').value; }
      return v;
    };
    const actions = [{ label: '清除', kind: 'bad', value: 'clear' }];
    if (kd === '專項') actions.push({ label: '套用到每週同一面', click: (el) => { const v = read(el); if (v.人數下限 > v.人數上限) { ui.toast('下限大於上限', 'bad'); return false; } return { act: 'weekly', v: v }; } });
    actions.push({ label: '確定', kind: 'pri', click: (el) => { const v = read(el); if (v.人數下限 > v.人數上限) { ui.toast('下限大於上限', 'bad'); return false; } return { act: 'ok', v: v }; } });
    const r = await ui.modal({ title: (kd === '專項' ? '專項｜' : '期制課程｜') + draftName(x), body: body, sticky: true, actions: actions });
    if (!r) return;
    if (r === 'clear') { clearDraft(k); return PB.render(); }
    if (kd === '期制' && r.v.課程模板 !== x.課程模板) { const t = PB.get('0_課程模板', r.v.課程模板) || {}; r.v.人數上限 = num(t['人數上限']) || r.v.人數上限; r.v.人數下限 = num(t['人數下限']) || r.v.人數下限; }
    setDraft(k, r.v);
    if (r.act === 'weekly') weekly(k, slot, dd, court, Object.assign({ 用途: '專項' }, r.v));
    PB.render();
  }

  async function editGame(k, slot, dd, court, x, where) {
    const tpl = gameTpl(x.時段, x.日期);
    const body = '<p class="mut" style="margin:0 0 8px">' + esc(where) + '</p>' +
      '<div class="fld"><label>球敘類型</label><select name="type">' + GAME_TYPES.map((g) => '<option value="' + esc(g[0]) + '"' + (g[0] === (x.球敘類型 || '不限') ? ' selected' : '') + '>' + esc(g[1]) + '</option>').join('') + '</select></div>' +
      '<div class="fld"><label>費用（每人）</label><input type="number" name="fee" min="0" placeholder="' + esc(str(tpl['費用']) ? '同時段上一場 ' + num(tpl['費用']) : '') + '" value="' + esc(str(x.費用)) + '"><span class="hint">空白＝沿用同時段上一場' + (str(tpl['費用']) ? '（' + money(tpl['費用']) + '）' : '；沒有上一場，請填') + '</span></div>' +
      '<p class="mut" style="font-size:.8rem;margin:6px 0 0">同一天同時段、類型與費用相同的球敘格，發布時合成一場（人數上限＝各面人數相加），到開放報名時間自動開放；名稱、程度、計分沿用同時段上一場。</p>';
    const read = (el) => ({ 球敘類型: el.querySelector('[name=type]').value, 費用: el.querySelector('[name=fee]').value });
    const r = await ui.modal({
      title: '球敘｜' + gameName(x.球敘類型), body: body, sticky: true,
      actions: [
        { label: '清除', kind: 'bad', value: 'clear' },
        { label: '這天同時段全部球面', click: (el) => ({ act: 'row', v: read(el) }) },
        { label: '套用到每週同一面', click: (el) => ({ act: 'weekly', v: read(el) }) },
        { label: '確定', kind: 'pri', click: (el) => ({ act: 'ok', v: read(el) }) },
      ],
    });
    if (!r) return;
    if (r === 'clear') { clearDraft(k); return PB.render(); }
    setDraft(k, Object.assign({ 用途: '球敘' }, r.v));
    if (r.act === 'weekly') weekly(k, slot, dd, court, Object.assign({ 用途: '球敘' }, r.v));
    if (r.act === 'row') {
      let ok = 0, skip = 0;
      split(slot['使用場地']).forEach((cid) => {
        if (cid === court) return;
        const k2 = key(str(slot['時段ID']), dd, cid);
        const c2 = cellState(slot, dd, cid, model());
        if (c2.kind === 'lock' || c2.kind === 'resv' || !useOk(slot, cid, '球敘') || (c2.kind === 'draft' && c2.dk !== '球敘')) { skip += 1; return; }
        setDraft(k2, Object.assign({ 用途: '球敘', 專項: '', 課程模板: '', 人數上限: '', 人數下限: '', 教練: '' }, r.v));
        ok += 1;
      });
      ui.toast('已套用 ' + ok + ' 面' + (skip ? '，' + skip + ' 面已排其他或鎖定略過' : ''));
    }
    PB.render();
  }

  /** 套用到這個月每週同一面（專項、球敘） */
  function weekly(k, slot, dd, court, v) {
    let ok = 0, skip = 0, noCoach = 0;
    const kd = v.用途;
    slotDates(slot, S.month).forEach((o) => {
      if (o.d === dd) return;
      const k2 = key(str(slot['時段ID']), o.d, court);
      const M2 = model();
      const c2 = cellState(slot, o.d, court, M2);
      if (c2.kind === 'lock' || c2.kind === 'resv' || (c2.kind === 'draft' && (c2.dk !== kd || (kd === '專項' && c2.draft.專項 !== v.專項)))) { skip += 1; return; }
      if (kd === '專項') {
        const coachOk = v.教練 && !coachState(v.教練, slot, o.d, k2, M2);
        if (v.教練 && !coachOk) noCoach += 1;
        setDraft(k2, { 用途: '專項', 專項: v.專項, 課程模板: '', 球敘類型: '', 費用: '', 人數下限: v.人數下限, 人數上限: v.人數上限, 教練: coachOk ? v.教練 : '' });
      } else setDraft(k2, { 用途: '球敘', 專項: '', 課程模板: '', 球敘類型: v.球敘類型, 費用: v.費用, 人數上限: '', 人數下限: '', 教練: '' });
      ok += 1;
    });
    ui.toast('已套用 ' + ok + ' 週' + (skip ? '，' + skip + ' 週鎖定或已排其他略過' : '') + (noCoach ? '，' + noCoach + ' 週教練不能上、請另派' : ''));
  }

  // ---------------- 自動儲存 ----------------
  function schedule() {
    clearTimeout(S.timer);
    S.timer = setTimeout(flush, 1500);
  }
  async function flush() {
    clearTimeout(S.timer);
    if (S.saving) { S.timer = setTimeout(flush, 800); return; }
    const keys = Object.keys(S.pending);
    if (!keys.length) return true;
    const sent = {};
    keys.forEach((k) => { sent[k] = S.pending[k]; });
    const items = [];
    const removes = [];
    keys.forEach((k) => {
      const p = sent[k];
      if (p.del) { if (p.id) removes.push(p.id); return; }
      items.push({ k: k, id: p.id || '', 日期: p.日期, 時段: p.時段, 球面: p.球面, 用途: kindOf(p), 專項: p.專項 || '', 課程模板: p.課程模板 || '', 球敘類型: p.球敘類型 || '', 費用: str(p.費用), 人數上限: p.人數上限, 人數下限: p.人數下限, 教練: p.教練 || '' });
    });
    S.saving = true;
    PB.render();
    const out = await PB.runMany([{ op: 'schedSave', args: { items: items, removes: removes } }], { quiet: true });
    S.saving = false;
    if (!out) { schedule(); PB.render(); return false; }
    const res = out.results[0];
    if (!res.ok) { ui.toast(res.message, 'bad'); PB.render(); return false; }
    keys.forEach((k) => { if (S.pending[k] === sent[k]) delete S.pending[k]; });
    if (res.data.errors && res.data.errors.length) ui.toast('有 ' + res.data.errors.length + ' 格沒有儲存：' + res.data.errors.slice(0, 2).join('；'), 'bad', 8000);
    PB.render();
    return true;
  }

  // ---------------- 統計 ----------------
  A.sbStats = () => {
    const An = analyze();
    const rows = Object.keys(An.rows).map((k) => An.rows[k]).sort((a, b) => byKey(a.d + str(a.slot['開始時間']) + m.venueName(a.slot['據點']), b.d + str(b.slot['開始時間']) + m.venueName(b.slot['據點'])));
    const tb = rows.map((r) => '<tr><td class="num">' + MD(r.d) + '</td><td>' + esc(m.venueName(r.slot['據點'])) + '<br><span class="mut">' + esc(m.hm(r.slot['開始時間'], r.slot['結束時間'])) + '</span></td><td class="num">' + r.coach + (r.coach > r.named ? ' <span class="badge bad">缺 ' + (r.coach - r.named) + '</span>' : '') + '</td><td class="num">' + r.host + '</td></tr>').join('');
    ui.modal({
      title: S.month + ' 人力與統計',
      body: '<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">專項課</div><div class="v">' + An.spec + ' 堂</div></div><div class="kpi"><div class="l">期制課程</div><div class="v">' + An.tpl + ' 班</div></div><div class="kpi"><div class="l">球敘</div><div class="v">' + An.game + ' 面</div></div><div class="kpi"><div class="l">預估課程收入</div><div class="v" style="font-size:1.05rem">' + money(An.revMin) + '–' + money(An.revMax) + '</div></div></div>' +
        '<h4 style="margin:8px 0 4px">需要處理</h4>' + (An.issues.length ? '<div class="sb-issues">' + An.issues.map((i) => '<div class="sb-issue' + (i.soft ? ' soft' : '') + '">' + (i.soft ? '' : '<b>衝突　</b>') + esc(i.t) + '</div>').join('') + '</div>' : '<div class="note">沒有衝突，教練都已指定</div>') +
        '<h4 style="margin:12px 0 4px">各時段人力</h4><p class="mut" style="font-size:.8rem;margin:0 0 4px">教練＝已排課程（含期制預訂）；場主＝有球敘的時段各 1 位</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>據點・時段</th><th class="num">教練</th><th class="num">場主</th></tr></thead><tbody>' + (tb || '<tr><td colspan="4" class="mut">—</td></tr>') + '</tbody></table></div>',
      actions: [{ label: '關閉' }],
    });
  };

  // ---------------- 發布 ----------------
  function defaultOpenAt() {
    const [y, mo] = S.month.split('-').map(Number);
    const py = mo === 1 ? y - 1 : y;
    const pm = mo === 1 ? 12 : mo - 1;
    const d = py + '-' + ('0' + pm).slice(-2) + '-' + ('0' + (PB.cfg.openDay || 25)).slice(-2) + 'T' + (PB.cfg.openTime || '12:00');
    if (d.replace('T', ' ') > PB.nowText()) return d;
    return addDays(today(), 1) + 'T' + (PB.cfg.openTime || '12:00');
  }
  A.sbPublish = async () => {
    if (Object.keys(S.pending).length && !(await flush())) return;
    const An = analyze();
    if (!An.n) return ui.toast(S.month + ' 沒有草稿', 'bad');
    const kpi = (l, v, neg) => '<div class="kpi' + (neg ? ' neg' : '') + '"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>';
    const body = '<p class="mut" style="margin:0 0 8px">發布前系統會再檢查一次：有人剛報名的球敘不會被取代、可用日沒確認或教練不能上的格子會略過。</p>' +
      '<div class="kpis" style="margin-bottom:10px">' + kpi('專項課', An.spec + ' 堂') + kpi('期制課程', An.tpl + ' 班（' + An.tplSes + ' 堂）') + kpi('球敘', An.game + ' 面') + kpi('衝突', An.hard, An.hard) + '</div>' +
      (An.sweep ? '<div class="note warn">有排草稿的據點，這個月沒人報名的舊球敘草稿 ' + An.sweep + ' 場會一起取消（看板全權決定）。</div>' : '') +
      (An.hard ? '<div class="note warn">還有 ' + An.hard + ' 格衝突，發布時會略過（點上方統計看是哪幾格）。</div>' : '') +
      (An.unnamed ? '<div class="note">未指定教練的課可以先發布，之後由行政在營運工作台「換教練」。</div>' : '') +
      (An.notReady ? '<div class="note warn">有 ' + An.notReady + ' 格的可用日還沒確認，會略過。</div>' : '') +
      '<div class="fld" style="margin-top:10px"><label>開放報名時間</label><input type="datetime-local" name="openAt" value="' + defaultOpenAt() + '"><span class="hint">課程與球敘都到這個時間才讓學員看到並報名（規則：每月 ' + (PB.cfg.openDay || 25) + ' 日 ' + (PB.cfg.openTime || '12:00') + ' 公告下月）。期制課程照期制規則：籌備中、開課前 7 天決定是否成班。</span></div>';
    const r = await ui.modal({ title: '發布 ' + S.month + ' 排課', body: body, sticky: true, actions: [{ label: '再看看' }, { label: '確認發布', kind: 'pri', click: (el) => { const v = el.querySelector('[name=openAt]').value; if (!v) { ui.toast('請填開放報名時間', 'bad'); return false; } return v.replace('T', ' '); } }] });
    if (!r) return;
    const skipped = [];
    let nc = 0, ng = 0, swept = 0;
    let guard = 0;
    for (;;) {
      ui.toast('發布中…已完成 ' + (nc + ng) + ' 筆', '', 2500);
      const out = await PB.runMany([{ op: 'schedPublish', args: { month: S.month, openAt: r, skip: skipped.map((x) => x.id) } }], { quiet: true });
      if (!out) break;
      const res = out.results[0];
      if (!res.ok) { ui.toast(res.message, 'bad'); break; }
      nc += (res.data.classes || []).length;
      ng += (res.data.games || []).length;
      swept += res.data.swept || 0;
      res.data.skipped.forEach((x) => skipped.push(x));
      if (!res.data.left || guard++ > 30) break;
    }
    const rows = skipped.map((x) => { const d = PB.get(T, x.id) || {}; const s = PB.get('1_據點_時段', d['時段']) || {}; const dx = { 用途: d['用途'], 專項: d['專項'], 課程模板: d['課程模板'], 球敘類型: d['球敘類型'] }; return '<li>' + esc(fmtD(d['日期']) + ' ' + m.venueName(s['據點']) + ' ' + m.hm(s['開始時間']) + ' ' + m.courtName(d['球面']) + '「' + draftName(dx) + '」') + '：' + esc(x.why) + '</li>'; }).join('');
    ui.modal({ title: '發布結果', body: '<p>已發布課程 <b>' + nc + '</b> 班、球敘 <b>' + ng + '</b> 場，' + esc(r) + ' 開放報名。' + (swept ? '取消舊球敘草稿 ' + swept + ' 場。' : '') + (nc + ng ? '學員看到前可以在營運工作台「課程」「球敘」核對。' : '') + '</p>' + (rows ? '<div class="note warn">沒有發布 ' + skipped.length + ' 格（留在草稿，調整後可再發布）：<ul style="margin:6px 0 0;padding-left:18px">' + rows + '</ul></div>' : ''), actions: [{ label: '好' }] });
  };
})();
