/**
 * 理論上匹克球｜營運工作台：課表 timetable.js v3.8（2026/10/31）
 * 課程和球敘合在同一頁，像排課看板一樣用「時段 × 球面」看：
 *   依日期：上方日期列（每天幾堂／幾場）→ 點一天 → 每個據點一張卡，時段一列、球面一欄
 *   依據點：據點頁籤 → 一張「日期×時段 × 球面」表（整個月）
 *   期制班：跨好幾週的班級用清單看（整期狀態、第幾堂）
 * 篩選：類別（全部／課程／球敘）、狀態（草稿／招生中／已成班／進行中／已結束／未成班・取消）
 *   不符合篩選的格子變淡（仍看得出那一面有人用）；未成班・取消的預設不顯示
 * 點格子：專項課、球敘 → 詳情；期制課程 → 這一堂（點名）
 */
(function () {
  'use strict';
  const { esc, str, split, num, today, addDays, fmtD, day, wd, sum, uniq, byKey, ui, m } = PB;

  // ---------------- 狀態 ----------------
  const ST = [
    { k: '草稿', badge: 'warn' },
    { k: '招生中', badge: 'info' },
    { k: '已成班', badge: 'brand' },
    { k: '進行中', badge: 'ok' },
    { k: '已結束', badge: '' },
    { k: '未成班・取消', badge: 'bad', off: true },
  ];
  const OFF = '未成班・取消';
  const stBadge = (s) => '<span class="badge ' + ((ST.find((x) => x.k === s) || {}).badge || '') + '">' + esc(s) + '</span>';
  const CLASS_ST = { 籌備中: '招生中', 確定開課: '已成班', 進行中: '進行中', 已結束: '已結束', 未成班: OFF, 取消: OFF };
  const hm = (t) => { const x = str(t).match(/(\d{1,2}):(\d{2})/); return x ? ('0' + x[1]).slice(-2) + ':' + x[2] : ''; };
  const hmEnd = (t) => hm(t).replace('23:59', '24:00');
  const nowText = () => PB.nowText();

  /** 課程一堂的狀態（以班級為準；這一堂上完＝已結束） */
  function sesStatus(s, c) {
    const sst = str(s['場次狀態']);
    const cst = str(c['課程狀態']);
    if (sst === '取消' || CLASS_ST[cst] === OFF) return OFF;
    if (sst === '已完成') return '已結束';
    return CLASS_ST[cst] || '招生中';
  }
  /** 球敘狀態：草稿／招生中（開放報名、額滿）／已成班（通過成團檢查）／已結束／取消 */
  function gameStatus(g) {
    const st = str(g['狀態']);
    if (st === '取消') return OFF;
    if (st === '草稿') return '草稿';
    if (st === '已結束' || day(g['日期']) < today()) return '已結束';
    if (str(g['成團檢查時間'])) return '已成班';
    return '招生中';
  }
  /** 期制班整期狀態 */
  const termStatus = (c) => CLASS_ST[str(c['課程狀態'])] || '招生中';

  // ---------------- 資料 ----------------
  const isPrivate = (c) => /個人/.test(m.typeName ? m.typeName(c['課程類型']) : '');
  /** 某天的所有格子（課程一堂＝一格、球敘一場＝一格） */
  function itemsOn(d) {
    const out = [];
    (PB.ix.sesByDay[d] || []).forEach((s) => {
      const c = PB.get('2_課程班級', s['班級']);
      if (!c || str(s['場次狀態']) === '改期') return;
      const single = m.isSingle(c);
      out.push({
        kind: 'c', single: single, d: d, v: str(s['據點']) || str(c['據點']), st: hm(s['開始時間']), en: hmEnd(s['結束時間']),
        courts: split(s['使用場地']), status: sesStatus(s, c), s: s, c: c,
        act: single ? 'openClass' : 'openSes', id: single ? str(c['班級ID']) : str(s['場次ID']),
      });
    });
    (PB.ix.gameByDay[d] || []).forEach((g) => {
      out.push({ kind: 'g', d: d, v: str(g['據點']), st: hm(g['開始時間']), en: hmEnd(g['結束時間']), courts: split(g['使用場地']), status: gameStatus(g), g: g, act: 'openGame', id: str(g['球敘ID']) });
    });
    return out;
  }
  /** 這個月有活動的日子 → { d: items } */
  function monthItems(month) {
    const out = {};
    const keys = uniq(Object.keys(PB.ix.sesByDay).concat(Object.keys(PB.ix.gameByDay))).filter((d) => d.slice(0, 7) === month).sort();
    keys.forEach((d) => { const it = itemsOn(d); if (it.length) out[d] = it; });
    return out;
  }
  /** 篩選：kind 全部／課程／球敘；s 空白＝全部（不含未成班・取消） */
  const kindOk = (it, k) => !k || (k === '課程' ? it.kind === 'c' : it.kind === 'g');
  const stOk = (it, s) => (s ? it.status === s : it.status !== OFF);
  const visible = (it, p) => (it.status !== OFF || p.s === OFF); // 取消的只在選「未成班・取消」時出現
  const match = (it, p) => kindOk(it, p.k) && stOk(it, p.s);

  /** 據點的球面（啟用、表格順序）；格子用到但已停用的面也補上 */
  function venueCourts(v, items) {
    const list = (PB.ix.courtByVenue[v] || []).filter((c) => ['啟用', ''].indexOf(str(c['狀態'])) >= 0).map((c) => str(c['場地ID']));
    (items || []).forEach((it) => it.courts.forEach((cid) => { if (list.indexOf(cid) < 0 && PB.get('1_據點_場地', cid)) list.push(cid); }));
    return list;
  }
  /** 欄名：「永平國小－A場」→ A 面；「綜合大樓四樓 C」→ C 面 */
  function courtShort(cid) {
    const n = str(m.courtName(cid));
    const x = n.match(/([A-H])\s*(場|面)?$/);
    return x ? x[1] + ' 面' : n;
  }

  // ---------------- 格子 ----------------
  function lvClass(c) {
    if (/體驗/.test(str(c['課程名稱']))) return 'tx';
    const lv = PB.get('0_程度', c['程度']);
    const i = lv ? num(lv['排序']) : 1;
    return 'lv' + Math.max(0, Math.min(2, (i || 1) - 1));
  }
  function cellHtml(it, p, span) {
    const on = match(it, p);
    const courts = it.courts.map(courtShort).join('＋');
    let cls = 'tt-cell';
    let k = '';
    let nm = '';
    let meta = '';
    if (it.kind === 'c') {
      const x = m.cls(it.c);
      const lvName = str(m.levelName(it.c['程度'])).split(' ')[0];
      if (it.single) {
        cls += ' ' + lvClass(it.c);
        k = (/體驗/.test(str(it.c['課程名稱'])) ? '新手體驗' : '專項' + (lvName ? ' ' + lvName : ''));
        nm = esc(it.c['課程名稱']);
        meta = '<span class="badge">' + (it.status === '招生中' ? '已付 ' + x.paid + '／' + x.min : '學員 ' + x.active.length) + '</span>' +
          '<span class="badge">' + esc(m.staffName(it.c['主教練']) || '未排教練') + '</span>';
        if (it.status === '招生中' && x.decideAt) meta += '<span class="tt-sub">' + esc(x.decideAt.slice(5).replace('-', '/')) + ' 決定</span>';
      } else {
        cls += isPrivate(it.c) ? ' pv' : ' term';
        k = isPrivate(it.c) ? '個人課' : '期制課程';
        nm = esc(m.classLabel(it.c));
        meta = (isPrivate(it.c) ? '' : '<span class="badge">第 ' + esc(str(it.s['第幾堂']) || '?') + '／' + x.total + ' 堂</span>') +
          '<span class="badge">' + esc(m.staffName(it.s['授課教練']) || '未排教練') + '</span>';
      }
    } else {
      const x = m.game(it.g);
      cls += ' g';
      k = '球敘';
      nm = esc(m.gameTypeName(it.g['球敘類型']));
      const hosts = x.hosts.map((h) => h.name).join('、');
      meta = '<span class="badge">' + x.active.length + '／' + x.limit + '</span>' + (x.wait.length ? '<span class="badge warn">候補 ' + x.wait.length + '</span>' : '') +
        '<span class="badge">' + (x.hostless ? '無場主' : '場主 ' + esc(hosts || '未排')) + '</span>' + (str(it.g['費用']) !== '' ? '<span class="badge">$' + esc(num(it.g['費用'])) + '</span>' : '');
      if (it.status === '草稿' && str(it.g['開放報名時間'])) meta += '<span class="tt-sub">' + esc(str(it.g['開放報名時間']).slice(5, 16).replace('-', '/')) + ' 開放</span>';
    }
    if (!on) cls += ' dim';
    return '<button class="' + cls + '"' + (span > 1 ? ' style="grid-column:span ' + span + '"' : '') + ' data-act="' + it.act + '" data-id="' + esc(it.id) + '">' +
      '<span class="tt-k">' + esc(k) + (courts ? '・' + esc(courts) : '') + '</span>' +
      '<span class="tt-n">' + nm + ' ' + stBadge(it.status) + '</span>' +
      (on ? '<span class="tt-m">' + meta + '</span>' : '') + '</button>';
  }
  /** 一列（同時段）排進球面欄：連續的面合併；沒球面或撞面的放到下方 */
  function placeRow(items, cols) {
    const taken = {};
    const cells = [];
    const extra = [];
    items.forEach((it) => {
      const idx = it.courts.map((c) => cols.indexOf(c)).filter((i) => i >= 0).sort((a, b) => a - b);
      const contiguous = idx.length && idx[idx.length - 1] - idx[0] === idx.length - 1;
      if (!idx.length || !contiguous || idx.some((i) => taken[i])) { extra.push(it); return; }
      idx.forEach((i) => { taken[i] = true; });
      cells.push({ at: idx[0], span: idx.length, it: it });
    });
    return { cells: cells.sort((a, b) => a.at - b.at), taken: taken, extra: extra };
  }
  function gridHtml(items, cols, p) {
    const r = placeRow(items, cols);
    let html = '';
    let i = 0;
    while (i < cols.length) {
      const c = r.cells.find((x) => x.at === i);
      if (c) { html += cellHtml(c.it, p, c.span); i += c.span; } else { html += '<div class="tt-cell e">' + esc(courtShort(cols[i])) + '・未使用</div>'; i += 1; }
    }
    return '<div class="tt-grid" style="grid-template-columns:repeat(' + Math.max(1, cols.length) + ',minmax(0,1fr))">' + html + '</div>' +
      (r.extra.length ? '<div class="tt-grid tt-extra">' + r.extra.map((it) => cellHtml(it, p, 1)).join('') + '</div>' : '');
  }
  /** 依時段分列 */
  function bySlot(items) {
    const g = {};
    items.forEach((it) => { const k = it.st + '–' + it.en; (g[k] = g[k] || []).push(it); });
    return Object.keys(g).sort().map((k) => ({ k: k, items: g[k] }));
  }

  // ---------------- 上方 ----------------
  function chips(name, list, cur, counts) {
    return list.map((x) => '<button class="chip' + ((cur || '') === x.v ? ' on' : '') + '" data-act="ttSet" data-k="' + name + '" data-v="' + esc(x.v) + '">' + esc(x.l) +
      (counts && counts[x.v] ? '<span class="c">' + counts[x.v] + '</span>' : '') + '</button>').join('');
  }
  function topHtml(p, counts) {
    const mode = p.mode || 'day';
    const head = '<div class="ptop"><h1>課表</h1><span class="mut" style="font-size:.85rem">課程和球敘在同一頁</span><span class="sp"></span>' +
      (PB.forms['2_課程班級'] ? ui.btn('新增班級', 'classNew', {}, 'sm', 'plus') : '') + (PB.forms['2_球敘場次'] ? ui.btn('新增球敘', 'gameNew', {}, 'sm pri', 'plus') : '') +
      ui.btn('班級清單', 'ttGo', { to: 'classes' }, 'sm ghost') + ui.btn('球敘清單', 'ttGo', { to: 'games' }, 'sm ghost') + '</div>';
    const seg = '<div class="seg">' + [['day', '依日期'], ['venue', '依據點'], ['term', '期制班']].map((x) => '<button class="' + (mode === x[0] ? 'on' : '') + '" data-act="ttSet" data-k="mode" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    const kind = mode === 'term' ? '' : '<div class="tt-f"><span>類別</span>' + chips('k', [{ v: '', l: '全部' }, { v: '課程', l: '課程' }, { v: '球敘', l: '球敘' }], p.k) + '</div>';
    const stList = [{ v: '', l: '全部' }].concat(ST.filter((x) => mode !== 'term' || x.k !== '草稿').map((x) => ({ v: x.k, l: x.k })));
    const st = '<div class="tt-f tt-fs"><span>狀態</span>' + chips('s', stList, p.s, counts) + '</div>';
    return head + '<div class="ptop">' + seg + '</div>' + kind + st;
  }
  const countBy = (items, p) => {
    const out = {};
    items.filter((it) => kindOk(it, p.k)).forEach((it) => { out[it.status] = (out[it.status] || 0) + 1; });
    return out;
  };
  const monthOf = (p) => (p.mo || (p.d || today()).slice(0, 7));
  const shiftMonth = (mo, n) => { let y = +mo.slice(0, 4); let x = +mo.slice(5, 7) + n; while (x > 12) { x -= 12; y += 1; } while (x < 1) { x += 12; y -= 1; } return y + '-' + ('0' + x).slice(-2); };
  const monthNav = (mo) => '<div class="tt-mo">' + ui.btn('‹', 'ttSet', { k: 'mo', v: shiftMonth(mo, -1) }, 'sm ghost') + '<b>' + (+mo.slice(0, 4)) + ' 年 ' + (+mo.slice(5, 7)) + ' 月</b>' + ui.btn('›', 'ttSet', { k: 'mo', v: shiftMonth(mo, 1) }, 'sm ghost') + '</div>';

  // ---------------- 依日期 ----------------
  function dayView(p) {
    const mo = monthOf(p);
    const all = monthItems(mo);
    const flat = [].concat.apply([], Object.keys(all).map((d) => all[d]));
    const dates = Object.keys(all).filter((d) => all[d].some((it) => visible(it, p) && kindOk(it, p.k)));
    let d = p.d && p.d.slice(0, 7) === mo ? p.d : '';
    if (!d) d = dates.find((x) => x >= today()) || dates[dates.length - 1] || (mo === today().slice(0, 7) ? today() : mo + '-01');
    const strip = '<div class="tt-days">' + dates.map((x) => {
      const its = all[x].filter((it) => visible(it, p) && match(it, p));
      const c = its.filter((it) => it.kind === 'c').length, g = its.filter((it) => it.kind === 'g').length;
      const w = wd(x);
      return '<button class="tt-day' + (x === d ? ' on' : '') + (w === '六' || w === '日' ? ' wk' : '') + (x === today() ? ' td' : '') + '" data-act="ttSet" data-k="d" data-v="' + x + '"><small>' + w + '</small><b>' + (+x.slice(5, 7)) + '/' + (+x.slice(8, 10)) + '</b>' +
        '<span class="n">' + (c ? '課 ' + c : '') + (c && g ? '・' : '') + (g ? '球 ' + g : '') + (!c && !g ? '—' : '') + '</span></button>';
    }).join('') + '</div>';
    const items = (all[d] || []).filter((it) => visible(it, p));
    const byV = {};
    items.forEach((it) => { (byV[it.v] = byV[it.v] || []).push(it); });
    const vids = Object.keys(byV).sort((a, b) => byKey(byV[a].map((i) => i.st).sort()[0] + m.venueName(a), byV[b].map((i) => i.st).sort()[0] + m.venueName(b)));
    const shown = items.filter((it) => match(it, p));
    const people = sum(shown, (it) => (it.kind === 'g' ? m.game(it.g).active.length : m.cls(it.c).active.length));
    const sumHtml = '<div class="td-sum"><div><b>' + fmtD(d) + '</b></div><div><b>' + vids.length + '</b><span>個據點</span></div><div><b>' + shown.filter((i) => i.kind === 'c').length + '</b><span>堂課程</span></div><div><b>' + shown.filter((i) => i.kind === 'g').length + '</b><span>場球敘</span></div><div><b>' + people + '</b><span>人報名</span></div></div>';
    const cards = vids.map((v) => {
      const its = byV[v];
      const cols = venueCourts(v, its);
      const host = m.staffName((PB.get('1_據點', v) || {})['場主']);
      return '<section class="tt-v"><div class="tt-vh"><b>' + esc(m.venueName(v) || '（未指定據點）') + '</b><span class="sp"></span>' + (host ? '<span class="mut">據點場主 <b>' + esc(host) + '</b></span>' : '') + '</div>' +
        bySlot(its).map((r) => '<div class="tt-slot"><div class="tt-st"><b>' + esc(r.k) + '</b></div>' + gridHtml(r.items, cols, p) + '</div>').join('') + '</section>';
    }).join('');
    return topHtml(p, countBy(flat.filter((it) => visible(it, p) || p.s === OFF), p)) + monthNav(mo) + (dates.length ? strip : '') +
      (items.length ? sumHtml + cards : '<div class="card list">' + ui.empty(dates.length ? '這天沒有課程或球敘' : '這個月沒有課程或球敘', '') + '</div>');
  }

  // ---------------- 依據點 ----------------
  function venueView(p) {
    const mo = monthOf(p);
    const all = monthItems(mo);
    const flat = [].concat.apply([], Object.keys(all).map((d) => all[d])).filter((it) => visible(it, p));
    const vids = uniq(flat.filter((it) => kindOk(it, p.k)).map((it) => it.v)).filter(Boolean).sort((a, b) => byKey(m.venueName(a), m.venueName(b)));
    const v = vids.indexOf(p.v) >= 0 ? p.v : vids[0] || '';
    const tabs = '<div class="tt-tabs">' + vids.map((id) => {
      const n = flat.filter((it) => it.v === id && match(it, p)).length;
      return '<button class="chip' + (id === v ? ' on' : '') + '" data-act="ttSet" data-k="v" data-v="' + esc(id) + '">' + esc(m.venueName(id)) + '<span class="c">' + n + '</span></button>';
    }).join('') + '</div>';
    if (!v) return topHtml(p, countBy(flat, p)) + monthNav(mo) + '<div class="card list">' + ui.empty('這個月沒有課程或球敘', '') + '</div>';
    const its = flat.filter((it) => it.v === v);
    const cols = venueCourts(v, its);
    const rows = [];
    Object.keys(all).sort().forEach((d) => {
      const dayIts = its.filter((it) => it.d === d);
      if (!dayIts.length) return;
      bySlot(dayIts).forEach((r, i) => rows.push({ d: d, first: i === 0, k: r.k, items: r.items }));
    });
    const tb = rows.map((r) => {
      const pl = placeRow(r.items, cols);
      let tds = '';
      let i = 0;
      while (i < cols.length) {
        const c = pl.cells.find((x) => x.at === i);
        if (c) { tds += '<td colspan="' + c.span + '">' + cellHtml(c.it, p, 1) + '</td>'; i += c.span; } else { tds += '<td><span class="tt-na">—</span></td>'; i += 1; }
      }
      const extra = pl.extra.length ? '<div class="tt-grid tt-extra">' + pl.extra.map((it) => cellHtml(it, p, 1)).join('') + '</div>' : '';
      return '<tr class="' + (r.first ? 'first' : '') + '"><th class="d">' + (r.first ? '<b>' + (+r.d.slice(5, 7)) + '/' + (+r.d.slice(8, 10)) + '</b><small>週' + wd(r.d) + '</small>' : '') + '<span class="t">' + esc(r.k) + '</span>' + extra + '</th>' + tds + '</tr>';
    }).join('');
    const host = m.staffName((PB.get('1_據點', v) || {})['場主']);
    const shown = its.filter((it) => match(it, p));
    const side = '<div class="tt-vh"><b>' + esc(m.venueName(v)) + '</b><span class="sp"></span><span class="mut">課程 ' + shown.filter((i) => i.kind === 'c').length + ' 堂・球敘 ' + shown.filter((i) => i.kind === 'g').length + ' 場' + (host ? '・據點場主 ' + esc(host) : '') + '</span></div>';
    return topHtml(p, countBy(flat, p)) + monthNav(mo) + tabs +
      '<section class="tt-v">' + side + '<div class="tt-tblwrap"><table class="tt-tbl"><thead><tr><th class="d">日期・時段</th>' + cols.map((c) => '<th>' + esc(courtShort(c)) + '</th>').join('') + '</tr></thead><tbody>' + tb + '</tbody></table></div></section>';
  }

  // ---------------- 期制班 ----------------
  function termView(p) {
    const list = PB.rows('2_課程班級').filter((c) => !m.isSingle(c) && !isPrivate(c));
    const items = list.map((c) => ({ c: c, x: m.cls(c), status: termStatus(c) }));
    const counts = {};
    items.forEach((it) => { counts[it.status] = (counts[it.status] || 0) + 1; });
    const shown = items.filter((it) => (p.s ? it.status === p.s : it.status !== OFF))
      .sort((a, b) => byKey(['進行中', '已成班', '招生中', '已結束', OFF].indexOf(a.status) + (day(a.c['開課日期']) || '9'), ['進行中', '已成班', '招生中', '已結束', OFF].indexOf(b.status) + (day(b.c['開課日期']) || '9')));
    const rows = shown.map((it) => {
      const c = it.c, x = it.x;
      const sub = [m.venueName(c['據點']), m.classWhen ? m.classWhen(c) : '', '教練 ' + (m.staffName(c['主教練']) || '未定'),
        it.status === '招生中' ? '已付 ' + x.paid + '／' + x.min + (day(c['開課日期']) ? '・預定 ' + fmtD(c['開課日期']) + ' 開課' : '') :
          it.status === '已結束' || it.status === OFF ? (day(c['結束日期']) ? '最後一堂 ' + fmtD(c['結束日期']) : '') :
            '第 ' + x.done + '／' + x.total + ' 堂上完' + (x.next ? '・下一堂 ' + fmtD(x.next['日期']) : '')].filter(Boolean).join('・');
      return '<div class="row click" data-act="openClass" data-id="' + esc(c['班級ID']) + '"><div class="main-c"><div class="t">' + esc(m.classLabel(c)) + ' ' + stBadge(it.status) + '</div><div class="s">' + esc(sub) + '</div></div>' +
        '<div class="r" data-stop><span class="badge">學員 ' + x.active.length + '</span></div></div>';
    }).join('');
    return topHtml(p, counts) + '<div class="card list">' + (rows || ui.empty('沒有符合的期制班', '單堂專項課在「依日期」「依據點」看')) + '</div>';
  }

  PB.Timetable = {
    id: 'timetable', label: '課表', icon: 'cal',
    show: () => PB.ws.indexOf('行政客服') >= 0 || PB.ws.indexOf('管理層') >= 0,
    render(p) {
      const mode = p.mode || 'day';
      return '<div class="tt">' + (mode === 'venue' ? venueView(p) : mode === 'term' ? termView(p) : dayView(p)) + '</div>';
    },
  };
  // 切換：換模式時清掉不適用的參數；換月份時清掉日期
  PB.acts.ttSet = (d) => {
    const k = d.k, v = d.v;
    const cur = PB.params ? PB.params() : {};
    if (k === 's' || k === 'k') return PB.setParam(k, cur[k] === v ? '' : v);
    if (k === 'mo') return PB.setParams({ mo: v, d: '' });
    if (k === 'mode') return PB.setParams({ mode: v === 'day' ? '' : v, s: cur.s === '草稿' && v === 'term' ? '' : cur.s });
    return PB.setParam(k, v);
  };
  PB.acts.ttGo = (d) => PB.go(d.to, {});
  // 給測試用
  PB.Timetable._t = { sesStatus: sesStatus, gameStatus: gameStatus, placeRow: placeRow, courtShort: courtShort };
})();
