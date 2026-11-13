/**
 * 理論上匹克球｜管理後台 admin.js v4.12（2026/11/10：排課、主檔與紀錄移到營運工作台 → sched.js、data.js）；v4.8（2026/11/06：系統設定加「表單」欄位設定）；v4.7（2026/11/06：系統設定 — 按鈕、介面、參數）；v3.4（2026/10/28：批次新增時段、複製到其他星期、租約一天多個時段）；v3.1（2026/10/27：據點與場地改版：據點左清單＋右分頁、跨據點總表、可用日月曆）；v3.0（球拍租借收入另列、不進分潤）；v2.4（2026/10/26：專項列表加「費用」）
 * 特助、主理人：總覽 Dashboard、管理待處理、財務（人員月結、分潤、支出、應收）、系統設定
 * Dashboard 全部在瀏覽器計算（換月份不發請求）；口徑：
 *   球敘收入＝當月球敘的報名實收（含待對帳、扣退款），v3.0 起扣掉球拍租借（另列「租拍收入」，全歸公司、不分潤）　課程收入＝當月扣堂數 × 每堂單價（與 F02 相同）
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
    const v = (id) => (V[id || '—'] = V[id || '—'] || { id: id, gN: 0, gHeads: 0, gIn: 0, gRev: 0, rkRev: 0, rkN: 0, sN: 0, sAtt: 0, cRev: 0, spRev: 0, spN: 0, venue: 0, coach: 0, host: 0, other: 0 });
    const types = {};
    const games = PB.rows('2_球敘場次').filter((g) => inM(g['日期']) && ['取消', '草稿'].indexOf(str(g['狀態'])) < 0);
    games.forEach((g) => {
      const x = v(str(g['據點']));
      const sigs = PB.ix.sigByGame[str(g['球敘ID'])] || [];
      const act = sigs.filter((r) => str(r['報名狀態']) === '已報名');
      const rk = sum(sigs, (r) => m.sigRacket(r['報名ID'])); // v3.0：球拍租借另列
      const rev = sum(sigs, (r) => m.sigPay(r['報名ID']).net) - rk;
      x.gN += 1; x.gHeads += act.length; x.gIn += act.filter((r) => str(r['簽到時間'])).length; x.gRev += rev; x.venue += num(g['場地成本']);
      x.rkRev += rk; x.rkN += sum(act, (r) => num(r['租拍數']));
      const tk = m.gameTypeName(g['球敘類型']); // v3.6：依類型名稱（舊值「不限」＝一般球敘）
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
      x.rev = x.gRev + x.cRev + x.rkRev;
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
      const vrows = S.venues.map((x) => '<tr class="click" data-act="venueDrill" data-id="' + esc(x.id) + '" data-m="' + mon + '"><td>' + esc(x.id ? m.venueName(x.id) : '（未指定據點）') + '</td><td class="num">' + x.gN + '</td><td class="num">' + x.gHeads + '</td><td class="num">' + money(x.gRev) + '</td><td class="num">' + money(x.rkRev) + '</td><td class="num">' + x.sN + '</td><td class="num">' + money(x.cRev) + '</td><td class="num">' + money(x.venue) + '</td><td class="num">' + money(x.coach) + '</td><td class="num">' + money(x.host) + '</td><td class="num">' + money(x.other) + '</td><td class="num" style="color:' + (x.pl < 0 ? 'var(--bad)' : 'var(--ok)') + '"><b>' + money(x.pl) + '</b></td></tr>').join('');
      const types = Object.keys(S.types).map((k) => { const t = S.types[k]; return '<tr><td>' + esc(k) + '</td><td class="num">' + t.n + '</td><td class="num">' + t.heads + '</td><td class="num">' + (t.n ? (t.heads / t.n).toFixed(1) : '—') + '</td><td class="num">' + money(t.rev) + '</td></tr>'; }).join('');
      return '<div class="ptop"><h1>營運總覽</h1><span class="sp"></span>' + monthSelect(mon, 'dashMonth') + (PB.cfg.legacyDashUrl ? '<a class="btn sm ghost" href="' + esc(PB.cfg.legacyDashUrl) + '" target="_blank" rel="noopener">' + PB.icon('ext') + '10 月整理 Dashboard</a>' : '') + '</div>' +
        '<div class="kpis">' +
        tile('營運收入', money(T.rev), '球敘 ' + money(T.gRev) + '・課程 ' + money(T.cRev) + (T.rkRev ? '・租拍 ' + money(T.rkRev) : '')) +
        tile('營運成本', money(T.cost), '場地 ' + money(T.venue) + '・教練 ' + money(T.coach) + '・場主 ' + money(T.host) + (T.other ? '・其他 ' + money(T.other) : '')) +
        tile('營運損益', money(T.pl), '收入 − 成本（場次口徑）', T.pl < 0 ? 'neg' : 'pos') +
        tile('本月實收', money(S.cashIn + S.cashOut), (S.cashOut ? '退款 ' + money(S.cashOut) + '・' : '') + (S.pending ? '待對帳 ' + money(S.pending) : '全部已對帳')) +
        tile('球敘', (T.gN || 0) + ' 場', '報名 ' + (T.gHeads || 0) + ' 人次・平均 ' + (T.gN ? (T.gHeads / T.gN).toFixed(1) : '—') + '・簽到 ' + pct(T.gIn || 0, T.gHeads || 0)) +
        tile('課程', (T.sN || 0) + ' 堂', '出席 ' + (T.sAtt || 0) + ' 人次（已點名）' + (T.spN ? '・專項 ' + T.spN + ' 堂 ' + money(T.spRev) : '')) +
        (T.rkRev || T.rkN ? tile('球拍租借', money(T.rkRev), (T.rkN || 0) + ' 支次・全歸公司，不進分潤') : '') +
        tile('新學員', S.newStu + ' 位', '報名課程 ' + S.conv + ' 位（' + pct(S.conv, S.newStu) + '）') +
        tile('目前未收', money(owedNow()), '全部未作廢應收', owedNow() > 0 ? 'neg' : '') +
        (PB.has('3_抵用金流水') ? tile('抵用金（預收）', money(creditTotal()), '學員還沒用掉的抵用金；折抵時才算收入') : '') +
        '</div>' +
        sec('近 6 個月', '') + barChart(trend) +
        sec('各據點', mon) + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>據點</th><th class="num">球敘</th><th class="num">人次</th><th class="num">球敘收入</th><th class="num">租拍</th><th class="num">上課</th><th class="num">課程收入</th><th class="num">場地成本</th><th class="num">教練費</th><th class="num">場主費</th><th class="num">其他</th><th class="num">損益</th></tr></thead><tbody>' + (vrows || '<tr><td colspan="12" class="mut">這個月沒有資料</td></tr>') +
        '</tbody><tfoot><tr><td>合計</td><td class="num">' + (T.gN || 0) + '</td><td class="num">' + (T.gHeads || 0) + '</td><td class="num">' + money(T.gRev) + '</td><td class="num">' + money(T.rkRev) + '</td><td class="num">' + (T.sN || 0) + '</td><td class="num">' + money(T.cRev) + '</td><td class="num">' + money(T.venue) + '</td><td class="num">' + money(T.coach) + '</td><td class="num">' + money(T.host) + '</td><td class="num">' + money(T.other) + '</td><td class="num">' + money(T.pl) + '</td></tr></tfoot></table></div>' +
        '<div class="grid2" style="margin-top:12px"><div>' + sec('球敘類型', '') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>類型</th><th class="num">場次</th><th class="num">人次</th><th class="num">平均</th><th class="num">收入</th></tr></thead><tbody>' + (types || '<tr><td colspan="5" class="mut">—</td></tr>') + '</tbody></table></div></div>' +
        '<div>' + sec('口徑說明', '') + '<div class="card" style="padding:10px 14px;font-size:.84rem;color:var(--mut)"><ul style="margin:0;padding-left:18px">' +
        '<li>球敘收入：當月球敘的報名實收（含待對帳、扣除退款），依球敘日期；不含球拍租借</li><li>租拍：線上＋現場的球拍租借實收，全歸公司、不進分潤（線上租拍費含在報名費裡，收款先算報名費）</li><li>課程收入：期制班＝當月教練確認上課扣的堂數 × 每堂單價（班級費用 ÷ 總堂數），與分潤試算相同；專項課＝當月已上完的場次的報名實收</li><li>抵用金是預收：轉入時從原課程收入扣掉，折抵時才算進新課程</li><li>場地成本為場次分攤（換算單價 × 面時數）；本月實際場租應付 ' + money(S.rent) + '（支出，F03）</li><li>教練費只算已完成場次；場主費只算有簽到的排班</li><li>其他支出不含場租、教練費、場主費細目，避免重複</li></ul></div></div></div>' +
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
        const rk = sum(x.sigs, (r) => m.sigRacket(r['報名ID'])); // v3.0
        const rev = sum(x.sigs, (r) => m.sigPay(r['報名ID']).net) - rk;
        const host = sum(PB.ix.dutyByGame[str(g['球敘ID'])] || [], (dd) => (str(dd['簽到時間']) ? dd['場主費'] : 0));
        return '<tr><td>' + esc(fmtD(g['日期']) + ' ' + m.hm(g['開始時間'])) + '</td><td>' + esc(m.gameLabel(g)) + '</td><td class="num">' + x.active.length + '</td><td class="num">' + money(rev) + '</td><td class="num">' + money(rk) + '</td><td class="num">' + money(g['場地成本']) + '</td><td class="num">' + money(host) + '</td><td class="num">' + money(rev + rk - num(g['場地成本']) - host) + '</td></tr>';
      }).join('');
      const sRows = ss.map((s) => '<tr><td>' + esc(fmtD(s['日期']) + ' ' + m.hm(s['開始時間'])) + '</td><td>' + esc(m.classLabel(PB.get('2_課程班級', s['班級'])) + ' 第' + str(s['第幾堂']) + '堂') + '</td><td>' + esc(str(s['場次狀態'])) + '</td><td>' + esc(m.staffName(s['授課教練'])) + '</td><td class="num">' + money(s['教練費']) + '</td><td class="num">' + money(s['場地成本']) + '</td></tr>').join('');
      return sec('球敘', gs.length + ' 場') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>類型</th><th class="num">人數</th><th class="num">實收</th><th class="num">租拍</th><th class="num">場地</th><th class="num">場主費</th><th class="num">損益</th></tr></thead><tbody>' + (gRows || '<tr><td colspan="8" class="mut">—</td></tr>') + '</tbody></table></div>' +
        sec('上課場次', ss.length + ' 堂') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日期</th><th>班級</th><th>狀態</th><th>教練</th><th class="num">教練費</th><th class="num">場地</th></tr></thead><tbody>' + (sRows || '<tr><td colspan="6" class="mut">—</td></tr>') + '</tbody></table></div>';
    }, 'venue');
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
  // v3.7：系統檢查（同營運工作台）
  Q.push({
    id: 'health', title: '系統檢查（排程漏跑／資料卡住）',
    items: () => PB.healthItems(),
    row: (x) => row({ t: esc(str(x['項目'])) + (str(x['等級']) === '急件' ? ' <span class="badge bad">急件</span>' : ''), s: esc(str(x['說明']) + (str(x['首次發現']) ? '・發現於 ' + fmtDT(x['首次發現']) : '')) + '<br><span class="mut">→ ' + esc(str(x['處理方式'])) + '</span>' }),
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
    const ms = PB.rows('3_人員費用結算').filter((s) => str(s['狀態']) === '試算中').map((s) => str(s['月份'])).sort(); // v4.11：只看還在試算的月份
    return ms[0] || months(2)[1];
  }
  A.finTab = (d) => PB.go('finance', Object.assign({}, PB.params(), { tab: d.v }));
  PB.inputs.finMonth = (v) => PB.setParam('m', v);

  function settleTab(mon, p) {
    // v4.11（11/10）：預設只列「試算中」；送出付款後的在「付款」頁（資料不會刪，付款後在「付款紀錄」）
    const all = PB.rows('3_人員費用結算').filter((s) => str(s['月份']) === mon);
    const showAll = (p && p.all) === '1';
    const sent = all.filter((s) => str(s['狀態']) !== '試算中').length;
    const list = (showAll ? all : all.filter((s) => str(s['狀態']) === '試算中')).sort((a, b) => byKey(str(a['結算類型']) + m.staffName(a['人員']), str(b['結算類型']) + m.staffName(b['人員'])));
    const tot = (st) => sum(list.filter((s) => !st || str(s['狀態']) === st), (s) => num(s['計算金額']) + num(s['調整金額']));
    const rows = list.map((s) => '<tr class="click" data-act="settleOpen" data-id="' + esc(s['結算ID']) + '"><td data-stop><input type="checkbox" data-q="settle" value="' + esc(s['結算ID']) + '"></td><td>' + esc(m.staffName(s['人員'])) + '</td><td>' + esc(s['結算類型']) + '</td><td class="num">' + money(s['計算金額']) + '</td><td class="num">' + (num(s['調整金額']) ? money(s['調整金額']) : '') + '</td><td class="num"><b>' + money(num(s['計算金額']) + num(s['調整金額'])) + '</b></td><td><span class="badge ' + ({ 試算中: 'warn', 待付款: 'info', 已付款: 'ok' }[str(s['狀態'])] || '') + '">' + esc(s['狀態']) + '</span>' + (day(s['付款日期']) ? ' <span class="mut">' + fmtD(s['付款日期']) + '</span>' : '') + '</td><td class="mut" style="white-space:normal">' + esc(s['調整原因']) + '</td></tr>').join('');
    return '<div class="acts">' + btn('勾選的送出付款', 'settleTo', { to: '待付款' }, 'pri') + btn('去付款（可和分潤、支出一起匯）', 'param2', { k: 'tab', v: '付款' }) + btn('退回試算', 'settleTo', { to: '試算中' }, 'ghost') + '</div>' +
      '<div class="chips" style="margin-bottom:10px"><button class="chip' + (showAll ? '' : ' on') + '" data-act="param2" data-k="all" data-v="">試算中<span class="c">' + (all.length - sent) + '</span></button><button class="chip' + (showAll ? ' on' : '') + '" data-act="param2" data-k="all" data-v="1">全部（含已送出 ' + sent + '）</button></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>人員</th><th>類型</th><th class="num">計算</th><th class="num">調整</th><th class="num">應付</th><th>狀態</th><th>調整原因</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">' + (sent && !showAll ? '這個月的結算單都已送出，在「付款」頁付款；付完會出現在「付款紀錄」' : '這個月沒有結算單（每月 1 日 06:00 由系統產生上個月的試算）') + '</td></tr>') +
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
    }, 'settle');
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
  // v4.11：每個受款對象可收合（記在這台裝置）；人員的匯款資料打開付款頁時讀一次，只放記憶體
  const LSO = 'pb:payOpen';
  const payOpen = (() => { try { return new Set(JSON.parse(localStorage.getItem(LSO) || '[]')); } catch (e) { return new Set(); } })();
  const saveOpen = () => { try { localStorage.setItem(LSO, JSON.stringify(Array.from(payOpen))); } catch (e) { /* 私密視窗 */ } };
  A.payToggle = (d) => { if (payOpen.has(d.k)) payOpen.delete(d.k); else payOpen.add(d.k); saveOpen(); PB.render(); };
  A.payOpenAll = (d) => { if (d.v === '1') split(d.ks.replace(/,/g, ' , ')).forEach((k) => payOpen.add(k)); else payOpen.clear(); saveOpen(); PB.render(); };
  let PAYINFO = null;
  let payInfoKey = '';
  function loadPayInfo(ids) {
    payInfoKey = ids.join(',');
    PB.read('payeeInfo', { staff: ids }).then((r) => { PAYINFO = (r && r.staff) || {}; }).catch(() => { PAYINFO = {}; }).finally(() => { PB.render(); });
  }
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
    const staffIds = uniq(order.map((k) => groups[k].py).filter((py) => py.kind === '人員').map((py) => py.id));
    if (staffIds.length && payInfoKey !== staffIds.join(',')) loadPayInfo(staffIds);
    const bankLine = (g, amt) => {
      // v4.16：應交扣抵讓淨額變負 → 場主要轉給公司（收到後一樣勾選「付款…」記錄）
      if (amt < 0) return '<span class="badge warn">淨額 ' + money(amt) + '：請 ' + esc(g.py.name) + ' 轉 ' + money(-amt) + ' 給公司</span> <span class="mut" style="font-size:.8rem">收到後勾選這幾筆按「付款…」記錄，付款方式寫「場主轉入」</span>';
      if (g.py.kind !== '人員') return g.py.info ? '<span class="mut" style="font-size:.84rem">付款方式：' + esc(g.py.info) + '</span>' : '';
      if (!PAYINFO) return '<span class="mut" style="font-size:.84rem">讀取匯款資料…</span>';
      const x = PAYINFO[g.py.id];
      if (!x || !(x.匯款銀行 || x.帳號)) return '<span class="badge warn">沒有匯款資料</span> <span class="mut" style="font-size:.8rem">請本人在 LINE 填「匯款帳戶」</span>';
      const b = bankOf(x.匯款銀行);
      const acct = acctDigits(x.帳號);
      return (x.changed ? '<span class="badge warn" title="' + esc(x.changeNote || '') + '">帳戶 ' + esc(fmtD(x.changed)) + ' 本人剛改過，付款前請跟本人確認</span> ' : '') + '<span class="mut" style="font-size:.8rem">銀行</span> <b>' + esc(b.code || '—') + '</b> <span class="mut" style="font-size:.84rem">' + esc(b.name) + '</span>' + (b.code ? cpBtn(b.code, g.py.name + ' 銀行代碼', 1) : '') +
        '<span style="display:inline-block;width:10px"></span><span class="mut" style="font-size:.8rem">帳號</span> <b style="letter-spacing:.02em">' + esc(acct || '—') + '</b>' + (acct ? cpBtn(acct, g.py.name + ' 帳號', 1) : '') +
        '<span style="display:inline-block;width:10px"></span><span class="mut" style="font-size:.8rem">金額</span> <b>' + money(amt) + '</b>' + cpBtn(String(Math.round(amt)), g.py.name + ' 金額', 1) +
        '<span style="flex:1"></span><button class="btn sm ghost" data-act="payCopy" data-v="' + esc(transferText(g.py.name, x, amt)) + '" data-w="' + esc(g.py.name + ' 轉帳資訊') + '">' + PB.icon('copy') + '複製全部</button>';
    };
    const cards = order.map((k) => {
      const g = groups[k];
      const ks = g.list.map(skey);
      const on = ks.filter((x) => paySel.has(x)).length;
      const kinds = uniq(g.list.map((x) => x.t === '月結' ? str(x.r['結算類型']) || '月結' : x.t));
      const amt = sum(g.list, (x) => x.amt);
      const open = payOpen.has(k);
      const rows = g.list.sort((a, b) => byKey(a.t + a.d, b.t + b.d)).map((x) => '<tr' + (x.open ? ' class="click" data-act="' + x.open + '" data-id="' + esc(x.id) + '"' : '') + '><td data-stop><input type="checkbox" data-paysel="' + esc(skey(x)) + '"' + (paySel.has(skey(x)) ? ' checked' : '') + '></td><td><span class="badge ' + TBADGE[x.t] + '">' + x.t + '</span></td><td style="white-space:normal">' + esc(x.t === '支出' ? fmtD(x.d) + '・' + x.label : x.label) + '</td><td class="fclip m-hide">' + (x.files ? '📎 ' + x.files : '') + '</td><td class="num">' + money(x.amt) + '</td></tr>').join('');
      return '<div class="card exp-g"><div class="exp-gh"><input type="checkbox" style="width:16px;height:16px;accent-color:var(--brand)" aria-label="全選 ' + esc(g.py.name) + '" data-paygrp="' + esc(ks.join(',')) + '"' + (on === ks.length ? ' checked' : '') + '>' +
        '<button class="pay-tg" data-act="payToggle" data-k="' + esc(k) + '" aria-expanded="' + open + '" style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;border:0;background:none;padding:2px 0;font:inherit;color:inherit;text-align:left;cursor:pointer">' +
        '<span class="grp-arrow' + (open ? ' on' : '') + '">' + PB.icon('chev') + '</span><b style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">' + esc(g.py.name) + '</b>' + (g.py.kind ? '<span class="badge m-hide">' + esc(g.py.kind) + '</span>' : '') +
        '<span class="mut m-hide" style="font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(kinds.join('＋')) + '・' + g.list.length + ' 筆</span><span style="flex:1"></span><b class="num">' + money(amt) + '</b></button></div>' +
        (open ? '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--line)">' + bankLine(g, amt) + '</div>' +
          '<div class="tbl-wrap flat"><table class="tbl"><tbody>' + rows + '</tbody></table></div>' : '') + '</div>';
    }).join('');
    const allKeys = order.join(',');
    const openBar = order.length > 1 ? '<div style="display:flex;gap:6px;margin-bottom:8px">' + btn('全部展開', 'payOpenAll', { v: '1', ks: allKeys }, 'ghost') + btn('全部收合', 'payOpenAll', { v: '0', ks: '' }, 'ghost') + '</div>' : '';
    const filt = '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="受款對象、項目" value="' + esc(p.q || '') + '" data-input="arSearch"></label><span class="sp"></span><span class="mut">待付 ' + list.length + ' 筆・' + money(sum(list, (x) => x.amt)) + '</span>' + (list.length ? btn('轉帳清單', 'payList', {}, 'pri') : '') + btn('新增支出', 'expNew', {}, 'ghost', 'plus') + '</div>';
    return filt + openBar + (cards || '<div class="card">' + ui.empty('沒有待付款的項目', '') + '</div>') + '<div class="exp-bar" id="payBar">' + barHtml() + '</div>' +
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
    const bank = (py) => { const r = info && info.staff[py.id]; return r && (r.匯款銀行 || r.帳號) ? r.匯款銀行 + ' ' + r.帳號 + (r.changed ? '（⚠ ' + fmtD(r.changed) + ' 本人剛改過帳戶，請先確認）' : '') : py.kind === '人員' ? '沒有匯款資料' : py.info || ''; };
    const list = Object.keys(groups).map((k) => { const g = groups[k]; return '<tr><td><b>' + esc(g.py.name) + '</b><br><span class="mut" style="font-size:.8rem">' + esc(bank(g.py)) + '</span><br><span class="mut" style="font-size:.76rem">' + esc(uniq(g.list.map((x) => x.t)).map((t) => t + ' ' + g.list.filter((x) => x.t === t).length).join('・')) + '</span></td><td class="num"><b>' + money(sum(g.list, (x) => x.amt)) + '</b>' + (sum(g.list, (x) => x.amt) < 0 ? '<br><span class="mut" style="font-size:.76rem">對方轉給公司</span>' : '') + '</td></tr>'; }).join('');
    const body = '<div class="tbl-wrap" style="margin-bottom:10px"><table class="tbl"><tbody>' + list + '</tbody><tfoot><tr><td>合計 ' + sel.length + ' 筆</td><td class="num">' + money(sum(sel, (x) => x.amt)) + '</td></tr></tfoot></table></div>' +
      '<div class="fld-row"><div class="fld"><label>付款日期</label><input type="date" name="date" value="' + today() + '"></div><div class="fld"><label>付款方式</label><select name="method">' + (PB.enums['支出付款方式'] || ['轉帳', '現金', '其他']).map((x) => '<option>' + esc(x) + '</option>').join('') + '</select></div></div>' +
      '<div class="fld"><label>備註</label><input name="note" placeholder="例：10 月教練費與代墊一起匯"></div>' +
      '<div class="fld"><label>付款憑證</label>' + ui.filesField({ k: '付款憑證', _table: '3_支出' }, '', 'payproof') + '<span class="hint">轉帳截圖等；會附在這次付款的每一筆</span></div>';
    const r = await ui.modal({ title: '付款 ' + sel.length + ' 筆', body: body, sticky: true, actions: [{ label: '取消' }, { label: '確認付款', kind: 'pri', click: (el) => { const d = el.querySelector('[name=date]').value; if (!d) { ui.toast('請選付款日期', 'bad'); return false; } return { date: d, method: el.querySelector('[name=method]').value, note: el.querySelector('[name=note]').value, proof: el.querySelector('.files input[type=hidden]').value }; } }] });
    if (!r) return;
    const out = await PB.run('payBatch', Object.assign({ items: sel.map((x) => ({ t: x.t, id: x.id })) }, r));
    if (out) { sel.forEach((x) => paySel.delete(skey(x))); saveSel(); PB.render(); }
    PAYINFO = null; payInfoKey = '';
  };
  // ---- v4.11（11/10）轉帳資訊：銀行代碼、帳號、金額一鍵複製（主理人轉帳用；只讀不存本機） ----
  const BANK_NAMES = { '004': '臺灣銀行', '005': '土地銀行', '006': '合作金庫', '007': '第一銀行', '008': '華南銀行', '009': '彰化銀行', '011': '上海商銀', '012': '台北富邦', '013': '國泰世華', '017': '兆豐銀行', '048': '王道銀行', '050': '臺灣企銀', '052': '渣打銀行', '053': '台中銀行', '081': '匯豐銀行', '103': '新光銀行', '108': '陽信銀行', '700': '中華郵政', '803': '聯邦銀行', '805': '遠東銀行', '806': '元大銀行', '807': '永豐銀行', '808': '玉山銀行', '809': '凱基銀行', '810': '星展銀行', '812': '台新銀行', '822': '中國信託', '823': '將來銀行', '824': '連線銀行（LINE Bank）', '826': '樂天銀行' };
  /** 「013」「013 國泰世華」「國泰世華」→ { code, name } */
  function bankOf(v) {
    const s0 = str(v).trim();
    const m0 = s0.match(/^(\d{3})\s*(.*)$/);
    if (m0) return { code: m0[1], name: str(m0[2]) || BANK_NAMES[m0[1]] || '' };
    const code = Object.keys(BANK_NAMES).find((c) => s0 && (BANK_NAMES[c].indexOf(s0) >= 0 || s0.indexOf(BANK_NAMES[c].replace(/銀行$/, '')) >= 0));
    return { code: code || '', name: s0 };
  }
  const acctDigits = (v) => str(v).replace(/\D/g, '');
  const cpBtn = (v, what, short) => '<button class="btn sm ghost" style="padding:2px 8px" data-act="payCopy" data-v="' + esc(v) + '" data-w="' + esc(what) + '" title="複製' + esc(what) + '" aria-label="複製' + esc(what) + '">' + PB.icon('copy') + (short ? '' : '複製') + '</button>';
  A.payCopy = (d) => PB.copy(d.v, d.w);
  function transferText(name, info, amt) {
    const b = bankOf(info.匯款銀行);
    return [name, '銀行：' + [b.code, b.name].filter(Boolean).join(' '), '帳號：' + acctDigits(info.帳號), amt ? '金額：' + Math.round(amt) : ''].filter(Boolean).join('\n');
  }
  A.secretView = async (d) => {
    const r = await PB.read('payeeInfo', { staff: [d.id] });
    const x = r && r.staff[d.id];
    const name = m.staffName(d.id);
    const amt = num(d.amt);
    if (!x || !(x.匯款銀行 || x.帳號)) {
      return ui.modal({ title: '轉帳資訊：' + name, body: '<div class="note warn">還沒有匯款資料。請本人到 LINE 官方帳號「資料／教練資料 → 匯款帳戶」填寫，或到「營運工作台 → 主檔與紀錄 → 人員與權限 → 人員」按「請款資料」代填。</div>' + (amt ? '<p>應付金額 <b>' + money(amt) + '</b></p>' : ''), actions: [{ label: '關閉' }] });
    }
    const b = bankOf(x.匯款銀行);
    const acct = acctDigits(x.帳號);
    const row = (label, shown, val, what) => '<tr><td class="mut" style="width:5em">' + label + '</td><td><b style="font-size:1.05rem">' + esc(shown || '—') + '</b></td><td style="text-align:right">' + (val ? cpBtn(val, what) : '') + '</td></tr>';
    const body = '<div class="tbl-wrap"><table class="tbl"><tbody>' +
      row('銀行代碼', b.code, b.code, '銀行代碼') + row('銀行', b.name, '', '') + row('帳號', acct, acct, '帳號') + (amt ? row('金額', money(amt), String(Math.round(amt)), '金額') : '') +
      '</tbody></table></div>' + (b.code ? '' : '<div class="note warn" style="margin-top:8px">銀行沒有填代碼，轉帳前請先確認。</div>');
    const text = transferText(name, x, amt);
    ui.modal({ title: '轉帳資訊：' + name, body: body, actions: [{ label: '關閉' }, { label: '複製全部', kind: 'pri', click: () => { PB.copy(text, '轉帳資訊'); return false; } }] });
  };
  /** 待付款的人員一次列出：銀行代碼／帳號／金額各自可複製；勾選了就只列勾選的對象 */
  A.payList = async () => {
    const due = payItems(false);
    const picked = due.filter((x) => paySel.has(skey(x)));
    let src = picked.length ? picked : due;
    const groups = {};
    src.forEach((x) => { (groups[x.py.k] = groups[x.py.k] || { py: x.py, list: [] }).list.push(x); });
    // v4.16：淨額 ≤ 0（應交扣抵比場主費多）不用轉帳，另外列出
    const owe = Object.keys(groups).filter((k) => sum(groups[k].list, (x) => x.amt) <= 0).map((k) => { const g = groups[k]; delete groups[k]; return g; });
    src = src.filter((x) => groups[x.py.k]);
    const order = Object.keys(groups).sort((a, b) => sum(groups[b].list, (x) => x.amt) - sum(groups[a].list, (x) => x.amt));
    const staff = order.map((k) => groups[k].py).filter((py) => py.kind === '人員').map((py) => py.id);
    const info = staff.length ? await PB.read('payeeInfo', { staff: staff }) : null;
    let missing = 0;
    const lines = [];
    const rows = order.map((k) => {
      const g = groups[k];
      const amt = sum(g.list, (x) => x.amt);
      const what = uniq(g.list.map((x) => x.t === '月結' ? str(x.r['結算類型']) || '月結' : x.t)).join('＋');
      const x = g.py.kind === '人員' && info ? info.staff[g.py.id] : null;
      const has = x && (x.匯款銀行 || x.帳號);
      const b = has ? bankOf(x.匯款銀行) : { code: '', name: '' };
      const acct = has ? acctDigits(x.帳號) : '';
      if (!has && g.py.kind === '人員') missing += 1;
      lines.push([g.py.name, b.code, b.name, acct, Math.round(amt)].join('\t'));
      const bankLine = has
        ? '<span class="mut" style="font-size:.8rem">銀行</span> <b>' + esc(b.code || '—') + '</b> <span class="mut">' + esc(b.name) + '</span>' + (b.code ? cpBtn(b.code, g.py.name + ' 銀行代碼', 1) : '') +
          '<span style="display:inline-block;width:14px"></span><span class="mut" style="font-size:.8rem">帳號</span> <b style="letter-spacing:.02em">' + esc(acct || '—') + '</b>' + (acct ? cpBtn(acct, g.py.name + ' 帳號', 1) : '')
        : '<span class="badge ' + (g.py.kind === '人員' ? 'warn' : '') + '">' + (g.py.kind === '人員' ? '沒有匯款資料' : esc(g.py.info || '請依合作方案付款')) + '</span>';
      return '<div style="border:1px solid var(--line,#dde5e1);border-radius:10px;padding:8px 10px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>' + esc(g.py.name) + '</b><span class="mut" style="font-size:.76rem">' + esc(what) + '</span><span style="flex:1"></span><b class="num" style="font-size:1.05rem">' + money(amt) + '</b>' + cpBtn(String(Math.round(amt)), g.py.name + ' 金額', 1) + '</div>' +
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px">' + bankLine + '</div></div>';
    }).join('');
    const total = sum(src, (x) => x.amt);
    const body = (picked.length ? '<div class="note" style="margin-bottom:8px">只列勾選的 ' + order.length + ' 個對象（清除勾選就列全部）</div>' : '') +
      (owe.length ? '<div class="note warn" style="margin-bottom:8px">不用轉帳、要請對方轉給公司：' + owe.map((g) => esc(g.py.name) + ' ' + money(-sum(g.list, (x) => x.amt))).join('、') + '</div>' : '') +
      (missing ? '<div class="note warn" style="margin-bottom:8px">' + missing + ' 位人員還沒有匯款資料：請他到 LINE 官方帳號填「匯款帳戶」，或在人員「請款資料」代填。</div>' : '') +
      rows + '<div style="display:flex;padding:4px 10px"><span>合計 ' + order.length + ' 位</span><span style="flex:1"></span><b class="num">' + money(total) + '</b></div>' +
      '<p class="mut" style="font-size:.8rem;margin-top:8px">轉完帳回到這頁勾選對象 →「付款…」記錄付款日期與轉帳截圖。匯款資料只在打開時讀取，不會存在這台裝置。</p>';
    ui.modal({ title: '轉帳清單（' + order.length + ' 位・' + money(total) + '）', body: body, actions: [{ label: '關閉' }, { label: '複製整份清單', kind: 'pri', click: () => { PB.copy(['受款人\t銀行代碼\t銀行\t帳號\t金額'].concat(lines).join('\n'), '轉帳清單'); return false; } }] });
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
      return '<tr><td>' + esc(fmtD(r['建立日期'])) + '</td><td>' + esc(str(r['付款人']) || str(r['學員']) ? m.stuName(str(r['付款人']) || r['學員']) : '名單外') + (str(r['付款人']) && str(r['付款人']) !== str(r['學員']) ? '<br><span class="mut">替 ' + esc(m.stuName(r['學員'])) + '</span>' : '') + '</td><td style="white-space:normal;min-width:160px">' + esc(str(r['項目說明']) || str(r['收入來源'])) + '<br><span class="mut">' + esc(str(r['款項類別'])) + (sig ? '・' + esc(str(sig['報名狀態'])) : '') + '</span></td><td class="num">' + money(x.due) + '</td><td class="num">' + money(x.net) + '</td><td class="num"><b>' + money(x.left) + '</b></td><td>' + m.payBadge(x.status) + '</td><td>' + esc(sig && str(sig['付款期限']) ? fmtDT(sig['付款期限']) : fmtD(r['到期日'])) + '</td></tr>';
    }).join('');
    return '<div class="ptop"><div class="chips"><button class="chip' + (only ? ' on' : '') + '" data-act="param2" data-k="all" data-v="">未收</button><button class="chip' + (!only ? ' on' : '') + '" data-act="param2" data-k="all" data-v="1">全部</button></div><span class="sp"></span><label class="search">' + PB.icon('search') + '<input placeholder="學員、項目" value="' + esc(p.q || '') + '" data-input="arSearch"></label></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>建立</th><th>付款人</th><th>項目</th><th class="num">應收</th><th class="num">已付</th><th class="num">未收</th><th>狀態</th><th>期限</th></tr></thead><tbody>' + (rows || '<tr><td colspan="8" class="mut">沒有資料</td></tr>') + '</tbody><tfoot><tr><td colspan="3">合計 ' + list.length + ' 筆</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).due)) + '</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).net)) + '</td><td class="num">' + money(sum(list, (r) => m.rec(r['應收ID']).left)) + '</td><td colspan="2"></td></tr></tfoot></table></div>' +
      '<p class="mut" style="font-size:.8rem">收款、提醒、退款請在營運工作台的學員頁處理（一人一筆帳）。</p>';
  }
  /** 抵用金：各付款人餘額＋近期流水（查詢用；轉入、折抵、退現在營運工作台的學員頁操作） */
  function creditTab(mon, p) {
    if (!PB.has('3_抵用金流水')) return '<div class="note warn">還沒有「3_抵用金流水」工作表。請在 3_財務 新增，第一列欄位：流水ID、付款人、金額、類型、來源報名、對應應收、建立時間、經手人、備註。</div>';
    const all = PB.rows('3_抵用金流水');
    const by = {}; // v4.9+：依歸屬人（家人的算管理人）
    all.forEach((r) => { const k = m.creditOwner(r['付款人']); (by[k] = by[k] || []).push(r); });
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
  // v4.7（11/6）系統設定：按鈕、介面、參數集中開關（只有管理層；只影響內部網頁，LINE 官方帳號不讀）
  // ================================================================
  const SYS_TABS = ['按鈕', '介面', '表單', '參數', '修改紀錄']; // v4.8：表單
  const APPN = { ops: '營運工作台', admin: '管理後台' };
  const sysCat = () => ((PB.sys || {}).catalog) || null;
  const placeName = (id) => { const c = sysCat(); const p = c && c.places.find((x) => x.id === id); return p ? p.name : id; };
  const wsText = (ws) => (ws && ws.length ? ws.join('、') : '不限');
  const atText = (at) => (at && at.length ? at.map(placeName).join('、') : '不限');
  const sysBadge = (r) => (!r ? '<span class="badge">預設</span>' : r.on === false ? '<span class="badge bad">停用</span>' : (r.ws && r.ws.length) || (r.at && r.at.length) ? '<span class="badge warn">有限制</span>' : '<span class="badge ok">啟用</span>');
  async function sysSave(items) {
    const r = await PB.run('sysSave', { items: items });
    sysApply(r);
    return r;
  }
  /** 儲存結果 → 更新規則與自己的表單（v4.8） */
  function sysApply(r) {
    if (!r || !r.data) return;
    if (r.data.sys) PB.sys = r.data.sys;
    if (r.data.forms) PB.forms = r.data.forms;
    PB.render();
  }

  const Sys = {
    id: 'sys', label: '系統設定', icon: 'gear', sysLock: true,
    show: () => PB.ws.indexOf('管理層') >= 0,
    render(p) {
      const tab = SYS_TABS.indexOf(p.tab) >= 0 ? p.tab : SYS_TABS[0];
      const head = '<div class="ptop"><h1>系統設定</h1></div>' +
        '<p class="mut" style="margin:-4px 0 10px;font-size:.88rem">只影響內部網頁（營運工作台、管理後台）。改完後其他人重新整理頁面就生效（離開網頁超過 5 分鐘再切回來也會自動更新）。每次修改都會留紀錄。</p>' +
        '<div class="tabs">' + SYS_TABS.map((t) => '<button class="' + (t === tab ? 'on' : '') + '" data-act="sysTab" data-v="' + t + '">' + t + '</button>').join('') + '</div>';
      if (!sysCat()) return head + ui.empty('讀不到設定目錄', '請重新整理；如果還是這樣，請確認 GAS 已更新到 v4.7');
      return head + ui.safe(() => ({ 按鈕: sysBtnTab, 介面: sysViewTab, 表單: sysFormTab, 參數: sysParTab, 修改紀錄: sysLogTab })[tab](p), tab);
    },
  };
  A.sysTab = (d) => PB.go('sys', { tab: d.v });
  A.sysApp = (d) => PB.setParam('app', d.v);
  let sysTimer;
  PB.inputs.sysSearch = (v) => { clearTimeout(sysTimer); sysTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="sysSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };

  function sysBtnTab(p) {
    const c = sysCat();
    const app = p.app === 'admin' ? 'admin' : 'ops';
    const q = str(p.q);
    const rules = PB.sys.btn || {};
    const seen = PB.seen();
    const list = c.buttons.filter((b) => b.app === app && (!q || (b.g + b.n).indexOf(q) >= 0));
    const changed = c.buttons.filter((b) => rules[b.k]).length;
    const groups = groupBy(list, 'g');
    const body = Object.keys(groups).map((g) => '<div class="sec"><h2>' + esc(g) + '</h2><span class="mut">' + groups[g].length + ' 顆</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:28px"></th><th>按鈕</th><th>狀態</th><th>工作區</th><th>出現的介面</th><th></th></tr></thead><tbody>' +
      groups[g].map((b) => {
        const r = rules[b.k];
        const saw = (seen[b.k] || []).filter((x) => x.indexOf(app + '.') === 0);
        return '<tr class="click" data-act="sysBtnEdit" data-k="' + esc(b.k) + '"><td data-stop><input type="checkbox" data-q="sysb" value="' + esc(b.k) + '"></td>' +
          '<td><b>' + esc(b.n) + '</b>' + (saw.length ? '<div class="mut" style="font-size:.78rem">這台裝置看過：' + esc(saw.map(placeName).join('、')) + '</div>' : '') + '</td>' +
          '<td>' + sysBadge(r) + '</td><td>' + esc(wsText(r && r.ws)) + '</td><td style="white-space:normal">' + esc(atText(r && r.at)) + '</td>' +
          '<td data-stop class="nowrap">' + btn(r && r.on === false ? '啟用' : '停用', 'sysBtnToggle', { k: b.k }, r && r.on === false ? 'pri' : 'ghost') + '</td></tr>';
      }).join('') + '</tbody></table></div>').join('');
    return '<div class="chips" style="margin-bottom:10px">' + ['ops', 'admin'].map((a) => '<button class="chip' + (a === app ? ' on' : '') + '" data-act="sysApp" data-v="' + a + '">' + APPN[a] + '<span class="c">' + c.buttons.filter((b) => b.app === a).length + '</span></button>').join('') + '</div>' +
      '<div class="acts"><label class="search">' + PB.icon('search') + '<input data-input="sysSearch" value="' + esc(q) + '" placeholder="搜尋按鈕名稱或分組"></label>' +
      btn('勾選的批次設定', 'sysBtnBatch', {}, 'pri') + '<span class="mut" style="font-size:.85rem">已調整 ' + changed + ' 顆</span></div>' +
      '<div class="note" style="margin:8px 0">停用：所有人都看不到，伺服器也不接受這個操作。工作區：只有勾選的工作區看得到（不勾＝不限）。介面：只在勾選的畫面或詳情顯示（不勾＝原本出現的地方都顯示）。</div>' +
      (body || ui.empty('沒有符合的按鈕'));
  }

  async function sysBtnDialog(keys) {
    const c = sysCat();
    const defs = keys.map((k) => c.buttons.find((b) => b.k === k)).filter(Boolean);
    if (!defs.length) return;
    const apps = uniq(defs.map((b) => b.app));
    if (apps.length > 1) return ui.toast('營運工作台和管理後台的按鈕請分開設定', 'bad');
    const places = c.places.filter((x) => x.app === apps[0]);
    const r0 = defs.length === 1 ? (PB.sys.btn || {})[defs[0].k] : null;
    const title = defs.length === 1 ? defs[0].n : '批次設定 ' + defs.length + ' 顆按鈕';
    const seen = PB.seen();
    const saw = defs.length === 1 ? (seen[defs[0].k] || []).filter((x) => x.indexOf(apps[0] + '.') === 0) : [];
    const v = await ui.ask(title, defs.length > 1 ? esc(defs.map((b) => b.n).join('、')) : '', {
      fields: [
        { k: 'on', label: '啟用', t: 'bool', value: !r0 || r0.on !== false },
        { k: 'ws', label: '哪些工作區看得到', t: 'enum', multi: true, opts: c.ws, value: (r0 && r0.ws) || [], hint: '不勾＝不限（原本有權限的人都看得到）' },
        { k: 'at', label: '出現在哪些介面', t: 'enum', multi: true, opts: places.map((x) => x.name), value: ((r0 && r0.at) || []).map(placeName), hint: '不勾＝原本出現的地方都顯示' + (saw.length ? '。這台裝置看過出現在：' + saw.map(placeName).join('、') : '') },
        { k: 'reset', label: '回到預設（全部開啟、不限）', t: 'bool', value: false },
      ],
      ok: '儲存',
    });
    if (!v) return;
    const at = (v.at || []).map((n) => (places.find((x) => x.name === n) || {}).id).filter(Boolean);
    await sysSave(defs.map((b) => ({ id: 'btn:' + b.k, on: v.on, ws: v.ws || [], at: at, reset: v.reset === true })));
  }
  A.sysBtnEdit = (d) => sysBtnDialog([d.k]);
  A.sysBtnBatch = () => { const ks = checked('sysb'); if (!ks.length) return ui.toast('請先勾選'); return sysBtnDialog(ks); };
  A.sysBtnToggle = (d) => {
    const r = (PB.sys.btn || {})[d.k];
    const b = sysCat().buttons.find((x) => x.k === d.k);
    const off = !r || r.on !== false;
    return PB.run('sysSave', { items: [{ id: 'btn:' + d.k, on: !off, ws: (r && r.ws) || [], at: (r && r.at) || [] }] }, off ? { confirm: { title: '停用：' + b.n, text: '所有人都看不到這顆按鈕，伺服器也不接受這個操作。之後可以再按「啟用」。', danger: true, ok: '停用' } } : {})
      .then((res) => sysApply(res));
  };

  function sysViewTab() {
    const c = sysCat();
    const rules = PB.sys.view || {};
    const rows = (app) => c.places.filter((x) => x.app === app && x.kind === 'p').map((x) => {
      const id = x.id.slice(app.length + 1);
      const r = rules[x.id];
      return '<tr class="click" data-act="sysViewEdit" data-k="' + esc(x.id) + '"><td><b>' + esc(x.name) + '</b></td><td>' + sysBadge(r) + '</td><td>' + esc(wsText(r && r.ws)) + '</td><td class="mut">' + esc('#/' + id) + '</td></tr>';
    }).join('');
    return ['ops', 'admin'].map((a) => '<div class="sec"><h2>' + APPN[a] + '</h2></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>畫面</th><th>狀態</th><th>工作區</th><th>網址</th></tr></thead><tbody>' + rows(a) + '</tbody></table></div>').join('') +
      '<p class="mut" style="font-size:.85rem">關掉的畫面不會出現在選單，直接輸入網址也會跳回第一個畫面。這只是隱藏畫面：資料權限仍照角色（例如營運工作台本來就看不到成本）。「系統設定」本身不能關。</p>';
  }
  A.sysViewEdit = async (d) => {
    const c = sysCat();
    const x = c.places.find((y) => y.id === d.k);
    const r0 = (PB.sys.view || {})[d.k];
    const v = await ui.ask(APPN[x.app] + '・' + x.name, '', {
      fields: [
        { k: 'on', label: '顯示這個畫面', t: 'bool', value: !r0 || r0.on !== false },
        { k: 'ws', label: '哪些工作區看得到', t: 'enum', multi: true, opts: c.ws, value: (r0 && r0.ws) || [], hint: '不勾＝不限（原本看得到的人都看得到）' },
      ],
      ok: '儲存',
    });
    if (v) await sysSave([{ id: 'view:' + d.k, on: v.on, ws: v.ws || [] }]);
  };

  function sysParTab() {
    const c = sysCat();
    const show = (p, v) => (p.t === 'money' ? money(v) : esc(v));
    const rows = c.params.map((p) => {
      const isDef = String(p.cur) === String(p.def);
      return '<tr class="click" data-act="sysParEdit" data-k="' + esc(p.k) + '"><td><b>' + esc(p.n) + '</b>' + (p.hint ? '<div class="mut" style="font-size:.78rem">' + esc(p.hint) + '</div>' : '') + '</td><td class="num"><b>' + show(p, p.cur) + '</b></td><td class="num mut">' + show(p, p.def) + '</td><td>' + (isDef ? '<span class="badge">預設</span>' : '<span class="badge warn">已調整</span>') + '</td></tr>';
    }).join('');
    const shared = c.shared.map((x) => '<tr><td>' + esc(x[0]) + '</td><td class="num">' + esc(x[1]) + '</td></tr>').join('');
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>參數</th><th class="num">目前</th><th class="num">預設</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="sec"><h2>和 LINE 官方帳號共用的規則（只能看）</h2></div>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + shared + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.85rem">這些規則學員、教練、場主的 LINE 也在用，只改內部網頁會兩邊不一致，所以不開放在這裡改；要調整請告訴系統負責人一起改程式。</p>';
  }
  A.sysParEdit = async (d) => {
    const p = sysCat().params.find((x) => x.k === d.k);
    const t = p.t === 'time' ? 'time' : 'num';
    const v = await ui.ask(p.n, (p.hint ? esc(p.hint) + '<br>' : '') + '預設：' + esc(p.def) + (p.min !== undefined ? '（可填 ' + p.min + '～' + p.max + '）' : ''), {
      fields: [{ k: 'v', label: '新的值', t: t, value: p.cur, hint: '清空＝回到預設' }],
      ok: '儲存',
    });
    if (v) {
      await sysSave([{ id: 'par:' + p.k, v: v.v }]);
      if (['specSchool', 'specGym'].indexOf(p.k) >= 0) await PB.ripple(); // v4.13：專項預設價改了 → 問要不要套用到已排好的
    }
  };

  // ---- v4.8：表單欄位設定 ----
  const RO_NAME = { '': '可以改', edit: '只能新增時填', all: '唯讀' };
  const RO_KEY = { 可以改: '', 只能新增時填: 'edit', 唯讀: 'all' };
  /** 程式原本的欄位＋系統設定 → 目前的樣子（與伺服器 formFieldsFor_ 同規則） */
  function fldState(form) {
    const rules = ((PB.sys || {}).fld || {})[form.t] || {};
    const order = ((PB.sys || {}).ford || {})[form.t] || [];
    const pos = (k, i) => { const n = order.indexOf(k); return n >= 0 ? n : 1000 + i; };
    return form.fields.map((f, i) => {
      const r = rules[f.k] || null;
      const show = f.req ? true : !(r && r.show === false);
      let ro = f.ro;
      if (r && r.ro === 'all' && !f.req) ro = 'all';
      else if (r && (r.ro === 'edit' || r.ro === 'all') && f.ro !== 'all') ro = 'edit';
      const req = f.req || !!(r && r.req && show && ro !== 'all');
      const ws = r && r.ws && r.ws.length ? (f.ws.length ? f.ws.filter((w) => r.ws.indexOf(w) >= 0) : r.ws) : f.ws;
      return {
        f: f, r: r, i: i, ord: pos(f.k, i),
        show: show, ro: ro, req: req, extraReq: !!(r && r.req), ws: ws, wsRule: (r && r.ws) || [],
        label: (r && r.label) || '', hint: r && r.hint !== null && r.hint !== undefined ? r.hint : f.hint,
      };
    }).sort((a, b) => a.ord - b.ord);
  }
  /** 一個欄位的完整設定（儲存時整筆送出，避免蓋掉其他設定） */
  function fldItem(form, s, o) {
    o = o || {};
    const it = {
      id: 'fld:' + form.t + '|' + s.f.k,
      show: 'show' in o ? o.show : s.r ? s.r.show !== false : true,
      ro: 'ro' in o ? o.ro : s.r ? s.r.ro || '' : '',
      ws: 'ws' in o ? o.ws : s.wsRule,
      label: 'label' in o ? o.label : s.label,
    };
    const hint = 'hint' in o ? o.hint : s.r ? s.r.hint : null;
    if (hint !== null && hint !== undefined) it.hint = hint;
    const req = 'req' in o ? o.req : s.extraReq;
    if (req && !s.f.req) it.req = true;
    if (s.f.req) { it.show = true; if (it.ro === 'all') it.ro = 'edit'; }
    return it;
  }
  const fldForm = (t) => (sysCat().forms || []).find((x) => x.t === t);
  const fldChanged = (form) => Object.keys((((PB.sys || {}).fld || {})[form.t]) || {}).length;
  const fldOrdered = (form) => !!(((PB.sys || {}).ford || {})[form.t]);

  function sysFormTab(p) {
    const c = sysCat();
    if (!c.forms) return ui.empty('讀不到表單目錄', '請確認 GAS 已更新到 v4.8');
    const form = p.f && fldForm(p.f);
    if (!form) {
      const opsForms = c.forms.filter((x) => x.apps.indexOf('ops') >= 0 && x.ws.indexOf('行政客服') >= 0);
      const others = c.forms.filter((x) => opsForms.indexOf(x) < 0);
      const list = (arr) => '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>表單</th><th class="num">欄位</th><th>可以新增</th><th>狀態</th></tr></thead><tbody>' +
        arr.map((x) => '<tr class="click" data-act="fldOpen" data-t="' + esc(x.t) + '"><td><b>' + esc(x.title) + '</b> <span class="mut" style="font-size:.8rem">' + esc(x.t) + '</span></td><td class="num">' + x.fields.length + '</td><td>' + (x.create ? '是' : '<span class="mut">只能編輯</span>') + '</td><td>' + (fldChanged(x) || fldOrdered(x) ? '<span class="badge warn">已調整' + (fldChanged(x) ? ' ' + fldChanged(x) + ' 欄' : '') + (fldOrdered(x) ? '・順序' : '') + '</span>' : '<span class="badge">預設</span>') + '</td></tr>').join('') +
        '</tbody></table></div>';
      return '<div class="note" style="margin-bottom:8px">設定「新增／編輯」表單裡每個欄位：顯示、名稱、說明、可不可以改、必填、哪些工作區可以改、順序。程式規定必填的欄位不能隱藏或取消必填。</div>' +
        '<div class="sec"><h2>行政客服會用到（含主檔與紀錄）</h2></div>' + list(opsForms) +
        '<div class="sec"><h2>只有管理層（合作方案、角色、財務等）</h2></div>' + list(others);
    }
    const st = fldState(form);
    const rows = st.map((s, n) => {
      const name = s.label ? esc(s.label) + ' <span class="mut" style="font-size:.78rem">（' + esc(s.f.k) + '）</span>' : esc(s.f.k);
      const tags = [s.f.req ? '<span class="badge info">程式必填</span>' : '', s.f.lock ? '<span class="badge" title="依狀態鎖定（程式規定）">狀態鎖定</span>' : '', s.f.when ? '<span class="badge" title="符合條件才顯示（程式規定）">條件顯示</span>' : ''].join(' ');
      return '<tr class="click" data-act="fldEdit" data-t="' + esc(form.t) + '" data-k="' + esc(s.f.k) + '"' + (s.show ? '' : ' style="opacity:.55"') + '>' +
        '<td class="num mut">' + (n + 1) + '</td><td><b>' + name + '</b> ' + tags + '</td>' +
        '<td>' + (s.show ? '顯示' : '<span class="badge bad">隱藏</span>') + '</td>' +
        '<td>' + (s.ro ? '<span class="badge warn">' + RO_NAME[s.ro] + '</span>' : '可以改') + '</td>' +
        '<td>' + (s.req ? (s.f.req ? '必填' : '<span class="badge warn">必填</span>') : '<span class="mut">—</span>') + '</td>' +
        '<td>' + esc(s.ws.length ? s.ws.join('、') : '不限') + '</td>' +
        '<td class="mut" style="white-space:normal;font-size:.82rem;max-width:280px">' + esc(s.hint || '') + '</td>' +
        '<td data-stop class="nowrap">' + btn('↑', 'fldMove', { t: form.t, k: s.f.k, d: '-1' }, 'ghost' + (n === 0 ? '" disabled="disabled' : '')) + btn('↓', 'fldMove', { t: form.t, k: s.f.k, d: '1' }, 'ghost' + (n === st.length - 1 ? '" disabled="disabled' : '')) + '</td></tr>';
    }).join('');
    return '<div class="acts"><button class="chip" data-act="fldBack">← 全部表單</button><h2 style="margin:0 8px;font-size:1.05rem">' + esc(form.title) + '</h2><span class="mut" style="font-size:.85rem">' + esc(form.t) + '</span><span class="sp" style="flex:1"></span>' +
      (fldChanged(form) || fldOrdered(form) ? btn('整張表單回到預設', 'fldResetAll', { t: form.t }, 'ghost') : '') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th class="num">#</th><th>欄位</th><th>表單</th><th>修改</th><th>必填</th><th>可以改的工作區</th><th>說明</th><th>順序</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="mut" style="font-size:.85rem">隱藏：表單不顯示，系統自動帶入的值照樣存。只能新增時填：建立後不能再改。唯讀：表單上只能看。工作區：只有勾選的工作區可以改這欄（只能比程式原本的更嚴格）。加了必填後，存檔時沒填會被擋（包含舊資料編輯時）。</p>';
  }
  A.fldOpen = (d) => PB.setParam('f', d.t);
  A.fldBack = () => PB.setParam('f', '');
  A.fldEdit = async (d) => {
    const form = fldForm(d.t);
    const s = fldState(form).find((x) => x.f.k === d.k);
    const c = sysCat();
    const roOpts = s.f.req ? ['可以改', '只能新增時填'] : ['可以改', '只能新增時填', '唯讀'];
    const fields = [
      s.f.req ? { k: 'x', label: '必填', t: 'ro', value: '程式規定必填（不能隱藏、不能設成唯讀、不能取消必填）' } : { k: 'show', label: '顯示在表單', t: 'bool', value: s.show },
      { k: 'label', label: '顯示名稱', t: 'text', value: s.label, placeholder: s.f.k, hint: '空白＝用原本的欄名「' + s.f.k + '」' },
      { k: 'hint', label: '說明（欄位下方的小字）', t: 'text', value: s.hint || '', hint: s.f.hint ? '原本：' + s.f.hint : '原本沒有說明' },
      { k: 'ro', label: '可不可以改', t: 'enum', opts: roOpts, value: RO_NAME[(s.r && s.r.ro) || ''] === undefined ? '可以改' : RO_NAME[(s.r && s.r.ro) || ''], req: true, hint: s.f.ro ? '程式原本：' + RO_NAME[s.f.ro] + '（不能放寬）' : '' },
    ];
    if (!s.f.req) fields.push({ k: 'req', label: '必填', t: 'bool', value: s.extraReq });
    fields.push({ k: 'ws', label: '哪些工作區可以改這欄', t: 'enum', multi: true, opts: c.ws, value: s.wsRule, hint: '不勾＝照原本' + (s.f.ws.length ? '（原本只有 ' + s.f.ws.join('、') + '）' : '（不限）') });
    fields.push({ k: 'reset', label: '這一欄回到預設', t: 'bool', value: false });
    const v = await ui.ask(form.title + '・' + s.f.k, '', { fields: fields, ok: '儲存' });
    if (!v) return;
    if (v.reset) return sysSave([{ id: 'fld:' + form.t + '|' + s.f.k, reset: true }]);
    const show = s.f.req ? true : v.show !== false;
    const ro = RO_KEY[v.ro] || '';
    if (v.req && (!show || ro === 'all')) return ui.toast('隱藏或唯讀的欄位不能設成必填', 'bad');
    await sysSave([fldItem(form, s, { show: show, ro: ro, req: v.req === true, label: str(v.label), hint: str(v.hint) === str(s.f.hint) && !(s.r && s.r.hint !== null && s.r.hint !== undefined) ? null : str(v.hint), ws: v.ws || [] })]);
  };
  A.fldMove = (d) => {
    const form = fldForm(d.t);
    const st = fldState(form);
    const i = st.findIndex((x) => x.f.k === d.k);
    const j = i + Number(d.d);
    if (j < 0 || j >= st.length) return null;
    const t = st[i]; st[i] = st[j]; st[j] = t;
    return sysSave([{ id: 'ford:' + form.t, order: st.map((s) => s.f.k) }]); // 整張表單的順序存一筆
  };
  A.fldResetAll = (d) => {
    const form = fldForm(d.t);
    const keys = Object.keys((((PB.sys || {}).fld || {})[form.t]) || {});
    const items = keys.map((k) => ({ id: 'fld:' + form.t + '|' + k, reset: true }));
    if (fldOrdered(form)) items.push({ id: 'ford:' + form.t, reset: true });
    return PB.run('sysSave', { items: items }, { confirm: { title: form.title + '：回到預設', text: '這張表單的欄位設定（' + keys.length + ' 欄）' + (fldOrdered(form) ? '和欄位順序' : '') + '全部清掉，回到程式原本的樣子。', danger: true, ok: '回到預設' } })
      .then((res) => sysApply(res));
  };

  function sysLogTab() {
    const list = PB.rows('0_設定紀錄').slice().sort((a, b) => byKey(str(b['時間']), str(a['時間'])));
    if (!list.length) return ui.empty('還沒有修改紀錄', '在「按鈕」「介面」「參數」改過設定後會出現在這裡');
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>時間</th><th>人員</th><th>項目</th><th>原設定</th><th>新設定</th></tr></thead><tbody>' +
      list.map((r) => '<tr><td class="nowrap">' + esc(fmtDT(r['時間'])) + '</td><td class="nowrap">' + esc(r['人員']) + '</td><td style="white-space:normal">' + esc(r['名稱']) + '</td><td class="mut" style="white-space:normal">' + esc(r['原設定']) + '</td><td style="white-space:normal"><b>' + esc(r['新設定']) + '</b></td></tr>').join('') +
      '</tbody></table></div><p class="mut" style="font-size:.85rem">顯示最近 300 筆；完整紀錄在 0_設定 試算表的「0_設定紀錄」。</p>';
  }

  // v4.12：待處理「合約到期」點進去編輯合作方案（主檔畫面已移到營運工作台）
  A.planEdit = (d) => ui.form('3_合作方案', { id: d.id });

  PB.app({
    app: 'admin',
    title: '管理後台',
    version: '4.16',
    screens: [Dash, Queue, Finance, Sys], // v4.12：排課、主檔與紀錄移到營運工作台
    links: () => (PB.cfg.opsUrl ? [{ label: '營運工作台', url: PB.cfg.opsUrl, icon: 'swap', mobile: true }] : []),
  });
})();
