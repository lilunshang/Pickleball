/**
 * 理論上匹克球｜管理後台：專項排課看板 sched.js v2.4（2026/10/26：預估營收依專項費用、程度名稱不重複 L）
 * 手機為主：上方選月份、據點 → 每天一張卡、每個時段一列球面格子 → 下方專項列
 *   點專項 → 點格子放上去；點已放的格子 → 指定教練、人數、換專項、套用每週、清除
 *   格子：空（可排）／球敘草稿（沒人報名，可轉；發布時取消那場草稿）／鎖定（已有課程、已開放或有人報名的球敘、只限球敘的球面）
 *   草稿自動存到 2_排課草稿（停手 1.5 秒後送出，一次一個請求）
 *   發布：重新檢查（避免球敘剛有人報名）後建立單堂專項課＋上課場次，開放報名時間到了學員才看得到
 * 看板不新增據點或時段（特助在「主檔與紀錄」維護）。
 */
(function () {
  'use strict';
  const { esc, str, split, num, money, today, addDays, fmtD, fmtDT, day, wd, sum, uniq, byKey, ui, m } = PB;
  const A = PB.acts;
  const T = '2_排課草稿';
  const S = { month: '', venue: '', placing: '', pending: {}, saving: false, timer: null, flash: '' };
  const WEEK = '一二三四五六日';

  // ---------------- 小工具 ----------------
  const key = (slot, d, court) => slot + '|' + d + '|' + court;
  const mins = (t) => { const x = str(t).match(/(\d{1,2}):(\d{2})/); if (!x) return 0; const v = +x[1] * 60 + +x[2]; return v === 23 * 60 + 59 ? 1440 : v; };
  const overlap = (s1, e1, s2, e2) => mins(s1) < mins(e2) && mins(s2) < mins(e1);
  const monthsAhead = () => { const out = []; let y = +today().slice(0, 4); let mo = +today().slice(5, 7); for (let i = 0; i < 4; i++) { out.push(y + '-' + ('0' + mo).slice(-2)); mo += 1; if (mo > 12) { mo = 1; y += 1; } } return out; };
  const nextMonth = () => monthsAhead()[1];
  const venueKind = (vid) => { const v = PB.get('1_據點', vid) || {}; return str(v['據點類別']) || (/國小|國中|高中|大學|科大|學校|中學/.test(str(v['據點名稱'])) ? '學校' : '球館'); };
  const price = (vid, specId) => { const own = num((PB.get('0_專項', specId) || {})['費用']); if (own > 0) return own; const p = PB.cfg.specPrice || { 學校: 1000, 球館: 1200 }; return num(p[venueKind(vid)]) || 1000; }; // v2.4：專項有填費用就用它
  const specs = () => PB.rows('0_專項').filter((s) => s['是否啟用'] !== false).sort((a, b) => byKey(('000' + num((PB.get('0_程度', a['程度']) || {})['排序'])).slice(-3) + str(a['專項名稱']), ('000' + num((PB.get('0_程度', b['程度']) || {})['排序'])).slice(-3) + str(b['專項名稱'])));
  const lvIdx = (lv) => { const list = uniq(specs().map((s) => str(s['程度']))); const i = list.indexOf(str(lv)); return i < 0 ? 0 : i % 3; };
  const lvShort = (lv) => { const r = PB.get('0_程度', lv); if (!r) return '未分程度'; const nm = str(r['程度名稱']); return /^L\d/.test(nm) || !str(r['排序']) ? nm : 'L' + num(r['排序']) + ' ' + nm; }; // v2.4：程度名稱已含 L1～L3 就不重複加
  const coachList = () => PB.rows('1_人員_教練').filter((c) => ['在職', ''].indexOf(str((PB.get('1_人員', c['人員ID']) || {})['在職狀態'])) >= 0).map((c) => ({ v: str(c['人員ID']), l: m.staffName(c['人員ID']) })).sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));

  /** 這個據點有課程用途的時段（使用中） */
  function venueSlots(vid) {
    return PB.rows('1_據點_時段').filter((s) => str(s['據點']) === vid && ['使用中', ''].indexOf(str(s['狀態'])) >= 0)
      .sort((a, b) => byKey(WEEK.indexOf(str(a['星期'])) + str(a['開始時間']), WEEK.indexOf(str(b['星期'])) + str(b['開始時間'])));
  }
  /** 有可以排課的球面的據點 */
  function venues() {
    return PB.rows('1_據點').filter((v) => ['合作中', '籌備中', ''].indexOf(str(v['狀態'])) >= 0 && venueSlots(str(v['據點ID'])).length)
      .sort((a, b) => byKey(str(a['據點名稱']), str(b['據點名稱'])));
  }
  /** 時段在這個月的日期（可用＋待確認；今天以後） */
  function slotDates(slot, month) {
    return (PB.ix.availBySlot[str(slot['時段ID'])] || []).filter((a) => day(a['日期']).slice(0, 7) === month && day(a['日期']) >= today() && ['可用', '待確認'].indexOf(str(a['狀態'])) >= 0)
      .map((a) => ({ d: day(a['日期']), ok: str(a['狀態']) === '可用' }));
  }

  // ---------------- 草稿（已存＋還沒存的變更） ----------------
  function savedDrafts() {
    return PB.rows(T).filter((r) => str(r['狀態']) === '草稿' && day(r['日期']).slice(0, 7) === S.month);
  }
  /** key → 草稿（合併本機還沒存的）；del 的不列 */
  function drafts() {
    const out = {};
    savedDrafts().forEach((r) => { out[key(str(r['時段']), day(r['日期']), str(r['球面']))] = { id: str(r['排課ID']), 日期: day(r['日期']), 時段: str(r['時段']), 球面: str(r['球面']), 專項: str(r['專項']), 人數上限: r['人數上限'], 人數下限: r['人數下限'], 教練: str(r['教練']) }; });
    Object.keys(S.pending).forEach((k) => {
      const p = S.pending[k];
      if (p.del) delete out[k];
      else out[k] = Object.assign({}, out[k] || {}, p);
    });
    return out;
  }

  /** 一格目前的狀態：{ kind: empty|draft|gdraft|lock, why, label, sub, draft, games } */
  function cellState(slot, d, courtId, D) {
    const k = key(str(slot['時段ID']), d, courtId);
    const court = PB.get('1_據點_場地', courtId) || {};
    const st = str(slot['開始時間']);
    const en = str(slot['結束時間']);
    const sess = (PB.ix.sesByDay[d] || []).filter((s) => str(s['使用場地']) === courtId && ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0 && overlap(st, en, s['開始時間'], s['結束時間']));
    if (sess.length) {
      const c = PB.get('2_課程班級', sess[0]['班級']);
      const single = m.isSingle(c);
      return { kind: 'lock', course: true, single: single, label: c ? str(c['課程名稱']) : '課程', sub: single ? '專項・已發布' : '期制 ' + str(c && c['期別']), why: '已有課程「' + (c ? m.classLabel(c) : '') + '」，要調整請到營運工作台的課程處理。', cls: c };
    }
    const games = (PB.ix.gameByDay[d] || []).filter((g) => str(g['狀態']) !== '取消' && split(g['使用場地']).indexOf(courtId) >= 0 && overlap(st, en, g['開始時間'], g['結束時間']));
    const types = split(court['類型']);
    const typeOk = (!types.length || types.indexOf('課程') >= 0) && (!split(slot['用途']).length || split(slot['用途']).indexOf('課程') >= 0);
    if (games.length) {
      const g = games[0];
      const x = m.game(g);
      const n = x.active.length + x.wait.length + x.walkin.length;
      const name = str(g['球敘類型']) === '新手場' ? '新手場球敘' : str(g['球敘類型']) === 'DUPR' ? 'DUPR 球敘' : str(g['球敘類型']) === '分級' ? '分級球敘' : '一般球敘';
      if (x.st !== '草稿' || n) return { kind: 'lock', game: true, label: name, sub: x.st === '草稿' ? '草稿・' + n + ' 人' : x.st + ' ' + x.active.length + ' 人', why: x.st === '草稿' ? '這場球敘草稿已有 ' + n + ' 人報名，不能轉成專項課。' : '這場球敘已開放報名（' + x.active.length + ' 人），不能轉成專項課。' };
      if (D[k]) return { kind: 'draft', draft: D[k], games: games, typeOk: typeOk };
      if (!typeOk) return { kind: 'lock', game: true, label: name, sub: '只限球敘', why: '這一面只登記「球敘」用途，不能排課。要改用途請在主檔調整。' };
      return { kind: 'gdraft', label: name, sub: '草稿・可轉', games: games };
    }
    if (!typeOk) return { kind: 'lock', label: '只限球敘', sub: '', why: '這一面只登記「球敘」用途，不能排課。要改用途請在主檔調整。' };
    if (D[k]) return { kind: 'draft', draft: D[k] };
    return { kind: 'empty' };
  }

  /** 教練在這一格能不能排：不可排日期、同時段已有課（含其他草稿） */
  function coachState(coachId, slot, d, k, D) {
    if (!coachId) return '';
    const un = PB.rows('2_教練不可排日期').find((r) => str(r['教練']) === coachId && day(r['開始日期']) && day(r['開始日期']) <= d && (day(r['結束日期']) || day(r['開始日期'])) >= d);
    if (un) return '登記不可排';
    const st = str(slot['開始時間']);
    const en = str(slot['結束時間']);
    const s = (PB.ix.sesByDay[d] || []).find((x) => str(x['授課教練']) === coachId && ['取消', '改期'].indexOf(str(x['場次狀態'])) < 0 && overlap(st, en, x['開始時間'], x['結束時間']));
    if (s) return '已排 ' + m.venueName(s['據點']);
    const other = Object.keys(D).find((k2) => {
      if (k2 === k) return false;
      const x = D[k2];
      if (x.教練 !== coachId || x.日期 !== d) return false;
      const s2 = PB.get('1_據點_時段', x.時段);
      return s2 && overlap(st, en, s2['開始時間'], s2['結束時間']);
    });
    if (other) { const x = D[other]; return '已排 ' + m.venueName((PB.get('1_據點_時段', x.時段) || {})['據點']) + ' ' + m.courtName(x.球面); }
    return '';
  }

  // ---------------- 統計 ----------------
  function analyze() {
    const D = drafts();
    const out = { n: 0, min: 0, max: 0, revMin: 0, revMax: 0, conv: 0, issues: [], conf: {}, rows: {}, peak: 0, unnamed: 0, hard: 0, notReady: 0, byVenue: {} };
    Object.keys(D).forEach((k) => {
      const x = D[k];
      const slot = PB.get('1_據點_時段', x.時段);
      if (!slot) return;
      const vid = str(slot['據點']);
      const where = fmtD(x.日期) + ' ' + m.venueName(vid) + ' ' + m.hm(slot['開始時間']) + ' ' + m.courtName(x.球面);
      const c = cellState(slot, x.日期, x.球面, D);
      out.n += 1;
      out.byVenue[vid] = (out.byVenue[vid] || 0) + 1;
      const mn = num(x.人數下限) || 5;
      const mx = num(x.人數上限) || 6;
      out.min += mn; out.max += mx; out.revMin += mn * price(vid, x.專項); out.revMax += mx * price(vid, x.專項);
      if (c.games) out.conv += 1;
      const avail = (PB.ix.availBySlot[str(x.時段)] || []).find((a) => day(a['日期']) === x.日期);
      if (!avail || str(avail['狀態']) !== '可用') { out.notReady += 1; out.issues.push({ k: k, t: where + '：這天的可用日還沒確認', soft: true }); }
      if (c.kind === 'lock') { out.hard += 1; out.conf[k] = 1; out.issues.push({ k: k, t: where + '：' + c.why }); }
      if (!x.教練) { out.unnamed += 1; out.issues.push({ k: k, t: where + '「' + m.specName(x.專項) + '」還沒指定教練', soft: true }); }
      else { const why = coachState(x.教練, slot, x.日期, k, D); if (why) { out.hard += 1; out.conf[k] = 1; out.issues.push({ k: k, t: where + '：' + m.staffName(x.教練) + ' ' + why }); } }
    });
    // 各日期時段需要的人力（只看看板上的據點時段）
    venues().forEach((v) => venueSlots(str(v['據點ID'])).forEach((slot) => slotDates(slot, S.month).forEach((dd) => {
      const rk = dd.d + '|' + str(slot['時段ID']);
      const r = (out.rows[rk] = { d: dd.d, slot: slot, coach: 0, named: 0, host: 0 });
      split(slot['使用場地']).forEach((cid) => {
        const c = cellState(slot, dd.d, cid, D);
        if (c.kind === 'draft') { r.coach += 1; if (c.draft.教練) r.named += 1; }
        if (c.course) { r.coach += 1; r.named += 1; }
        if (c.game || c.kind === 'gdraft') r.host = 1;
      });
      if (!r.coach && !r.host) delete out.rows[rk];
    })));
    const perDay = {};
    Object.keys(out.rows).forEach((k) => { const r = out.rows[k]; perDay[r.d] = (perDay[r.d] || 0) + r.coach; });
    out.peak = Math.max(0, ...Object.keys(perDay).map((d) => perDay[d]));
    out.D = D;
    return out;
  }

  // ---------------- 畫面 ----------------
  function cellHtml(slot, d, cid, D, An) {
    const k = key(str(slot['時段ID']), d, cid);
    const c = cellState(slot, d, cid, D);
    const cn = esc(m.courtName(cid));
    const can = c.kind === 'empty' || c.kind === 'gdraft' || c.kind === 'draft';
    const cls = ['sb-cell'];
    let nm = '';
    let meta = '';
    if (c.kind === 'draft') {
      const sp = PB.get('0_專項', c.draft.專項) || {};
      cls.push('new', 'lv' + lvIdx(sp['程度']));
      nm = esc(sp['專項名稱'] || '（專項已刪除）');
      meta = c.draft.教練 ? esc(m.staffName(c.draft.教練)) + '・' + (num(c.draft.人數下限) || 5) + '–' + (num(c.draft.人數上限) || 6) + '人' : '未指定教練';
      if (!c.draft.教練) cls.push('nocoach');
      if (An.conf[k]) cls.push('conf');
      if (S.pending[k]) cls.push('dirty');
      if (c.games) meta += '<br>取代球敘草稿';
    } else if (c.kind === 'gdraft') { cls.push('gath', 'draftg'); nm = esc(c.label); meta = esc(c.sub); }
    else if (c.kind === 'lock') { cls.push('lock'); if (c.game) cls.push('gath'); nm = esc(c.label); meta = esc(c.sub); }
    else { cls.push('sb-empty'); nm = '空・可排'; }
    if (can && S.placing) cls.push('can');
    if (S.flash === k) cls.push('flash');
    return '<button class="' + cls.join(' ') + '" data-act="sbCell" data-k="' + esc(k) + '"><span class="cc">' + cn + (c.kind === 'lock' ? ' <span class="lk">🔒</span>' : '') + '</span><span class="nm">' + nm + '</span><span class="meta">' + meta + '</span></button>';
  }

  const Sched = {
    id: 'sched', label: '排課', icon: 'grid',
    show: () => PB.has(T) && PB.has('0_專項'),
    render(p) {
      if (!S.month) S.month = p.m || nextMonth();
      const vs = venues();
      if (!vs.length) return '<div class="ptop"><h1>專項排課</h1></div>' + '<div class="card">' + ui.empty('沒有可以排課的據點', '請先在主檔設定據點、時段與可用日') + '</div>';
      if (!S.venue || !vs.some((v) => str(v['據點ID']) === S.venue)) S.venue = str(vs[0]['據點ID']);
      const An = analyze();
      const D = An.D;
      const sp = specs();
      const v = PB.get('1_據點', S.venue);
      const slots = venueSlots(S.venue);
      const dates = uniq(slots.reduce((a, s) => a.concat(slotDates(s, S.month).map((x) => x.d)), [])).sort();
      const dirty = Object.keys(S.pending).length;
      const head = '<div class="sb-head"><div class="ptop" style="margin-bottom:8px"><h1>專項排課</h1><select class="btn sm" data-input="sbMonth">' + monthsAhead().map((x) => '<option' + (x === S.month ? ' selected' : '') + '>' + x + '</option>').join('') + '</select><span class="sp"></span>' +
        '<span class="sb-save mut">' + (S.saving ? '儲存中…' : dirty ? '有 ' + dirty + ' 格未儲存' : '草稿已儲存') + '</span>' +
        ui.btn('發布', 'sbPublish', {}, 'pri sm') + '</div>' +
        '<div class="sb-tabs">' + vs.map((x) => { const n = An.byVenue[str(x['據點ID'])] || 0; return '<button class="chip' + (str(x['據點ID']) === S.venue ? ' on' : '') + '" data-act="sbVenue" data-v="' + esc(x['據點ID']) + '">' + esc(x['據點名稱']) + (n ? '<span class="c">' + n + '</span>' : '') + '</button>'; }).join('') + '</div>' +
        '<button class="sb-strip" data-act="sbStats"><span>專項<b>' + An.n + '</b></span><span>名額<b>' + An.max + '</b></span><span>單日最多教練<b>' + An.peak + '</b></span><span class="' + (An.hard ? 'bad' : An.unnamed ? 'warn' : '') + '">待處理<b>' + (An.hard + An.unnamed) + '</b></span></button></div>';
      let board = '<div class="sb-legend"><span><i class="lg lg-new"></i>專項課</span><span><i class="lg lg-gath"></i>球敘草稿（可轉）</span><span><i class="lg lg-lock"></i>鎖定</span><span><i class="lg lg-empty"></i>空</span><span>' + esc(venueKind(S.venue)) + ' ' + money(price(S.venue)) + '／人（專項有填費用者依專項）</span></div>';
      if (v && str(v['注意事項'])) board += '<div class="note" style="margin-bottom:8px">' + esc(v['注意事項']) + '</div>';
      if (!dates.length) board += '<div class="card">' + ui.empty(S.month + ' 沒有可用日', '請先在主檔「時段」產生並確認可用日') + '</div>';
      dates.forEach((d) => {
        const ss = slots.filter((s) => slotDates(s, S.month).some((x) => x.d === d));
        let coach = 0, host = 0;
        ss.forEach((s) => { const r = An.rows[d + '|' + str(s['時段ID'])]; if (r) { coach += r.coach; host += r.host; } });
        board += '<section class="sb-day"><div class="sb-dayh"><span class="d">' + (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '</span><span class="w">週' + wd(d) + '</span><span class="need">教練 <b>' + coach + '</b>・場主 <b>' + host + '</b></span></div>';
        ss.forEach((s) => {
          const ok = slotDates(s, S.month).find((x) => x.d === d).ok;
          const courts = split(s['使用場地']);
          const n = courts.filter((cid) => D[key(str(s['時段ID']), d, cid)]).length;
          board += '<div class="sb-slot"><div class="t"><span class="num">' + esc(m.hm(s['開始時間'], s['結束時間'])) + '</span>' + (ok ? '' : '<span class="badge warn">可用日待確認</span>') + '<span>專項 ' + n + ' 堂</span></div><div class="sb-courts" style="grid-template-columns:repeat(' + Math.max(courts.length, 2) + ',minmax(0,1fr))">' +
            courts.map((cid) => cellHtml(s, d, cid, D, An)).join('') + '</div></div>';
        });
        board += '</section>';
      });
      const tray = '<div class="sb-tray"><div class="sb-trayh"><span>' + (S.placing ? '放置中：<b>' + esc(m.specName(S.placing)) + '</b>，點黃框的球面' : '專項（點一下進入放置模式）') + '</span>' + (S.placing ? '<button class="btn sm ghost" data-act="sbPlace" data-v="">結束放置</button>' : '') + '</div>' +
        '<div class="sb-chips">' + (sp.length ? sp.map((x) => '<button class="sb-chip lv' + lvIdx(x['程度']) + (S.placing === str(x['專項ID']) ? ' on' : '') + '" data-act="sbPlace" data-v="' + esc(x['專項ID']) + '"><small>' + esc(lvShort(x['程度'])) + '</small><span>' + esc(x['專項名稱']) + '</span></button>').join('') : '<span class="mut">還沒有專項：請到「主檔與紀錄 → 專項」新增</span>') + '</div></div>';
      return '<div class="sb' + (S.placing ? ' placing' : '') + '">' + head + '<div class="sb-board">' + board + '</div>' + tray + '</div>';
    },
    after() { S.flash = ''; },
  };
  PB.schedScreen = Sched;
  window.addEventListener('beforeunload', (e) => { if (Object.keys(S.pending).length) { e.preventDefault(); e.returnValue = ''; } });

  PB.inputs.sbMonth = (val) => { flush(); S.month = val; S.pending = {}; PB.render(); };
  A.sbVenue = (d) => { S.venue = d.v; PB.render(); document.getElementById('main').scrollTop = 0; };
  A.sbPlace = (d) => { S.placing = S.placing === d.v ? '' : d.v; PB.render(); };

  function setDraft(k, vals) {
    const [slot, d, court] = k.split('|');
    const base = drafts()[k] || {};
    S.pending[k] = Object.assign({ 日期: d, 時段: slot, 球面: court }, base, vals, { del: false });
    schedule();
  }
  function clearDraft(k) {
    const saved = savedDrafts().find((r) => key(str(r['時段']), day(r['日期']), str(r['球面'])) === k);
    if (saved) S.pending[k] = { del: true, id: str(saved['排課ID']) };
    else delete S.pending[k];
    schedule();
  }
  function placeSpec(k, specId) {
    const sp = PB.get('0_專項', specId) || {};
    const cur = drafts()[k];
    setDraft(k, { 專項: specId, 人數上限: cur ? cur.人數上限 : num(sp['人數上限']) || 6, 人數下限: cur ? cur.人數下限 : num(sp['人數下限']) || 5, 教練: cur ? cur.教練 : '' });
  }

  A.sbCell = async (d) => {
    const k = d.k;
    const [slotId, dd, court] = k.split('|');
    const slot = PB.get('1_據點_時段', slotId);
    const D = drafts();
    const c = cellState(slot, dd, court, D);
    const where = fmtD(dd) + '・' + m.venueName(slot['據點']) + '・' + m.hm(slot['開始時間'], slot['結束時間']) + '・' + m.courtName(court);
    if (S.placing) {
      if (c.kind === 'lock') return ui.toast(c.why, 'bad');
      placeSpec(k, S.placing);
      S.flash = k;
      return PB.render();
    }
    if (c.kind === 'lock') return ui.modal({ title: c.label, body: '<p class="mut">' + esc(where) + '</p><div class="note">' + esc(c.why) + '</div>', actions: [{ label: '知道了' }] });
    const sp = specs();
    if (c.kind !== 'draft') {
      const v = await ui.ask(c.kind === 'gdraft' ? '球敘草稿：' + c.label : '空的球面', esc(where) + (c.kind === 'gdraft' ? '<br>這場球敘還沒開放、沒人報名，可以改排專項課；發布後這場球敘草稿會取消。' : ''), { fields: [{ k: 'sp', label: '排專項課', t: 'enum', req: true, opts: sp.map((x) => lvShort(x['程度']) + '｜' + str(x['專項名稱'])) }], ok: '放上去' });
      if (!v) return;
      const pick = sp.find((x) => lvShort(x['程度']) + '｜' + str(x['專項名稱']) === v.sp);
      if (pick) { placeSpec(k, str(pick['專項ID'])); S.flash = k; PB.render(); }
      return;
    }
    const x = c.draft;
    const coaches = coachList().map((o) => { const why = coachState(o.v, slot, dd, k, D); return Object.assign(o, { why: why, l2: o.l + (why ? '（' + why + '）' : '') }); });
    const body = '<p class="mut" style="margin:0 0 8px">' + esc(where) + (c.games ? '<br>發布後會取消這格原本的球敘草稿' : '') + '</p>' +
      '<div class="fld"><label>專項</label><select name="sp">' + sp.map((o) => '<option value="' + esc(o['專項ID']) + '"' + (str(o['專項ID']) === x.專項 ? ' selected' : '') + '>' + esc(lvShort(o['程度']) + '｜' + o['專項名稱']) + '</option>').join('') + '</select></div>' +
      '<div class="fld"><label>教練</label><div class="sb-opts">' + coaches.map((o) => '<label class="sb-opt' + (o.why ? ' busy' : '') + '"><input type="radio" name="coach" value="' + esc(o.v) + '"' + (o.v === x.教練 ? ' checked' : '') + (o.why && o.v !== x.教練 ? ' disabled' : '') + '><span>' + esc(o.l) + '<small>' + esc(o.why || '可排') + '</small></span></label>').join('') +
      '<label class="sb-opt"><input type="radio" name="coach" value=""' + (!x.教練 ? ' checked' : '') + '><span>之後再派<small>由行政安排</small></span></label></div></div>' +
      '<div class="fld-row"><div class="fld"><label>人數下限</label><input type="number" name="min" min="1" max="12" value="' + (num(x.人數下限) || 5) + '"></div><div class="fld"><label>人數上限</label><input type="number" name="max" min="1" max="12" value="' + (num(x.人數上限) || 6) + '"></div></div>';
    const read = (el) => ({ 專項: el.querySelector('[name=sp]').value, 教練: (el.querySelector('[name=coach]:checked') || {}).value || '', 人數下限: num(el.querySelector('[name=min]').value) || 5, 人數上限: num(el.querySelector('[name=max]').value) || 6 });
    const r = await ui.modal({
      title: m.specName(x.專項) || '專項課', body: body, sticky: true,
      actions: [
        { label: c.games ? '還原成球敘草稿' : '清除', kind: 'bad', value: 'clear' },
        { label: '套用到每週同一面', click: (el) => { const v = read(el); if (v.人數下限 > v.人數上限) { ui.toast('下限大於上限', 'bad'); return false; } return { act: 'weekly', v: v }; } },
        { label: '確定', kind: 'pri', click: (el) => { const v = read(el); if (v.人數下限 > v.人數上限) { ui.toast('下限大於上限', 'bad'); return false; } return { act: 'ok', v: v }; } },
      ],
    });
    if (!r) return;
    if (r === 'clear') { clearDraft(k); return PB.render(); }
    setDraft(k, r.v);
    if (r.act === 'weekly') {
      let ok = 0, skip = 0, noCoach = 0;
      slotDates(slot, S.month).forEach((o) => {
        if (o.d === dd) return;
        const k2 = key(slotId, o.d, court);
        const D2 = drafts();
        const c2 = cellState(slot, o.d, court, D2);
        if (c2.kind === 'lock' || (c2.kind === 'draft' && c2.draft.專項 !== r.v.專項 && c2.draft.專項)) { skip += 1; return; }
        const coachOk = r.v.教練 && !coachState(r.v.教練, slot, o.d, k2, D2);
        if (r.v.教練 && !coachOk) noCoach += 1;
        setDraft(k2, { 專項: r.v.專項, 人數下限: r.v.人數下限, 人數上限: r.v.人數上限, 教練: coachOk ? r.v.教練 : '' });
        ok += 1;
      });
      ui.toast('已套用 ' + ok + ' 週' + (skip ? '，' + skip + ' 週鎖定或已排其他專項略過' : '') + (noCoach ? '，' + noCoach + ' 週教練不能上、請另派' : ''));
    }
    PB.render();
  };

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
      items.push({ k: k, id: p.id || '', 日期: p.日期, 時段: p.時段, 球面: p.球面, 專項: p.專項, 人數上限: p.人數上限, 人數下限: p.人數下限, 教練: p.教練 || '' });
    });
    S.saving = true;
    PB.render();
    const out = await PB.runMany([{ op: 'schedSave', args: { items: items, removes: removes } }], { quiet: true });
    S.saving = false;
    if (!out) { schedule(); PB.render(); return false; }
    const res = out.results[0];
    if (!res.ok) { ui.toast(res.message, 'bad'); PB.render(); return false; }
    // 送出後又改過的格子保留，其餘清掉
    keys.forEach((k) => { if (S.pending[k] === sent[k]) delete S.pending[k]; });
    if (res.data.errors && res.data.errors.length) ui.toast('有 ' + res.data.errors.length + ' 格沒有儲存：' + res.data.errors.slice(0, 2).join('；'), 'bad', 8000);
    PB.render();
    return true;
  }

  // ---------------- 統計 ----------------
  A.sbStats = () => {
    const An = analyze();
    const rows = Object.keys(An.rows).map((k) => An.rows[k]).sort((a, b) => byKey(a.d + str(a.slot['開始時間']) + m.venueName(a.slot['據點']), b.d + str(b.slot['開始時間']) + m.venueName(b.slot['據點'])));
    const tb = rows.map((r) => '<tr><td class="num">' + (+r.d.slice(5, 7)) + '/' + (+r.d.slice(8, 10)) + '</td><td>' + esc(m.venueName(r.slot['據點'])) + '<br><span class="mut">' + esc(m.hm(r.slot['開始時間'], r.slot['結束時間'])) + '</span></td><td class="num">' + r.coach + (r.coach > r.named ? ' <span class="badge bad">缺 ' + (r.coach - r.named) + '</span>' : '') + '</td><td class="num">' + r.host + '</td></tr>').join('');
    ui.modal({
      title: S.month + ' 人力與統計',
      body: '<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">專項課</div><div class="v">' + An.n + ' 堂</div></div><div class="kpi"><div class="l">名額（下限–上限）</div><div class="v">' + An.min + '–' + An.max + '</div></div><div class="kpi"><div class="l">預估收入</div><div class="v" style="font-size:1.05rem">' + money(An.revMin) + '–' + money(An.revMax) + '</div></div><div class="kpi"><div class="l">取代球敘草稿</div><div class="v">' + An.conv + ' 場</div></div></div>' +
        '<h4 style="margin:8px 0 4px">需要處理</h4>' + (An.issues.length ? '<div class="sb-issues">' + An.issues.map((i) => '<div class="sb-issue' + (i.soft ? ' soft' : '') + '">' + (i.soft ? '' : '<b>衝突　</b>') + esc(i.t) + '</div>').join('') + '</div>' : '<div class="note">沒有衝突，教練都已指定</div>') +
        '<h4 style="margin:12px 0 4px">各時段人力</h4><p class="mut" style="font-size:.8rem;margin:0 0 4px">教練＝已排課程（含期制班）；場主＝有球敘的時段各 1 位</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>據點・時段</th><th class="num">教練</th><th class="num">場主</th></tr></thead><tbody>' + (tb || '<tr><td colspan="4" class="mut">—</td></tr>') + '</tbody></table></div>',
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
    return addDays(today(), 1) + 'T' + (PB.cfg.openTime || '12:00'); // 已過 25 日：預設明天中午
  }
  A.sbPublish = async () => {
    if (Object.keys(S.pending).length && !(await flush())) return;
    const An = analyze();
    if (!An.n) return ui.toast(S.month + ' 沒有專項課草稿', 'bad');
    const body = '<p class="mut" style="margin:0 0 8px">發布前系統會再檢查一次：有人剛報名的球敘不會被轉換、可用日沒確認或教練不能上的格子會略過。</p>' +
      '<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">新增專項課</div><div class="v">' + An.n + ' 堂</div></div><div class="kpi"><div class="l">取代球敘草稿</div><div class="v">' + An.conv + ' 場</div></div><div class="kpi' + (An.unnamed ? ' neg' : '') + '"><div class="l">未指定教練</div><div class="v">' + An.unnamed + '</div></div><div class="kpi' + (An.hard ? ' neg' : '') + '"><div class="l">衝突</div><div class="v">' + An.hard + '</div></div></div>' +
      (An.hard ? '<div class="note warn">還有 ' + An.hard + ' 格衝突，發布時會略過（點上方統計看是哪幾格）。</div>' : '') +
      (An.unnamed ? '<div class="note">未指定教練的課可以先發布，之後由行政在營運工作台「換教練」。</div>' : '') +
      (An.notReady ? '<div class="note warn">有 ' + An.notReady + ' 格的可用日還沒確認，會略過。</div>' : '') +
      '<div class="fld" style="margin-top:10px"><label>開放報名時間</label><input type="datetime-local" name="openAt" value="' + defaultOpenAt() + '"><span class="hint">到了這個時間學員才看得到並可報名（規則：每月 ' + (PB.cfg.openDay || 25) + ' 日 ' + (PB.cfg.openTime || '12:00') + ' 公告下月）</span></div>';
    const r = await ui.modal({ title: '發布 ' + S.month + ' 專項課', body: body, sticky: true, actions: [{ label: '再看看' }, { label: '確認發布', kind: 'pri', click: (el) => { const v = el.querySelector('[name=openAt]').value; if (!v) { ui.toast('請填開放報名時間', 'bad'); return false; } return v.replace('T', ' '); } }] });
    if (!r) return;
    const skipped = [];
    let done = 0;
    let guard = 0;
    for (;;) {
      ui.toast('發布中…已完成 ' + done + ' 堂', '', 2500);
      const out = await PB.runMany([{ op: 'schedPublish', args: { month: S.month, openAt: r, skip: skipped.map((x) => x.id) } }], { quiet: true });
      if (!out) break;
      const res = out.results[0];
      if (!res.ok) { ui.toast(res.message, 'bad'); break; }
      done += res.data.done;
      res.data.skipped.forEach((x) => skipped.push(x));
      if (!res.data.left || guard++ > 20) break;
    }
    const rows = skipped.map((x) => { const d = PB.get(T, x.id) || {}; const s = PB.get('1_據點_時段', d['時段']) || {}; return '<li>' + esc(fmtD(d['日期']) + ' ' + m.venueName(s['據點']) + ' ' + m.hm(s['開始時間']) + ' ' + m.courtName(d['球面']) + '「' + m.specName(d['專項']) + '」') + '：' + esc(x.why) + '</li>'; }).join('');
    ui.modal({ title: '發布結果', body: '<p>已發布 <b>' + done + '</b> 堂，' + esc(r) + ' 開放報名。' + (done ? '學員看到前可以在營運工作台「課程 → 專項課」核對。' : '') + '</p>' + (rows ? '<div class="note warn">沒有發布 ' + skipped.length + ' 堂（留在草稿，調整後可再發布）：<ul style="margin:6px 0 0;padding-left:18px">' + rows + '</ul></div>' : ''), actions: [{ label: '好' }] });
  };
})();
