/**
 * 理論上匹克球｜管理後台 admin.js v2.4（2026/10/26：專項列表加「費用」）
 * 特助、主理人：總覽 Dashboard、管理待處理、財務（人員月結、分潤、支出、應收）、主檔設定
 * Dashboard 全部在瀏覽器計算（換月份不發請求）；口徑：
 *   球敘收入＝當月球敘的報名實收（含待對帳、扣退款）　課程收入＝當月扣堂數 × 每堂單價（與 F02 相同）
 *   v2.3 專項課收入＝當月已完成場次的報名實收（抵用金是預收：轉入時從原課扣掉，折抵時才算進新課）
 *   成本＝場地成本（場次分攤）＋教練費（已完成場次）＋場主費（有簽到的排班）＋其他支出（不含場租／教練費／場主費細目）
 */
(function () {
  'use strict';
  const { esc, str, split, num, money, today, addDays, fmtD, fmtDT, day, sum, uniq, byKey, groupBy, ui, m } = PB;
  const A = PB.acts;
  const sec = (title, cnt, right) => '<div class="sec"><h2>' + esc(title) + '</h2>' + (cnt !== undefined ? '<span class="cnt">' + cnt + '</span>' : '') + '<span class="sp"></span>' + (right || '') + '</div>';
  const btn = (label, act, data, cls, icon) => ui.btn(label, act, data, 'sm ' + (cls || ''), icon);
  const card = (inner) => '<div class="card list">' + inner + '</div>';
  const checked = (q) => Array.from(document.querySelectorAll('input[data-q="' + q + '"]:checked')).map((i) => i.value);
  const row = (o) => '<div class="row' + (o.act ? ' click' : '') + '"' + (o.act ? ' data-act="' + o.act + '" data-id="' + esc(o.id) + '"' : '') + '><div class="main-c"><div class="t">' + (o.t || '') + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' + (o.r ? '<div class="r">' + o.r + '</div>' : '') + '</div>';
  const months = (n) => {
    const out = [];
    const t = today();
    let y = +t.slice(0, 4);
    let mo = +t.slice(5, 7);
    for (let i = 0; i < n; i++) {
      out.push(y + '-' + ('0' + mo).slice(-2));
      mo -= 1;
      if (!mo) { mo = 12; y -= 1; }
    }
    return out;
  };
  const monthSelect = (cur, input) => '<select class="btn" data-input="' + input + '">' + months(13).map((x) => '<option' + (x === cur ? ' selected' : '') + '>' + x + '</option>').join('') + '</select>';
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

  // ================================================================
  // Dashboard 計算
  // ================================================================
  const LESSON_USE = ['上課扣除', '補課扣除'];
  const NOT_OTHER = ['場租', '教練費', '場主費'];
  function unitPrice(c) {
    if (!c) return 0;
    if (str(c['計費方式']) === '每小時') return num(c['費用']) * (num(c['每堂時數']) || 1);
    return num(c['總堂數']) ? num(c['費用']) / num(c['總堂數']) : 0;
  }
  function lessonClass(l) {
    const r = PB.get('2_報名', l['報名']);
    if (r) return PB.get('2_課程班級', r['班級']);
    const a = PB.get('2_出缺勤', l['出缺勤']);
    const s = a ? PB.get('2_上課場次', a['上課場次']) : null;
    return s ? PB.get('2_課程班級', s['班級']) : null;
  }
  const memo = {};
  PB.onRebuild = () => Object.keys(memo).forEach((k) => delete memo[k]);

  function stats(mon) {
    if (memo[mon]) return memo[mon];
    const inM = (v) => day(v).slice(0, 7) === mon;
    const V = {};
    const v = (id) => (V[id || '—'] = V[id || '—'] || { id: id, gN: 0, gHeads: 0, gIn: 0, gRev: 0, sN: 0, sAtt: 0, cRev: 0, spRev: 0, spN: 0, venue: 0, coach: 0, host: 0, other: 0 });
    const types = {};
    const games = PB.rows('2_球敘場次').filter((g) => inM(g['日期']) && ['取消', '草稿'].indexOf(str(g['狀態'])) < 0);
    games.forEach((g) => {
      const x = v(str(g['據點']));
      const sigs = PB.ix.sigByGame[str(g['球敘ID'])] || [];
      const act = sigs.filter((r) => str(r['報名狀態']) === '已報名');
      const rev = sum(sigs, (r) => m.sigPay(r['報名ID']).net);
      x.gN += 1; x.gHeads += act.length; x.gIn += act.filter((r) => str(r['簽到時間'])).length; x.gRev += rev; x.venue += num(g['場地成本']);
      const tk = str(g['球敘類型']) || '不限';
      const t = (types[tk] = types[tk] || { n: 0, heads: 0, rev: 0 });
      t.n += 1; t.heads += act.length; t.rev += rev;
      (PB.ix.dutyByGame[str(g['球敘ID'])] || []).forEach((d) => { if (str(d['簽到時間'])) x.host += num(d['場主費']); });
    });
    const ses = PB.rows('2_上課場次').filter((s) => inM(s['日期']) && ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0);
    ses.forEach((s) => {
      const x = v(str(s['據點']));
      x.venue += num(s['場地成本']);
      if (str(s['場次狀態']) === '已完成') {
        const c = PB.get('2_課程班級', s['班級']);
        if (m.isSingle(c)) {
          // 單堂專項：上完才認列，金額＝這堂所有報名的實收
          const rev = sum(PB.ix.sigByClass[str(s['班級'])] || [], (r) => m.sigPay(r['報名ID']).net);
          x.spRev += rev; x.cRev += rev; x.spN += 1;
        }
        x.sN += 1;
        x.coach += num(s['教練費']);
        x.sAtt += (PB.ix.attBySes[str(s['場次ID'])] || []).filter((a) => /出席/.test(str(a['狀態']))).length;
      }
    });
    PB.rows('3_堂數流水').filter((l) => inM(l['日期']) && LESSON_USE.indexOf(str(l['類型'])) >= 0).forEach((l) => {
      const c = lessonClass(l);
      if (m.isSingle(c)) return; // 專項課在上面依場次實收計算，不重複
      v(c ? str(c['據點']) : '').cRev += Math.abs(num(l['堂數'])) * unitPrice(c);
    });
    PB.rows('3_支出').filter((e) => inM(e['日期']) && NOT_OTHER.indexOf(str(e['細目'])) < 0).forEach((e) => { v(str(e['據點'])).other += num(e['金額']); });
    const pays = PB.rows('3_收款明細').filter((p) => inM(p['收款日期']) && (PB.cfg.payIgnore || []).indexOf(str(p['對帳狀態'])) < 0);
    const venues = Object.keys(V).map((k) => {
      const x = V[k];
      x.rev = x.gRev + x.cRev;
      x.cost = x.venue + x.coach + x.host + x.other;
      x.pl = x.rev - x.cost;
      return x;
    }).sort((a, b) => b.rev - a.rev);
    const T = venues.reduce((t, x) => { Object.keys(x).forEach((k) => { if (typeof x[k] === 'number') t[k] = (t[k] || 0) + x[k]; }); return t; }, {});
    const newStu = PB.rows('1_學員').filter((s) => inM(str(s['第一次接觸日期']) || str(s['建立時間'])));
    const conv = newStu.filter((s) => (PB.ix.sigByStu[str(s['學員ID'])] || []).some((r) => str(r['報名類型']) === '課程' && str(r['報名狀態']) !== '已取消'));
    const rent = sum(PB.rows('3_支出').filter((e) => inM(e['日期']) && str(e['細目']) === '場租'), (e) => e['金額']);
    return (memo[mon] = {
      T: T, venues: venues, types: types, games: games.length, ses: ses.length,
      cashIn: sum(pays.filter((p) => num(p['金額']) > 0), (p) => p['金額']),
      cashOut: sum(pays.filter((p) => num(p['金額']) < 0), (p) => p['金額']),
      pending: sum(pays.filter((p) => str(p['對帳狀態']) === '待確認'), (p) => p['金額']),
      newStu: newStu.length, conv: conv.length, rent: rent,
      cancels: cancelStats(mon),
    });
  }
  /** 取消原因統計（依取消時間的月份）：學員選的原因 × 課程／球敘，另列系統原因 */
  function cancelStats(mon) {
    const list = PB.rows('2_報名').filter((r) => str(r['報名狀態']) === '已取消' && str(r['取消時間']).slice(0, 7) === mon);
    const why = {};
    const sys = {};
    list.forEach((r) => {
      const k = str(r['學員取消原因']) || '（未填）';
      const o = (why[k] = why[k] || { k: k, 課程: 0, 專項: 0, 球敘: 0, n: 0 });
      const c = str(r['報名類型']) === '課程' ? PB.get('2_課程班級', r['班級']) : null;
      o[str(r['報名類型']) === '球敘' ? '球敘' : m.isSingle(c) ? '專項' : '課程'] += 1;
      o.n += 1;
      const sk = str(r['取消原因']) || '（未填）';
      sys[sk] = (sys[sk] || 0) + 1;
    });
    return { n: list.length, why: Object.keys(why).map((k) => why[k]).sort((a, b) => (a.k === '（未填）') - (b.k === '（未填）') || b.n - a.n), sys: sys };
  }
  function creditTotal() {
    return sum(PB.rows('3_抵用金流水'), (r) => r['金額']);
  }
  function owedNow() {
    return sum(PB.rows('3_應收帳款').filter((r) => r['作廢'] !== true), (r) => m.rec(r['應收ID']).left);
  }

  function barChart(list) {
    const W = 640, H = 210, pad = 34, bw = 18;
    const max = Math.max(1, ...list.map((x) => Math.max(x.rev, x.cost)));
    const step = (W - pad * 2) / list.length;
    const y = (v) => H - 26 - (v / max) * (H - 50);
    let g = '<line x1="' + pad + '" x2="' + (W - 8) + '" y1="' + (H - 26) + '" y2="' + (H - 26) + '" stroke="var(--line)"/>';
    list.forEach((x, i) => {
      const cx = pad + step * i + step / 2;
      g += '<rect x="' + (cx - bw - 1) + '" y="' + y(x.rev) + '" width="' + bw + '" height="' + (H - 26 - y(x.rev)) + '" rx="3" fill="var(--brand)"><title>' + x.mon + ' 收入 ' + money(x.rev) + '</title></rect>';
      g += '<rect x="' + (cx + 1) + '" y="' + y(x.cost) + '" width="' + bw + '" height="' + (H - 26 - y(x.cost)) + '" rx="3" fill="var(--warn)" opacity=".75"><title>' + x.mon + ' 成本 ' + money(x.cost) + '</title></rect>';
      g += '<text x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle" font-size="12" fill="var(--mut)">' + x.mon.slice(5) + '月</text>';
      g += '<text x="' + cx + '" y="' + (Math.min(y(x.rev), y(x.cost)) - 6) + '" text-anchor="middle" font-size="11" fill="' + (x.rev - x.cost < 0 ? 'var(--bad)' : 'var(--ok)') + '">' + (x.rev || x.cost ? (x.rev - x.cost < 0 ? '−' : '+') + Math.round(Math.abs(x.rev - x.cost) / 1000) + 'k' : '') + '</text>';
    });
    return '<div class="chart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="近 6 個月收入與成本">' + g + '</svg><div class="legend"><span><i style="background:var(--brand)"></i>營運收入</span><span><i style="background:var(--warn);opacity:.75"></i>營運成本</span><span>數字＝損益（千元）</span></div></div>';
  }

  const Dash = {
    id: 'dash', label: '總覽', icon: 'chart',
    render(p) {
      const mon = p.m || today().slice(0, 7);
      const S = stats(mon);
      const T = S.T;
      const tile = (l, v, d, cls) => '<div class="kpi ' + (cls || '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' + (d ? '<div class="d">' + d + '</div>' : '') + '</div>';
      const trend = months(6).reverse().map((x) => { const s = stats(x); return { mon: x, rev: s.T.rev || 0, cost: s.T.cost || 0 }; });
      const vrows = S.venues.map((x) => '<tr class="click" data-act="venueDrill" data-id="' + esc(x.id) + '" data-m="' + mon + '"><td>' + esc(x.id ? m.venueName(x.id) : '（未指定據點）') + '</td><td class="num">' + x.gN + '</td><td class="num">' + x.gHeads + '</td><td class="num">' + money(x.gRev) + '</td><td class="num">' + x.sN + '</td><td class="num">' + money(x.cRev) + '</td><td class="num">' + money(x.venue) + '</td><td class="num">' + money(x.coach) + '</td><td class="num">' + money(x.host) + '</td><td class="num">' + money(x.other) + '</td><td class="num" style="color:' + (x.pl < 0 ? 'var(--bad)' : 'var(--ok)') + '"><b>' + money(x.pl) + '</b></td></tr>').join('');
      const types = Object.keys(S.types).map((k) => { const t = S.types[k]; return '<tr><td>' + esc(k) + '</td><td class="num">' + t.n + '</td><td class="num">' + t.heads + '</td><td class="num">' + (t.n ? (t.heads / t.n).toFixed(1) : '—') + '</td><td class="num">' + money(t.rev) + '</td></tr>'; }).join('');
      return '<div class="ptop"><h1>營運總覽</h1><span class="sp"></span>' + monthSelect(mon, 'dashMonth') + (PB.cfg.legacyDashUrl ? '<a class="btn sm ghost" href="' + esc(PB.cfg.legacyDashUrl) + '" target="_blank" rel="noopener">' + PB.icon('ext') + '10 月整理 Dashboard</a>' : '') + '</div>' +
        '<div class="kpis">' +
        tile('營運收入', money(T.rev), '球敘 ' + money(T.gRev) + '・課程 ' + money(T.cRev)) +
        tile('營運成本', money(T.cost), '場地 ' + money(T.venue) + '・教練 ' + money(T.coach) + '・場主 ' + money(T.host) + (T.other ? '・其他 ' + money(T.other) : '')) +
        tile('營運損益', money(T.pl), '收入 − 成本（場次口徑）', T.pl < 0 ? 'neg' : 'pos') +
        tile('本月實收', money(S.cashIn + S.cashOut), (S.cashOut ? '退款 ' + money(S.cashOut) + '・' : '') + (S.pending ? '待對帳 ' + money(S.pending) : '全部已對帳')) +
        tile('球敘', (T.gN || 0) + ' 場', '報名 ' + (T.gHeads || 0) + ' 人次・平均 ' + (T.gN ? (T.gHeads / T.gN).toFixed(1) : '—') + '・簽到 ' + pct(T.gIn || 0, T.gHeads || 0)) +
        tile('課程', (T.sN || 0) + ' 堂', '出席 ' + (T.sAtt || 0) + ' 人次（已點名）' + (T.spN ? '・專項 ' + T.spN + ' 堂 ' + money(T.spRev) : '')) +
        tile('新學員', S.newStu + ' 位', '報名課程 ' + S.conv + ' 位（' + pct(S.conv, S.newStu) + '）') +
        tile('目前未收', money(owedNow()), '全部未作廢應收', owedNow() > 0 ? 'neg' : '') +
        (PB.has('3_抵用金流水') ? tile('抵用金（預收）', money(creditTotal()), '學員還沒用掉的抵用金；折抵時才算收入') : '') +
        '</div>' +
        sec('近 6 個月', '') + barChart(trend) +
        sec('各據點', mon) + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>據點</th><th class="num">球敘</th><th class="num">人次</th><th class="num">球敘收入</th><th class="num">上課</th><th class="num">課程收入</th><th class="num">場地成本</th><th class="num">教練費</th><th class="num">場主費</th><th class="num">其他</th><th class="num">損益</th></tr></thead><tbody>' + (vrows || '<tr><td colspan="11" class="mut">這個月沒有資料</td></tr>') +
        '</tbody><tfoot><tr><td>合計</td><td class="num">' + (T.gN || 0) + '</td><td class="num">' + (T.gHeads || 0) + '</td><td class="num">' + money(T.gRev) + '</td><td class="num">' + (T.sN || 0) + '</td><td class="num">' + money(T.cRev) + '</td><td class="num">' + money(T.venue) + '</td><td class="num">' + money(T.coach) + '</td><td class="num">' + money(T.host) + '</td><td class="num">' + money(T.other) + '</td><td class="num">' + money(T.pl) + '</td></tr></tfoot></table></div>' +
        '<div class="grid2" style="margin-top:12px"><div>' + sec('球敘類型', '') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>類型</th><th class="num">場次</th><th class="num">人次</th><th class="num">平均</th><th class="num">收入</th></tr></thead><tbody>' + (types || '<tr><td colspan="5" class="mut">—</td></tr>') + '</tbody></table></div></div>' +
        '<div>' + sec('口徑說明', '') + '<div class="card" style="padding:10px 14px;font-size:.84rem;color:var(--mut)"><ul style="margin:0;padding-left:18px">' +
        '<li>球敘收入：當月球敘的報名實收（含待對帳、扣除退款），依球敘日期</li><li>課程收入：期制班＝當月教練確認上課扣的堂數 × 每堂單價（班級費用 ÷ 總堂數），與分潤試算相同；專項課＝當月已上完的場次的報名實收</li><li>抵用金是預收：轉入時從原課程收入扣掉，折抵時才算進新課程</li><li>場地成本為場次分攤（換算單價 × 面時數）；本月實際場租應付 ' + money(S.rent) + '（支出，F03）</li><li>教練費只算已完成場次；場主費只算有簽到的排班</li><li>其他支出不含場租、教練費、場主費細目，避免重複</li></ul></div></div></div>' +
        cancelCard(S.cancels, mon);
    },
  };
  function cancelCard(cs, mon) {
    const rows = cs.why.map((o) => '<tr><td>' + esc(o.k) + '</td><td class="num">' + o.專項 + '</td><td class="num">' + o.課程 + '</td><td class="num">' + o.球敘 + '</td><td class="num"><b>' + o.n + '</b></td><td style="min-width:90px"><div class="bar" style="width:100%"><i style="width:' + Math.round((o.n / Math.max(1, cs.n)) * 100) + '%"></i></div></td></tr>').join('');
    const sys = Object.keys(cs.sys).map((k) => esc(k) + ' ' + cs.sys[k]).join('・');
    return sec('取消原因', mon + '・' + cs.n + ' 筆') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>學員說的原因</th><th class="num">專項課</th><th class="num">期制課</th><th class="num">球敘</th><th class="num">合計</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="mut">這個月沒有取消</td></tr>') + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.8rem">依取消時間的月份。「學員說的原因」由學員在 LINE 取消時選，或客服後台取消時選（' + esc((PB.enums.學員取消原因 || []).join('／')) + '）。' + (sys ? '系統分類：' + sys : '') + '</p>';
  }
  PB.inputs.dashMonth = (v) => PB.setParam('m', v);
  A.venueDrill = (d) => {
    const mon = d.m;
    const inM = (v) => day(v).slice(0, 7) === mon;
    ui.sheet(() => (d.id ? m.venueName(d.id) : '未指定據點') + '｜' + mon, () => {
      const gs = PB.rows('2_球敘場次').filter((g) => str(g['據點']) === d.id && inM(g['日期']) && ['取消', '草稿'].indexOf(str(g['狀態'])) < 0).sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
      const ss = PB.rows('2_上課場次').filter((s) => str(s['據點']) === d.id && inM(s['日期']) && ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0).sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
      const gRows = gs.map((g) => {
        const x = m.game(g);
        const rev = sum(x.sigs, (r) => m.sigPay(r['報名ID']).net);
        const host = sum(PB.ix.dutyByGame[str(g['球敘ID'])] || [], (dd) => (str(dd['簽到時間']) ? dd['場主費'] : 0));
        return '<tr><td>' + esc(fmtD(g['日期']) + ' ' + m.hm(g['開始時間'])) + '</td><td>' + esc(m.gameLabel(g)) + '</td><td class="num">' + x.active.length + '</td><td class="num">' + money(rev) + '</td><td class="num">' + money(g['場地成本']) + '</td><td class="num">' + money(host) + '</td><td class="num">' + money(rev - num(g['場地成本']) - host) + '</td></tr>';
      }).join('');
      const sRows = ss.map((s) => '<tr><td>' + esc(fmtD(s['日期']) + ' ' + m.hm(s['開始時間'])) + '</td><td>' + esc(m.classLabel(PB.get('2_課程班級', s['班級'])) + ' 第' + str(s['第幾堂']) + '堂') + '</td><td>' + esc(str(s['場次狀態'])) + '</td><td>' + esc(m.staffName(s['授課教練'])) + '</td><td class="num">' + money(s['教練費']) + '</td><td class="num">' + money(s['場地成本']) + '</td></tr>').join('');
      return sec('球敘', gs.length + ' 場') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>類型</th><th class="num">人數</th><th class="num">實收</th><th class="num">場地</th><th class="num">場主費</th><th class="num">損益</th></tr></thead><tbody>' + (gRows || '<tr><td colspan="7" class="mut">—</td></tr>') + '</tbody></table></div>' +
        sec('上課場次', ss.length + ' 堂') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>班級</th><th>狀態</th><th>教練</th><th class="num">教練費</th><th class="num">場地</th></tr></thead><tbody>' + (sRows || '<tr><td colspan="6" class="mut">—</td></tr>') + '</tbody></table></div>';
    });
  };

  // ================================================================
  // 管理待處理
  // ================================================================
  const Q = [];
  Q.push({
    title: '新人員待審核（場主／教練自行註冊）',
    items: () => PB.rows('1_人員').filter((p) => str(p['在職狀態']) === '待審核'),
    row: (p) => row({ t: esc(p['姓名']), s: esc([str(p['電話']), split(p['角色']).map((r) => (PB.get('0_角色', r) || {})['角色名稱'] || r).join('、'), str(p['備註'])].filter(Boolean).join('・')), r: btn('核准', 'staffOk', { id: p['人員ID'] }, 'pri') + btn('婉拒', 'staffNo', { id: p['人員ID'] }, 'bad') }),
  });
  Q.push({
    title: '待我確認的任務',
    items: () => PB.rows('4_工作任務').filter((t) => str(t['狀態']) === '待確認' && (str(t['建立人']) === PB.me.id || !str(t['建立人']))),
    row: (t) => row({ act: 'taskEdit', id: t['任務ID'], t: esc(t['工作名稱']), s: esc('負責人 ' + m.staffName(t['負責人']) + (str(t['完成成果']) ? '・' + str(t['完成成果']).slice(0, 60) : '')), r: btn('確認完成', 'taskOk', { id: t['任務ID'] }, 'pri') }),
  });
  Q.push({
    title: '處理中的異常事件',
    items: () => PB.rows('4_異常事件').filter((x) => str(x['狀態']) !== '已結案').sort((a, b) => byKey(str(a['發生時間']), str(b['發生時間']))),
    row: (x) => row({ act: 'incEdit', id: x['事件ID'], t: esc(x['標題']) + ' <span class="badge ' + (/受傷|金流/.test(str(x['類型'])) ? 'bad' : 'warn') + '">' + esc(x['類型']) + '</span>', s: esc(fmtDT(x['發生時間']) + '・' + m.venueName(x['據點']) + '・負責 ' + m.staffName(x['負責人']) + '・' + PB.daysBetween(x['發生時間'], today()) + ' 天'), r: btn('結案', 'incClose', { id: x['事件ID'] }, 'pri') }),
  });
  Q.push({
    title: '人員月結待處理',
    items: () => PB.rows('3_人員費用結算').filter((s) => ['試算中', '待付款'].indexOf(str(s['狀態'])) >= 0),
    row: (s) => row({ act: 'settleOpen', id: s['結算ID'], t: esc(str(s['月份']) + '｜' + m.staffName(s['人員']) + '｜' + str(s['結算類型'])) + ' <span class="badge ' + (str(s['狀態']) === '試算中' ? 'warn' : 'info') + '">' + esc(s['狀態']) + '</span>', s: esc('應付 ' + money(num(s['計算金額']) + num(s['調整金額']))) }),
    link: { label: '到財務處理', go: 'finance', p: { tab: '人員月結' } },
  });
  Q.push({
    title: '分潤結算待確認／付款',
    items: () => PB.rows('3_分潤結算').filter((s) => ['試算', '已確認'].indexOf(str(s['結算狀態'])) >= 0),
    row: (s) => row({ t: esc(str(s['月份']) + '｜' + m.label('3_合作方案', PB.get('3_合作方案', s['合作方案']))) + ' <span class="badge ' + (str(s['結算狀態']) === '試算' ? 'warn' : 'info') + '">' + esc(s['結算狀態']) + '</span>', s: esc('合作方 ' + money(s['合作方金額']) + '・理論上 ' + money(s['理論上金額'])) }),
    link: { label: '到財務處理', go: 'finance', p: { tab: '分潤結算' } },
  });
  Q.push({
    title: '應付支出（3 天內到期與逾期）',
    items: () => PB.rows('3_支出').filter((e) => str(e['付款狀態']) === '應付' && day(e['日期']) <= addDays(today(), 3)).sort((a, b) => byKey(day(a['日期']), day(b['日期']))),
    row: (e) => row({ act: 'expEdit', id: e['支出ID'], t: esc(fmtD(e['日期']) + '｜' + (str(e['細目']) || str(e['類別'])) + '｜' + money(e['金額'])) + (day(e['日期']) < today() ? ' <span class="badge bad">逾期</span>' : ''), s: esc([m.venueName(e['據點']), m.staffName(e['受款人員']), m.label('1_合作夥伴', PB.get('1_合作夥伴', e['受款夥伴'])), str(e['備註'])].filter(Boolean).join('・')), r: btn('已付', 'expPaid', { id: e['支出ID'] }, 'pri') }),
  });
  Q.push({
    title: '30 天內到期的合約與方案',
    items: () => {
      const t = today();
      const lim = addDays(t, 30);
      const docs = PB.rows('4_文件').filter((d) => day(d['合約到期日']) && day(d['合約到期日']) >= t && day(d['合約到期日']) <= lim).map((d) => ({ k: '文件', name: str(d['文件名稱']), d: day(d['合約到期日']) }));
      const plans = PB.rows('3_合作方案').filter((p) => day(p['失效日期']) && day(p['失效日期']) >= t && day(p['失效日期']) <= lim).map((p) => ({ k: '合作方案', name: str(p['方案名稱']), d: day(p['失效日期']), id: p['方案ID'] }));
      return docs.concat(plans).sort((a, b) => byKey(a.d, b.d));
    },
    row: (x) => row({ act: x.id ? 'planEdit' : '', id: x.id || '', t: esc(x.name) + ' <span class="badge">' + esc(x.k) + '</span>', s: esc('到期 ' + fmtD(x.d) + '（剩 ' + PB.daysBetween(today(), x.d) + ' 天）') }),
  });
  Q.push({
    title: '退款待辦（全部）',
    items: () => PB.rows('4_工作任務').filter((t) => str(t['狀態']) !== '完成' && /^退款/.test(str(t['工作名稱']))),
    row: (t) => row({ act: 'taskEdit', id: t['任務ID'], t: esc(t['工作名稱']), s: esc('負責人 ' + (m.staffName(t['負責人']) || '未指派') + '・' + str(t['狀態']) + (day(t['Deadline']) ? '・期限 ' + fmtD(t['Deadline']) : '')) }),
  });
  Q.push({
    title: '通知發送失敗（近 7 天）',
    items: () => PB.rows('9_通知紀錄').filter((n) => str(n['發送結果']) === '失敗' && day(n['發送時間']) >= addDays(today(), -7)),
    row: (n) => row({ t: esc((str(n['對象學員']) ? m.stuName(n['對象學員']) : m.staffName(n['對象人員'])) + '・' + str(n['通知類型'])), s: esc(fmtDT(n['發送時間']) + '・' + str(n['官方帳號']) + '・' + str(n['錯誤訊息']).slice(0, 80)) }),
  });
  const qCount = () => Q.reduce((s, d) => { try { return s + d.items().length; } catch (e) { return s; } }, 0);

  const Queue = {
    id: 'queue', label: '待處理', icon: 'inbox', badge: qCount,
    render(p) {
      const opsN = {
        待對帳: PB.rows('3_收款明細').filter((p) => str(p['對帳狀態']) === '待確認').length,
        待確認成班: PB.rows('2_課程班級').filter((c) => { const x = m.cls(c); return x && !x.single && (x.canDecide || x.pending); }).length,
        專項課過決定時間: PB.rows('2_課程班級').filter((c) => { const x = m.cls(c); return x && x.late && day(c['開課日期']) >= today(); }).length,
        球敘草稿: PB.rows('2_球敘場次').filter((g) => str(g['狀態']) === '草稿' && day(g['日期']) >= today()).length,
        待確認可用日: PB.rows('1_據點_可用日').filter((a) => str(a['狀態']) === '待確認' && day(a['日期']) >= today()).length,
      };
      const opsLine = Object.keys(opsN).filter((k) => opsN[k]).map((k) => k + ' ' + opsN[k]).join('・');
      const parts = ui.groups(Q.map((d, i) => {
        let items = [];
        try { items = d.items(); } catch (e) { return { id: 'q' + i, title: d.title, count: 1, body: () => { throw e; } }; }
        return { id: d.id || 'q' + i, title: d.title, count: items.length, right: d.link ? ui.btn(d.link.label, 'goTab', { go: d.link.go, tab: d.link.p.tab }, 'sm ghost') : '', body: () => card(items.slice(0, 40).map(d.row).join('')) };
      }), p, { key: 'queue' });
      return '<div class="ptop"><h1>管理待處理</h1></div>' +
        (opsLine ? '<div class="note" style="margin-bottom:8px">營運工作台：' + esc(opsLine) + (PB.cfg.opsUrl ? '　<a href="' + esc(PB.cfg.opsUrl) + '#/queue">前往處理</a>' : '') + '</div>' : '') +
        (parts || card(ui.empty('沒有待處理的事', '')));
    },
    after(page) { const c = page.querySelector('.grp-menu .chip.on'); if (c && c.parentNode.scrollWidth > c.parentNode.clientWidth) c.parentNode.scrollLeft = c.offsetLeft - 16; },
  };
  A.goTab = (d) => PB.go(d.go, { tab: d.tab });
  A.staffOk = (d) => PB.run('staffApprove', { ids: [d.id] }, { confirm: { title: '核准人員', text: esc(m.staffName(d.id)) + ' 的官方帳號功能會立即開通。', ok: '核准' } });
  A.staffNo = (d) => PB.run('staffApprove', { ids: [d.id], reject: true }, { confirm: { title: '婉拒', text: '在職狀態會改為「離職」。', danger: true, ok: '婉拒' } });
  A.taskOk = (d) => PB.run('taskApprove', { id: d.id });
  A.taskEdit = (d) => ui.form('4_工作任務', { id: d.id });
  A.incEdit = (d) => ui.form('4_異常事件', { id: d.id });
  A.incClose = async (d) => {
    const v = await ui.ask('結案', esc(str((PB.get('4_異常事件', d.id) || {})['標題'])), { fields: [{ k: 'how', label: '處理結果', t: 'text', req: true }], ok: '結案' });
    if (v) PB.run('incidentClose', { id: d.id, how: v.how });
  };

  // ================================================================
  // 財務
  // ================================================================
  const FIN_TABS = ['人員月結', '分潤結算', '支出', '應收總覽', '抵用金'];
  const Finance = {
    id: 'finance', label: '財務', icon: 'cash',
    render(p) {
      const tab = FIN_TABS.indexOf(p.tab) >= 0 ? p.tab : FIN_TABS[0];
      const mon = p.m || defaultSettleMonth();
      const head = '<div class="ptop"><h1>財務</h1><span class="sp"></span>' + (['應收總覽', '抵用金'].indexOf(tab) < 0 ? monthSelect(mon, 'finMonth') : '') + '</div><div class="tabs">' + FIN_TABS.map((t) => '<button class="' + (t === tab ? 'on' : '') + '" data-act="finTab" data-v="' + t + '">' + t + '</button>').join('') + '</div>';
      return head + ui.safe(() => ({ 人員月結: settleTab, 分潤結算: profitTab, 支出: expenseTab, 應收總覽: arTab, 抵用金: creditTab })[tab](mon, p), tab);
    },
  };
  function defaultSettleMonth() {
    const ms = PB.rows('3_人員費用結算').filter((s) => str(s['狀態']) !== '已付款').map((s) => str(s['月份'])).sort();
    return ms[0] || months(2)[1];
  }
  A.finTab = (d) => PB.go('finance', Object.assign({}, PB.params(), { tab: d.v }));
  PB.inputs.finMonth = (v) => PB.setParam('m', v);

  function settleTab(mon) {
    const list = PB.rows('3_人員費用結算').filter((s) => str(s['月份']) === mon).sort((a, b) => byKey(str(a['結算類型']) + m.staffName(a['人員']), str(b['結算類型']) + m.staffName(b['人員'])));
    const tot = (st) => sum(list.filter((s) => !st || str(s['狀態']) === st), (s) => num(s['計算金額']) + num(s['調整金額']));
    const rows = list.map((s) => '<tr class="click" data-act="settleOpen" data-id="' + esc(s['結算ID']) + '"><td onclick="event.stopPropagation()"><input type="checkbox" data-q="settle" value="' + esc(s['結算ID']) + '"></td><td>' + esc(m.staffName(s['人員'])) + '</td><td>' + esc(s['結算類型']) + '</td><td class="num">' + money(s['計算金額']) + '</td><td class="num">' + (num(s['調整金額']) ? money(s['調整金額']) : '') + '</td><td class="num"><b>' + money(num(s['計算金額']) + num(s['調整金額'])) + '</b></td><td><span class="badge ' + ({ 試算中: 'warn', 待付款: 'info', 已付款: 'ok' }[str(s['狀態'])] || '') + '">' + esc(s['狀態']) + '</span>' + (day(s['付款日期']) ? ' <span class="mut">' + fmtD(s['付款日期']) + '</span>' : '') + '</td><td class="mut" style="white-space:normal">' + esc(s['調整原因']) + '</td></tr>').join('');
    return '<div class="acts">' + btn('勾選的送出付款', 'settleTo', { to: '待付款' }, 'pri') + btn('勾選的標記已付款', 'settleTo', { to: '已付款' }) + btn('退回試算', 'settleTo', { to: '試算中' }, 'ghost') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>人員</th><th>類型</th><th class="num">計算</th><th class="num">調整</th><th class="num">應付</th><th>狀態</th><th>調整原因</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">這個月沒有結算單（每月 1 日 06:00 由系統產生上個月的試算）</td></tr>') +
      '</tbody><tfoot><tr><td></td><td colspan="4">合計（試算中 ' + money(tot('試算中')) + '・待付款 ' + money(tot('待付款')) + '）</td><td class="num">' + money(tot()) + '</td><td colspan="2"></td></tr></tfoot></table></div>' +
      '<p class="mut" style="font-size:.8rem">試算中可以調整金額；送出付款後不能再改。改了場次的教練費／場主費後，請在管理 GAS 執行 f01Recalc() 重算。</p>';
  }
  A.settleTo = async (d) => {
    const ids = checked('settle');
    if (!ids.length) return ui.toast('請先勾選');
    let date = '';
    if (d.to === '已付款') {
      const v = await ui.ask('標記已付款 ' + ids.length + ' 筆', '合計 ' + money(sum(ids, (id) => { const s = PB.get('3_人員費用結算', id); return num(s['計算金額']) + num(s['調整金額']); })), { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付款' });
      if (!v) return;
      date = v.date;
    }
    PB.run('settleStatus', { ids: ids, to: d.to, date: date });
  };
  A.settleOpen = (d) => {
    ui.sheet(() => { const s = PB.get('3_人員費用結算', d.id); return s ? str(s['月份']) + '｜' + m.staffName(s['人員']) + '｜' + str(s['結算類型']) : null; }, () => {
      const s = PB.get('3_人員費用結算', d.id);
      const isCoach = str(s['結算類型']) === '教練費';
      const items = isCoach ? PB.rows('2_上課場次').filter((x) => str(x['費用結算']) === d.id) : PB.rows('2_場主排班').filter((x) => str(x['費用結算']) === d.id);
      const rows = items.sort((a, b) => byKey(day(isCoach ? a['日期'] : (PB.get('2_球敘場次', a['球敘']) || {})['日期']), day(isCoach ? b['日期'] : (PB.get('2_球敘場次', b['球敘']) || {})['日期']))).map((x) => {
        if (isCoach) return '<tr><td>' + esc(fmtD(x['日期']) + ' ' + m.hm(x['開始時間'], x['結束時間'])) + '</td><td>' + esc(m.classLabel(PB.get('2_課程班級', x['班級']))) + '</td><td class="num">' + money(x['教練費']) + '</td></tr>';
        const g = PB.get('2_球敘場次', x['球敘']);
        return '<tr><td>' + esc(g ? fmtD(g['日期']) + ' ' + m.hm(g['開始時間'], g['結束時間']) : '') + '</td><td>' + esc(g ? m.venueName(g['據點']) + '・' + m.gameLabel(g) : '') + '</td><td class="num">' + money(x['場主費']) + '</td></tr>';
      }).join('');
      return '<div class="acts">' + (str(s['狀態']) === '試算中' ? ui.btn('調整金額', 'settleEdit', { id: d.id }, 'pri') : '') + '</div>' +
        '<dl class="kv"><dt>狀態</dt><dd>' + esc(s['狀態']) + (day(s['付款日期']) ? '（' + fmtD(s['付款日期']) + ' 付款）' : '') + '</dd><dt>計算金額</dt><dd>' + money(s['計算金額']) + '</dd><dt>調整</dt><dd>' + money(s['調整金額']) + ' ' + esc(s['調整原因']) + '</dd><dt>應付</dt><dd><b>' + money(num(s['計算金額']) + num(s['調整金額'])) + '</b></dd></dl>' +
        sec('明細', items.length + ' 筆') + '<div class="tbl-wrap"><table class="tbl"><tbody>' + (rows || '<tr><td class="mut">沒有明細</td></tr>') + '</tbody></table></div>';
    });
  };
  A.settleEdit = (d) => ui.form('3_人員費用結算', { id: d.id, title: '調整金額' });

  function profitTab(mon) {
    const list = PB.rows('3_分潤結算').filter((s) => str(s['月份']) === mon);
    const rows = list.map((s) => {
      const can = num(s['本月總收入']) - num(s['場地成本']) - num(s['教練成本']) - num(s['場主成本']) - num(s['其他成本']);
      return '<tr><td><input type="checkbox" data-q="profit" value="' + esc(s['結算ID']) + '"></td><td>' + esc(m.label('3_合作方案', PB.get('3_合作方案', s['合作方案']))) + '</td><td class="num">' + money(s['本月總收入']) + '</td><td class="num">' + money(s['場地成本']) + '</td><td class="num">' + money(s['教練成本']) + '</td><td class="num">' + money(s['場主成本']) + '</td><td class="num">' + money(s['其他成本']) + '</td><td class="num">' + money(can) + '</td><td class="num">' + money(s['理論上金額']) + '</td><td class="num"><b>' + money(s['合作方金額']) + '</b></td><td><span class="badge ' + ({ 試算: 'warn', 已確認: 'info', 已付款: 'ok' }[str(s['結算狀態'])] || '') + '">' + esc(s['結算狀態']) + '</span></td></tr>';
    }).join('');
    return '<div class="acts">' + btn('勾選的確認', 'profitTo', { to: '已確認' }, 'pri') + btn('勾選的標記已付款', 'profitTo', { to: '已付款' }) + btn('退回試算', 'profitTo', { to: '試算' }, 'ghost') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>合作方案</th><th class="num">總收入</th><th class="num">場地</th><th class="num">教練</th><th class="num">場主</th><th class="num">其他</th><th class="num">可分潤</th><th class="num">理論上</th><th class="num">合作方</th><th>狀態</th></tr></thead><tbody>' + (rows || '<tr><td colspan="11" class="mut">這個月沒有分潤結算（每月 1 日由系統試算）</td></tr>') + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.8rem">試算可重算覆蓋；確認後系統不再改動。分潤虧損時合作方金額＝0（我方吸收）。</p>';
  }
  A.profitTo = async (d) => {
    const ids = checked('profit');
    if (!ids.length) return ui.toast('請先勾選');
    let date = '';
    if (d.to === '已付款') {
      const v = await ui.ask('標記已付款 ' + ids.length + ' 筆', '', { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付款' });
      if (!v) return;
      date = v.date;
    }
    PB.run('profitStatus', { ids: ids, to: d.to, date: date });
  };

  function expenseTab(mon) {
    const list = PB.rows('3_支出').filter((e) => day(e['日期']).slice(0, 7) === mon).sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
    const rows = list.map((e) => '<tr class="click" data-act="expEdit" data-id="' + esc(e['支出ID']) + '"><td onclick="event.stopPropagation()">' + (str(e['付款狀態']) === '應付' ? '<input type="checkbox" data-q="exp" value="' + esc(e['支出ID']) + '">' : '') + '</td><td>' + esc(fmtD(e['日期'])) + '</td><td>' + esc(str(e['類別']) + (str(e['細目']) ? '／' + e['細目'] : '')) + '</td><td class="num">' + money(e['金額']) + '</td><td>' + esc(m.venueName(e['據點'])) + '</td><td>' + esc(m.staffName(e['受款人員']) || m.label('1_合作夥伴', PB.get('1_合作夥伴', e['受款夥伴']))) + '</td><td><span class="badge ' + (str(e['付款狀態']) === '已付' ? 'ok' : 'warn') + '">' + esc(e['付款狀態']) + '</span></td><td class="mut" style="white-space:normal">' + esc(str(e['備註']).slice(0, 60)) + '</td></tr>').join('');
    return '<div class="acts">' + btn('新增支出', 'expNew', {}, 'pri', 'plus') + btn('勾選的標記已付', 'expPaidChecked', {}) + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>日期</th><th>類別</th><th class="num">金額</th><th>據點</th><th>受款</th><th>狀態</th><th>備註</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">這個月沒有支出</td></tr>') + '</tbody><tfoot><tr><td></td><td colspan="2">合計（應付 ' + money(sum(list.filter((e) => str(e['付款狀態']) === '應付'), (e) => e['金額'])) + '）</td><td class="num">' + money(sum(list, (e) => e['金額'])) + '</td><td colspan="4"></td></tr></tfoot></table></div>' +
      '<p class="mut" style="font-size:.8rem">包場租金由系統每月 1 日依合作方案自動建立（備註 F03:…）。</p>';
  }
  A.expNew = () => ui.form('3_支出', {});
  A.expEdit = (d) => ui.form('3_支出', { id: d.id });
  A.expPaid = async (d) => {
    const v = await ui.ask('標記已付', '', { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付' });
    if (v) PB.run('expensePaid', { ids: [d.id], date: v.date });
  };
  A.expPaidChecked = async () => {
    const ids = checked('exp');
    if (!ids.length) return ui.toast('請先勾選');
    const v = await ui.ask('標記已付 ' + ids.length + ' 筆', '', { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付' });
    if (v) PB.run('expensePaid', { ids: ids, date: v.date });
  };

  function arTab(mon, p) {
    const only = p.all !== '1';
    const kw = str(p.q).toLowerCase();
    let list = PB.rows('3_應收帳款').filter((r) => r['作廢'] !== true);
    if (only) list = list.filter((r) => m.rec(r['應收ID']).left > 0);
    if (kw) list = list.filter((r) => (m.stuName(r['學員']) + m.stuName(r['付款人']) + str(r['項目說明'])).toLowerCase().indexOf(kw) >= 0);
    list.sort((a, b) => byKey(day(a['建立日期']), day(b['建立日期'])));
    const rows = list.slice(0, 300).map((r) => {
      const x = m.rec(r['應收ID']);
      const sig = PB.get('2_報名', r['報名']);
      return '<tr><td>' + esc(fmtD(r['建立日期'])) + '</td><td>' + esc(m.stuName(str(r['付款人']) || r['學員'])) + (str(r['付款人']) && str(r['付款人']) !== str(r['學員']) ? '<br><span class="mut">替 ' + esc(m.stuName(r['學員'])) + '</span>' : '') + '</td><td style="white-space:normal;min-width:160px">' + esc(str(r['項目說明']) || str(r['收入來源'])) + '<br><span class="mut">' + esc(str(r['款項類別'])) + (sig ? '・' + esc(str(sig['報名狀態'])) : '') + '</span></td><td class="num">' + money(x.due) + '</td><td class="num">' + money(x.net) + '</td><td class="num"><b>' + money(x.left) + '</b></td><td>' + m.payBadge(x.status) + '</td><td>' + esc(sig && str(sig['付款期限']) ? fmtDT(sig['付款期限']) : fmtD(r['到期日'])) + '</td></tr>';
    }).join('');
    return '<div class="ptop"><div class="chips"><button class="chip' + (only ? ' on' : '') + '" data-act="param2" data-k="all" data-v="">未收</button><button class="chip' + (!only ? ' on' : '') + '" data-act="param2" data-k="all" data-v="1">全部</button></div><span class="sp"></span><label class="search">' + PB.icon('search') + '<input placeholder="學員、項目" value="' + esc(p.q || '') + '" data-input="arSearch"></label></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>建立</th><th>付款人</th><th>項目</th><th class="num">應收</th><th class="num">已付</th><th class="num">未收</th><th>狀態</th><th>期限</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">沒有資料</td></tr>') + '</tbody><tfoot><tr><td colspan="3">合計 ' + list.length + ' 筆</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).due)) + '</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).net)) + '</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).left)) + '</td><td colspan="2"></td></tr></tfoot></table></div>' +
      '<p class="mut" style="font-size:.8rem">收款、提醒、退款請在營運工作台的學員頁處理（一人一筆帳）。</p>';
  }
  /** 抵用金：各付款人餘額＋近期流水（查詢用；轉入、折抵、退現在營運工作台的學員頁操作） */
  function creditTab(mon, p) {
    if (!PB.has('3_抵用金流水')) return '<div class="note warn">還沒有「3_抵用金流水」工作表。請在 3_財務 新增，第一列欄位：流水ID、付款人、金額、類型、來源報名、對應應收、建立時間、經手人、備註。</div>';
    const all = PB.rows('3_抵用金流水');
    const by = PB.groupBy(all, '付款人');
    const kw = str(p.q).toLowerCase();
    let list = Object.keys(by).map((k) => ({ id: k, bal: sum(by[k], (r) => r['金額']), inn: sum(by[k].filter((r) => num(r['金額']) > 0), (r) => r['金額']), n: by[k].length, last: by[k].map((r) => str(r['建立時間'])).sort().pop() }));
    if (p.all !== '1') list = list.filter((x) => x.bal !== 0);
    if (kw) list = list.filter((x) => m.stuName(x.id).toLowerCase().indexOf(kw) >= 0);
    list.sort((a, b) => b.bal - a.bal);
    const rows = list.map((x) => '<tr><td>' + esc(m.stuName(x.id)) + '</td><td class="num"><b>' + money(x.bal) + '</b></td><td class="num">' + money(x.inn) + '</td><td class="num">' + x.n + '</td><td>' + esc(fmtDT(x.last)) + '</td></tr>').join('');
    const T = { 轉入: 0, 折抵: 0, 退現: 0, 調整: 0 };
    all.forEach((r) => { T[str(r['類型'])] = (T[str(r['類型'])] || 0) + num(r['金額']); });
    const recent = all.slice().sort((a, b) => byKey(str(b['建立時間']), str(a['建立時間']))).slice(0, 40)
      .map((r) => '<tr><td>' + esc(fmtDT(r['建立時間'])) + '</td><td>' + esc(m.stuName(r['付款人'])) + '</td><td>' + esc(r['類型']) + '</td><td class="num">' + money(r['金額']) + '</td><td style="white-space:normal">' + esc([PB.get('2_報名', r['來源報名']) ? m.sigTarget(PB.get('2_報名', r['來源報名'])) : '', str(r['備註'])].filter(Boolean).join('・')) + '</td><td>' + esc(m.staffName(r['經手人'])) + '</td></tr>').join('');
    return '<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="l">目前餘額合計（預收）</div><div class="v">' + money(sum(all, (r) => r['金額'])) + '</div></div><div class="kpi"><div class="l">累計轉入</div><div class="v">' + money(T.轉入) + '</div></div><div class="kpi"><div class="l">累計折抵</div><div class="v">' + money(-T.折抵) + '</div></div><div class="kpi"><div class="l">累計退現</div><div class="v">' + money(-T.退現) + '</div></div></div>' +
      '<div class="ptop"><div class="chips"><button class="chip' + (p.all !== '1' ? ' on' : '') + '" data-act="param2" data-k="all" data-v="">有餘額</button><button class="chip' + (p.all === '1' ? ' on' : '') + '" data-act="param2" data-k="all" data-v="1">全部</button></div><span class="sp"></span><label class="search">' + PB.icon('search') + '<input placeholder="學員" value="' + esc(p.q || '') + '" data-input="arSearch"></label></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>付款人</th><th class="num">餘額</th><th class="num">累計轉入</th><th class="num">筆數</th><th>最近</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' +
      sec('最近 40 筆', '') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>付款人</th><th>類型</th><th class="num">金額</th><th>來源／備註</th><th>經手</th></tr></thead><tbody>' + (recent || '<tr><td colspan="6" class="mut">—</td></tr>') + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.8rem">抵用金只來自已付的課費、不設到期日、可申請退現。轉入、折抵、退現請在營運工作台的學員頁操作。</p>';
  }
  A.param2 = (d) => PB.setParam(d.k, d.v);
  let arTimer;
  PB.inputs.arSearch = (v) => { clearTimeout(arTimer); arTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="arSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };

  // ================================================================
  // 主檔設定（依 Forms 規格的通用清單＋表單）
  // ================================================================
  const D = {
    據點: { t: '1_據點', cols: [['名稱', (r) => r['據點名稱']], ['類別', (r) => r['據點類別'] || ''], ['區域', (r) => r['區域']], ['場主', (r) => m.staffName(r['場主'])], ['面數', (r) => (PB.ix.courtByVenue[str(r['據點ID'])] || []).length], ['狀態', (r) => r['狀態']]] },
    場地: { t: '1_據點_場地', cols: [['據點', (r) => m.venueName(r['據點'])], ['場地', (r) => r['場地名稱']], ['人數', (r) => r['人數上限']], ['類型', (r) => split(r['類型']).join('、')], ['狀態', (r) => r['狀態']]], sort: (r) => m.venueName(r['據點']) },
    時段: { t: '1_據點_時段', cols: [['據點', (r) => m.venueName(r['據點'])], ['時段', (r) => m.slotLabel(r)], ['場地', (r) => split(r['使用場地']).map(m.courtName).join('、')], ['期間', (r) => fmtD(r['生效日期']) + '～' + fmtD(r['結束日期'])], ['週期', (r) => r['週期']], ['可用日', (r) => (PB.ix.availBySlot[str(r['時段ID'])] || []).filter((a) => str(a['狀態']) === '可用' && day(a['日期']) >= today()).length + ' 天'], ['狀態', (r) => r['狀態']]],
      sort: (r) => m.venueName(r['據點']) + '週' + '一二三四五六日'.indexOf(str(r['星期'])),
      acts: (r) => btn('產生可用日', 'slotAvail', { id: r['時段ID'] }) + btn('產生球敘草稿', 'slotDrafts', { id: r['時段ID'] }, 'ghost') + btn('可用日', 'availOf', { id: r['時段ID'] }, 'ghost') },
    可用日: { t: '1_據點_可用日', custom: true },
    人員: { t: '1_人員', cols: [['姓名', (r) => r['姓名']], ['角色', (r) => split(r['角色']).map((x) => (PB.get('0_角色', x) || {})['角色名稱'] || x).join('、')], ['Email', (r) => r['Email']], ['電話', (r) => r['電話']], ['LINE', (r) => (str(r['LINE_userId']) ? '已綁定' : '')], ['狀態', (r) => r['在職狀態']]],
      acts: (r) => (str(r['在職狀態']) === '待審核' ? btn('核准', 'staffOk', { id: r['人員ID'] }, 'pri') : '') + btn('請款資料', 'secret', { id: r['人員ID'] }, 'ghost') },
    教練: { t: '1_人員_教練', cols: [['教練', (r) => m.staffName(r['人員ID'])], ['可教程度', (r) => split(r['可教程度']).map(m.levelName).join('、')], ['證照', (r) => r['證照']], ['擅長', (r) => str(r['擅長項目']).slice(0, 30)]] },
    合作方案: { t: '3_合作方案', cols: [['方案', (r) => r['方案名稱']], ['對象', (r) => str(r['合作對象類型']) + '：' + (str(r['合作對象類型']) === '人員' ? m.staffName(r['人員']) : str(r['合作對象類型']) === '合作夥伴' ? m.label('1_合作夥伴', PB.get('1_合作夥伴', r['合作夥伴'])) : m.venueName(r['據點']))], ['模式', (r) => str(r['合作模式']) + '・' + str(r['適用範圍'])], ['條件', (r) => planTerms(r)], ['期間', (r) => fmtD(r['生效日期']) + '～' + fmtD(r['失效日期'])]] },
    合作夥伴: { t: '1_合作夥伴', cols: [['名稱', (r) => r['名稱']], ['類型', (r) => r['類型']], ['聯絡人', (r) => r['聯絡人']], ['電話', (r) => r['電話']]] },
    程度: { t: '0_程度', cols: [['程度', (r) => r['程度名稱']], ['排序', (r) => r['排序']], ['說明', (r) => str(r['說明']).slice(0, 40)]], sort: (r) => ('000' + num(r['排序'])).slice(-3) },
    專項: { t: '0_專項', cols: [['專項', (r) => r['專項名稱']], ['建議程度', (r) => m.levelName(r['程度'])], ['人數', (r) => (str(r['人數下限']) || '5') + '–' + (str(r['人數上限']) || '6')], ['費用', (r) => (num(r['費用']) > 0 ? num(r['費用']).toLocaleString() : '依據點')], ['說明', (r) => str(r['說明']).slice(0, 40)], ['啟用', (r) => (r['是否啟用'] === false ? '停用' : '啟用')]], sort: (r) => ('000' + num((PB.get('0_程度', r['程度']) || {})['排序'])).slice(-3) + str(r['專項名稱']) },
    課程類型: { t: '0_課程類型', cols: [['類型', (r) => r['課程類型']], ['標準教練費', (r) => (str(r['標準教練費']) ? money(r['標準教練費']) + '／' + str(r['計費方式']) : '')], ['請假上限', (r) => r['每期請假上限']], ['補課', (r) => (str(r['補課起算']) ? r['補課起算'] + ' + ' + (str(r['補課天數']) || 30) + ' 天' : '')]] },
    課程模板: { t: '0_課程模板', cols: [['模板', (r) => r['模板名稱']], ['類型', (r) => m.typeName(r['課程類型'])], ['人數', (r) => str(r['人數下限']) + '–' + str(r['人數上限'])], ['費用', (r) => (str(r['費用']) ? money(r['費用']) + '／' + str(r['計費方式']) : '')], ['堂數', (r) => r['總堂數']]] },
    教練費率: { t: '0_教練費率', cols: [['教練', (r) => m.staffName(r['教練'])], ['課程類型', (r) => m.typeName(r['課程類型'])], ['基準', (r) => r['基準']], ['費率', (r) => money(r['教練費']) + '／' + str(r['計價方式'])]], sort: (r) => m.staffName(r['教練']) },
    角色: { t: '0_角色', cols: [['角色', (r) => r['角色名稱']], ['歸屬', (r) => r['歸屬']], ['工作區', (r) => split(r['權限']).join('、')], ['說明', (r) => str(r['說明']).slice(0, 40)]] },
    // v2：紀錄類
    決策紀錄: { t: '4_決策紀錄', cols: [['日期', (r) => fmtD(r['日期'])], ['議題', (r) => r['議題']], ['最後決策', (r) => str(r['最後決策']).slice(0, 40)], ['決策人', (r) => m.staffName(r['決策人'])], ['執行', (r) => m.staffName(r['負責執行人'])], ['生效', (r) => fmtD(r['生效日期'])]],
      sort: (r) => 'z' + String(99999999 - Number(day(r['日期']).replace(/-/g, '') || 0)).padStart(8, '0') },
    文件: { t: '4_文件', cols: [['文件', (r) => r['文件名稱']], ['類別', (r) => r['類別']], ['可查看', (r) => (split(r['可查看角色']).map((x) => (PB.get('0_角色', x) || {})['角色名稱'] || x).join('、') || '所有人')], ['版本', (r) => r['版本']], ['更新', (r) => fmtD(r['更新日期'])], ['到期', (r) => fmtD(r['合約到期日'])]],
      sort: (r) => str(r['類別']) + str(r['文件名稱']), acts: (r) => (str(r['連結']) ? '<a class="btn sm ghost" href="' + esc(r['連結']) + '" target="_blank" rel="noopener">' + PB.icon('ext') + '開啟</a>' : '<span class="badge warn">沒有連結</span>') },
    通知紀錄: { t: '9_通知紀錄', custom: 'notify' },
  };
  function planTerms(r) {
    const mode = str(r['合作模式']);
    if (mode === '比例分潤') return '我方 ' + Math.round(num(r['我方比例']) * 100) + '%（' + str(r['計算基礎']) + '）';
    if (mode === '人頭抽成') return '每人 ' + money(r['每人抽成']);
    if (mode === '按次租用') return money(r['每面每小時單價']) + '／面／時';
    if (mode === '包場租約' || mode === '外包') return money(r['合約金額']) + (str(r['付款週期']) ? '・' + str(r['付款週期']) : '');
    return '';
  }

  const Data = {
    id: 'data', label: '主檔與紀錄', icon: 'db',
    render(p) {
      const k = D[p.k] ? p.k : '據點';
      const def = D[k];
      const chips = '<div class="chips" style="margin-bottom:12px">' + Object.keys(D).map((x) => '<button class="chip' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + x + '</button>').join('') + '</div>';
      if (def.custom) return '<div class="ptop"><h1>主檔與紀錄</h1></div>' + chips + (def.custom === 'notify' ? notifyView(p) : availView(p));
      const kw = str(p.q).toLowerCase();
      let list = PB.rows(def.t);
      if (kw) list = list.filter((r) => def.cols.map((c) => str(c[1](r))).join(' ').toLowerCase().indexOf(kw) >= 0);
      if (def.sort) list = list.slice().sort((a, b) => byKey(def.sort(a), def.sort(b)));
      const key = PB.db.keys[def.t];
      const rows = list.map((r) => '<tr class="click" data-act="dataEdit" data-t="' + def.t + '" data-id="' + esc(r[key]) + '">' + def.cols.map((c) => '<td>' + esc(c[1](r)) + '</td>').join('') + (def.acts ? '<td onclick="event.stopPropagation()" style="text-align:right">' + def.acts(r) + '</td>' : '') + '</tr>').join('');
      const canNew = PB.forms[def.t] && PB.forms[def.t].create;
      return '<div class="ptop"><h1>主檔與紀錄</h1><span class="sp"></span>' + (canNew ? ui.btn('新增' + k, 'dataNew', { t: def.t }, 'pri', 'plus') : '') + '</div>' + chips +
        '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="搜尋" value="' + esc(p.q || '') + '" data-input="dataSearch"></label><span class="sp"></span><span class="mut">' + list.length + ' 筆</span></div>' +
        (PB.has(def.t) ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + def.cols.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + (def.acts ? '<th></th>' : '') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' : '<div class="err-box">「' + esc(def.t) + '」沒有載入（工作表不存在或未設定試算表）</div>');
    },
  };
  A.dataK = (d) => PB.go('data', { k: d.v });
  A.dataEdit = (d) => ui.form(d.t, { id: d.id });
  A.dataNew = (d) => ui.form(d.t, {});
  A.planEdit = (d) => ui.form('3_合作方案', { id: d.id });
  let dataTimer;
  PB.inputs.dataSearch = (v) => { clearTimeout(dataTimer); dataTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="dataSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };
  A.slotAvail = (d) => PB.run('slotGenAvail', { id: d.id }, { confirm: { title: '產生可用日', text: '依生效～結束日期與週期展開「待確認」可用日（已存在的日期略過；國定假日會標記）。產生後請到可用日確認。', ok: '產生' } });
  A.slotDrafts = (d) => PB.run('slotGenDrafts', { id: d.id }, { confirm: { title: '產生球敘草稿', text: '依這個時段之後的「可用」日，在沒被課程佔用的場地建立球敘草稿；費用與類型沿用上一場。草稿要在營運工作台確認後開放報名。', ok: '產生' } });
  A.availOf = (d) => PB.go('data', { k: '可用日', slot: d.id });

  function availView(p) {
    const slot = p.slot || '';
    const st = p.st || '待確認';
    const t = today();
    let list = PB.rows('1_據點_可用日').filter((a) => (!slot || str(a['時段']) === slot) && (st === '全部' || str(a['狀態']) === st) && (p.past === '1' || day(a['日期']) >= t));
    list = list.sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
    const slots = PB.rows('1_據點_時段').slice().sort((a, b) => byKey(m.venueName(a['據點']) + a['星期'], m.venueName(b['據點']) + b['星期']));
    const rows = list.slice(0, 300).map((a) => {
      const s = PB.get('1_據點_時段', a['時段']);
      const used = (PB.ix.sesByDay[day(a['日期'])] || []).filter((x) => str(x['時段']) === str(a['時段']) && ['取消', '改期'].indexOf(str(x['場次狀態'])) < 0).length + (PB.ix.gameByDay[day(a['日期'])] || []).filter((g) => str(g['時段']) === str(a['時段']) && str(g['狀態']) !== '取消').length;
      return '<tr><td>' + (str(a['狀態']) !== '取消' ? '<input type="checkbox" data-q="avail" value="' + esc(a['可用日ID']) + '">' : '') + '</td><td>' + esc(fmtD(a['日期'])) + (a['假日標記'] === true ? ' <span class="badge warn">假日</span>' : '') + '</td><td>' + esc(m.venueName(s && s['據點'])) + '</td><td>' + esc(m.slotLabel(s)) + '</td><td><span class="badge ' + ({ 可用: 'ok', 待確認: 'warn', 取消: 'bad' }[str(a['狀態'])] || '') + '">' + esc(a['狀態']) + '</span>' + (str(a['取消原因']) ? ' <span class="mut">' + esc(a['取消原因']) + '</span>' : '') + '</td><td class="num">' + (used ? used + ' 場' : '') + '</td></tr>';
    }).join('');
    return '<div class="ptop"><select class="btn" data-input="availSlot"><option value="">全部時段</option>' + slots.map((s) => '<option value="' + esc(s['時段ID']) + '"' + (str(s['時段ID']) === slot ? ' selected' : '') + '>' + esc(m.venueName(s['據點']) + '｜' + m.slotLabel(s)) + '</option>').join('') + '</select>' +
      '<div class="chips">' + ['待確認', '可用', '取消', '全部'].map((x) => '<button class="chip' + (x === st ? ' on' : '') + '" data-act="param2" data-k="st" data-v="' + x + '">' + x + '</button>').join('') + '<button class="chip' + (p.past === '1' ? ' on' : '') + '" data-act="param2" data-k="past" data-v="' + (p.past === '1' ? '' : '1') + '">含過去</button></div><span class="sp"></span>' +
      ui.btn('新增單日', 'availNew', { slot: slot }, 'sm', 'plus') + '</div>' +
      '<div class="acts">' + btn('勾選的確認可用', 'availOk', {}, 'pri') + btn('勾選的取消', 'availNo', {}, 'bad') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>日期</th><th>據點</th><th>時段</th><th>狀態</th><th class="num">已排</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.8rem">取消可用日後，系統會寄出受影響的課程與球敘；課程請在營運工作台逐堂改期，球敘請取消。</p>';
  }
  PB.inputs.availSlot = (v) => PB.setParam('slot', v);

  // 通知紀錄查詢（v2）：按「查詢」才讀全部紀錄（開頁只帶近 30 天）
  const NQ = { res: null, busy: false, f: null };
  function notifyView(p) {
    const f = Object.assign({ from: addDays(today(), -30), to: today(), type: '', result: '', q: '' }, NQ.f || {});
    const types = (NQ.res && NQ.res.types) || uniq(PB.rows('9_通知紀錄').map((n) => str(n['通知類型'])).filter(Boolean)).sort();
    const sel = (k, list, all) => '<select class="btn" data-nq="' + k + '"><option value="">' + all + '</option>' + list.map((x) => '<option' + (x === f[k] ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
    const RES = { 成功: 'ok', 失敗: 'bad', 略過: 'warn' };
    const r = NQ.res;
    const target = (x) => (str(x['對象學員']) ? m.stuName(x['對象學員']) : str(x['對象人員']) ? m.staffName(x['對象人員']) + '（人員）' : '');
    const rows = r ? r.rows.map((x) => '<tr><td>' + esc(fmtDT(x['發送時間'])) + '</td><td>' + esc(x['官方帳號']) + '</td><td>' + esc(target(x)) + '</td><td>' + esc(x['通知類型']) + '</td><td><span class="badge ' + (RES[str(x['發送結果'])] || '') + '">' + esc(x['發送結果']) + '</span></td><td style="white-space:normal;min-width:260px;font-size:.84rem">' + esc(x['內容']) + (str(x['錯誤訊息']) ? '<br><span class="mut">錯誤：' + esc(x['錯誤訊息']) + '</span>' : '') + '</td></tr>').join('') : '';
    return '<div class="ptop" style="flex-wrap:wrap;gap:8px"><input type="date" class="btn" data-nq="from" value="' + esc(f.from) + '"><span class="mut">～</span><input type="date" class="btn" data-nq="to" value="' + esc(f.to) + '">' +
      sel('type', types, '全部類型') + sel('result', ['成功', '失敗', '略過'], '全部結果') +
      '<label class="search">' + PB.icon('search') + '<input data-nq="q" placeholder="內容、錯誤訊息" value="' + esc(f.q) + '"></label>' + ui.btn(NQ.busy ? '查詢中…' : '查詢', 'nqRun', {}, 'pri sm', 'search') + '</div>' +
      (r ? '<p class="mut" style="font-size:.84rem">符合 ' + r.total + ' 則' + (r.total > r.rows.length ? '，顯示最新 ' + r.rows.length + ' 則（請縮小日期範圍）' : '') + '</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>官方帳號</th><th>對象</th><th>類型</th><th>結果</th><th>內容</th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">沒有符合的紀錄</td></tr>') + '</tbody></table></div>'
        : '<div class="card">' + ui.empty('設定條件後按「查詢」', '學員個人的紀錄也可以在營運工作台的學員頁按「通知紀錄」') + '</div>');
  }
  A.nqRun = async () => {
    const v = {};
    document.querySelectorAll('[data-nq]').forEach((el) => { v[el.dataset.nq] = el.value; });
    NQ.f = v;
    NQ.busy = true;
    PB.render();
    const r = await PB.read('notifyQuery', { from: v.from, to: v.to, type: v.type, result: v.result, q: v.q });
    NQ.busy = false;
    if (r) NQ.res = r;
    PB.render();
  };
  A.availNew = (d) => ui.form('1_據點_可用日', { values: d.slot ? { 時段: d.slot } : {}, title: '新增可用日（指定日期）' });
  A.availOk = () => { const ids = checked('avail'); if (!ids.length) return ui.toast('請先勾選'); PB.run('availConfirm', { ids: ids }); };
  A.availNo = async () => {
    const ids = checked('avail');
    if (!ids.length) return ui.toast('請先勾選');
    const v = await ui.ask('取消 ' + ids.length + ' 天', '', { fields: [{ k: 'reason', label: '原因', t: 'text', req: true }], danger: true, ok: '取消' });
    if (v) PB.run('availCancel', { ids: ids, reason: v.reason });
  };

  // 請款資料：打開才讀，不存在本機
  A.secret = async (d) => {
    const r = await PB.runMany([{ op: 'secretGet', args: { id: d.id } }], { quiet: true });
    if (!r || !r.results[0].ok) return r && ui.toast(r.results[0].message, 'bad');
    const row0 = r.results[0].data.row || {};
    const fields = ['身份證字號', '地址', '匯款銀行', '帳號', '備註'].map((k) => ({ k: k, label: k, t: 'text', value: str(row0[k]) }));
    const v = await ui.ask('請款資料：' + m.staffName(d.id), '只有管理層看得到；不會存在這台裝置。', { fields: fields, ok: '儲存' });
    if (v) PB.run('secretSave', { id: d.id, values: v });
  };

  PB.app({
    app: 'admin',
    title: '管理後台',
    version: '2.3',
    screens: [Dash, Queue].concat(PB.schedScreen ? [PB.schedScreen] : []).concat([Finance, Data]),
    links: () => (PB.cfg.opsUrl ? [{ label: '營運工作台', url: PB.cfg.opsUrl, icon: 'swap', mobile: true }] : []),
  });
})();
