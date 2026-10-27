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
    title: '應付支出',
    items: () => PB.rows('3_支出').filter((e) => str(e['付款狀態']) !== '已付').sort((a, b) => byKey(day(a['日期']), day(b['日期']))),
    row: (e) => row({ act: 'expEdit', id: e['支出ID'], t: esc(fmtD(e['日期']) + '｜' + (str(e['細目']) || str(e['類別'])) + '｜' + money(e['金額'])) + (day(e['日期']) < today() ? ' <span class="badge bad">逾期</span>' : ''), s: esc([m.venueName(e['據點']), m.staffName(e['受款人員']), m.label('1_合作夥伴', PB.get('1_合作夥伴', e['受款夥伴'])), str(e['備註'])].filter(Boolean).join('・')), r: btn('去付款', 'expGoPay', { id: e['支出ID'] }, 'pri') }),
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
  const FIN_TABS = ['付款', '人員月結', '分潤結算', '支出', '應收總覽', '抵用金'];
  const Finance = {
    id: 'finance', label: '財務', icon: 'cash',
    render(p) {
      const tab = FIN_TABS.indexOf(p.tab) >= 0 ? p.tab : FIN_TABS[0];
      const mon = p.m || defaultSettleMonth();
      const head = '<div class="ptop"><h1>財務</h1><span class="sp"></span>' + (['付款', '應收總覽', '抵用金'].indexOf(tab) < 0 ? monthSelect(mon, 'finMonth') : '') + '</div><div class="tabs">' + FIN_TABS.map((t) => '<button class="' + (t === tab ? 'on' : '') + '" data-act="finTab" data-v="' + t + '">' + t + '</button>').join('') + '</div>';
      return head + ui.safe(() => ({ 付款: payTab, 人員月結: settleTab, 分潤結算: profitTab, 支出: expenseTab, 應收總覽: arTab, 抵用金: creditTab })[tab](mon, p), tab);
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
    const rows = list.map((s) => '<tr class="click" data-act="settleOpen" data-id="' + esc(s['結算ID']) + '"><td data-stop><input type="checkbox" data-q="settle" value="' + esc(s['結算ID']) + '"></td><td>' + esc(m.staffName(s['人員'])) + '</td><td>' + esc(s['結算類型']) + '</td><td class="num">' + money(s['計算金額']) + '</td><td class="num">' + (num(s['調整金額']) ? money(s['調整金額']) : '') + '</td><td class="num"><b>' + money(num(s['計算金額']) + num(s['調整金額'])) + '</b></td><td><span class="badge ' + ({ 試算中: 'warn', 待付款: 'info', 已付款: 'ok' }[str(s['狀態'])] || '') + '">' + esc(s['狀態']) + '</span>' + (day(s['付款日期']) ? ' <span class="mut">' + fmtD(s['付款日期']) + '</span>' : '') + '</td><td class="mut" style="white-space:normal">' + esc(s['調整原因']) + '</td></tr>').join('');
    return '<div class="acts">' + btn('勾選的送出付款', 'settleTo', { to: '待付款' }, 'pri') + btn('去付款（可和分潤、支出一起匯）', 'param2', { k: 'tab', v: '付款' }) + btn('退回試算', 'settleTo', { to: '試算中' }, 'ghost') + '</div>' +
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
    return '<div class="acts">' + btn('勾選的確認', 'profitTo', { to: '已確認' }, 'pri') + btn('去付款', 'param2', { k: 'tab', v: '付款' }) + btn('退回試算', 'profitTo', { to: '試算' }, 'ghost') + '</div>' +
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

  // ---------------- 付款（v2.8：同一個受款對象的 人員月結＋分潤＋支出 一次匯款） ----------------
  const PAY_VIEWS = { due: '待付款', paid: '付款紀錄' };
  const LSK = 'pb:paySel';
  const paySel = (() => { try { return new Set(JSON.parse(localStorage.getItem(LSK) || '[]')); } catch (e) { return new Set(); } })();
  const saveSel = () => { try { localStorage.setItem(LSK, JSON.stringify(Array.from(paySel))); } catch (e) { /* 私密視窗 */ } };
  /** 受款對象：人員 → 合作夥伴 → 據點 → 未指定 */
  function payee(kind, id) {
    if (kind === '人員' && id) return { k: 'P:' + id, name: m.staffName(id) || '（人員已刪除）', kind: '人員', id: id };
    if (kind === '合作夥伴' && id) { const p = PB.get('1_合作夥伴', id) || {}; return { k: 'B:' + id, name: str(p['名稱']) || '（夥伴已刪除）', kind: '合作夥伴', id: id, info: str(p['付款資訊']) }; }
    if (kind === '據點' && id) return { k: 'V:' + id, name: m.venueName(id) + '（據點）', kind: '據點', id: id, info: venuePayInfo(id) };
    return { k: 'N:', name: '未指定受款對象', kind: '' };
  }
  function payeeOf(e) {
    if (str(e['受款人員'])) return payee('人員', str(e['受款人員']));
    if (str(e['受款夥伴'])) return payee('合作夥伴', str(e['受款夥伴']));
    return payee('據點', str(e['據點']));
  }
  function venuePayInfo(vid) {
    if (!PB.has('3_合作方案')) return '';
    const p = PB.rows('3_合作方案').find((x) => str(x['合作對象類型']) === '據點' && str(x['據點']) === vid && (!day(x['失效日期']) || day(x['失效日期']) >= today()));
    return p ? [str(p['付款方式']), str(p['付款週期'])].filter(Boolean).join('・') : '';
  }
  const expLine = (e) => str(e['類別']) + (str(e['細目']) ? '／' + str(e['細目']) : '');
  const fileCount = (e) => str(e['憑證']).split('\n').filter(Boolean).length + str(e['付款憑證']).split('\n').filter(Boolean).length;
  /** 三種來源整理成同一種付款項目 */
  function payItems(paid) {
    const out = [];
    PB.rows('3_支出').forEach((e) => {
      const isPaid = str(e['付款狀態']) === '已付';
      if (isPaid !== !!paid) return;
      out.push({ t: '支出', id: str(e['支出ID']), r: e, py: payeeOf(e), d: day(e['日期']), label: expLine(e) + (str(e['備註']) ? '・' + str(e['備註']).slice(0, 30) : ''), amt: num(e['金額']), files: fileCount(e), open: 'expEdit' });
    });
    if (PB.has('3_人員費用結算')) PB.rows('3_人員費用結算').forEach((s) => {
      const st = str(s['狀態']);
      if (paid ? st !== '已付款' : st !== '待付款') return;
      out.push({ t: '月結', id: str(s['結算ID']), r: s, py: payee('人員', str(s['人員'])), d: str(s['月份']), label: str(s['月份']) + ' ' + str(s['結算類型']) + '月結' + (num(s['調整金額']) ? '（調整 ' + money(s['調整金額']) + '）' : ''), amt: num(s['計算金額']) + num(s['調整金額']), files: 0, open: 'settleOpen' });
    });
    if (PB.has('3_分潤結算')) PB.rows('3_分潤結算').forEach((s) => {
      const st = str(s['結算狀態']);
      if (paid ? st !== '已付款' : st !== '已確認') return;
      if (num(s['合作方金額']) <= 0) return;
      const plan = PB.get('3_合作方案', s['合作方案']) || {};
      const kind = str(plan['合作對象類型']);
      const py = payee(kind, str(kind === '人員' ? plan['人員'] : kind === '合作夥伴' ? plan['合作夥伴'] : plan['據點']));
      out.push({ t: '分潤', id: str(s['結算ID']), r: s, py: py, d: str(s['月份']), label: str(s['月份']) + ' 分潤｜' + str(plan['方案名稱']), amt: num(s['合作方金額']), files: 0, open: '' });
    });
    return out;
  }
  const skey = (x) => x.t + ':' + x.id;
  const TBADGE = { 支出: '', 月結: 'info', 分潤: 'brand' };

  function payTab(mon, p) {
    const v = PAY_VIEWS[p.v] ? p.v : 'due';
    const due = payItems(false);
    const chips = '<div class="chips" style="margin-bottom:12px">' + Object.keys(PAY_VIEWS).map((k) => '<button class="chip' + (k === v ? ' on' : '') + '" data-act="param2" data-k="v" data-v="' + k + '">' + PAY_VIEWS[k] + (k === 'due' ? '<span class="c">' + due.length + '</span>' : '') + '</button>').join('') + '</div>';
    const pend = PB.has('3_人員費用結算') ? PB.rows('3_人員費用結算').filter((s) => str(s['狀態']) === '試算中').length : 0;
    const pendP = PB.has('3_分潤結算') ? PB.rows('3_分潤結算').filter((s) => str(s['結算狀態']) === '試算').length : 0;
    const tip = pend || pendP ? '<div class="note" style="margin-bottom:10px">還有 ' + [pend ? '人員月結試算中 ' + pend + ' 筆' : '', pendP ? '分潤試算 ' + pendP + ' 筆' : ''].filter(Boolean).join('、') + '：核對後在「人員月結」按「送出付款」、在「分潤結算」按「確認」，才會出現在這裡。</div>' : '';
    return chips + (v === 'paid' ? paidView(p) : tip + dueView(due, p));
  }

  function dueView(due, p) {
    const keys = due.map(skey);
    Array.from(paySel).forEach((k) => { if (keys.indexOf(k) < 0) paySel.delete(k); });
    const kw = str(p.q).toLowerCase();
    let list = due;
    if (kw) list = list.filter((x) => (x.py.name + x.label + x.t).toLowerCase().indexOf(kw) >= 0);
    const groups = {};
    list.forEach((x) => { (groups[x.py.k] = groups[x.py.k] || { py: x.py, list: [] }).list.push(x); });
    const order = Object.keys(groups).sort((a, b) => sum(groups[b].list, (x) => x.amt) - sum(groups[a].list, (x) => x.amt));
    const cards = order.map((k) => {
      const g = groups[k];
      const ks = g.list.map(skey);
      const on = ks.filter((x) => paySel.has(x)).length;
      const kinds = uniq(g.list.map((x) => x.t));
      const rows = g.list.sort((a, b) => byKey(a.t + a.d, b.t + b.d)).map((x) => '<tr' + (x.open ? ' class="click" data-act="' + x.open + '" data-id="' + esc(x.id) + '"' : '') + '><td data-stop><input type="checkbox" data-paysel="' + esc(skey(x)) + '"' + (paySel.has(skey(x)) ? ' checked' : '') + '></td><td><span class="badge ' + TBADGE[x.t] + '">' + x.t + '</span></td><td style="white-space:normal">' + esc(x.t === '支出' ? fmtD(x.d) + '・' + x.label : x.label) + '</td><td class="fclip m-hide">' + (x.files ? '📎 ' + x.files : '') + '</td><td class="num">' + money(x.amt) + '</td></tr>').join('');
      return '<div class="card exp-g"><div class="exp-gh"><label class="exp-all"><input type="checkbox" data-paygrp="' + esc(ks.join(',')) + '"' + (on === ks.length ? ' checked' : '') + '><b>' + esc(g.py.name) + '</b></label>' +
        (g.py.kind ? '<span class="badge">' + esc(g.py.kind) + '</span>' : '') + (kinds.length > 1 ? '<span class="mut" style="font-size:.8rem">' + esc(kinds.join('＋')) + '</span>' : '') + (g.py.info ? '<span class="mut exp-info">' + esc(g.py.info) + '</span>' : '') + (g.py.kind === '人員' ? btn('匯款資料', 'secretView', { id: g.py.id }, 'ghost') : '') +
        '<span class="sp"></span><span class="mut">' + g.list.length + ' 筆</span><b class="num">' + money(sum(g.list, (x) => x.amt)) + '</b></div>' +
        '<div class="tbl-wrap flat"><table class="tbl"><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
    const filt = '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="受款對象、項目" value="' + esc(p.q || '') + '" data-input="arSearch"></label><span class="sp"></span><span class="mut">待付 ' + list.length + ' 筆・' + money(sum(list, (x) => x.amt)) + '</span>' + btn('新增支出', 'expNew', {}, 'ghost', 'plus') + '</div>';
    return filt + (cards || '<div class="card">' + ui.empty('沒有待付款的項目', '') + '</div>') + '<div class="exp-bar" id="payBar">' + barHtml() + '</div>' +
      '<p class="mut" style="font-size:.8rem">同一個人的月結、分潤、支出可以一起勾、一起付（同一次付款、同一張轉帳截圖）。勾選記在這台裝置，可以分幾天慢慢勾。</p>';
  }
  function barHtml() {
    const sel = payItems(false).filter((x) => paySel.has(skey(x)));
    if (!sel.length) return '<span class="mut">勾選本次要付的項目</span>';
    return '<span>已勾選 <b>' + sel.length + '</b> 筆・' + uniq(sel.map((x) => x.py.k)).length + ' 個對象・合計 <b class="num">' + money(sum(sel, (x) => x.amt)) + '</b></span><span class="sp"></span>' + btn('清除勾選', 'paySelClear', {}, 'ghost') + btn('付款…', 'payGo', {}, 'pri');
  }
  document.addEventListener('change', (e) => {
    const one = e.target.closest && e.target.closest('input[data-paysel]');
    const grp = e.target.closest && e.target.closest('input[data-paygrp]');
    if (!one && !grp) return;
    if (one) { if (one.checked) paySel.add(one.dataset.paysel); else paySel.delete(one.dataset.paysel); }
    if (grp) {
      grp.dataset.paygrp.split(',').forEach((k) => { if (grp.checked) paySel.add(k); else paySel.delete(k); });
      grp.closest('.exp-g').querySelectorAll('input[data-paysel]').forEach((c) => { c.checked = grp.checked; });
    }
    saveSel();
    const el = document.getElementById('payBar');
    if (el) el.innerHTML = barHtml();
  });
  A.paySelClear = () => { paySel.clear(); saveSel(); PB.render(); };
  // 待處理「去付款」、人員月結「去付款」→ 勾起來帶到付款頁
  A.expGoPay = (d) => { paySel.add('支出:' + d.id); saveSel(); PB.go('finance', { tab: '付款', v: 'due' }); };
  A.payGo = async () => {
    const sel = payItems(false).filter((x) => paySel.has(skey(x)));
    if (!sel.length) return ui.toast('請先勾選', 'bad');
    const groups = {};
    sel.forEach((x) => { (groups[x.py.k] = groups[x.py.k] || { py: x.py, list: [] }).list.push(x); });
    const staff = Object.keys(groups).map((k) => groups[k].py).filter((py) => py.kind === '人員').map((py) => py.id);
    const info = staff.length ? await PB.read('payeeInfo', { staff: staff }) : null;
    const bank = (py) => { const r = info && info.staff[py.id]; return r && (r.匯款銀行 || r.帳號) ? r.匯款銀行 + ' ' + r.帳號 : py.kind === '人員' ? '沒有匯款資料' : py.info || ''; };
    const list = Object.keys(groups).map((k) => { const g = groups[k]; return '<tr><td><b>' + esc(g.py.name) + '</b><br><span class="mut" style="font-size:.8rem">' + esc(bank(g.py)) + '</span><br><span class="mut" style="font-size:.76rem">' + esc(uniq(g.list.map((x) => x.t)).map((t) => t + ' ' + g.list.filter((x) => x.t === t).length).join('・')) + '</span></td><td class="num"><b>' + money(sum(g.list, (x) => x.amt)) + '</b></td></tr>'; }).join('');
    const body = '<div class="tbl-wrap" style="margin-bottom:10px"><table class="tbl"><tbody>' + list + '</tbody><tfoot><tr><td>合計 ' + sel.length + ' 筆</td><td class="num">' + money(sum(sel, (x) => x.amt)) + '</td></tr></tfoot></table></div>' +
      '<div class="fld-row"><div class="fld"><label>付款日期</label><input type="date" name="date" value="' + today() + '"></div><div class="fld"><label>付款方式</label><select name="method">' + (PB.enums['支出付款方式'] || ['轉帳', '現金', '其他']).map((x) => '<option>' + esc(x) + '</option>').join('') + '</select></div></div>' +
      '<div class="fld"><label>備註</label><input name="note" placeholder="例：10 月教練費與代墊一起匯"></div>' +
      '<div class="fld"><label>付款憑證</label>' + ui.filesField({ k: '付款憑證', _table: '3_支出' }, '', 'payproof') + '<span class="hint">轉帳截圖等；會附在這次付款的每一筆</span></div>';
    const r = await ui.modal({ title: '付款 ' + sel.length + ' 筆', body: body, sticky: true, actions: [{ label: '取消' }, { label: '確認付款', kind: 'pri', click: (el) => { const d = el.querySelector('[name=date]').value; if (!d) { ui.toast('請選付款日期', 'bad'); return false; } return { date: d, method: el.querySelector('[name=method]').value, note: el.querySelector('[name=note]').value, proof: el.querySelector('.files input[type=hidden]').value }; } }] });
    if (!r) return;
    const out = await PB.run('payBatch', Object.assign({ items: sel.map((x) => ({ t: x.t, id: x.id })) }, r));
    if (out) { sel.forEach((x) => paySel.delete(skey(x))); saveSel(); PB.render(); }
  };
  A.secretView = async (d) => {
    const r = await PB.read('payeeInfo', { staff: [d.id] });
    const x = r && r.staff[d.id];
    ui.modal({ title: '匯款資料：' + m.staffName(d.id), body: x ? '<div class="tbl-wrap"><table class="tbl"><tbody><tr><td class="mut">匯款銀行</td><td><b>' + esc(x.匯款銀行 || '—') + '</b></td></tr><tr><td class="mut">帳號</td><td><b>' + esc(x.帳號 || '—') + '</b></td></tr></tbody></table></div>' : '<div class="note warn">還沒有匯款資料：請到「主檔與紀錄 → 人員與權限 → 人員」按「請款資料」填寫。</div>', actions: [{ label: '關閉' }] });
  };

  /** 付款紀錄：依付款批次（沒有批次的舊資料依付款日期＋受款對象） */
  function paidView(p) {
    const since = p.since || addDays(today(), -90);
    const paid = payItems(true).filter((x) => day(x.r['付款日期'] || x.d) >= since);
    const groups = {};
    paid.forEach((x) => { const pd = day(x.r['付款日期']) || x.d; const k = str(x.r['付款批次']) || 'D' + pd + '|' + x.py.k; (groups[k] = groups[k] || { batch: str(x.r['付款批次']), d: pd, list: [] }).list.push(x); });
    const order = Object.keys(groups).sort((a, b) => byKey(groups[b].d + b, groups[a].d + a));
    const cards = order.map((k) => {
      const g = groups[k];
      const byPy = {};
      g.list.forEach((x) => { (byPy[x.py.k] = byPy[x.py.k] || { py: x.py, n: 0, amt: 0 }); byPy[x.py.k].n += 1; byPy[x.py.k].amt += x.amt; });
      const proofs = uniq(g.list.reduce((a, x) => a.concat(str(x.r['付款憑證']).split('\n')), []).filter(Boolean)).join('\n');
      const method = str(g.list[0].r['付款方式']);
      return '<div class="card exp-g"><div class="exp-gh"><b>' + esc(fmtD(g.d)) + '</b>' + (g.batch ? '<span class="badge">' + esc(g.batch) + '</span>' : '') + (method ? '<span class="badge info">' + esc(method) + '</span>' : '') +
        '<span class="sp"></span><span class="mut">' + g.list.length + ' 筆</span><b class="num">' + money(sum(g.list, (x) => x.amt)) + '</b>' + (g.batch ? btn('取消這次付款', 'payUndo', { batch: g.batch }, 'ghost') : '') + '</div>' +
        '<div class="exp-payees">' + Object.keys(byPy).map((y) => '<span>' + esc(byPy[y].py.name) + ' <b>' + money(byPy[y].amt) + '</b> <span class="mut">(' + byPy[y].n + ' 筆)</span></span>').join('') + '</div>' +
        (proofs ? '<div class="fthumbs" style="margin:6px 12px 10px">' + ui.fileList(proofs) + '</div>' : '') +
        '<div class="tbl-wrap flat"><table class="tbl"><tbody>' + g.list.map((x) => '<tr' + (x.open ? ' class="click" data-act="' + x.open + '" data-id="' + esc(x.id) + '"' : '') + '><td><span class="badge ' + TBADGE[x.t] + '">' + x.t + '</span></td><td>' + esc(x.py.name) + '</td><td style="white-space:normal">' + esc(x.t === '支出' ? fmtD(x.d) + '・' + x.label : x.label) + '</td><td class="num">' + money(x.amt) + '</td></tr>').join('') + '</tbody></table></div></div>';
    }).join('');
    return '<div class="ptop"><label class="mut" style="font-size:.85rem">付款日期從 <input type="date" class="btn sm" value="' + esc(since) + '" data-input="expSince"></label><span class="sp"></span><span class="mut">' + paid.length + ' 筆・' + money(sum(paid, (x) => x.amt)) + '</span></div>' +
      (cards || '<div class="card">' + ui.empty('這段期間沒有付款紀錄', '') + '</div>');
  }
  PB.inputs.expSince = (v) => PB.setParam('since', v);
  A.payUndo = (d) => PB.run('payUndo', { batch: d.batch }, { confirm: { title: '取消這次付款', text: '這一批會回到付款前的狀態（支出→應付、月結→待付款、分潤→已確認）；付款憑證留在各筆上。', danger: true, ok: '取消付款' } });

  /** 支出：本月明細＋新增（付款請到「付款」） */
  function expenseTab(mon) {
    const all = PB.rows('3_支出');
    const list = all.filter((e) => day(e['日期']).slice(0, 7) === mon).sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
    const rows = list.map((e) => '<tr class="click" data-act="expEdit" data-id="' + esc(e['支出ID']) + '"><td>' + esc(fmtD(e['日期'])) + '</td><td>' + esc(expLine(e)) + '</td><td class="num">' + money(e['金額']) + '</td><td>' + esc(m.venueName(e['據點'])) + '</td><td>' + esc(payeeOf(e).name) + '</td><td><span class="badge ' + (str(e['付款狀態']) === '已付' ? 'ok' : 'warn') + '">' + esc(e['付款狀態']) + '</span>' + (day(e['付款日期']) ? ' <span class="mut">' + esc(fmtD(e['付款日期'])) + '</span>' : '') + '</td><td class="fclip">' + (fileCount(e) ? '📎 ' + fileCount(e) : '') + '</td><td class="mut" style="white-space:normal">' + esc(str(e['備註']).slice(0, 60)) + '</td></tr>').join('');
    return '<div class="acts">' + btn('新增支出', 'expNew', {}, 'pri', 'plus') + btn('去付款', 'param2', { k: 'tab', v: '付款' }, 'ghost') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>類別</th><th class="num">金額</th><th>據點</th><th>受款</th><th>狀態</th><th></th><th>備註</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">這個月沒有支出</td></tr>') + '</tbody><tfoot><tr><td colspan="2">合計（應付 ' + money(sum(list.filter((e) => str(e['付款狀態']) !== '已付'), (e) => e['金額'])) + '）</td><td class="num">' + money(sum(list, (e) => e['金額'])) + '</td><td colspan="5"></td></tr></tfoot></table></div>' +
      '<p class="mut" style="font-size:.8rem">付款請到「付款」：同一個人的月結、分潤、支出可以一起付。租約的場租在登錄租約時自動建立。</p>';
  }
  A.expNew = () => ui.form('3_支出', {});
  A.expEdit = (d) => ui.form('3_支出', { id: d.id });
  A.expPaid = async (d) => {
    const v = await ui.ask('標記已付', '', { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付' });
    if (v) PB.run('expensePay', { ids: [d.id], date: v.date });
  };
  A.expPaidChecked = async () => {
    const ids = checked('exp');
    if (!ids.length) return ui.toast('請先勾選');
    const v = await ui.ask('標記已付 ' + ids.length + ' 筆', '', { fields: [{ k: 'date', label: '付款日期', t: 'date', req: true, value: today() }], ok: '已付' });
    if (v) PB.run('expensePay', { ids: ids, date: v.date });
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
    據點: { t: '1_據點', open: 'venueOpen', cols: [['名稱', (r) => r['據點名稱']], ['類別', (r) => r['據點類別'] || ''], ['區域', (r) => r['區域']], ['場主', (r) => m.staffName(r['場主'])], ['面數', (r) => (PB.ix.courtByVenue[str(r['據點ID'])] || []).length], ['狀態', (r) => r['狀態']]] },
    場地: { t: '1_據點_場地', cols: [['據點', (r) => m.venueName(r['據點'])], ['場地', (r) => r['場地名稱']], ['人數', (r) => r['人數上限']], ['類型', (r) => split(r['類型']).join('、')], ['狀態', (r) => r['狀態']]], sort: (r) => m.venueName(r['據點']) },
    時段: { t: '1_據點_時段', cols: [['據點', (r) => m.venueName(r['據點'])], ['時段', (r) => m.slotLabel(r)], ['場地', (r) => split(r['使用場地']).map(m.courtName).join('、')], ['期間', (r) => fmtD(r['生效日期']) + '～' + fmtD(r['結束日期'])], ['週期', (r) => r['週期']], ['可用日', (r) => (PB.ix.availBySlot[str(r['時段ID'])] || []).filter((a) => str(a['狀態']) === '可用' && day(a['日期']) >= today()).length + ' 天'], ['狀態', (r) => r['狀態']], ['產生可用日', (r) => availGen(r).t, (r) => availGen(r).h]],
      sort: (r) => m.venueName(r['據點']) + '週' + '一二三四五六日'.indexOf(str(r['星期'])),
      acts: (r) => btn('產生可用日', 'slotAvail', { id: r['時段ID'] }) + btn('可用日', 'availOf', { id: r['時段ID'] }, 'ghost') },
    可用日: { t: '1_據點_可用日', custom: true },
    租約: { t: '3_合作方案', custom: 'lease' },
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
  // v2.6：時段的「產生可用日」進度（管理 GAS Q1 約 15 分鐘內處理）
  function availGen(r) {
    const req = str(r['可用日產生請求']), done = str(r['可用日產生時間']), res = str(r['可用日產生結果']);
    if (req && (!done || req > done)) return { t: '處理中', h: '<span class="badge info" title="送出 ' + esc(fmtDT(req)) + '">處理中</span>' };
    if (done) return { t: res || '完成', h: '<span class="badge ' + (/錯|要填|無法|早於|超過|不是/.test(res) ? 'bad' : 'ok') + '" title="' + esc(res) + '">' + esc(fmtD(done)) + ' 完成</span>' + (res ? '<div class="mut" style="font-size:.76rem;white-space:normal;max-width:220px">' + esc(res.slice(0, 60)) + '</div>' : '') };
    return { t: '', h: '' };
  }
  function planTerms(r) {
    const mode = str(r['合作模式']);
    if (mode === '比例分潤') return '我方 ' + Math.round(num(r['我方比例']) * 100) + '%（' + str(r['計算基礎']) + '）';
    if (mode === '人頭抽成') return '每人 ' + money(r['每人抽成']);
    if (mode === '按次租用') return money(r['每面每小時單價']) + '／面／時';
    if (mode === '包場租約' || mode === '外包') return money(r['合約金額']) + (str(r['付款週期']) ? '・' + str(r['付款週期']) : '');
    return '';
  }

  // v2.6：主檔依功能分 4 個入口，入口下再選資料表；每張表有一句說明
  const DGROUPS = [
    { id: 'venue', label: '據點與場地', icon: 'pin', desc: '據點、球面、固定時段、可用日，以及場地合作條件', keys: ['租約', '據點', '場地', '時段', '可用日', '合作方案', '合作夥伴'] },
    { id: 'course', label: '課程設定', icon: 'book', desc: '課程類型（規則）→ 課程模板（期制班預設值）／專項（單堂專項課）', keys: ['課程類型', '課程模板', '專項', '程度'] },
    { id: 'staff', label: '人員與權限', icon: 'users', desc: '人員、教練資料、教練費率與角色權限', keys: ['人員', '教練', '教練費率', '角色'] },
    { id: 'record', label: '紀錄', icon: 'kb', desc: '決策紀錄、文件中心、通知紀錄', keys: ['決策紀錄', '文件', '通知紀錄'] },
  ];
  const DDESC = {
    據點: '點一個據點看詳情：上方可新增租約、球面、時段；下方列出這個據點的租約、球面、時段與可用日。',
    場地: '據點裡的每一面球場；類型決定能排課程或球敘。',
    時段: '據點每週固定可用的時間。按「產生可用日」依期間與週期展開待確認的日期（約 15 分鐘內完成）。',
    可用日: '時段實際能用的日期；確認「可用」後才能排課、開球敘。',
    租約: '所有據點的包場租約。新租約建議從「據點」點進該據點再按「新增租約」：① 租約（金額、簽約當天付款）② 球面（勾既有、或新增）③ 時段與日期，最後一次建立。可以貼上「20261027_光電球場_一三五1900-2100_共2面共22日(20261109~1230)_共30800(每面每時段700)」自動帶入。',
    合作方案: '場地租金、分潤、外包等合作條件（只有管理層看得到）。',
    合作夥伴: '非人員、非據點的合作對象（廠商、學校窗口等）。',
    課程類型: '課程的「規則」：標準教練費、請假上限、補課期限。每個班級、模板、教練費率都要指定一個類型。',
    課程模板: '期制班（例：兒童班 8 堂）的預設值：新增班級時選模板，自動帶入名稱、人數、費用、堂數。',
    專項: '單堂專項課的內容清單（例：握拍與正反手）。排課看板從這裡選；有填費用就用它，空白依據點類別。',
    程度: 'L1～L3 程度分級；專項的建議程度、球敘分級都用它。',
    人員: '所有工作人員；角色決定能進哪些工作區。「請款資料」只有管理層能看。',
    教練: '教練的可教程度、證照、介紹。',
    教練費率: '個別教練、個別課程類型的教練費；沒有設定時用課程類型的標準教練費。',
    角色: '角色與工作區權限（管理層／行政客服／社群行銷）。',
    決策紀錄: '重要決定的來龍去脈與生效日期。',
    文件: '合約、手冊等文件的連結；檔案本身放在 Google 雲端硬碟。',
    通知紀錄: '系統發出的 LINE 通知與結果。',
  };
  const groupOf = (k) => DGROUPS.find((g) => g.keys.indexOf(k) >= 0) || DGROUPS[0];
  const dCount = (k) => (D[k] && PB.has(D[k].t) ? PB.rows(D[k].t).length : null);

  const Data = {
    id: 'data', label: '主檔與紀錄', icon: 'db',
    render(p) {
      const g = DGROUPS.find((x) => x.id === p.grp) || (D[p.k] ? groupOf(p.k) : DGROUPS[0]);
      const k = D[p.k] && g.keys.indexOf(p.k) >= 0 ? p.k : g.keys[0];
      const def = D[k];
      const tabs = '<div class="dgrp">' + DGROUPS.map((x) => '<button class="dgrp-b' + (x.id === g.id ? ' on' : '') + '" data-act="dataG" data-v="' + x.id + '">' + PB.icon(x.icon) + '<span><b>' + esc(x.label) + '</b><small>' + esc(x.keys.join('・')) + '</small></span></button>').join('') + '</div>';
      const chips = '<div class="chips dsub">' + g.keys.map((x) => { const n = dCount(x); return '<button class="chip' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + x + (n !== null && !D[x].custom ? '<span class="c">' + n + '</span>' : x === '租約' && PB.has('3_合作方案') ? '<span class="c">' + PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約').length + '</span>' : '') + '</button>'; }).join('') + '</div>';
      const desc = DDESC[k] ? '<p class="ddesc">' + esc(DDESC[k]) + '</p>' : '';
      const head = (right) => '<div class="ptop"><h1>主檔與紀錄</h1><span class="sp"></span>' + (right || '') + '</div>' + tabs + chips + desc;
      if (def.custom) return head('') + (def.custom === 'notify' ? notifyView(p) : def.custom === 'lease' ? leaseView(p) : availView(p));
      const kw = str(p.q).toLowerCase();
      let list = PB.rows(def.t);
      if (kw) list = list.filter((r) => def.cols.map((c) => str(c[1](r))).join(' ').toLowerCase().indexOf(kw) >= 0);
      if (def.sort) list = list.slice().sort((a, b) => byKey(def.sort(a), def.sort(b)));
      const key = PB.db.keys[def.t];
      const rows = list.map((r) => '<tr class="click" data-act="' + (def.open || 'dataEdit') + '" data-t="' + def.t + '" data-id="' + esc(r[key]) + '">' + def.cols.map((c) => '<td>' + c[2](r, c[1](r)) + '</td>').join('') + (def.acts ? '<td data-stop style="text-align:right">' + def.acts(r) + '</td>' : '') + '</tr>').join('');
      const canNew = PB.forms[def.t] && PB.forms[def.t].create;
      return head(canNew ? ui.btn('新增' + k, 'dataNew', { t: def.t }, 'pri', 'plus') : '') +
        '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="搜尋' + esc(k) + '" value="' + esc(p.q || '') + '" data-input="dataSearch"></label><span class="sp"></span><span class="mut">' + list.length + ' 筆</span></div>' +
        (PB.has(def.t) ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + def.cols.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + (def.acts ? '<th></th>' : '') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' : '<div class="err-box">「' + esc(def.t) + '」沒有載入（工作表不存在或未設定試算表）</div>');
    },
  };
  // 欄位第 3 項：自訂 HTML（預設＝跳脫文字）
  Object.keys(D).forEach((k) => (D[k].cols || []).forEach((c) => { if (!c[2]) c[2] = (r, v) => esc(v); }));
  A.dataG = (d) => PB.go('data', { grp: d.v });
  A.dataK = (d) => PB.go('data', { grp: groupOf(d.v).id, k: d.v });
  A.dataEdit = (d) => ui.form(d.t, { id: d.id });
  A.dataNew = (d) => ui.form(d.t, {});
  A.planEdit = (d) => ui.form('3_合作方案', { id: d.id });
  let dataTimer;
  PB.inputs.dataSearch = (v) => { clearTimeout(dataTimer); dataTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="dataSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };
  A.slotAvail = (d) => PB.run('slotGenAvail', { id: d.id }, { confirm: { title: '產生可用日', text: '依生效～結束日期與週期展開「待確認」可用日（已存在的日期略過；國定假日會標記）。產生後請到可用日確認。', ok: '產生' } });
  A.slotDrafts = (d) => PB.run('slotGenDrafts', { id: d.id }, { confirm: { title: '產生球敘草稿', text: '依這個時段之後的「可用」日，在沒被課程佔用的場地建立球敘草稿；費用與類型沿用上一場。草稿要在營運工作台確認後開放報名。', ok: '產生' } });
  A.availOf = (d) => PB.go('data', { grp: 'venue', k: '可用日', slot: d.id });

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

  // ================================================================
  // 租約（v2.8）：一次登錄 球面、時段、可用日、包場合作方案、場租應付
  // ================================================================
  const WDS = '一二三四五六日';
  const wdOf = (k) => '日一二三四五六'[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).getDay()];
  const pad2 = (n) => ('0' + n).slice(-2);
  function leaseView(p) {
    const plans = PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約').sort((a, b) => byKey(day(b['生效日期']), day(a['生效日期']))) : [];
    const exp = PB.rows('3_支出');
    const rows = plans.map((r) => {
      const pid = str(r['方案ID']);
      const ex = exp.filter((e) => str(e['備註']).indexOf('F03:' + pid + ':') >= 0);
      const paid = ex.filter((e) => str(e['付款狀態']) === '已付').length;
      return '<tr class="click" data-act="dataEdit" data-t="3_合作方案" data-id="' + esc(pid) + '"><td style="white-space:normal">' + esc(r['方案名稱']) + '</td><td>' + esc(m.venueName(r['據點'])) + '</td><td>' + esc(fmtD(r['生效日期']) + '～' + fmtD(r['失效日期'])) + '</td><td class="num">' + money(r['合約金額']) + '</td><td>' + (ex.length ? '<span class="badge ' + (paid === ex.length ? 'ok' : 'warn') + '">場租 ' + (paid === ex.length ? '已付' : '應付') + '</span>' : '<span class="mut">—</span>') + '</td><td>' + (str(r['合約']) ? '<span class="fclip">📎</span>' : '') + '</td></tr>';
    }).join('');
    return '<div class="acts">' + btn('新增租約', 'leaseNew', {}, 'pri', 'plus') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>租約</th><th>據點</th><th>期間</th><th class="num">金額</th><th>場租</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="6" class="mut">還沒有租約</td></tr>') + '</tbody></table></div>';
  }

  /** 日期文字 → 日期清單：「20261018、1101、1115」「20261109~1230」「2026-11-09～2026-12-30」；範圍依勾選的星期展開 */
  function parseDates(text, wds, baseYear) {
    let y = baseYear || +today().slice(0, 4);
    let prev = '';
    const one = (t) => {
      t = t.replace(/[\/.]/g, '-');
      let mt = t.match(/^(\d{4})-?(\d{1,2})-?(\d{1,2})$/);
      if (mt && t.length >= 8) { y = +mt[1]; return y + '-' + pad2(+mt[2]) + '-' + pad2(+mt[3]); }
      mt = t.match(/^(\d{1,2})-?(\d{2})$/) || t.match(/^(\d{1,2})-(\d{1,2})$/);
      if (!mt) return '';
      let k = y + '-' + pad2(+mt[1]) + '-' + pad2(+mt[2]);
      if (prev && k < prev) { y += 1; k = y + '-' + pad2(+mt[1]) + '-' + pad2(+mt[2]); }
      return k;
    };
    const out = [];
    str(text).split(/[、,，;；\s]+/).filter(Boolean).forEach((tok) => {
      const r = tok.split(/~|～|至/);
      if (r.length === 2) {
        const a = one(r[0]); prev = a; const b = one(r[1]); prev = b;
        if (!a || !b) return;
        for (let d = a; d <= b; d = addDays(d, 1)) if (!wds.length || wds.indexOf(wdOf(d)) >= 0) out.push(d);
      } else { const k = one(tok); if (k) { out.push(k); prev = k; } }
    });
    return uniq(out).sort();
  }
  /** 貼上的一行 → 表單值 */
  function parseLease(line) {
    const o = {};
    const parts = str(line).trim().split('_').map((x) => x.trim()).filter(Boolean);
    const left = [];
    parts.forEach((x, i) => {
      let mt;
      if (i === 0 && (mt = x.match(/^(\d{8})(簽約)?$/))) { o.sign = mt[1].slice(0, 4) + '-' + mt[1].slice(4, 6) + '-' + mt[1].slice(6, 8); return; }
      if ((mt = x.match(/^([一二三四五六日]+)\s*(\d{1,2}):?(\d{2})\s*[-~～]\s*(\d{1,2}):?(\d{2})$/))) { o.wds = mt[1].split(''); o.start = pad2(+mt[2]) + ':' + mt[3]; o.end = pad2(+mt[4]) + ':' + mt[5]; return; }
      if ((mt = x.match(/共?(\d+)面共?(\d+)日[(（](.+)[)）]/))) { o.courts = +mt[1]; o.expect = +mt[2]; o.dates = mt[3]; return; }
      if ((mt = x.match(/^共?([\d,]+)元?(?:[(（]每面每時段([\d,]+)元?[)）])?$/))) { o.total = +mt[1].replace(/,/g, ''); if (mt[2]) o.unit = +mt[2].replace(/,/g, ''); return; }
      left.push(x);
    });
    const vs = PB.rows('1_據點');
    if (left.length >= 2) { const v = vs.find((r) => str(r['據點名稱']) === left[0]); if (v) o.venue = str(v['據點ID']); else o.newVenue = left[0]; o.area = left.slice(1).join(' '); }
    else if (left.length === 1) { const v = vs.find((r) => str(r['據點名稱']) === left[0]); if (v) o.venue = str(v['據點ID']); else o.area = left[0]; }
    return o;
  }

  // ---- v2.9 登錄租約：① 租約 ② 球面 ③ 時段與日期（最後一步按「確認登錄」一次寫入） ----
  const LS_ = { step: 1, v: {}, off: new Set(), sel: new Set(), add: [], timer: null, seq: 0, fixedVenue: '' };
  const vCourts = (vid) => PB.rows('1_據點_場地').filter((c) => str(c['據點']) === vid).sort((a, b) => byKey(str(a['場地名稱']), str(b['場地名稱'])));
  A.leaseNew = async (d) => {
    d = d || {};
    LS_.step = 1;
    LS_.off = new Set();
    LS_.sel = new Set();
    LS_.add = [];
    LS_.fixedVenue = str(d.venue);
    LS_.v = { venue: str(d.venue), newVenue: '', area: '', wds: [], start: '', end: '', dates: '', total: '', unit: '', sign: today(), pay: '轉帳', paid: true, expect: 0, expectCourts: 0, name: '', contract: '' };
    // 續約：沿用上一份租約的球面、星期、時間
    if (d.copy) {
      const plan = PB.get('3_合作方案', d.copy) || {};
      LS_.v.venue = str(plan['據點']);
      const inVenue = PB.rows('1_據點_時段').filter((x) => str(x['據點']) === LS_.v.venue);
      let slots = inVenue.filter((x) => str(x['說明']) === str(plan['方案名稱']));
      // 續約的續約：時段沿用第一份租約的名稱 → 改找期間和這份租約重疊的時段
      if (!slots.length) {
        const a = day(plan['生效日期']), b = day(plan['失效日期']) || a;
        slots = inVenue.filter((x) => a && day(x['生效日期']) && day(x['生效日期']) <= b && (!day(x['結束日期']) || day(x['結束日期']) >= a));
      }
      if (slots.length) {
        LS_.v.wds = uniq(slots.map((x) => str(x['星期'])));
        LS_.v.start = str(slots[0]['開始時間']).slice(0, 5);
        LS_.v.end = str(slots[0]['結束時間']).slice(0, 5);
        split(slots[0]['使用場地']).forEach((c) => LS_.sel.add(c));
      }
    }
    const vs = PB.rows('1_據點').slice().sort((x, y) => byKey(str(x['據點名稱']), str(y['據點名稱'])));
    const v = LS_.v;
    const body = '<div id="leaseBox"><div class="lsteps">' + ['租約', '球面', '時段與日期'].map((t, i) => '<button type="button" data-lstep="' + (i + 1) + '">' + (i + 1) + '　' + t + '</button>').join('') + '</div>' +
      // ① 租約
      '<section data-ls="1"><div class="fld"><label>快速貼上（可略過）</label><textarea name="paste" rows="2" placeholder="20261027_光電球場_一三五1900-2100_共2面共22日(20261109~1230)_共30800(每面每時段700)"></textarea><button type="button" class="btn sm" data-lease="parse" style="align-self:flex-start;margin-top:4px">帶入</button><span class="hint">會一起帶入球面數、星期、時間與日期</span></div>' +
      '<div class="fld"><label>據點<b>*</b></label><select name="venue"' + (LS_.fixedVenue ? ' disabled' : '') + '><option value="">請選擇</option>' + vs.map((x) => '<option value="' + esc(x['據點ID']) + '"' + (str(x['據點ID']) === v.venue ? ' selected' : '') + '>' + esc(x['據點名稱']) + '</option>').join('') + '<option value="__new">＋ 新據點</option></select><input name="newVenue" placeholder="新據點名稱" style="margin-top:6px;display:none"></div>' +
      '<div class="fld-row"><div class="fld"><label>簽約日</label><input type="date" name="sign" value="' + esc(v.sign) + '"></div><div class="fld"><label>租約名稱</label><input name="name" placeholder="空白＝自動（據點 區域 星期 時間 期間）"></div></div>' +
      '<div class="fld-row"><div class="fld"><label>合約總額</label><input type="number" name="total" min="0"></div><div class="fld"><label>每面每時段</label><input type="number" name="unit" min="0"><span class="hint">填一個就好；兩個都填會核對</span></div></div>' +
      '<div class="fld"><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="paid" checked> 簽約當天已付款（公司帳戶）</label></div>' +
      '<div class="fld-row"><div class="fld"><label>付款方式</label><select name="pay">' + (PB.enums['現金轉帳'] || ['現金', '轉帳']).map((x) => '<option' + (x === '轉帳' ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div><div class="fld"></div></div>' +
      '<div class="fld"><label>合約檔案</label>' + ui.filesField({ k: '合約', _table: '3_合作方案' }, '', 'leasefile') + '</div></section>' +
      // ② 球面
      '<section data-ls="2" hidden><div class="fld"><label>區域</label><input name="area" list="leaseAreas" placeholder="例：綜合大樓四樓、光電球場"><datalist id="leaseAreas"></datalist><span class="hint">新增的球面會叫「區域 A」「區域 B」…</span></div>' +
      '<div class="fld"><label>這份租約用哪幾面</label><div id="lsCourts"></div><button type="button" class="btn sm" data-lease="addCourt" style="align-self:flex-start;margin-top:6px">' + PB.icon('plus') + '新增球面</button><span class="hint">新增的球面：類型 課程＋球敘、人數上限 8、啟用（之後可在據點詳情修改）</span></div></section>' +
      // ③ 時段與日期
      '<section data-ls="3" hidden><div class="fld-row"><div class="fld"><label>星期<b>*</b></label><div class="multi" data-lwds>' + WDS.split('').map((w) => '<label><input type="checkbox" value="' + w + '"' + (v.wds.indexOf(w) >= 0 ? ' checked' : '') + '>' + w + '</label>').join('') + '</div></div>' +
      '<div class="fld"><label>時間<b>*</b></label><div style="display:flex;gap:6px;align-items:center"><input type="time" name="start" value="' + esc(v.start) + '"><span>–</span><input type="time" name="end" value="' + esc(v.end) + '"></div></div></div>' +
      '<div class="fld"><label>日期<b>*</b></label><input name="dates" placeholder="指定日期：20261018、1101、1115　或期間：20261109~1230（依勾選的星期展開）"><span class="hint">展開後點日期可以排除（例如那天學校不借）</span></div>' +
      '<div class="note" style="font-size:.82rem">系統依「據點＋星期＋時間＋球面」找時段：已有就沿用並延長期間，沒有就新增一個（每個星期一個）；每個日期寫一筆可用日（直接「可用」）。</div></section>' +
      '<div id="leasePrev" class="lease-prev" hidden></div></div>';
    const r = await ui.modal({ title: LS_.fixedVenue ? '新增租約｜' + m.venueName(LS_.fixedVenue) : '新增租約', body: body, sticky: true, actions: [{ label: '取消' }, { label: '下一步', kind: 'pri', click: async () => {
      if (LS_.step < 3) { const why = stepCheck(LS_.step); if (why) { ui.toast(why, 'bad'); return false; } goStep(LS_.step + 1); return false; }
      const args = leaseArgs();
      if (!args.ok) { ui.toast(args.why, 'bad'); return false; }
      const out = await PB.run('leaseCreate', args.a);
      return out ? true : false;
    } }] });
    if (r) PB.render();
  };
  function goStep(n) {
    const box = document.getElementById('leaseBox');
    if (!box) return;
    LS_.step = n;
    box.querySelectorAll('section[data-ls]').forEach((sec) => { sec.hidden = sec.dataset.ls !== String(n); });
    box.querySelectorAll('[data-lstep]').forEach((b) => { b.classList.toggle('on', b.dataset.lstep === String(n)); b.classList.toggle('done', +b.dataset.lstep < n); });
    const pri = document.querySelector('.modal-f .btn.pri');
    if (pri) pri.textContent = n < 3 ? '下一步' : '確認登錄';
    document.getElementById('leasePrev').hidden = n !== 3;
    if (n === 2) courtsHtml();
    leaseRead();
    leasePreview();
    const mb = box.closest('.modal-b') || box.parentNode;
    if (mb) mb.scrollTop = 0;
  }
  function stepCheck(n) {
    const v = leaseRead();
    if (n === 1) {
      if (!v.venue || (v.venue === '__new' && !v.newVenue)) return '請選據點';
      if (!num(v.total) && !num(v.unit)) return '請填合約總額或每面每時段';
    }
    if (n === 2 && !LS_.sel.size && !LS_.add.length) return '請至少選 1 面球面（或新增）';
    return '';
  }
  /** ② 球面清單：據點既有的（勾選）＋本次新增的 */
  function courtsHtml() {
    const el = document.getElementById('lsCourts');
    if (!el) return;
    const v = LS_.v;
    const mine = v.venue && v.venue !== '__new' ? vCourts(v.venue) : [];
    const area = v.area;
    const rows = mine.map((c) => {
      const id = str(c['場地ID']);
      const off = str(c['狀態']) === '暫停使用';
      return '<label class="lcourt' + (area && str(c['場地名稱']).indexOf(area) === 0 ? ' hit' : '') + '"><input type="checkbox" data-lcourt="' + esc(id) + '"' + (LS_.sel.has(id) ? ' checked' : '') + '><b>' + esc(c['場地名稱']) + '</b><span class="mut">' + esc(split(c['類型']).join('・') + '・' + (num(c['人數上限']) || '') + ' 人' + (off ? '・暫停使用' : '')) + '</span></label>';
    }).join('') + LS_.add.map((c, i) => '<div class="lcourt new"><span class="badge info">新</span><input data-lnew="' + i + '" value="' + esc(c.name) + '"><span class="mut">人數</span><input type="number" data-lcap="' + i + '" value="' + c.cap + '" style="width:64px"><button type="button" class="fdel" data-ldel="' + i + '" title="移除">×</button></div>').join('');
    const cnt = LS_.sel.size + LS_.add.length;
    el.innerHTML = (rows || '<span class="mut">這個據點還沒有球面，請按「新增球面」</span>') +
      '<div class="lease-cnt">已選 <b>' + cnt + '</b> 面' + (v.expectCourts ? (cnt === v.expectCourts ? ' <span class="badge ok">與「共 ' + v.expectCourts + ' 面」相符</span>' : ' <span class="badge warn">貼上的是共 ' + v.expectCourts + ' 面</span>') : '') + '</div>';
  }
  function nextCourtName() {
    const v = LS_.v;
    const used = (v.venue && v.venue !== '__new' ? vCourts(v.venue).map((c) => str(c['場地名稱'])) : []).concat(LS_.add.map((c) => c.name));
    for (let i = 0; i < 26; i++) { const nm = (v.area ? v.area + ' ' : '') + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i] + (v.area ? '' : ' 面'); if (used.indexOf(nm) < 0) return nm; }
    return '';
  }
  function leaseRead() {
    const box = document.getElementById('leaseBox');
    if (!box) return LS_.v;
    const q = (n) => box.querySelector('[name="' + n + '"]');
    const v = LS_.v;
    v.venue = LS_.fixedVenue || q('venue').value;
    v.newVenue = q('newVenue').value.trim();
    v.area = q('area').value.trim();
    v.start = q('start').value;
    v.end = q('end').value;
    v.wds = Array.from(box.querySelectorAll('[data-lwds] input:checked')).map((i) => i.value);
    v.dates = q('dates').value;
    v.total = q('total').value;
    v.unit = q('unit').value;
    v.sign = q('sign').value;
    v.pay = q('pay').value;
    v.paid = q('paid').checked;
    v.name = q('name').value.trim();
    v.contract = box.querySelector('.files input[type=hidden]').value;
    box.querySelectorAll('[data-lnew]').forEach((i) => { LS_.add[+i.dataset.lnew].name = i.value.trim(); });
    box.querySelectorAll('[data-lcap]').forEach((i) => { LS_.add[+i.dataset.lcap].cap = num(i.value) || 8; });
    q('newVenue').style.display = v.venue === '__new' ? '' : 'none';
    const areas = v.venue && v.venue !== '__new' ? uniq(vCourts(v.venue).map((c) => str(c['場地名稱']).replace(/\s*[A-Z]( 面)?$/, '')).filter(Boolean)) : [];
    box.querySelector('#leaseAreas').innerHTML = areas.map((x) => '<option value="' + esc(x) + '">').join('');
    return v;
  }
  function leaseFill(o) {
    const box = document.getElementById('leaseBox');
    const set = (n, val) => { if (val !== undefined && val !== null) box.querySelector('[name="' + n + '"]').value = val; };
    if (!LS_.fixedVenue) { if (o.venue) set('venue', o.venue); else if (o.newVenue) { set('venue', '__new'); set('newVenue', o.newVenue); } }
    set('area', o.area); set('start', o.start); set('end', o.end); set('dates', o.dates); set('total', o.total); set('unit', o.unit); set('sign', o.sign);
    if (o.wds) box.querySelectorAll('[data-lwds] input').forEach((i) => { i.checked = o.wds.indexOf(i.value) >= 0; });
    LS_.v.expect = o.expect || 0;
    LS_.v.expectCourts = o.courts || 0;
    LS_.off = new Set();
    leaseRead();
    // 球面：先勾同區域既有的，不夠再新增
    LS_.sel = new Set();
    LS_.add = [];
    const v = LS_.v;
    const need = o.courts || 0;
    if (need && v.venue && v.venue !== '__new') vCourts(v.venue).filter((c) => (!v.area || str(c['場地名稱']).indexOf(v.area) === 0) && str(c['狀態']) !== '暫停使用').slice(0, need).forEach((c) => LS_.sel.add(str(c['場地ID'])));
    while (LS_.sel.size + LS_.add.length < need) LS_.add.push({ name: nextCourtName(), cap: 8 });
  }
  function leaseDates() {
    const v = LS_.v;
    return parseDates(v.dates, v.wds, +(v.sign || today()).slice(0, 4));
  }
  function leaseArgs() {
    const v = leaseRead();
    const all = leaseDates();
    const dates = all.filter((d) => !LS_.off.has(d));
    const why = stepCheck(1) || stepCheck(2);
    if (why) return { ok: false, why: why, all: all };
    if (!v.start || !v.end) return { ok: false, why: '請填時間', all: all };
    if (!dates.length) return { ok: false, why: '請填日期（期間要勾星期）', all: all };
    const bad = dates.filter((d) => v.wds.length && v.wds.indexOf(wdOf(d)) < 0);
    if (bad.length) return { ok: false, why: bad.map(fmtD).join('、') + ' 不是勾選的星期', all: all };
    return { ok: true, all: all, a: { venue: v.venue === '__new' ? '' : v.venue, newVenue: v.venue === '__new' ? v.newVenue : '', area: v.area, courtIds: Array.from(LS_.sel), newCourts: LS_.add.filter((c) => c.name), start: v.start, end: v.end, dates: dates, total: num(v.total) || '', unit: num(v.unit) || '', signDate: v.sign, payMethod: v.pay, paidNow: v.paid, name: v.name, contract: v.contract } };
  }
  function leasePreview() {
    clearTimeout(LS_.timer);
    if (LS_.step !== 3) return;
    LS_.timer = setTimeout(async () => {
      const el = document.getElementById('leasePrev');
      if (!el) return;
      const args = leaseArgs();
      const all = args.all || leaseDates();
      const v = LS_.v;
      const nC = LS_.sel.size + LS_.add.length;
      const chips = all.length ? '<div class="lease-dates">' + all.map((d) => '<button type="button" class="ldate' + (LS_.off.has(d) ? ' off' : '') + '" data-ldate="' + d + '">' + esc(fmtD(d)) + '</button>').join('') + '</div>' : '';
      const n = all.filter((d) => !LS_.off.has(d)).length;
      const cnt = '<div class="lease-cnt">共 <b>' + n + '</b> 日' + (v.expect ? (n === v.expect ? ' <span class="badge ok">與「共 ' + v.expect + ' 日」相符</span>' : ' <span class="badge warn">貼上的是共 ' + v.expect + ' 日，請點掉不租的日期</span>') : '') + (num(v.unit) && nC && n ? '・' + nC + ' 面 × ' + n + ' 日 × ' + money(v.unit) + '＝<b>' + money(num(v.unit) * nC * n) + '</b>' : '') + '</div>';
      if (!args.ok) { el.innerHTML = chips + cnt + '<div class="mut" style="font-size:.84rem">' + esc(args.why) + '</div>'; return; }
      const seq = ++LS_.seq;
      el.innerHTML = chips + cnt + '<div class="mut">預覽中…</div>';
      const r = await PB.read('leasePreview', args.a);
      if (seq !== LS_.seq || !document.getElementById('leasePrev')) return;
      if (!r) { el.innerHTML = chips + cnt; return; }
      el.innerHTML = chips + cnt + '<div class="lease-plan"><b>確認登錄後會建立：</b><ul>' +
        (r.venue.isNew ? '<li>新據點「' + esc(r.venue.name) + '」</li>' : '') +
        '<li>球面：' + r.courts.map((c) => esc(c.name) + (c.isNew ? '<span class="badge info">新</span>' : '')).join('、') + '</li>' +
        '<li>時段：' + r.slots.map((s2) => '週' + s2.wd + ' ' + esc(v.start + '–' + v.end) + '（' + (s2.reuse ? '沿用既有時段' : '新增時段') + '，' + s2.n + ' 日' + (s2.skip ? '，其中 ' + s2.skip + ' 日已有' : '') + '）').join('、') + '</li>' +
        '<li>可用日 ' + r.avail + ' 天（直接「可用」）</li><li>租約「' + esc(r.plan) + '」' + money(r.amount) + (r.unitHour ? '（每面每小時 ' + money(r.unitHour) + '）' : '') + '</li><li>場租支出 ' + money(r.amount) + '：' + (v.paid ? v.sign + ' 已付（' + esc(v.pay) + '）' : '應付') + '</li></ul></div>' +
        (r.warnings.length ? r.warnings.map((w) => '<div class="note warn">' + esc(w) + '</div>').join('') : '');
    }, 400);
  }
  document.addEventListener('input', (e) => {
    if (!e.target.closest || !e.target.closest('#leaseBox') || e.target.closest('[name=paste]')) return;
    leaseRead();
    if (e.target.name === 'area' && LS_.step === 2) { const el = document.activeElement; courtsHtml(); if (el) el.focus(); }
    leasePreview();
  });
  document.addEventListener('change', (e) => {
    if (!e.target.closest || !e.target.closest('#leaseBox')) return;
    const c = e.target.closest('[data-lcourt]');
    if (c) { if (c.checked) LS_.sel.add(c.dataset.lcourt); else LS_.sel.delete(c.dataset.lcourt); courtsHtml(); }
    if (e.target.name === 'venue') { LS_.sel = new Set(); courtsHtml(); }
    leaseRead();
    leasePreview();
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#leaseBox [data-lease], #leaseBox [data-ldate], #leaseBox [data-lstep], #leaseBox [data-ldel]');
    if (!b) return;
    e.preventDefault();
    leaseRead();
    if (b.dataset.lstep) {
      const to = +b.dataset.lstep;
      for (let i = 1; i < to; i++) { const why = stepCheck(i); if (why) { ui.toast(why, 'bad'); goStep(i); return; } }
      return goStep(to);
    }
    if (b.dataset.lease === 'parse') {
      const o = parseLease(document.querySelector('#leaseBox [name=paste]').value);
      if (!o.start && !o.dates) return ui.toast('看不懂這個格式，請直接填下面的欄位', 'bad');
      leaseFill(o);
      return ui.toast('已帶入，請檢查後按「下一步」');
    }
    if (b.dataset.lease === 'addCourt') { LS_.add.push({ name: nextCourtName(), cap: 8 }); courtsHtml(); return; }
    if (b.dataset.ldel !== undefined) { LS_.add.splice(+b.dataset.ldel, 1); courtsHtml(); return; }
    const d = b.dataset.ldate;
    if (LS_.off.has(d)) LS_.off.delete(d); else LS_.off.add(d);
    leasePreview();
  });

  // ================================================================
  // v2.9 據點詳情：上方按鈕＋下方 inline（租約、球面、時段、可用日）
  // ================================================================
  function openVenue(id) {
    ui.sheet(() => { const v = PB.get('1_據點', id); return v ? str(v['據點名稱']) : null; }, () => venueBody(id));
  }
  A.venueOpen = (d) => openVenue(d.id);
  const sec2 = (title, cnt, right) => '<div class="sec"><h2>' + esc(title) + '</h2>' + (cnt !== undefined ? '<span class="cnt">' + cnt + '</span>' : '') + '<span class="sp"></span>' + (right || '') + '</div>';
  function venueBody(id) {
    const v = PB.get('1_據點', id);
    const t = today();
    const acts = [btn('新增租約', 'leaseNew', { venue: id }, 'pri', 'plus'), btn('新增球面', 'courtNew', { venue: id }, '', 'plus'), btn('新增時段', 'slotNew', { venue: id }, 'ghost', 'plus'), btn('編輯據點', 'dataEdit', { t: '1_據點', id: id }, 'ghost')];
    const kv2 = [['類別', str(v['據點類別'])], ['區域', str(v['區域'])], ['地址', str(v['地址'])], ['場主', m.staffName(v['場主'])], ['狀態', str(v['狀態'])], ['簽到座標', str(v['座標']) || '<span class="badge warn">未設定（現場簽到需要）</span>']].filter((x) => x[1]);
    const plans = PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((p) => str(p['合作對象類型']) === '據點' && str(p['據點']) === id).sort((a, b) => byKey(day(b['生效日期']), day(a['生效日期']))) : [];
    const exp = PB.rows('3_支出');
    const planRows = plans.map((p) => {
      const pid = str(p['方案ID']);
      const ex = exp.filter((e) => str(e['備註']).indexOf('F03:' + pid + ':') >= 0);
      const paid = ex.length && ex.every((e) => str(e['付款狀態']) === '已付');
      const live = !day(p['失效日期']) || day(p['失效日期']) >= t;
      const amt = str(p['合作模式']) === '按次租用' ? money(p['每面每小時單價']) + '／面／時' : str(p['合約金額']) ? money(p['合約金額']) : '';
      return '<tr class="click" data-act="dataEdit" data-t="3_合作方案" data-id="' + esc(pid) + '"><td style="white-space:normal"><b>' + esc(p['方案名稱']) + '</b><br><span class="mut" style="font-size:.8rem">' + esc(str(p['合作模式']) + '・' + fmtD(p['生效日期']) + '～' + fmtD(p['失效日期'])) + '</span></td><td class="num">' + amt + '</td><td>' + (ex.length ? '<span class="badge ' + (paid ? 'ok' : 'warn') + '">場租' + (paid ? '已付' : '應付') + '</span>' : '') + (live ? '' : ' <span class="badge">已到期</span>') + (str(p['合約']) ? ' <span class="fclip">📎</span>' : '') + '</td><td data-stop style="text-align:right">' + (str(p['合作模式']) === '包場租約' ? btn('續約', 'leaseNew', { copy: pid }, 'ghost') : '') + '</td></tr>';
    }).join('');
    const courts = vCourts(id);
    const courtRows = courts.map((c) => '<tr class="click" data-act="dataEdit" data-t="1_據點_場地" data-id="' + esc(c['場地ID']) + '"><td><b>' + esc(c['場地名稱']) + '</b></td><td>' + esc(split(c['類型']).join('・')) + '</td><td class="num">' + esc(c['人數上限']) + ' 人</td><td>' + (str(c['狀態']) === '暫停使用' ? '<span class="badge warn">暫停使用</span>' : '<span class="badge ok">啟用</span>') + '</td></tr>').join('');
    const slots = PB.rows('1_據點_時段').filter((s) => str(s['據點']) === id).sort((a, b) => byKey(WDS.indexOf(str(a['星期'])) + str(a['開始時間']), WDS.indexOf(str(b['星期'])) + str(b['開始時間'])));
    const slotRows = slots.map((s) => {
      const av = (PB.ix.availBySlot[str(s['時段ID'])] || []).filter((a) => day(a['日期']) >= t);
      const ok = av.filter((a) => str(a['狀態']) === '可用');
      const pend = av.filter((a) => str(a['狀態']) === '待確認').length;
      const last = ok.map((a) => day(a['日期'])).sort().pop();
      return '<tr class="click" data-act="dataEdit" data-t="1_據點_時段" data-id="' + esc(s['時段ID']) + '"><td><b>週' + esc(s['星期']) + ' ' + esc(m.hm(s['開始時間'], s['結束時間'])) + '</b><br><span class="mut" style="font-size:.8rem">' + esc(split(s['使用場地']).map(m.courtName).join('、')) + '</span></td><td style="font-size:.84rem">' + esc(split(s['用途']).join('・')) + (str(s['狀態']) !== '使用中' ? ' <span class="badge">' + esc(s['狀態']) + '</span>' : '') + '</td><td style="font-size:.84rem">可用 <b>' + ok.length + '</b> 天' + (last ? '<br><span class="mut">到 ' + esc(fmtD(last)) + '</span>' : '') + (pend ? '<br><span class="badge warn">待確認 ' + pend + '</span>' : '') + '</td><td data-stop style="text-align:right;white-space:nowrap">' + btn('加日期', 'availAddDlg', { id: s['時段ID'] }, 'pri') + btn('可用日', 'availOf', { id: s['時段ID'] }, 'ghost') + '</td></tr>';
    }).join('');
    const tbl = (rows, empty) => '<div class="tbl-wrap"><table class="tbl"><tbody>' + (rows || '<tr><td class="mut">' + empty + '</td></tr>') + '</tbody></table></div>';
    return '<div class="acts">' + acts.join('') + '</div>' + kv(kv2.map((x) => [x[0], x[0] === '簽到座標' && !str(v['座標']) ? x[1] : esc(x[1])])) +
      sec2('租約與合作方案', plans.length) + tbl(planRows, '還沒有租約：按上方「新增租約」') +
      sec2('球面', courts.length, btn('新增', 'courtNew', { venue: id }, 'sm ghost', 'plus')) + tbl(courtRows, '還沒有球面') +
      sec2('時段', slots.length, btn('新增', 'slotNew', { venue: id }, 'sm ghost', 'plus')) + tbl(slotRows, '還沒有時段') +
      '<p class="mut" style="font-size:.8rem">流程：簽新約 →「新增租約」（球面、時段、可用日一次建好）；同一份約多租幾天 → 時段的「加日期」；下一期 → 租約的「續約」（沿用球面與時間，填新日期與金額）。</p>';
  }
  const kv = (pairs) => '<dl class="kv">' + pairs.filter((p) => p && p[1] !== '' && p[1] !== undefined && p[1] !== null).map((p) => '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>';
  A.courtNew = (d) => ui.form('1_據點_場地', { values: { 據點: d.venue, 人數上限: 8, 類型: ['課程', '球敘'], 狀態: '啟用' } });
  A.slotNew = (d) => ui.form('1_據點_時段', { values: { 據點: d.venue, 用途: ['課程', '球敘'], 週期: '指定日期' } });
  A.availAddDlg = async (d) => {
    const s = PB.get('1_據點_時段', d.id);
    const wd = str(s['星期']);
    const st = { off: new Set() };
    const body = '<p class="mut" style="margin:0 0 8px">' + esc(m.venueName(s['據點']) + '｜週' + wd + ' ' + m.hm(s['開始時間'], s['結束時間']) + '｜' + split(s['使用場地']).map(m.courtName).join('、')) + '</p>' +
      '<div class="fld"><label>日期</label><input name="dates" id="aaDates" placeholder="例：1206、1213、1220　或 20261206~1227（只取週' + esc(wd) + '）"></div><div id="aaPrev" class="lease-prev"><span class="mut">輸入後這裡會列出日期，點一下可以排除</span></div>';
    const calc = () => parseDates((document.getElementById('aaDates') || {}).value || '', [wd], +today().slice(0, 4));
    const draw = () => {
      const el = document.getElementById('aaPrev');
      if (!el) return;
      const all = calc();
      const have = (PB.ix.availBySlot[str(s['時段ID'])] || []).filter((a) => str(a['狀態']) !== '取消').map((a) => day(a['日期']));
      el.innerHTML = all.length ? '<div class="lease-dates">' + all.map((x) => '<button type="button" class="ldate' + (st.off.has(x) ? ' off' : '') + '" data-aad="' + x + '">' + esc(fmtD(x)) + (have.indexOf(x) >= 0 ? '（已有）' : '') + '</button>').join('') + '</div><div class="lease-cnt">新增 <b>' + all.filter((x) => !st.off.has(x) && have.indexOf(x) < 0).length + '</b> 天（直接「可用」）</div>' : '<span class="mut">沒有符合週' + esc(wd) + '的日期</span>';
    };
    const onIn = (e) => { if (e.target.id === 'aaDates') draw(); };
    const onClick = (e) => { const b = e.target.closest && e.target.closest('[data-aad]'); if (!b) return; e.preventDefault(); const x = b.dataset.aad; if (st.off.has(x)) st.off.delete(x); else st.off.add(x); draw(); };
    document.addEventListener('input', onIn);
    document.addEventListener('click', onClick, true);
    const r = await ui.modal({ title: '加日期', body: body, sticky: true, actions: [{ label: '取消' }, { label: '加入', kind: 'pri', click: () => { const ds = calc().filter((x) => !st.off.has(x)); if (!ds.length) { ui.toast('請填日期', 'bad'); return false; } return ds; } }] });
    document.removeEventListener('input', onIn);
    document.removeEventListener('click', onClick, true);
    if (r) PB.run('availAdd', { slot: d.id, dates: r });
  };

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
    version: '2.9',
    screens: [Dash, Queue].concat(PB.schedScreen ? [PB.schedScreen] : []).concat([Finance, Data]),
    links: () => (PB.cfg.opsUrl ? [{ label: '營運工作台', url: PB.cfg.opsUrl, icon: 'swap', mobile: true }] : []),
  });
})();
