/**
 * 理論上匹克球｜營運工作台：帳務 ledger.js v4.24（2026/11/23 Imperfect：沒有辦法統一查到誰還沒付款、已付款、取消退款怎麼處理）
 * 一筆報名一列，系統判斷狀態：未付／部分付款／待對帳／查無入帳／已付／待退款／已退款／轉抵用金／已取消・已付未退／已取消
 *   上方提醒「對不上的」：已取消但已付的錢還沒處理、已退款但報名沒取消
 *   篩選：狀態、類型（課程／球敘）、據點、月份（依上課／球敘日期）；搜尋：姓名、電話、帳號末五碼、金額
 *   點一列 → 這筆的經過（報名 → 應收 → 每筆收款／回報 → 退款／轉抵用金 → 取消）＋可直接處理（都是原本的操作）
 * 「名單外收入」分頁：場主登記的匹客城／IG／現場收入（沒有報名的應收），不跟系統報名混在一起
 * 只讀已載入的資料，不多送請求
 */
(function () {
  'use strict';
  const { esc, str, num, money, fmtD, day, byKey, ui, m } = PB;
  const A = PB.acts;
  const isOps = () => PB.ws.indexOf('行政客服') >= 0 || PB.ws.indexOf('管理層') >= 0;
  const btn = (label, act, data, cls) => ui.btn(label, act, data, 'sm ' + (cls || ''));
  const IGNORE = () => ((PB.cfg && PB.cfg.payIgnore) || ['有誤', '作廢', '退回']);
  const ORDER = ['未付', '部分付款', '查無入帳', '待對帳', '已付', '待退款', '已取消・已付未退', '已退款', '轉抵用金', '已取消'];
  const BADGE = { 未付: 'bad', 部分付款: 'warn', 查無入帳: 'bad', 待對帳: 'info', 已付: 'ok', 待退款: 'warn', '已取消・已付未退': 'warn', 已退款: '', 轉抵用金: 'info', 已取消: '' };
  const badge = (st) => '<span class="badge ' + (BADGE[st] || '') + '">' + esc(st) + '</span>';
  const dShort = (k) => (k ? fmtD(k).replace(/（.）/, '') : '');

  /** 一筆報名的帳：所有應收（含作廢）＋收款 */
  function entry(r) {
    const sid = str(r['報名ID']);
    const recs = PB.ix.recBySig[sid] || [];
    if (!recs.length) return null;
    const isClass = str(r['報名類型']) === '課程';
    const tg = isClass ? PB.get('2_課程班級', r['班級']) : PB.get('2_球敘場次', r['球敘']);
    const pays = [];
    let due = 0, got = 0, pend = 0, refund = 0, credit = 0, todo = 0, miss = 0;
    recs.forEach((rec) => {
      if (rec['作廢'] !== true) due += num(rec['應收金額']);
      (PB.ix.payByRec[str(rec['應收ID'])] || []).forEach((p) => {
        pays.push(p);
        if (IGNORE().indexOf(str(p['對帳狀態'])) >= 0) return;
        const a = num(p['金額']);
        if (a < 0 && str(p['付款方式']) === '轉抵用金') credit += a;
        else if (a < 0) { refund += a; if (m.payRefundTodo(p)) todo += 1; }
        else { got += a; if (str(p['對帳狀態']) === '待確認') { pend += a; if (m.payNoBank(p)) miss += 1; } }
      });
    });
    const net = got + refund + credit;
    const st = str(r['報名狀態']);
    const cancelled = st === '已取消';
    let status;
    if (todo) status = '待退款';
    else if (cancelled) status = refund < 0 ? '已退款' : credit < 0 ? '轉抵用金' : net > 0 ? '已取消・已付未退' : '已取消';
    else if (miss) status = '查無入帳';
    else if (due - net > 0) status = net > 0 ? '部分付款' : '未付';
    else status = pend > 0 ? '待對帳' : '已付';
    // 對不上的：已退款（已收歸零）但報名還有效
    const odd = !cancelled && refund < 0 && net <= 0 && ['已報名', '保留中'].indexOf(st) >= 0;
    const when = tg ? day(isClass ? tg['開課日期'] : tg['日期']) : '';
    const payer = str(recs[0]['付款人']) || str(r['學員']);
    return { r: r, sid: sid, recs: recs, pays: pays, tg: tg, isClass: isClass, due: due, net: net, got: got, pend: pend, refund: refund, credit: credit, left: cancelled ? 0 : Math.max(0, due - net), status: status, odd: odd, when: when, payer: payer, venue: str(tg && tg['據點']) || str(recs[0]['據點']), st: st };
  }
  let cacheKey = null; let cache = [];
  function entries() {
    const k = [PB.rows('2_報名'), PB.rows('3_收款明細'), PB.rows('3_應收帳款')];
    if (cacheKey && cacheKey[0] === k[0] && cacheKey[1] === k[1] && cacheKey[2] === k[2]) return cache;
    cache = k[0].map(entry).filter(Boolean);
    cacheKey = k;
    return cache;
  }
  function matches(e, kw) {
    if (!kw) return true;
    const s = PB.get('1_學員', e.r['學員']) || {};
    const py = PB.get('1_學員', e.payer) || {};
    const digits = kw.replace(/[^\d]/g, '');
    const text = (str(s['姓名']) + ' ' + str(s['LINE顯示名稱']) + ' ' + str(py['姓名']) + ' ' + m.sigTarget(e.r)).toLowerCase();
    if (text.indexOf(kw) >= 0) return true;
    if (!digits || digits !== kw.replace(/[\s,\-]/g, '')) return false;
    if (digits.length >= 4 && (str(s['電話']) + ' ' + str(py['電話'])).replace(/[^\d ]/g, '').indexOf(digits) >= 0) return true;
    if (e.pays.some((p) => str(p['帳號末五碼']) === digits || String(Math.abs(Math.round(num(p['金額'])))) === digits)) return true;
    return String(Math.round(e.due)) === digits;
  }
  const monthsOf = (list) => { const o = {}; list.forEach((e) => { if (e.when) o[e.when.slice(0, 7)] = 1; }); return Object.keys(o).sort().reverse(); };

  function rowHtml(e) {
    const name = m.stuName(e.r['學員']) + (e.payer && e.payer !== str(e.r['學員']) ? '（' + m.stuName(e.payer) + ' 付）' : '');
    const amt = e.status === '未付' ? money(e.left) : e.status === '部分付款' ? '還差 ' + money(e.left) : e.status === '已退款' || e.status === '待退款' ? '退 ' + money(Math.abs(e.refund)) : e.status === '轉抵用金' ? '轉 ' + money(Math.abs(e.credit)) : e.net > 0 ? money(e.net) : '';
    return '<div class="row click" data-act="ledgerOpen" data-id="' + esc(e.sid) + '"><div class="when">' + esc(dShort(e.when)) + '<small>' + esc(e.isClass ? '課程' : '球敘') + '</small></div>' +
      '<div class="main-c"><div class="t">' + esc(name) + ' ' + badge(e.status) + (e.odd ? ' <span class="badge bad">已退款但報名沒取消</span>' : '') + (amt ? ' <span class="num">' + esc(amt) + '</span>' : '') + '</div>' +
      '<div class="s">' + esc([m.sigTarget(e.r), m.venueName(e.venue), '應收 ' + money(e.due), e.net ? '已收 ' + money(e.net) : ''].filter(Boolean).join('・')) + '</div></div></div>';
  }

  // ---------------- 名單外 ----------------
  function outsideRows(p) {
    let list = PB.rows('3_應收帳款').filter((r) => !str(r['報名']) && r['作廢'] !== true);
    if (p.v) list = list.filter((r) => str(r['據點']) === p.v);
    const dk = (r) => day(r['到期日']) || day(r['建立日期']);
    list = list.slice().sort((a, b) => byKey(dk(b), dk(a)));
    return list.slice(0, num(p.n) || 100).map((r) => {
      const x = m.rec(r['應收ID']);
      const pays = PB.ix.payByRec[str(r['應收ID'])] || [];
      const who = pays.map((y) => m.staffName(y['經手人'])).filter(Boolean)[0] || '';
      const st = x.left > 0 ? (x.net > 0 ? '部分付款' : '未付') : x.pending > 0 ? '待對帳' : '已付';
      return '<div class="row"><div class="when">' + esc(dShort(dk(r))) + '</div><div class="main-c"><div class="t">' + esc(str(r['項目說明'])) + ' ' + badge(st) + ' <span class="num">' + money(x.net) + '</span></div>' +
        '<div class="s">' + esc(['應收 ' + money(x.due), x.left > 0 ? '還差 ' + money(x.left) : '', who ? '經手 ' + who : '', pays.map((y) => str(y['付款方式'])).filter(Boolean)[0] || ''].filter(Boolean).join('・')) + '</div></div></div>';
    }).join('') || ui.empty('沒有名單外收入', '');
  }

  // ---------------- 畫面 ----------------
  const Ledger = {
    id: 'ledger', label: '帳務', icon: 'cash', show: isOps,
    render(p) {
      const tab = p.t === 'out' ? 'out' : 'sig';
      const venues = PB.rows('1_據點');
      const venueSel = '<select class="btn" data-input="ledgerVenue"><option value="">全部據點</option>' + venues.map((v) => '<option value="' + esc(v['據點ID']) + '"' + (str(v['據點ID']) === str(p.v) ? ' selected' : '') + '>' + esc(v['據點名稱']) + '</option>').join('') + '</select>';
      const tabs = '<div class="chips"><button class="chip' + (tab === 'sig' ? ' on' : '') + '" data-act="param" data-k="t" data-v="">系統報名</button><button class="chip' + (tab === 'out' ? ' on' : '') + '" data-act="param" data-k="t" data-v="out">名單外收入</button></div>';
      if (tab === 'out') {
        return '<div class="ptop"><h1>帳務</h1><span class="sp"></span>' + venueSel + '</div><div class="ptop">' + tabs + '</div>' +
          '<div class="s mut" style="margin:0 2px 8px">場主登記的匹客城、IG、現場收入：系統裡沒有每個人的資料，只有人數和實收。</div><div class="card list">' + outsideRows(p) + '</div>';
      }
      const all = entries();
      let list = all;
      if (p.v) list = list.filter((e) => e.venue === p.v);
      if (p.k) list = list.filter((e) => (p.k === 'c') === e.isClass);
      const months = monthsOf(all);
      if (p.mo) list = list.filter((e) => e.when.slice(0, 7) === p.mo);
      const kw = str(p.q).trim().toLowerCase();
      if (kw) list = list.filter((e) => matches(e, kw));
      const count = {};
      list.forEach((e) => { count[e.status] = (count[e.status] || 0) + 1; });
      const stuck = list.filter((e) => e.status === '已取消・已付未退');
      const odd = list.filter((e) => e.odd);
      let shown = p.st === 'odd' ? odd : p.st ? list.filter((e) => e.status === p.st) : list;
      shown = shown.slice().sort((a, b) => byKey(b.when || '0', a.when || '0') || byKey(str(b.r['報名時間']), str(a.r['報名時間'])));
      const chip = (id, label, n) => '<button class="chip' + (str(p.st) === id ? ' on' : '') + '" data-act="param" data-k="st" data-v="' + esc(id) + '">' + esc(label) + '<span class="c">' + n + '</span></button>';
      const moSel = '<select class="btn" data-input="ledgerMonth"><option value="">全部月份</option>' + months.map((x) => '<option' + (x === p.mo ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>';
      const kindSel = '<select class="btn" data-input="ledgerKind"><option value="">課程＋球敘</option><option value="c"' + (p.k === 'c' ? ' selected' : '') + '>課程</option><option value="g"' + (p.k === 'g' ? ' selected' : '') + '>球敘</option></select>';
      const unpaid = list.reduce((a, e) => a + e.left, 0);
      const warn = (stuck.length || odd.length)
        ? '<div class="note warn" style="margin-bottom:10px"><b>對不上的 ' + (stuck.length + odd.length) + ' 筆：</b>' +
          (stuck.length ? '已取消但已付的錢還沒處理 ' + stuck.length + ' 筆 ' + btn('看這些', 'param', { k: 'st', v: '已取消・已付未退' }, 'ghost') : '') +
          (odd.length ? '　已退款但報名沒取消 ' + odd.length + ' 筆 ' + btn('看這些', 'param', { k: 'st', v: 'odd' }, 'ghost') : '') + '</div>' : '';
      const limit = num(p.n) || 100;
      return '<div class="ptop"><h1>帳務</h1><span class="cnt mut">' + list.length + ' 筆・未付合計 ' + money(unpaid) + '</span><span class="sp"></span>' + moSel + kindSel + venueSel + '</div>' +
        '<div class="ptop">' + tabs + '<span class="sp"></span><label class="search">' + PB.icon('search') + '<input placeholder="姓名、電話、末五碼、金額" value="' + esc(p.q || '') + '" data-input="ledgerSearch"></label></div>' +
        warn +
        '<div class="chips" style="margin-bottom:10px">' + chip('', '全部', list.length) + ORDER.filter((s) => count[s]).map((s) => chip(s, s, count[s])).join('') + '</div>' +
        '<div class="card list">' + (shown.slice(0, limit).map(rowHtml).join('') || ui.empty('沒有符合的資料', kw ? '可以用姓名、電話、末五碼或金額搜尋' : '')) +
        (shown.length > limit ? '<div class="empty">' + ui.btn('顯示更多', 'param', { k: 'n', v: limit + 200 }) + '</div>' : '') + '</div>' +
        '<p class="mut" style="font-size:.8rem">一筆報名一列；日期是上課或球敘的日期。「待對帳」＝學員已回報或已登記、主理人還沒確認入帳。點一列看這筆的經過。</p>';
    },
  };
  PB.ledgerScreen = Ledger;
  PB.ledgerEntry = (sid) => { const r = PB.get('2_報名', sid); return r ? entry(r) : null; };
  PB.inputs.ledgerVenue = (v) => PB.setParam('v', v);
  PB.inputs.ledgerMonth = (v) => PB.setParam('mo', v);
  PB.inputs.ledgerKind = (v) => PB.setParam('k', v);
  let timer;
  PB.inputs.ledgerSearch = (v) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      PB.setParam('q', v);
      const el = document.querySelector('[data-input="ledgerSearch"]');
      if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
    }, 250);
  };

  // ---------------- 一筆報名的經過 ----------------
  function timeline(e) {
    const ev = [];
    const add = (t, title, sub, cls) => ev.push({ t: str(t), title: title, sub: sub || '', cls: cls || '' });
    const r = e.r;
    add(r['報名時間'], '報名' + (str(r['報名來源']) ? '（' + str(r['報名來源']) + '）' : ''), m.sigTarget(r));
    if (str(r['遞補時間'])) add(r['遞補時間'], '候補遞補');
    const tasks = PB.has('4_工作任務') ? PB.rows('4_工作任務') : [];
    e.recs.forEach((rec) => {
      add(day(rec['建立日期']), '應收 ' + money(rec['應收金額']) + (num(rec['折扣金額']) > 0 ? '（原價 ' + money(rec['原價']) + '，' + (str(rec['折扣類型']) || '折扣') + ' −' + num(rec['折扣金額']) + '）' : '') + (rec['作廢'] === true ? '（已作廢）' : ''), str(rec['項目說明']), rec['作廢'] === true ? 'mut' : ''); // v4.25：折價券
      (PB.ix.payByRec[str(rec['應收ID'])] || []).forEach((p) => {
        const a = num(p['金額']);
        const pst = str(p['對帳狀態']);
        const off = IGNORE().indexOf(pst) >= 0;
        const kind = a < 0 ? (str(p['付款方式']) === '轉抵用金' ? '轉抵用金' : m.payRefundTodo(p) ? '待退款' : '退款') : str(p['付款方式']) === '抵用金' ? '抵用金折抵' : /^學員回報/.test(str(p['備註'])) ? '學員回報付款' : '收款';
        const flag = off ? '（' + pst + '，不算）' : m.payNoBank(p) ? '（查無入帳）' : pst === '待確認' && a > 0 ? '（待對帳）' : '';
        add(str(p['確認時間']) || day(p['收款日期']), kind + ' ' + money(a) + flag,
          [fmtD(p['收款日期']), str(p['付款方式']), str(p['帳號末五碼']) ? '末五碼 ' + p['帳號末五碼'] : '', str(p['經手人']) ? '經手 ' + m.staffName(p['經手人']) : '', str(p['確認人']) ? '確認 ' + m.staffName(p['確認人']) : '', str(p['備註'])].filter(Boolean).join('・'),
          off ? 'mut' : a < 0 ? 'warn' : pst === '已確認' ? 'ok' : 'info');
      });
      tasks.filter((t) => str(t['工作內容']).indexOf('[REF ' + str(rec['應收ID']) + ']') >= 0).forEach((t) => {
        add(day(t['完成日期']) || day(t['Deadline']), str(t['工作名稱']) + '（' + str(t['狀態']) + '）', str(t['完成成果']), 'mut');
      });
    });
    if (str(r['取消時間'])) add(r['取消時間'], '取消報名（' + str(r['取消原因']) + '）', [str(r['學員取消原因']), str(r['未成班選擇']) ? '學員選擇：' + str(r['未成班選擇']) : ''].filter(Boolean).join('・'), 'bad');
    const key = (x) => day(x.t) || '9999';
    ev.forEach((x, i) => { x.i = i; });
    ev.sort((a, b) => byKey(key(a), key(b)) || a.i - b.i);
    return ev.map((x) => '<div class="row"><div class="when">' + esc(dShort(day(x.t))) + '<small>' + esc(x.t.length > 10 ? x.t.slice(11, 16) : '') + '</small></div><div class="main-c"><div class="t">' +
      (x.cls ? '<span class="badge ' + (x.cls === 'mut' ? '' : x.cls) + '">' + esc(x.title) + '</span>' : esc(x.title)) + '</div>' + (x.sub ? '<div class="s">' + esc(x.sub) + '</div>' : '') + '</div></div>').join('');
  }
  // 用詳情面板（和學員頁一樣）：處理完會自動重畫，看得到最新狀態
  function ledgerBody(sid) {
    const e = PB.ledgerEntry(sid);
    if (!e) return ui.empty('這筆報名沒有帳務資料', '');
    const acts = [];
    const open = e.recs.filter((rec) => rec['作廢'] !== true);
    const owe = open.find((rec) => m.rec(rec['應收ID']).left > 0);
    const paid = open.find((rec) => m.rec(rec['應收ID']).net > 0) || e.recs.find((rec) => m.rec(rec['應收ID']).net > 0);
    if (owe) acts.push(btn('收款', 'payAdd', { id: owe['應收ID'] }, 'pri'), btn('提醒', 'payRemind', { ids: owe['應收ID'] }));
    if (paid) acts.push(btn('退款', 'refund', { id: paid['應收ID'] }));
    if (paid && e.st === '已取消' && PB.has('3_抵用金流水')) acts.push(btn('轉抵用金', 'creditIn', { id: paid['應收ID'] }));
    if (['已報名', '候補', '保留中'].indexOf(e.st) >= 0) acts.push(btn('取消報名', 'sigCancel', { id: e.sid }, 'bad'));
    acts.push(btn('學員', 'openStu', { id: str(e.r['學員']) }, 'ghost'));
    const head = '<dl class="kv"><dt>狀態</dt><dd>' + badge(e.status) + ' <span class="mut">報名 ' + esc(e.st) + '</span></dd><dt>項目</dt><dd>' + esc(m.sigTarget(e.r)) + '</dd><dt>金額</dt><dd>' +
      esc('應收 ' + money(e.due) + '・已收 ' + money(e.net) + (e.left ? '・未付 ' + money(e.left) : '') + (e.refund ? '・已退 ' + money(Math.abs(e.refund)) : '') + (e.credit ? '・轉抵用金 ' + money(Math.abs(e.credit)) : '')) + '</dd></dl>';
    return '<div class="acts">' + acts.join('') + '</div>' + head + '<div class="sec"><h2>經過</h2></div><div class="card list">' + timeline(e) + '</div>';
  }
  A.ledgerOpen = (d) => {
    if (!d.id) return;
    ui.sheet(() => { const r = PB.get('2_報名', d.id); return r ? '帳務｜' + m.stuName(r['學員']) : null; }, () => ledgerBody(d.id), 'ledger');
  };
})();
