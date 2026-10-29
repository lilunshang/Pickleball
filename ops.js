/**
 * 理論上匹克球｜營運工作台 ops.js v3.3（2026/10/28：修正改期、撤銷改期、刪除建錯的班級）；前版 v2.3（2026/10/26）
 * 行政客服：今日、待處理、課程、球敘、學員、知識庫（讀「客服知識庫」試算表＋文件中心）
 * 社群行銷：發布資訊（報名連結＋來源碼）、來源成效
 * 每個畫面是一個 { id, label, icon, show, badge, render } 物件；新增畫面＝在 SCREENS 加一個。
 * v2.3：單堂專項課（課程 → 專項課）、抵用金（學員頁）、換人上課、取消原因、換教練檢查可否排課
 */
(function () {
  'use strict';
  const { esc, str, split, num, money, today, addDays, fmtD, fmtDT, day, wd, sum, uniq, byKey, ui, m } = PB;
  const isOps = () => PB.ws.indexOf('行政客服') >= 0 || PB.ws.indexOf('管理層') >= 0;
  const isSocial = () => PB.ws.indexOf('社群行銷') >= 0 || PB.ws.indexOf('管理層') >= 0;
  const isMgmt = () => PB.ws.indexOf('管理層') >= 0;
  const A = PB.acts;
  const nowHM = () => PB.nowText().slice(11, 16);

  /** 清單列 */
  function row(o) {
    return '<div class="row' + (o.act ? ' click' : '') + '"' + (o.act ? ' data-act="' + o.act + '" data-id="' + esc(o.id) + '"' : '') + '>' +
      (o.check ? '<input type="checkbox" data-q="' + esc(o.check) + '" value="' + esc(o.id) + '" data-stop>' : '') +
      (o.when !== undefined ? '<div class="when">' + o.when + '</div>' : '') +
      '<div class="main-c"><div class="t">' + (o.t || '') + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' +
      (o.r ? '<div class="r"' + (o.act ? ' data-stop' : '') + '>' + o.r + '</div>' : '') + '</div>';
  }
  const card = (inner) => '<div class="card list">' + inner + '</div>';
  const sec = (title, cnt, right) => '<div class="sec"><h2>' + esc(title) + '</h2>' + (cnt !== undefined ? '<span class="cnt">' + cnt + '</span>' : '') + '<span class="sp"></span>' + (right || '') + '</div>';
  const btn = (label, act, data, cls, icon) => ui.btn(label, act, data, 'sm ' + (cls || ''), icon);
  const kv = (pairs) => '<dl class="kv">' + pairs.filter((p) => p && p[1] !== '' && p[1] !== undefined && p[1] !== null).map((p) => '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>').join('') + '</dl>';
  const coaches = () => PB.rows('1_人員_教練').map((c) => ({ v: str(c['人員ID']), l: m.staffName(c['人員ID']) }));
  const checked = (q) => Array.from(document.querySelectorAll('input[data-q="' + q + '"]:checked')).map((i) => i.value);

  // ================================================================
  // 今日
  // ================================================================
  // v2.6：依據點分卡片，一眼看到每個據點今天有哪些課程與球敘（時間排序、課程／球敘用顏色區分）
  const Today = {
    id: 'today', label: '今日', icon: 'today', show: isOps,
    render(p) {
      const d = p.d || today();
      const isToday = d === today();
      const now = nowHM();
      const ses = (PB.ix.sesByDay[d] || []).slice();
      const games = (PB.ix.gameByDay[d] || []).filter((g) => str(g['狀態']) !== '草稿');
      const nav = '<div class="ptop"><h1>' + (isToday ? '今天 ' : '') + fmtD(d) + '</h1><span class="sp"></span>' +
        btn('前一天', 'day', { d: addDays(d, -1) }, 'ghost') + (!isToday ? btn('今天', 'day', { d: '' }) : '') + btn('後一天', 'day', { d: addDays(d, 1) }, 'ghost') + '</div>';
      // 每個活動整理成同一種格式
      const items = [];
      let noRoll = 0, noStaff = 0, people = 0;
      ses.forEach((s) => {
        const c = PB.get('2_課程班級', s['班級']);
        const st = str(s['場次狀態']);
        const att = PB.ix.attBySes[str(s['場次ID'])] || [];
        const leave = att.filter((a) => str(a['狀態']) === '請假').length;
        const mk = att.filter((a) => str(a['狀態']) === '補課出席').length;
        const info = c ? m.cls(c) : null;
        const mkSes = m.isMakeupSes(s);
        const expect = mkSes ? mk : info ? info.active.length - leave + mk : 0;
        const off = st === '取消' || st === '改期';
        if (!off) people += expect;
        let right = st === '已完成' ? '<span class="badge ok">已點名 ' + att.filter((a) => /出席/.test(str(a['狀態']))).length + '</span>' :
          st === '取消' ? '<span class="badge bad">停課</span>' : st === '改期' ? '<span class="badge">已改期</span>' :
            '<span class="badge">應到 ' + (info ? expect : '?') + '</span>' + (leave ? '<span class="badge warn">請假 ' + leave + '</span>' : '');
        const late = st === '預定' && (d < today() || (isToday && str(s['結束時間']).slice(0, 5) < now));
        if (late) { right += '<span class="badge bad">未點名</span>'; noRoll += 1; }
        const coach = m.staffName(s['授課教練']);
        if (!coach && !off) noStaff += 1;
        const title = c && m.isSingle(c) ? '【專項】' + str(c['課程名稱']) : m.classLabel(c);
        items.push({ v: str(s['據點']), st: str(s['開始時間']), en: str(s['結束時間']), kind: 'c', off: off, act: 'openSes', id: s['場次ID'],
          t: esc(title) + (mkSes ? ' <span class="badge info">期末補課堂</span>' : s['第幾堂'] && !(c && m.isSingle(c)) ? ' <span class="mut">第' + s['第幾堂'] + '/' + (info ? info.total : '') + '堂</span>' : '') + (c && str(c['課程狀態']) === '籌備中' ? ' <span class="badge warn">' + (m.isSingle(c) ? '待成班' : '籌備中') + '</span>' : ''),
          s: esc(m.courtName(s['使用場地'])) + '・教練 ' + (coach ? esc(coach) : '<b class="bad-t">未排</b>'), r: right });
      });
      games.forEach((g) => {
        const x = m.game(g);
        const off = str(g['狀態']) === '取消';
        if (!off) people += x.active.length;
        const hosts = x.hosts.map((h) => esc(h.name) + (h.in ? ' ✓' : '')).join('、');
        if (!hosts && !off) noStaff += 1;
        items.push({ v: str(g['據點']), st: str(g['開始時間']), en: str(g['結束時間']), kind: 'g', off: off, act: 'openGame', id: g['球敘ID'],
          t: esc(m.gameLabel(g)) + ' ' + m.gameBadge(x.st, g),
          s: esc(x.courts.map((c) => c.name).join('、')) + '・場主 ' + (hosts || '<b class="bad-t">未排</b>'),
          r: '<span class="badge">報名 ' + x.active.length + '/' + x.limit + '</span>' + (x.wait.length ? '<span class="badge warn">候補 ' + x.wait.length + '</span>' : '') + (x.walkin.length ? '<span class="badge warn">現場 ' + x.walkin.length + '</span>' : '') + (x.checked ? '<span class="badge ok">簽到 ' + x.checked + '</span>' : '') });
      });
      const byV = {};
      items.forEach((it) => { (byV[it.v] = byV[it.v] || []).push(it); });
      const vids = Object.keys(byV).sort((a, b) => byKey(byV[a].map((i) => i.st).sort()[0] + m.venueName(a), byV[b].map((i) => i.st).sort()[0] + m.venueName(b)));
      const nC = items.filter((i) => i.kind === 'c' && !i.off).length, nG = items.filter((i) => i.kind === 'g' && !i.off).length;
      const sum = '<div class="td-sum">' +
        '<div><b>' + vids.length + '</b><span>個據點</span></div>' + (nC ? '<div><b>' + nC + '</b><span>堂課程</span></div>' : '') + (nG ? '<div><b>' + nG + '</b><span>場球敘</span></div>' : '') + '<div><b>' + people + '</b><span>人次</span></div>' +
        (noRoll ? '<div class="bad"><b>' + noRoll + '</b><span>未點名</span></div>' : '') + (noStaff ? '<div class="warn"><b>' + noStaff + '</b><span>未排教練／場主</span></div>' : '') + '</div>';
      const cards = vids.map((v) => {
        const list = byV[v].sort((a, b) => byKey(a.st + a.kind, b.st + b.kind));
        const vr = PB.get('1_據點', v) || {};
        const c = list.filter((i) => i.kind === 'c' && !i.off).length, g = list.filter((i) => i.kind === 'g' && !i.off).length;
        const first = list[0].st.slice(0, 5), last = list.map((i) => i.en.slice(0, 5)).sort().pop().replace('23:59', '24:00');
        return '<div class="tv"><div class="tv-h"><div><b>' + esc(m.venueName(v) || '（未指定據點）') + '</b>' + (str(vr['區域']) ? '<small>' + esc(vr['區域']) + '</small>' : '') + '</div><span class="sp"></span>' +
          (c ? '<span class="tag c">課程 ' + c + '</span>' : '') + (g ? '<span class="tag g">球敘 ' + g + '</span>' : '') + '<span class="tv-t">' + first + '–' + last + '</span></div>' +
          list.map((it) => {
            const live = isToday && !it.off && it.st.slice(0, 5) <= now && now < it.en.slice(0, 5);
            return '<div class="tv-i ' + it.kind + (it.off ? ' off' : '') + (live ? ' live' : '') + '" data-act="' + it.act + '" data-id="' + esc(it.id) + '">' +
              '<div class="when">' + m.hm(it.st) + '<small>' + m.hm(it.en).replace('23:59', '24:00') + '</small></div>' +
              '<div class="main-c"><div class="t"><span class="k">' + (it.kind === 'c' ? '課程' : '球敘') + '</span>' + (live ? '<span class="badge ok">進行中</span> ' : '') + it.t + '</div><div class="s">' + it.s + '</div></div>' +
              '<div class="r">' + it.r + '</div></div>';
          }).join('') + '</div>';
      }).join('');
      const idle = PB.rows('1_據點').filter((v) => str(v['狀態']) !== '停用' && str(v['狀態']) !== '已停用' && !byV[str(v['據點ID'])]).map((v) => str(v['據點名稱']));
      return nav + (items.length ? sum + '<div class="tv-grid">' + cards + '</div>' : card(ui.empty('這天沒有課程或球敘', '') + (() => { for (let i = 1; i <= 30; i += 1) { const n = addDays(d, i); if ((PB.ix.sesByDay[n] || []).length || (PB.ix.gameByDay[n] || []).some((g) => str(g['狀態']) !== '草稿')) return '<div class="empty">' + btn('下一個有活動的日子：' + fmtD(n), 'day', { d: n }, 'pri') + '</div>'; } return ''; })())) +
        (idle.length ? '<p class="mut" style="font-size:.82rem;margin-top:12px">沒有活動的據點：' + esc(idle.join('、')) + '</p>' : '');
    },
  };
  A.day = (d) => PB.setParam('d', d.d);

  // ================================================================
  // 待處理（每個佇列一個設定；數量 0 的不顯示）
  // ================================================================
  const Q = [];
  const q = (def) => Q.push(def);
  const fut = (dk) => day(dk) >= today();
  const MAKEUP_FULL = /\[期末補課堂：可用日不足/;

  q({
    id: 'pay', title: '轉帳／現金待對帳', hint: '對照銀行入帳明細或場主交款；截圖不算入帳',
    items: () => PB.rows('3_收款明細').filter((p) => str(p['對帳狀態']) === '待確認').sort((a, b) => byKey(day(a['收款日期']), day(b['收款日期']))),
    row: (p) => {
      const rec = PB.get('3_應收帳款', p['應收款項']) || {};
      const payer = str(rec['付款人']) || str(rec['學員']);
      return row({ check: 'pay', id: p['收款ID'], t: esc(m.stuName(payer)) + ' <span class="num">' + money(p['金額']) + '</span>', s: esc([fmtD(p['收款日期']), str(p['付款方式']), str(p['帳號末五碼']) ? '末五碼 ' + p['帳號末五碼'] : '', '經手 ' + m.staffName(p['經手人']), str(rec['項目說明'])].filter(Boolean).join('・')), r: btn('確認入帳', 'payConfirm', { id: p['收款ID'] }, 'pri') + btn('有誤', 'payWrong', { id: p['收款ID'] }, 'bad') });
    },
    bulk: { label: '確認勾選的入帳', act: 'payConfirmChecked' },
  });
  q({
    id: 'decide', title: '待確認成班（期制班）', hint: '決定日（開課前 7 天）到了，或已付首堂達人數上限',
    items: () => PB.rows('2_課程班級').map((c) => m.cls(c)).filter((x) => !x.single && (x.canDecide || x.pending)),
    row: (x) => row({ act: 'openClass', id: x.c['班級ID'], t: esc(m.classLabel(x.c)) + (x.pending ? ' <span class="badge info">排程處理中</span>' : ''), s: esc(m.venueName(x.c['據點']) + '・' + m.classWhen(x.c) + '・預定開課 ' + fmtD(x.c['開課日期'])), r: progress(x) + (x.wait.length ? '<span class="badge warn">候補 ' + x.wait.length + '</span>' : '') }),
  });
  q({
    id: 'singleLate', title: '專項課：已過決定時間仍未處理', hint: '正常會在上課前 3 天 12:00 自動判斷成班；還在籌備中表示排程沒處理到，請手動確認成班或設為未成班',
    items: () => PB.rows('2_課程班級').map((c) => m.cls(c)).filter((x) => x.late && day(x.c['開課日期']) >= today()).sort((a, b) => byKey(day(a.c['開課日期']), day(b.c['開課日期']))),
    row: (x) => row({ act: 'openClass', id: x.c['班級ID'], t: esc(m.singleLabel(x.c)) + (x.pending ? ' <span class="badge info">排程處理中</span>' : ''), s: esc(m.venueName(x.c['據點']) + '・決定時間 ' + fmtDT(x.decideAt)), r: progress(x) }),
  });
  q({
    id: 'creditTodo', title: '選了抵用金、還沒轉入', hint: '未成班時學員在 LINE 選「課程抵用金」：核對已付金額後按「轉抵用金」',
    items: () => PB.has('3_抵用金流水') ? PB.rows('2_報名').filter((r) => str(r['未成班選擇']) === '抵用金' && m.sigPay(r['報名ID']).net > 0) : [],
    row: (r) => {
      const p = m.sigPay(r['報名ID']);
      const rec = p.recs.find((x) => m.rec(x['應收ID']).net > 0) || {};
      return row({ t: esc(m.stuName(r['學員'])) + ' <span class="num">已付 ' + money(p.net) + '</span>', s: esc(m.sigTarget(r)), r: btn('轉抵用金', 'creditIn', { id: rec['應收ID'] || '' }, 'pri') + btn('學員', 'openStu', { id: r['學員'] }, 'ghost') });
    },
  });
  q({
    id: 'roll', title: '教練還沒點名', hint: '沒點名就不會扣堂：請提醒教練在教練官方帳號「確認上課」',
    items: () => PB.rows('2_上課場次').filter((s) => str(s['場次狀態']) === '預定' && (day(s['日期']) < today() || (day(s['日期']) === today() && str(s['結束時間']).slice(0, 5) < nowHM()))).sort((a, b) => byKey(day(a['日期']), day(b['日期']))),
    row: (s) => {
      const coach = PB.get('1_人員', s['授課教練']);
      return row({ act: 'openSes', id: s['場次ID'], t: esc(m.sesLabel(s)), s: esc('教練 ' + (coach ? str(coach['姓名']) : '未排')), r: coach && str(coach['電話']) ? ui.tel(str(coach['電話'])) : '' });
    },
  });
  q({
    id: 'makeup', title: '請假待補課', hint: '找程度相近、有空位的班，跟學員確認後安排；不保證原教練',
    items: () => PB.rows('2_出缺勤').filter((a) => str(a['狀態']) === '請假' && !(PB.ix.attBySrc[str(a['出缺勤ID'])] || []).length && (!day(a['補課期限']) || fut(a['補課期限'])) && str((PB.get('2_上課場次', a['上課場次']) || {})['場次狀態']) !== '改期' && !MAKEUP_FULL.test(str(a['備註']))),
    row: (a) => {
      const s = PB.get('2_上課場次', a['上課場次']);
      return row({ t: esc(m.stuName(a['學員'])), s: esc('請假：' + m.sesLabel(s) + (day(a['補課期限']) ? '・補課期限 ' + fmtD(a['補課期限']) : '')), r: btn('安排補課', 'makeup', { id: a['出缺勤ID'] }, 'pri') + btn('學員', 'openStu', { id: a['學員'] }, 'ghost') });
    },
  });
  // v2.6：期末補課堂排不進去（學員 OA L04：這一面接下來沒有可用日）→ 已寄信給管理層
  q({
    id: 'makeupFull', title: '期末補課堂排不進去', hint: '這班之後同時段同球面沒有可用日：請新增可用日（系統下一輪會自動補排），或手動安排到其他班補課',
    items: () => PB.rows('2_出缺勤').filter((a) => str(a['狀態']) === '請假' && MAKEUP_FULL.test(str(a['備註'])) && !(PB.ix.attBySrc[str(a['出缺勤ID'])] || []).length),
    row: (a) => {
      const s = PB.get('2_上課場次', a['上課場次']);
      return row({ t: esc(m.stuName(a['學員'])), s: esc('請假：' + m.sesLabel(s) + '・' + m.venueName(s && s['據點'])), r: btn('安排補課', 'makeup', { id: a['出缺勤ID'] }, 'pri') + btn('學員', 'openStu', { id: a['學員'] }, 'ghost') });
    },
  });
  q({
    id: 'wait', title: '候補中', hint: '有名額時系統自動遞補第一位；手動遞補不檢查名額',
    items: () => PB.rows('2_報名').filter((r) => str(r['報名狀態']) === '候補' && targetOpen(r)).sort((a, b) => num(a['候補順位']) - num(b['候補順位'])),
    row: (r) => row({ t: esc(m.stuName(r['學員'])) + ' <span class="badge warn">候補 ' + (num(r['候補順位']) || '') + '</span>', s: esc(m.sigTarget(r)), r: btn('遞補', 'sigPromote', { id: r['報名ID'] }) + (str(r['報名類型']) === '課程' ? btn('移班', 'sigMove', { id: r['報名ID'] }) : '') + btn('取消', 'sigCancel', { id: r['報名ID'] }, 'bad') }),
  });
  q({
    id: 'unformed', title: '未成班後續', hint: '期制班：學員在 LINE 選順延／轉班／退款。專項課：選改報／抵用金／退款，3 天未回覆系統轉抵用金',
    items: () => PB.rows('2_報名').filter((r) => {
      const c = PB.get('2_課程班級', r['班級']);
      if (!c || str(r['報名類型']) !== '課程') return false;
      const st = str(r['報名狀態']);
      if (st === '保留中') return true;
      return str(c['課程狀態']) === '未成班' && st !== '已取消';
    }),
    row: (r) => {
      const ch = str(r['未成班選擇']);
      const st = str(r['報名狀態']);
      const single = m.isSingle(PB.get('2_課程班級', r['班級']));
      const tag = st === '保留中' ? '<span class="badge info">保留中（順延）</span>' : ch === '轉班' || ch === '改報' ? '<span class="badge warn">選' + esc(ch) + '：請移到新的一堂</span>' : ch === '退款' ? '<span class="badge bad">選退款</span>' : ch === '抵用金' ? '<span class="badge info">選抵用金</span>' : '<span class="badge">尚未選擇' + (single ? '（3 天未回覆系統轉抵用金）' : '') + '</span>';
      const p = m.sigPay(r['報名ID']);
      const rec = p.recs.find((x) => m.rec(x['應收ID']).net > 0);
      return row({ t: esc(m.stuName(r['學員'])) + ' ' + tag, s: esc(m.sigTarget(r) + (p.net > 0 ? '・已付 ' + money(p.net) : '')), r: btn(single ? '改報' : '移班', 'sigMove', { id: r['報名ID'] }) + (rec && PB.has('3_抵用金流水') ? btn('轉抵用金', 'creditIn', { id: rec['應收ID'] }) : '') + btn('學員', 'openStu', { id: r['學員'] }, 'ghost') });
    },
  });
  q({
    id: 'task', title: '我的任務（含退款待辦）', hint: '退款：核對金額 → 主管核准匯款 → 建立退款 → 完成',
    items: () => PB.rows('4_工作任務').filter((t) => str(t['狀態']) !== '完成' && str(t['狀態']) !== '待確認' && (str(t['負責人']) === PB.me.id || split(t['協作者']).indexOf(PB.me.id) >= 0 || (!str(t['負責人']) && /^退款/.test(str(t['工作名稱']))))).sort((a, b) => byKey(day(a['Deadline']) || '9', day(b['Deadline']) || '9')),
    row: (t) => {
      const ref = (str(t['工作內容']).match(/\[REF ([^\]]+)\]/) || [])[1];
      const late = day(t['Deadline']) && day(t['Deadline']) < today();
      const cashRef = (str(t['工作內容']).match(/\[CREDIT ([^\]]+)\]/) || [])[1];
      return row({ act: 'taskEdit', id: t['任務ID'], t: esc(t['工作名稱']) + (late ? ' <span class="badge bad">逾期</span>' : '') + (str(t['優先級']) === '高' ? ' <span class="badge warn">高</span>' : ''), s: esc((day(t['Deadline']) ? '期限 ' + fmtD(t['Deadline']) + '・' : '') + str(t['狀態']) + (str(t['工作內容']) ? '・' + str(t['工作內容']).split('\n')[0].slice(0, 60) : '')), r: (ref && PB.get('3_應收帳款', ref) ? btn('建立退款', 'refund', { id: ref, task: t['任務ID'] }, 'pri') + (PB.has('3_抵用金流水') ? btn('改轉抵用金', 'creditIn', { id: ref, task: t['任務ID'] }) : '') : '') + (cashRef && PB.get('1_學員', cashRef) ? btn('抵用金退現', 'creditCash', { id: cashRef, task: t['任務ID'] }, 'pri') : '') + btn('完成', 'taskDone', { id: t['任務ID'] }) });
    },
  });
  q({
    id: 'taskCheck', title: '待我確認的任務',
    items: () => PB.rows('4_工作任務').filter((t) => str(t['狀態']) === '待確認' && str(t['建立人']) === PB.me.id),
    row: (t) => row({ act: 'taskEdit', id: t['任務ID'], t: esc(t['工作名稱']), s: esc('負責人 ' + m.staffName(t['負責人']) + (str(t['完成成果']) ? '・' + str(t['完成成果']).slice(0, 60) : '')), r: btn('確認完成', 'taskApprove', { id: t['任務ID'] }, 'pri') + btn('退回', 'taskReject', { id: t['任務ID'] }, 'bad') }),
  });
  q({
    id: 'draft', title: '球敘草稿（待開放報名）', hint: '核對日期、時間、據點、面數、費用、程度、場主後再開放',
    items: () => PB.rows('2_球敘場次').filter((g) => str(g['狀態']) === '草稿' && !str(g['開放報名時間']) && fut(g['日期'])).sort((a, b) => byKey(day(a['日期']), day(b['日期']))),
    row: (g) => row({ check: 'draft', id: g['球敘ID'], act: 'openGame', t: esc(fmtD(g['日期']) + ' ' + m.hm(g['開始時間'], g['結束時間'])) + ' ' + esc(m.venueName(g['據點'])), s: esc([m.gameLabel(g), split(g['使用場地']).map(m.courtName).join('、'), str(g['費用']) !== '' ? money(g['費用']) + '／人' : '未填費用'].join('・')), r: btn('開放報名', 'gameOpen', { id: g['球敘ID'] }, 'pri') }),
    bulk: { label: '開放勾選的球敘', act: 'gameOpenChecked' },
  });
  q({
    id: 'avail', title: '待確認可用日', hint: '確認場地當天真的能用；不能用的按取消並寫原因',
    items: () => PB.rows('1_據點_可用日').filter((a) => str(a['狀態']) === '待確認' && fut(a['日期'])).sort((a, b) => byKey(day(a['日期']), day(b['日期']))),
    row: (a) => {
      const s = PB.get('1_據點_時段', a['時段']);
      return row({ check: 'avail', id: a['可用日ID'], t: esc(fmtD(a['日期']) + '・' + m.venueName(s && s['據點'])) + (a['假日標記'] === true ? ' <span class="badge warn">國定假日</span>' : ''), s: esc(m.slotLabel(s)), r: btn('可用', 'availConfirm', { id: a['可用日ID'] }, 'pri') + btn('取消', 'availCancel', { id: a['可用日ID'] }, 'bad') });
    },
    bulk: { label: '勾選的都可用', act: 'availConfirmChecked' },
  });
  q({
    id: 'owe', title: '超過付款期限仍未付', hint: '系統已自動提醒；球敘開始前 6 小時仍未付會取消名額（尾款只提醒）',
    items: () => PB.rows('2_報名').filter((r) => str(r['報名狀態']) === '已報名' && str(r['付款期限']) && str(r['付款期限']) < PB.nowText() && m.sigPay(r['報名ID']).left > 0 && targetOpen(r)),
    row: (r) => {
      const p = m.sigPay(r['報名ID']);
      const s = PB.get('1_學員', r['學員']);
      return row({ t: esc(m.stuName(r['學員'])) + ' <span class="num">未付 ' + money(p.left) + '</span>', s: esc(m.sigTarget(r) + '・期限 ' + fmtDT(r['付款期限'])), r: ui.tel(m.phone(s)) + btn('提醒', 'payRemind', { ids: p.recs.map((x) => x['應收ID']).join(',') }) + btn('收款', 'payAdd', { id: (p.recs.find((x) => m.rec(x['應收ID']).left > 0) || {})['應收ID'] || '' }, 'pri') });
    },
  });
  q({
    id: 'friend', title: '報名了但沒加官方帳號好友', hint: '收不到付款與提醒通知：請用電話或私訊聯繫',
    items: () => PB.rows('2_報名').filter((r) => ['已報名', '候補'].indexOf(str(r['報名狀態'])) >= 0 && targetOpen(r) && (PB.get('1_學員', r['學員']) || {})['好友狀態'] === false && !str((PB.get('1_學員', r['學員']) || {})['管理人'])),
    row: (r) => row({ act: 'openStu', id: r['學員'], t: esc(m.stuName(r['學員'])), s: esc(m.sigTarget(r)), r: ui.tel(m.phone(PB.get('1_學員', r['學員']))) }),
  });
  q({
    id: 'fail', title: '通知發送失敗（近 7 天）', hint: '改用電話或私訊；重要通知要確認對方收到',
    items: () => PB.rows('9_通知紀錄').filter((n) => str(n['發送結果']) === '失敗' && day(n['發送時間']) >= addDays(today(), -7)).sort((a, b) => byKey(str(b['發送時間']), str(a['發送時間']))),
    row: (n) => row({ act: str(n['對象學員']) ? 'openStu' : '', id: n['對象學員'], t: esc((str(n['對象學員']) ? m.stuName(n['對象學員']) : m.staffName(n['對象人員'])) + '・' + str(n['通知類型'])), s: esc(fmtDT(n['發送時間']) + '・' + str(n['官方帳號']) + '・' + str(n['錯誤訊息']).slice(0, 80)) }),
  });
  q({
    id: 'lead', title: '招生待跟進', hint: '只列今天該跟進（下次跟進日已到或沒填）的；全部跟進中的學員請看「學員 → 跟進中」。兩次沒回就停；未成交要寫原因',
    items: () => PB.rows('2_招生跟進').filter((l) => ['已報名', '未成交'].indexOf(str(l['跟進狀態'])) < 0 && (!day(l['下次跟進日期']) || day(l['下次跟進日期']) <= today())),
    row: (l) => row({ act: 'leadEdit', id: l['跟進ID'], t: esc(m.stuName(l['學員'])) + ' <span class="badge">' + esc(l['跟進狀態']) + '</span>', s: esc((day(l['下次跟進日期']) ? '跟進日 ' + fmtD(l['下次跟進日期']) : '未排下次跟進') + (str(l['需求']) ? '・' + str(l['需求']).slice(0, 40) : '')), r: ui.tel(m.phone(PB.get('1_學員', l['學員']))) }),
  });
  q({
    id: 'merge', title: '疑似重複的學員', hint: '確認是同一人後按「合併至」，系統會搬移報名與帳務',
    items: () => PB.rows('1_學員').filter((s) => s['待合併'] === true && !str(s['合併至'])),
    row: (s) => row({ act: 'openStu', id: s['學員ID'], t: esc(m.label('1_學員', s)), s: esc('LINE：' + (str(s['LINE顯示名稱']) || '—') + '・建立 ' + fmtDT(s['建立時間'])), r: btn('合併至…', 'merge', { id: s['學員ID'] }, 'pri') }),
  });
  q({
    id: 'incident', title: '處理中的異常事件', hint: '補齊紀錄、追後續；結案由管理層處理',
    items: () => PB.rows('4_異常事件').filter((x) => str(x['狀態']) !== '已結案'),
    row: (x) => row({ act: 'incEdit', id: x['事件ID'], t: esc(x['標題']) + ' <span class="badge ' + (/受傷|金流/.test(str(x['類型'])) ? 'bad' : 'warn') + '">' + esc(x['類型']) + '</span>', s: esc(fmtDT(x['發生時間']) + '・' + m.venueName(x['據點']) + '・負責 ' + m.staffName(x['負責人'])) }),
  });
  q({
    id: 'journal', title: '教練未寫課程日誌（30 天內）', hint: '提醒教練填寫；不要代填',
    items: () => PB.rows('2_上課場次').filter((s) => str(s['場次狀態']) === '已完成' && day(s['日期']) >= addDays(today(), -30) && !(PB.ix.journalBySes[str(s['場次ID'])] || []).length),
    row: (s) => row({ act: 'openSes', id: s['場次ID'], t: esc(m.sesLabel(s)), s: esc('教練 ' + m.staffName(s['授課教練'])) }),
  });

  function targetOpen(r) {
    if (str(r['報名類型']) === '課程') {
      const c = PB.get('2_課程班級', r['班級']);
      return c && ['籌備中', '確定開課', '進行中'].indexOf(str(c['課程狀態'])) >= 0;
    }
    const g = PB.get('2_球敘場次', r['球敘']);
    return g && fut(g['日期']) && ['開放報名', '已額滿'].indexOf(str(g['狀態'])) >= 0;
  }
  function progress(x) {
    const pct = Math.min(100, Math.round((x.paid / x.limit) * 100));
    if (x.single) return '<span class="nowrap" title="已付人數／成班門檻／上限">' + x.paid + '／' + x.min + '／' + x.limit + (x.need ? '・差 ' + x.need : '・可成班') + '</span><div class="bar ' + (x.paid >= x.min ? 'ok' : 'warn') + '" style="width:70px"><i style="width:' + pct + '%"></i></div>';
    return '<span class="nowrap" title="已付首堂／成班門檻／上限">' + x.paid + '／' + x.min + '／' + x.limit + '</span><div class="bar ' + (x.paid >= x.min ? 'ok' : 'warn') + '" style="width:70px"><i style="width:' + pct + '%"></i></div>';
  }
  const queueCount = () => Q.reduce((s, d) => { try { return s + d.items().length; } catch (e) { return s; } }, 0);

  const Queue = {
    id: 'queue', label: '待處理', icon: 'inbox', show: isOps, badge: () => queueCount(),
    render(p) {
      const groups = Q.map((d) => {
        let items = [];
        try { items = d.items(); } catch (e) { return { id: d.id, title: d.title, count: 1, body: () => { throw e; } }; }
        return {
          id: d.id, title: d.title, count: items.length, hint: d.hint,
          right: d.bulk ? btn(d.bulk.label, d.bulk.act, {}, '') : '',
          body: () => card(items.slice(0, 60).map(d.row).join('') + (items.length > 60 ? '<div class="empty">另有 ' + (items.length - 60) + ' 件…</div>' : '')),
        };
      });
      const view = ui.groups(groups, p, { key: 'queue' });
      return '<div class="ptop"><h1>待處理</h1><span class="sp"></span>' + btn('新增異常事件', 'incNew', {}, 'ghost', 'plus') + btn('新增任務', 'taskNew', {}, 'ghost', 'plus') + '</div>' +
        (view || card(ui.empty('都處理完了 🎉', '有新的事情系統會放進來'))) +
        '<p class="mut" style="font-size:.82rem;margin-top:16px">下班前清單只剩「等別人回覆」的項目，並在備註寫等誰、等什麼。</p>';
    },
    after(page) { const c = page.querySelector('.grp-menu .chip.on'); if (c && c.parentNode.scrollWidth > c.parentNode.clientWidth) c.parentNode.scrollLeft = c.offsetLeft - 16; },
  };

  // ================================================================
  // 課程
  // ================================================================
  const CLASS_GROUPS = { 專項課: 'single', 招生中: ['籌備中', '確定開課'], 進行中: ['進行中'], 已結束: ['已結束'], 未成班: ['未成班', '取消'], 全部: null };
  const Classes = {
    id: 'classes', label: '課程', icon: 'book', show: isOps,
    render(p) {
      const hasSingle = PB.rows('2_課程班級').some((c) => m.isSingle(c));
      const g = CLASS_GROUPS[p.g] !== undefined ? p.g : hasSingle ? '專項課' : '招生中';
      const v = p.v || '';
      const kw = str(p.q).toLowerCase();
      const rule = CLASS_GROUPS[g];
      if (rule === 'single') return singleList(p, v, kw);
      // 期制班（專項課在「專項課」分頁；全部／已結束／未成班兩種都列）
      let list = PB.rows('2_課程班級').filter((c) => (!rule || rule.indexOf(str(c['課程狀態'])) >= 0) && (g !== '招生中' && g !== '進行中' || !m.isSingle(c)));
      if (v) list = list.filter((c) => str(c['據點']) === v);
      if (kw) list = list.filter((c) => (m.label('2_課程班級', c) + m.staffName(c['主教練'])).toLowerCase().indexOf(kw) >= 0);
      list.sort((a, b) => byKey(day(a['開課日期']) || '9', day(b['開課日期']) || '9'));
      const top = classTop(g, v) +
        '<label class="search">' + PB.icon('search') + '<input placeholder="搜尋班級、教練" value="' + esc(p.q || '') + '" data-input="classSearch"></label></div>';
      const rows = list.map((c) => {
        const x = m.cls(c);
        if (x.single) return singleRow(x);
        return row({ act: 'openClass', id: c['班級ID'], t: esc(m.classLabel(c)) + ' ' + m.classBadge(x.st) + (x.pending ? ' <span class="badge info">排程處理中</span>' : ''), s: esc(m.venueName(c['據點']) + '・' + m.classWhen(c) + '・教練 ' + (m.staffName(c['主教練']) || '未定') + '・' + (x.st === '籌備中' ? '預定開課 ' : '開課 ') + fmtD(c['開課日期'])), r: x.st === '籌備中' ? progress(x) : '<span class="badge">' + x.done + '／' + x.total + ' 堂</span><span class="badge">學員 ' + x.active.length + '</span>' });
      }).join('');
      return top + card(rows || ui.empty('沒有符合的班級'));
    },
  };
  function classTop(g, v) {
    const venues = uniq(PB.rows('2_課程班級').map((c) => str(c['據點'])).filter(Boolean));
    return '<div class="ptop"><h1>課程</h1><span class="sp"></span>' + (PB.forms['2_課程班級'] ? ui.btn('新增班級', 'classNew', {}, 'pri', 'plus') : '') + '</div>' +
      '<div class="ptop"><div class="chips">' + Object.keys(CLASS_GROUPS).map((k) => '<button class="chip' + (k === g ? ' on' : '') + '" data-act="param" data-k="g" data-v="' + k + '">' + k + '</button>').join('') + '</div><span class="sp"></span>' +
      '<select data-input="venueFilter" class="btn" style="padding:4px 8px"><option value="">全部據點</option>' + venues.map((id) => '<option value="' + esc(id) + '"' + (id === v ? ' selected' : '') + '>' + esc(m.venueName(id)) + '</option>').join('') + '</select>';
  }
  /** 專項課：依日期分組（今天以後；搜尋時含過去 30 天） */
  function singleList(p, v, kw) {
    const t = today();
    const from = kw ? addDays(t, -30) : t;
    let list = PB.rows('2_課程班級').filter((c) => m.isSingle(c) && day(c['開課日期']) >= from && str(c['課程狀態']) !== '取消');
    if (v) list = list.filter((c) => str(c['據點']) === v);
    if (p.lv) list = list.filter((c) => str(c['程度']) === p.lv);
    if (kw) list = list.filter((c) => (str(c['課程名稱']) + m.venueName(c['據點']) + m.staffName(c['主教練']) + fmtD(c['開課日期'])).toLowerCase().indexOf(kw) >= 0);
    list.sort((a, b) => byKey(day(a['開課日期']) + str(a['開始時間']) + m.venueName(a['據點']), day(b['開課日期']) + str(b['開始時間']) + m.venueName(b['據點'])));
    const lvs = uniq(PB.rows('2_課程班級').filter((c) => m.isSingle(c)).map((c) => str(c['程度'])).filter(Boolean));
    const top = classTop('專項課', v) + '<select data-input="lvFilter" class="btn" style="padding:4px 8px"><option value="">全部程度</option>' + lvs.map((id) => '<option value="' + esc(id) + '"' + (id === p.lv ? ' selected' : '') + '>' + esc(m.levelName(id)) + '</option>').join('') + '</select>' +
      '<label class="search">' + PB.icon('search') + '<input placeholder="搜尋專項、教練、日期" value="' + esc(p.q || '') + '" data-input="classSearch"></label></div>';
    const groups = uniq(list.map((c) => day(c['開課日期']))).map((d) => {
      const cs = list.filter((c) => day(c['開課日期']) === d);
      const xs = cs.map((c) => m.cls(c));
      const formed = xs.filter((x) => ['確定開課', '進行中', '已結束'].indexOf(x.st) >= 0).length;
      return {
        id: d, title: fmtD(d) + (d === t ? '（今天）' : ''), count: cs.length,
        meta: esc(uniq(cs.map((c) => m.venueName(c['據點']))).join('、')) + '・已付 ' + sum(xs, (x) => x.paid) + ' 人' + (formed ? ' <span class="badge ok">成班 ' + formed + '</span>' : ''),
        body: () => card(cs.map((c) => singleRow(m.cls(c))).join('')),
      };
    });
    const view = ui.groups(groups, {}, { key: 'single', menu: false, unit: '堂', forceOpen: !!kw });
    return top + (view || card(ui.empty('沒有專項課', PB.ws.indexOf('管理層') >= 0 ? '在管理後台「排課」排好後發布' : '由管理層在「排課」發布')));
  }
  function singleRow(x) {
    const c = x.c;
    return row({ act: 'openClass', id: c['班級ID'], when: m.hm(c['開始時間']) + '<small>' + m.hm(c['結束時間']).slice(0, 5) + '</small>', t: esc(c['課程名稱']) + ' ' + (str(c['程度']) ? '<span class="badge">' + esc(m.levelName(c['程度'])) + '</span> ' : '') + m.classBadge(x.st) + (x.notOpen ? ' <span class="badge">' + esc(fmtDT(x.openAt)) + ' 開放</span>' : '') + (x.pending ? ' <span class="badge info">排程處理中</span>' : '') + (x.late ? ' <span class="badge bad">已過決定時間</span>' : ''), s: esc(m.venueName(c['據點']) + '・' + m.courtName(c['使用場地']) + '・教練 ' + (m.staffName(c['主教練']) || '未定')), r: x.st === '籌備中' ? progress(x) : '<span class="badge">學員 ' + x.active.length + '/' + x.limit + '</span>' });
  }
  PB.inputs.lvFilter = (v) => PB.setParam('lv', v);
  A.param = (d) => PB.setParam(d.k, d.v);
  PB.inputs.venueFilter = (v) => PB.setParam('v', v);
  // 搜尋：停止輸入 250ms 後重畫，游標留在搜尋框
  let searchTimer;
  ['classSearch', 'gameSearch', 'stuSearch'].forEach((n) => {
    PB.inputs[n] = (v) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        PB.setParam('q', v);
        const el = document.querySelector('[data-input="' + n + '"]');
        if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
      }, 250);
    };
  });

  function openClass(id) {
    ui.sheet(() => { const c = PB.get('2_課程班級', id); return c ? m.classLabel(c) : null; }, () => classBody(id));
  }
  A.openClass = (d) => openClass(d.id);

  function classBody(id) {
    const c = PB.get('2_課程班級', id);
    const x = m.cls(c);
    if (x.single) return singleBody(id, x);
    const t = today();
    const isPre = x.st === '籌備中';
    const decideHint = isPre ? (x.canDecide ? '' : '已付首堂達人數下限 ' + x.min + ' 人就能確認成班（目前 ' + x.paid + ' 人）；決定日 ' + fmtD(x.decide) + ' 起不限人數') : '';
    const acts = [];
    if (isPre && PB.forms['2_課程班級']) {
      acts.push(ui.btn('確認成班', 'classAct', { id: id, a: '確認成班' }, 'pri' + (x.canDecide && !x.pending ? '' : '" disabled title="' + esc(decideHint || '排程處理中'))));
      acts.push(ui.btn('順延', 'classAct', { id: id, a: '順延' }, (num(c['順延次數']) >= (PB.cfg.maxPostpone || 1) || x.pending ? '" disabled title="已順延過或處理中' : '')));
      acts.push(ui.btn('未成班', 'classAct', { id: id, a: '未成班' }, 'bad' + (x.canDecide && !x.pending ? '' : '" disabled title="' + esc(decideHint || '排程處理中'))));
      if (str(c['彈性場地'])) acts.push(ui.btn('用彈性場地加開一班', 'copyClass', { id: id }));
    }
    // v3.5：確定開課、還沒上課 → 改回籌備中／取消開課
    if (x.st === '確定開課' && PB.forms['2_課程班級'] && !classStarted(x)) {
      acts.push(ui.btn('改回籌備中', 'classAct', { id: id, a: '改回籌備中' }, (x.pending ? '" disabled title="排程處理中' : '')));
      acts.push(ui.btn('取消開課', 'classAct', { id: id, a: '取消開課' }, 'bad' + (x.pending ? '" disabled title="排程處理中' : '')));
    }
    if (['籌備中', '確定開課', '進行中'].indexOf(x.st) >= 0) acts.push(ui.btn('後台報名', 'sigNew', { type: '課程', target: id }, '', 'plus'));
    acts.push(ui.btn('報名連結', 'copyLink', { type: '課程', id: id }, 'ghost', 'link'));
    if (PB.forms['2_課程班級']) acts.push(ui.btn('編輯', 'classEdit', { id: id }, 'ghost'));
    if (canDeleteClass(x)) acts.push(ui.btn('刪除班級', 'classDelete', { id: id }, 'bad'));
    const info = kv([
      ['狀態', m.classBadge(x.st) + (x.pending ? ' <span class="badge info">「' + esc(c['開班動作']) + '」排程處理中</span>' : '')],
      ['據點', esc(m.venueName(c['據點']) + '・' + m.courtName(c['使用場地'])) + (str(c['彈性場地']) ? '<br><span class="mut">彈性場地：' + esc(m.courtName(c['彈性場地'])) + '（決定日前保留）</span>' : '')],
      ['時間', esc(m.classWhen(c))],
      [isPre ? '預定開課' : '開課', esc(fmtD(c['開課日期'])) + (isPre ? ' <span class="mut">（學員看不到）・決定日 ' + esc(fmtD(x.decide)) + '</span>' : '') + (day(c['原開課日期']) ? '<br><span class="mut">原開課日 ' + esc(fmtD(c['原開課日期'])) + '（已順延 ' + num(c['順延次數']) + ' 次）</span>' : '')],
      ['結束', esc(fmtD(c['結束日期']))],
      ['教練', esc(m.staffName(c['主教練']) || '未定')],
      ['程度', esc(m.levelName(c['程度']) || '')],
      ['費用', esc(money(c['費用']) + '／' + (str(c['計費方式']) || '期') + '・共 ' + x.total + ' 堂')],
      ['人數', (isPre ? progress(x) + ' <span class="mut">已付首堂／門檻／上限</span>' : esc(x.active.length + ' 人（上限 ' + x.limit + '）')) + (x.wait.length ? ' <span class="badge warn">候補 ' + x.wait.length + '</span>' : '') + (x.hold.length ? ' <span class="badge info">保留 ' + x.hold.length + '</span>' : '')],
      ['進度', isPre ? '' : esc(x.done + '／' + x.total + ' 堂' + (x.next ? '・下一堂 ' + fmtD(x.next['日期']) : ''))],
      ['備註', esc(c['備註'])],
    ]);
    const result = str(c['開班處理結果']) ? '<div class="note' + (/未處理|失敗|不足/.test(str(c['開班處理結果'])) ? ' warn' : '') + '" style="margin-top:8px">系統處理結果：' + esc(c['開班處理結果']) + '</div>' : '';
    const hint = isPre && decideHint ? '<div class="note" style="margin-top:8px">' + esc(decideHint) + '</div>' : '';
    const sigList = (list, label, extra) => list.length ? sec(label, list.length + ' 人') + card(list.map((r) => sigRow(r, extra)).join('')) : '';
    const cancelled = x.sigs.filter((r) => str(r['報名狀態']) === '已取消');
    const ses = x.ses.map((s) => {
      const st = str(s['場次狀態']);
      const att = PB.ix.attBySes[str(s['場次ID'])] || [];
      const lv = att.filter((a) => str(a['狀態']) === '請假').length;
      return row({ act: 'openSes', id: s['場次ID'], when: esc(fmtD(s['日期']).replace(/（.）/, '')) + '<small>週' + wd(s['日期']) + '</small>', t: (m.isMakeupSes(s) ? '期末補課堂 <span class="mut">' + (PB.ix.attBySes[str(s['場次ID'])] || []).filter((a) => str(a['狀態']) === '補課出席').length + ' 人</span> ' : '第 ' + esc(s['第幾堂']) + ' 堂 ') + (st === '預定' ? (day(s['日期']) < t ? '<span class="badge bad">未點名</span>' : '') : '<span class="badge ' + (st === '已完成' ? 'ok' : st === '改期' ? '' : 'bad') + '">' + esc(st === '取消' ? '停課' : st) + '</span>'), s: esc(m.hm(s['開始時間'], s['結束時間']) + '・' + m.courtName(s['使用場地']) + '・教練 ' + (m.staffName(s['授課教練']) || '未排') + (str(s['改期原因']) ? '・改期原因 ' + s['改期原因'] : '')), r: lv ? '<span class="badge warn">請假 ' + lv + '</span>' : '' });
    }).join('');
    return '<div class="acts">' + acts.join('') + '</div>' + info + result + hint +
      sigList(x.active, '已報名', 'class') + sigList(x.hold, '保留中（順延）', 'class') + sigList(x.wait, '候補', 'class') +
      sec('上課場次', x.ses.length + ' 堂') + card(ses || ui.empty(isPre ? '場次產生中（約 ' + PB.cfg.scanMin + ' 分鐘）' : '沒有場次')) +
      (cancelled.length ? '<details style="margin-top:12px"><summary class="mut">已取消 ' + cancelled.length + ' 筆</summary>' + card(cancelled.map((r) => sigRow(r)).join('')) + '</details>' : '');
  }

  /** v3.5：已經開始上課（有已完成／已點名的場次或出缺勤） */
  function classStarted(x) {
    return x.ses.some((s) => str(s['場次狀態']) === '已完成' || str(s['點名確認時間']) || (PB.ix.attBySes[str(s['場次ID'])] || []).length);
  }
  /** v3.3：建錯的班級可以刪（管理層；沒有任何報名、場次沒上過課、沒有出缺勤）— 後端會再檢查一次 */
  function canDeleteClass(x) {
    if (!isMgmt() || !PB.forms['2_課程班級'] || x.sigs.length) return false;
    return !classStarted(x);
  }
  A.classDelete = async (d) => {
    const c = PB.get('2_課程班級', d.id);
    const x = m.cls(c);
    const v = await ui.ask('刪除班級：' + m.classLabel(c), '只用在<b>建錯、根本不存在</b>的班級：班級和 ' + x.ses.length + ' 堂場次會從資料庫刪除，不能復原（日曆事件約 15 分鐘內移除）。<br>真的有開但不開了，請用「未成班」或把課程狀態改成「取消」，紀錄才會保留。', { fields: [{ k: 'note', label: '刪除原因', t: 'text', req: true, hint: '例：誤建，實際沒有這堂課' }], danger: true, ok: '刪除' });
    if (!v) return;
    PB.run('classDelete', { id: d.id, note: v.note });
  };

  /** 單堂專項課詳情：成班進度、決定時間、開放報名時間；沒有順延、請假、補課 */
  function singleBody(id, x) {
    const c = x.c;
    const isPre = x.st === '籌備中';
    const ses = x.ses[0] || null;
    const acts = [];
    const can = !!PB.forms['2_課程班級'];
    if (isPre && can) {
      acts.push(ui.btn('提早確認成班', 'classAct', { id: id, a: '確認成班' }, 'pri' + (x.pending ? '" disabled title="排程處理中' : '')));
      acts.push(ui.btn('未成班（取消這堂）', 'classAct', { id: id, a: '未成班' }, 'bad' + (x.pending ? '" disabled title="排程處理中' : '')));
    }
    if (x.st === '確定開課' && can && !classStarted(x)) acts.push(ui.btn('取消開課', 'classAct', { id: id, a: '取消開課' }, 'bad' + (x.pending ? '" disabled title="排程處理中' : ''))); // v3.5
    if (['籌備中', '確定開課'].indexOf(x.st) >= 0) acts.push(ui.btn('後台報名', 'sigNew', { type: '課程', target: id }, '', 'plus'));
    acts.push(ui.btn('報名連結', 'copyLink', { type: '課程', id: id }, 'ghost', 'link'));
    if (ses) acts.push(ui.btn('場次', 'openSes', { id: ses['場次ID'] }, 'ghost'));
    if (can) acts.push(ui.btn('編輯', 'classEdit', { id: id }, 'ghost'));
    if (canDeleteClass(x)) acts.push(ui.btn('刪除班級', 'classDelete', { id: id }, 'bad'));
    const spec = PB.get('0_專項', c['專項']);
    const decideTxt = isPre ? (x.late ? '<span class="badge bad">已過 ' + esc(fmtDT(x.decideAt)) + '，排程還沒處理</span>' : esc(fmtDT(x.decideAt)) + ' 系統自動判斷（已付達 ' + x.min + ' 人成班）') : '';
    const info = kv([
      ['狀態', m.classBadge(x.st) + (x.pending ? ' <span class="badge info">「' + esc(c['開班動作']) + '」排程處理中</span>' : '')],
      ['專項', esc(str(c['課程名稱'])) + (spec && str(spec['說明']) ? '<br><span class="mut">' + esc(spec['說明']) + '</span>' : '')],
      ['建議程度', esc(m.levelName(c['程度']) || '不限') + ' <span class="mut">（不擋報名）</span>'],
      ['上課', esc(fmtD(c['開課日期']) + ' ' + m.hm(c['開始時間'], c['結束時間']))],
      ['地點', esc(m.venueName(c['據點']) + '・' + m.courtName(c['使用場地']))],
      ['教練', esc(m.staffName(ses ? ses['授課教練'] : c['主教練']) || '未定') + (can && ses && str(ses['場次狀態']) === '預定' ? ' ' + btn('換教練', 'sesCoach', { id: ses['場次ID'] }, 'ghost') : '')],
      ['費用', esc(money(c['費用']) + '／人（全額）')],
      ['開放報名', x.openAt ? esc(fmtDT(x.openAt)) + (x.notOpen ? ' <span class="badge">學員還看不到</span>' : '') : '立即'],
      ['成班進度', progress(x) + (isPre && x.need ? ' <span class="mut">還差 ' + x.need + ' 人成班</span>' : '') + (x.wait.length ? ' <span class="badge warn">候補 ' + x.wait.length + '</span>' : '')],
      ['決定時間', decideTxt],
      ['備註', esc(c['備註'])],
    ]);
    const rule = '<div class="note" style="margin-top:8px">' + (isPre ? '成班前學員可在 LINE 取消（未付直接取消、已付轉抵用金）。未成班：學員選改報／抵用金／退款，3 天未回覆轉抵用金。' : '已成班：不退費，可「換人」上課；生病等特殊狀況由客服個別處理。單堂課沒有請假與補課。') + '</div>';
    const result = str(c['開班處理結果']) ? '<div class="note' + (/未處理|失敗|不足/.test(str(c['開班處理結果'])) ? ' warn' : '') + '" style="margin-top:8px">系統處理結果：' + esc(c['開班處理結果']) + '</div>' : '';
    const sigList = (list, label) => list.length ? sec(label, list.length + ' 人') + card(list.map((r) => sigRow(r, 'class')).join('')) : '';
    const cancelled = x.sigs.filter((r) => str(r['報名狀態']) === '已取消');
    return '<div class="acts">' + acts.join('') + '</div>' + info + result + rule +
      sigList(x.active, '已報名') + sigList(x.wait, '候補') +
      (cancelled.length ? '<details style="margin-top:12px"><summary class="mut">已取消 ' + cancelled.length + ' 筆</summary>' + card(cancelled.map((r) => sigRow(r)).join('')) + '</details>' : '');
  }

  function sigRow(r, ctx) {
    const st = str(r['報名狀態']);
    const p = m.sigPay(r['報名ID']);
    const s = PB.get('1_學員', r['學員']);
    const b = [];
    if (['已報名', '候補', '保留中'].indexOf(st) >= 0) {
      if (st === '候補') b.push(btn('遞補', 'sigPromote', { id: r['報名ID'] }));
      const single = str(r['報名類型']) === '課程' && m.isSingle(PB.get('2_課程班級', r['班級']));
      const cst = single ? str((PB.get('2_課程班級', r['班級']) || {})['課程狀態']) : '';
      if (str(r['報名類型']) === '課程' && (!single || ['籌備中', '未成班'].indexOf(cst) >= 0)) b.push(btn(single ? '改報' : '移班', 'sigMove', { id: r['報名ID'] }, 'ghost'));
      if (st === '已報名') b.push(btn('換人', 'sigSwap', { id: r['報名ID'] }, 'ghost'));
      if (p.left > 0 && st === '已報名') b.push(btn('提醒付款', 'payRemind', { ids: p.recs.map((x) => x['應收ID']).join(',') }, 'ghost'));
      b.push(btn('取消', 'sigCancel', { id: r['報名ID'] }, 'bad'));
    }
    const extra = [num(r['租拍數']) ? '🏓 租拍 ' + num(r['租拍數']) + ' 支' : '', str(r['報名時間']) ? '報名 ' + fmtDT(r['報名時間']) : '', str(r['代報名人']) ? m.stuName(r['代報名人']) + ' 代報' : '', str(r['來源代碼']) ? '來源 ' + r['來源代碼'] : '', str(r['取消原因']) ? '取消：' + r['取消原因'] + (str(r['學員取消原因']) ? '（' + r['學員取消原因'] + '）' : '') : '', ctx === 'game' && str(r['簽到時間']) ? '已簽到 ' + str(r['簽到時間']).slice(11, 16) : '', st === '已報名' && str(r['付款期限']) && p.left > 0 ? '付款期限 ' + fmtDT(r['付款期限']) : ''].filter(Boolean).join('・');
    return row({ act: 'openStu', id: r['學員'], t: esc(m.stuName(r['學員'])) + (st !== '已報名' ? ' ' + m.sigBadge(st) : '') + ' ' + (st === '候補' ? '' : m.payBadge(p.status)) + (r['是否新人'] === true ? ' <span class="badge brand">新人</span>' : ''), s: (m.phone(s) ? esc(m.phone(s)) + '・' : '') + esc(extra), r: b.join('') });
  }

  A.classNew = () => ui.form('2_課程班級', { onSaved: (id) => id && openClass(id) });
  A.classEdit = (d) => ui.form('2_課程班級', { id: d.id });
  A.classAct = async (d) => {
    const c = PB.get('2_課程班級', d.id);
    const x = m.cls(c);
    if (x.single && d.a === '確認成班') {
      return PB.run('classAction', { id: d.id, action: '確認成班' }, { confirm: { title: '提早確認成班：' + m.singleLabel(c), text: '已付 ' + x.paid + ' 人（門檻 ' + x.min + '、上限 ' + x.limit + '）。<br>一般情況系統會在 ' + esc(fmtDT(x.decideAt)) + ' 自動判斷；提早確認只用在例外狀況。<br>確認後學員與教練會收到開課通知，之後取消不退費。', ok: '確認成班' } });
    }
    if (x.single && d.a === '未成班') {
      return PB.run('classAction', { id: d.id, action: '未成班' }, { confirm: { title: '未成班：' + m.singleLabel(c), text: '這堂取消；已付學員會在 LINE 收到「改報其他堂／課程抵用金／退款」，3 天未回覆轉抵用金。', danger: true, ok: '設為未成班' } });
    }
    if (d.a === '確認成班') {
      return PB.run('classAction', { id: d.id, action: '確認成班' }, { confirm: { title: '確認成班：' + m.classLabel(c), text: '已付首堂 ' + x.paid + ' 人（門檻 ' + x.min + '、上限 ' + x.limit + '）。<br>系統會開尾款、入帳堂數、把彈性場地轉成球敘草稿，並通知學員開課。還沒額滿時學員仍可報名到上限（付全額）。<br><b>請先確認開課日期、教練、場地都已定案。</b>', ok: '確認成班' } });
    }
    if (d.a === '未成班') {
      return PB.run('classAction', { id: d.id, action: '未成班' }, { confirm: { title: '未成班：' + m.classLabel(c), text: '場次全部取消、場地轉成球敘草稿；已付學員會在 LINE 收到「順延／轉班／退款」三選項。', danger: true, ok: '設為未成班' } });
    }
    // v3.5：確定開課 → 改回籌備中／取消開課（取消開課＝開班動作「未成班」）
    if (d.a === '改回籌備中') {
      return PB.run('classAction', { id: d.id, action: '改回籌備中' }, { confirm: { title: '改回籌備中：' + m.classLabel(c), text: '用在開課要延後、要重新招生的情況。<ul style="margin:6px 0 0;padding-left:18px"><li>報名、已付的款項、上課場次都保留</li><li>還沒付的尾款作廢、已入帳的堂數沖回（之後再確認成班會重新開立、入帳）</li><li>學員與教練會收到「開課時間調整」通知</li><li>彈性場地如果已經轉成球敘草稿，不會還原</li></ul>', ok: '改回籌備中' } });
    }
    if (d.a === '取消開課') {
      const txt = x.single ? '這一堂取消；已付學員會在 LINE 收到「改報其他堂／課程抵用金／退款」，3 天未回覆轉抵用金。教練會收到通知。'
        : '這一期不開了：<ul style="margin:6px 0 0;padding-left:18px"><li>場次全部取消、場地轉成球敘草稿</li><li>還沒付的尾款作廢、已入帳的堂數沖回</li><li>已付款的學員在 LINE 選「順延／轉班／退款」；沒付款的報名直接取消</li><li>學員與教練會收到「課程取消」通知</li></ul>';
      return PB.run('classAction', { id: d.id, action: '未成班' }, { confirm: { title: '取消開課：' + (x.single ? m.singleLabel(c) : m.classLabel(c)), text: txt, danger: true, ok: '取消開課' } });
    }
    const v = await ui.ask('順延：' + m.classLabel(c), '最多順延 1 次；已報名的學員自動帶到新日期並收到通知。', { fields: [{ k: 'date', label: '順延到', t: 'date', req: true, hint: '要是上課時段的「可用」日' }], ok: '順延' });
    if (v) PB.run('classAction', { id: d.id, action: '順延', date: v.date });
  };
  A.copyClass = (d) => PB.run('copyClass', { id: d.id }, { confirm: { title: '用彈性場地加開一班', text: '會複製一個籌備中班級（使用原班的彈性場地），原班的彈性場地清空。之後請確認主教練。', ok: '加開' } }).then((r) => r && r.data && r.data.id && openClass(r.data.id));
  A.copyLink = async (d) => {
    const v = await ui.ask('複製報名連結', '學員點連結可直接報名，不必先加好友。來源碼會記在報名紀錄上。', { fields: [{ k: 'src', label: '來源碼（選填）', t: 'text', value: PB.LS.get('pb:src') || '', hint: '小寫英數與底線，例如 line_post_1026；私訊給個人可留空' }], ok: '複製' });
    if (!v) return;
    const src = str(v.src).toLowerCase();
    if (src && !/^[a-z0-9_]+$/.test(src)) return ui.toast('來源碼只能用小寫英文、數字、底線', 'bad');
    PB.LS.set('pb:src', src);
    PB.copy(m.signupUrl(d.type, d.id, src), '報名連結');
  };

  // ---------------- 報名操作 ----------------
  A.sigNew = async (d) => {
    const fields = d.stu ? [] : [{ k: 'stu', label: '學員', t: 'ref', ref: '1_學員', req: true, other: true, hint: '找不到就先到「學員」新增' }];
    let type = d.type;
    let target = d.target;
    if (!type) {
      fields.unshift({ k: 'target', label: '報名哪一班／哪一場', t: 'enum', req: true, opts: openTargets().map((o) => o.l) });
    }
    if (type === '球敘') {
      const x = m.game(target);
      if (x.courts.length > 1) fields.push({ k: 'court', label: '場地（球面）', t: 'enum', req: true, opts: x.courts.map((c) => c.name + '（' + c.list.length + '/' + c.cap + '）') });
    }
    // v3.2：球敘可以順便登記租球拍（費用由系統併入同一筆應收）
    const rkOn = PB.rows('2_報名').some((r) => '租拍數' in r);
    const venueOf = (gid) => PB.get('1_據點', (PB.get('2_球敘場次', gid) || {})['據點']) || {};
    const rkOff = (gid) => str(venueOf(gid)['可租球拍數']) !== '' && num(venueOf(gid)['可租球拍數']) === 0;
    if (rkOn && (type === '球敘' ? !rkOff(target) : !type)) fields.push({ k: 'rackets', label: '租球拍（支）', t: 'enum', opts: ['0', '1', '2', '3', '4'], value: '0', hint: '只限球敘；每支每場依系統設定（預設 NT$50），費用併入報名的應收；同時段共用據點庫存' });
    if (isMgmt()) fields.push({ k: 'force', label: '額滿也直接報名（超收，管理層）', t: 'bool' });
    const v = await ui.ask('後台報名' + (target ? '：' + m.sigTarget({ 報名類型: type, 班級: target, 球敘: target }) : '：' + m.stuName(d.stu)), '學員真的不會操作才代建；報名後系統會建立應收並推播付款資訊。', { fields: fields, ok: '報名' });
    if (!v) return;
    if (!type) {
      const t = openTargets().find((o) => o.l === v.target);
      if (!t) return;
      type = t.type; target = t.id;
    }
    let court = '';
    if (type === '球敘') {
      const x = m.game(target);
      const label = (c) => c.name + '（' + c.list.length + '/' + c.cap + '）';
      if (x.courts.length > 1 && !v.court) {
        const v2 = await ui.ask('選場地（球面）', esc(m.label('2_球敘場次', x.g)), { fields: [{ k: 'court', label: '場地', t: 'enum', req: true, opts: x.courts.map(label) }], ok: '報名' });
        if (!v2) return;
        v.court = v2.court;
      }
      court = x.courts.length === 1 ? x.courts[0].id : (x.courts.find((c) => v.court === label(c)) || {}).id || '';
    }
    const stu = d.stu || v.stu;
    if (!stu || stu.charAt(0) === '?') return ui.toast('請從清單選學員', 'bad');
    const rackets = type === '球敘' ? Number(v.rackets) || 0 : 0;
    PB.run('signupNew', { type: type, target: target, studentIds: [stu], court: court, force: v.force === true, rackets: rackets });
  };
  function openTargets() {
    const t = today();
    const cls = PB.rows('2_課程班級').filter((c) => ['籌備中', '確定開課', '進行中'].indexOf(str(c['課程狀態'])) >= 0).map((c) => ({ type: '課程', id: c['班級ID'], l: '課程｜' + m.label('2_課程班級', c) }));
    const gs = PB.rows('2_球敘場次').filter((g) => day(g['日期']) >= t && ['開放報名', '已額滿'].indexOf(str(g['狀態'])) >= 0).sort((a, b) => byKey(day(a['日期']), day(b['日期']))).map((g) => ({ type: '球敘', id: g['球敘ID'], l: '球敘｜' + m.label('2_球敘場次', g) }));
    return cls.concat(gs);
  }
  A.sigCancel = async (d) => {
    const r = PB.get('2_報名', d.id);
    const p = m.sigPay(d.id);
    const c = str(r['報名類型']) === '課程' ? PB.get('2_課程班級', r['班級']) : null;
    const x = c ? m.cls(c) : null;
    const formed = x && x.single && ['確定開課', '進行中'].indexOf(x.st) >= 0;
    const fields = (PB.db.cols['2_報名'] || []).indexOf('學員取消原因') >= 0 ? [{ k: 'why', label: '學員的取消原因（選填）', t: 'enum', opts: '學員取消原因', hint: '累積資料找出取消的真正原因' }] : [];
    const text = esc(m.sigTarget(r)) + '<br>' + (formed ? '<b>這堂已成班：規則是不退費，可以改用「換人」。</b>確定要例外取消嗎？<br>' : '') +
      (p.net > 0 ? '已付 ' + money(p.net) + '：系統會開退款待辦' + (x && x.single && PB.has('3_抵用金流水') ? '（學員要抵用金的話，在退款待辦按「改轉抵用金」）' : '') + '。' : '未付款的應收會作廢。') + '學員會收到取消通知，候補自動遞補。';
    const v = await ui.ask('取消報名：' + m.stuName(r['學員']), text, { fields: fields, danger: true, ok: '取消報名' });
    if (v) PB.run('signupCancel', { ids: [d.id], why: v.why || '' });
  };
  A.sigSwap = async (d) => {
    const r = PB.get('2_報名', d.id);
    const v = await ui.ask('換人上課：' + m.stuName(r['學員']), esc(m.sigTarget(r)) + '<br>費用仍算原學員付的；換成的人要先建好學員資料。', { fields: [{ k: 'to', label: '換成', t: 'ref', ref: '1_學員', req: true, other: true }, { k: 'note', label: '備註', t: 'text' }], ok: '換人' });
    if (!v) return;
    if (!v.to || v.to.charAt(0) === '?' || v.to === str(r['學員'])) return ui.toast('請從清單選另一位學員', 'bad');
    PB.run('signupSwap', { id: d.id, to: v.to, note: v.note });
  };
  A.sigPromote = (d) => PB.run('signupPromote', { ids: [d.id] }, { confirm: { title: '手動遞補', text: '不檢查名額，直接改為已報名；系統會建立應收並通知付款。', ok: '遞補' } });
  A.sigMove = async (d) => {
    const r = PB.get('2_報名', d.id);
    const fromC = PB.get('2_課程班級', r['班級']);
    const single = m.isSingle(fromC);
    // 專項課「改報」：只列籌備中、今天以後的專項課（依日期）；期制班「移班」：只列籌備中的期制班
    const opts = PB.rows('2_課程班級').filter((c) => str(c['課程狀態']) === '籌備中' && str(c['班級ID']) !== str(r['班級']) && m.isSingle(c) === single && (!single || day(c['開課日期']) >= today()))
      .sort((a, b) => byKey(day(a['開課日期']) + str(a['開始時間']), day(b['開課日期']) + str(b['開始時間'])))
      .map((c) => ({ id: c['班級ID'], l: (single ? m.singleLabel(c) + '｜' + m.venueName(c['據點']) + '｜' + money(c['費用']) : m.label('2_課程班級', c)) + '（' + m.cls(c).used + '/' + m.cls(c).limit + '）' }));
    if (!opts.length) return ui.toast(single ? '目前沒有其他招生中的專項課' : '目前沒有其他籌備中的班級', 'bad');
    const fields = [{ k: 'to', label: '移到', t: 'enum', req: true, opts: opts.map((o) => o.l) }];
    if (isMgmt()) fields.push({ k: 'force', label: '目標班額滿也移入（管理層）', t: 'bool' });
    const v = await ui.ask((single ? '改報：' : '移班：') + m.stuName(r['學員']), single ? '已付的費用跟著報名一起移到新的一堂。學校 1,000／球館 1,200：價格不同時差額請另外收或轉抵用金。目標額滿時列入候補。' : '應收跟著報名一起移；候補／保留中會改為已報名（已付首堂自動折抵）。目標班額滿時列入候補。', { fields: fields, ok: single ? '改報' : '移班' });
    if (!v) return;
    const to = opts.find((o) => o.l === v.to);
    if (to) PB.run('signupMove', { ids: [d.id], classId: to.id, force: v.force === true });
  };

  // ---------------- 收款 ----------------
  A.payConfirm = (d) => PB.run('payConfirm', { ids: [d.id] });
  A.payConfirmChecked = () => {
    const ids = checked('pay');
    if (!ids.length) return ui.toast('請先勾選');
    PB.run('payConfirm', { ids: ids }, { confirm: { title: '確認入帳 ' + ids.length + ' 筆', text: '總額 ' + money(sum(ids, (id) => (PB.get('3_收款明細', id) || {})['金額'])) + '。只確認銀行明細看得到的款項。', ok: '確認入帳' } });
  };
  A.payWrong = async (d) => {
    const v = await ui.ask('標記有誤', '這筆不再算已付（名額可能因此被釋出），請寫原因並聯絡學員。', { fields: [{ k: 'note', label: '原因', t: 'text', req: true }], danger: true, ok: '標記有誤' });
    if (v) PB.run('payWrong', { id: d.id, note: v.note });
  };
  A.payRemind = (d) => PB.run('payRemind', { ids: split(d.ids) });
  A.payAdd = async (d) => {
    if (!d.id) return ui.toast('沒有未收的應收', 'bad');
    const rec = PB.get('3_應收帳款', d.id);
    const x = m.rec(d.id);
    const v = await ui.ask('新增收款：' + m.stuName(str(rec['付款人']) || rec['學員']), esc(str(rec['項目說明'])) + '<br>應收 ' + money(x.due) + '、已付 ' + money(x.net) + '、未收 <b>' + money(x.left) + '</b>', {
      fields: [
        { k: 'amount', label: '金額', t: 'money', req: true, value: x.left },
        { k: 'date', label: '收款日期', t: 'date', req: true, value: today() },
        { k: 'method', label: '付款方式', t: 'enum', opts: '收款方式', value: '轉帳', req: true },
        { k: 'last5', label: '帳號末五碼', t: 'text', when: { method: ['轉帳'] } },
        { k: 'status', label: '對帳', t: 'enum', opts: ['已確認', '待確認'], value: '已確認', hint: '已在銀行明細看到 → 已確認（學員會收到入帳通知）' },
        { k: 'note', label: '備註', t: 'text' },
      ], ok: '登記收款',
    });
    if (v) PB.run('payAdd', { rid: d.id, amount: v.amount, date: v.date, method: v.method, last5: v.last5, status: v.status, note: v.note });
  };
  A.refund = async (d) => {
    const rec = PB.get('3_應收帳款', d.id);
    const x = m.rec(d.id);
    const payer = str(rec['付款人']) || str(rec['學員']);
    const v = await ui.ask('建立退款：' + m.stuName(payer), esc(str(rec['項目說明'])) + '<br>已收 ' + money(x.net) + '。<b>退款金額與方式需主管核准，匯款完成後再登記。</b>', {
      fields: [
        { k: 'amount', label: '退款金額', t: 'money', req: true, value: x.net },
        { k: 'date', label: '退款日期', t: 'date', req: true, value: today() },
        { k: 'method', label: '方式', t: 'enum', opts: '收款方式', value: '轉帳' },
        { k: 'note', label: '備註（帳戶、核准人）', t: 'text', req: true },
      ], ok: '登記退款', danger: true,
    });
    if (v) PB.run('refund', { rid: d.id, amount: v.amount, date: v.date, method: v.method, note: v.note, taskId: d.task || '' });
  };

  // ================================================================
  // 上課場次（點名、請假、改期）
  // ================================================================
  function openSes(id) {
    ui.sheet(() => { const s = PB.get('2_上課場次', id); return s ? m.sesLabel(s) : null; }, () => sesBody(id));
  }
  A.openSes = (d) => openSes(d.id);
  function sesBody(id) {
    const s = PB.get('2_上課場次', id);
    const c = PB.get('2_課程班級', s['班級']);
    const st = str(s['場次狀態']);
    const att = PB.ix.attBySes[id] || [];
    const attBy = {};
    att.forEach((a) => { attBy[str(a['學員'])] = a; });
    const x = m.cls(c);
    const mkSes = m.isMakeupSes(s);
    const roster = mkSes ? [] : (x ? x.active : []).map((r) => r['學員']); // v2.6：期末補課堂只列排了補課的學員
    att.filter((a) => roster.indexOf(str(a['學員'])) < 0).forEach((a) => roster.push(str(a['學員'])));
    const can = st === '預定' && PB.forms['2_課程班級'];
    const acts = can ? [ui.btn('改期', 'sesMove', { id: id }, 'pri'), ui.btn('換教練', 'sesCoach', { id: id }), ui.btn('停課', 'sesCancel', { id: id }, 'bad')] : [];
    // v3.3：改期後的新場次（還沒點名）可以修正或撤銷
    if (can && str(s['原場次']) && !str(s['點名確認時間'])) acts.push(ui.btn('修正改期', 'sesMoveFix', { id: id }), ui.btn('撤銷改期', 'sesMoveUndo', { id: id }, 'ghost'));
    acts.push(ui.btn('班級', 'openClass', { id: s['班級'] }, 'ghost'));
    if (st === '已完成') acts.push(ui.btn('看日誌', 'journal', { id: id }, 'ghost'));
    const fixable = st === '已完成' && day(s['日期']) >= addDays(today(), -(PB.cfg.fixDays || 120)) && !!PB.forms['2_課程班級'];
    const orig = str(s['原場次']) ? PB.get('2_上課場次', s['原場次']) : null;
    const moved = st === '改期' ? PB.rows('2_上課場次').find((n) => str(n['原場次']) === id) : null;
    const rows = roster.map((sid) => {
      const a = attBy[sid];
      const ast = a ? str(a['狀態']) : '';
      const reg = x && x.active.find((r) => str(r['學員']) === sid);
      const leaves = reg ? (PB.ix.attByStu[sid] || []).filter((y) => str(y['報名']) === str(reg['報名ID']) && str(y['狀態']) === '請假').length : 0;
      const b = [];
      if (st === '預定' && !a && reg) b.push(btn('登記請假', 'leave', { ses: id, stu: sid }));
      if (st === '預定' && ast === '請假') b.push(btn('取消請假', 'leaveCancel', { id: a['出缺勤ID'] }, 'ghost'));
      if (st === '預定' && ast === '補課出席' && str(a['補課來源'])) b.push(btn('取消補課', 'makeupCancel', { id: a['出缺勤ID'] }, 'ghost'));
      if (ast === '請假' && !(PB.ix.attBySrc[str(a['出缺勤ID'])] || []).length) b.push(btn('安排補課', 'makeup', { id: a['出缺勤ID'] }));
      if (st === '已完成' && fixable && a) b.push(btn('修正', 'attFix', { id: a['出缺勤ID'] }, 'ghost'));
      if (st === '已完成' && fixable && !a && reg) b.push(btn('補登', 'attFix', { ses: id, stu: sid }));
      const tag = ast ? '<span class="badge ' + ({ 出席: 'ok', 補課出席: 'info', 請假: 'warn', 缺席: 'bad' }[ast] || '') + '">' + esc(ast === '補課出席' && st === '預定' ? '補課（預定）' : ast) + '</span>' : (st === '已完成' ? '<span class="badge">未記錄</span>' : '');
      return row({ act: 'openStu', id: sid, t: esc(m.stuName(sid)) + ' ' + tag, s: esc((leaves ? '本期已請假 ' + leaves + ' 次' : '') + (a && str(a['到場時間']) ? '・到場 ' + str(a['到場時間']).slice(11, 16) : '') + (a && day(a['補課期限']) ? '・補課期限 ' + fmtD(a['補課期限']) : '')), r: b.join('') });
    }).join('');
    return '<div class="acts">' + acts.join('') + '</div>' + kv([
      ['狀態', st === '取消' ? '<span class="badge bad">停課</span>' : '<span class="badge ' + (st === '已完成' ? 'ok' : '') + '">' + esc(st) + '</span>' + (st === '已完成' && str(s['點名確認時間']) ? ' <span class="mut">' + esc(m.staffName(s['點名確認人']) + ' ' + fmtDT(s['點名確認時間'])) + '</span>' : '')],
      ['班級', esc(m.classLabel(c)) + ' ' + m.classBadge(str(c && c['課程狀態']))],
      ['時間', esc(fmtD(s['日期']) + ' ' + m.hm(s['開始時間'], s['結束時間']))],
      ['地點', esc(m.venueName(s['據點']) + '・' + m.courtName(s['使用場地']))],
      ['教練', esc(m.staffName(s['授課教練']) || '未排')],
      ['改期', orig ? esc('由 ' + fmtD(orig['日期']) + ' 改到這天（' + str(s['改期原因']) + '）') : moved ? esc('已改到 ' + fmtD(moved['日期'])) : ''],
      ['日誌', (PB.ix.journalBySes[id] || []).length ? '已寫' : st === '已完成' ? '<span class="badge warn">未寫</span>' : ''],
      ['補課堂', mkSes ? '期末補課堂：只有排了補課的學員要來（系統依請假自動安排）' : ''],
      ['備註', esc(s['備註'])],
    ]) + sec('學員', roster.length + ' 人') + card(rows || ui.empty('沒有學員'));
  }
  A.leave = (d) => PB.run('leave', { sessionId: d.ses, studentIds: [d.stu] }, { confirm: { title: '登記請假：' + m.stuName(d.stu), text: '後台登記不受 LINE 的 8 小時與次數限制（例外情況）。補課期限由系統依課程類型補上，並通知教練。', ok: '登記請假' } });
  A.leaveCancel = (d) => PB.run('leaveCancel', { id: d.id }, { confirm: { title: '取消請假', text: '學員改為照常上課。' } });
  A.makeupCancel = (d) => PB.run('makeupCancel', { id: d.id }, { confirm: { title: '取消補課安排', text: '這次請假會回到「待補課」。' } });
  A.makeup = async (d) => {
    const lv = PB.get('2_出缺勤', d.id);
    const fromSes = PB.get('2_上課場次', lv['上課場次']);
    const fromCls = fromSes ? PB.get('2_課程班級', fromSes['班級']) : null;
    const t = today();
    const opts = PB.rows('2_上課場次').filter((s) => str(s['場次狀態']) === '預定' && day(s['日期']) >= t && (!day(lv['補課期限']) || day(s['日期']) <= day(lv['補課期限'])) && str(s['場次ID']) !== str(lv['上課場次']))
      .map((s) => {
        const c = PB.get('2_課程班級', s['班級']);
        const x = m.cls(c);
        if (!c || ['確定開課', '進行中'].indexOf(str(c['課程狀態'])) < 0) return null;
        const att = PB.ix.attBySes[str(s['場次ID'])] || [];
        const n = x.active.length - att.filter((a) => str(a['狀態']) === '請假').length + att.filter((a) => str(a['狀態']) === '補課出席').length;
        const same = fromCls && str(c['課程類型']) === str(fromCls['課程類型']) && str(c['程度']) === str(fromCls['程度']);
        return { id: s['場次ID'], same: same, l: (same ? '★ ' : '') + m.sesLabel(s) + '｜' + m.venueName(s['據點']) + '｜' + n + '/' + x.limit + ' 人', d: day(s['日期']) };
      }).filter(Boolean).sort((a, b) => (a.same === b.same ? byKey(a.d, b.d) : a.same ? -1 : 1));
    if (!opts.length) return ui.toast('補課期限內沒有可安排的場次', 'bad');
    const v = await ui.ask('安排補課：' + m.stuName(lv['學員']), '請假：' + esc(m.sesLabel(fromSes)) + '<br>★＝同課程類型、同程度。教練點名確認後才扣堂。', { fields: [{ k: 's', label: '補課場次', t: 'enum', req: true, opts: opts.map((o) => o.l) }, { k: 'note', label: '備註', t: 'text' }], ok: '安排' });
    if (!v) return;
    const o = opts.find((x) => x.l === v.s);
    if (o) PB.run('makeup', { leaveId: d.id, sessionId: o.id, note: v.note });
  };
  A.sesMove = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    const courts = (PB.ix.courtByVenue[str(s['據點'])] || []).map((c) => ({ v: str(c['場地ID']), l: str(c['場地名稱']) }));
    const fields = [
      { k: 'date', label: '新日期', t: 'date', req: true, hint: '要是這班時段的「可用」日；沒有的話請特助先新增可用日' },
      { k: 'start', label: '開始時間', t: 'time', value: str(s['開始時間']).slice(0, 5) },
      { k: 'end', label: '結束時間', t: 'time', value: str(s['結束時間']).slice(0, 5) },
      { k: 'court', label: '場地', t: 'enum', opts: courts.map((c) => c.l), value: m.courtName(s['使用場地']) },
      { k: 'coach', label: '授課教練', t: 'enum', opts: coaches().map((c) => c.l), value: m.staffName(s['授課教練']) },
      { k: 'reason', label: '改期原因（會通知學員）', t: 'text', req: true, hint: '例：教練請假、場地被借用、颱風停課' },
    ];
    if (isMgmt()) fields.push({ k: 'force', label: '略過可用日與場地檢查（管理層）', t: 'bool' });
    const v = await ui.ask('改期：' + m.sesLabel(s), '原場次會標記「改期」保留紀錄，另建一堂新場次；學員與教練約 ' + PB.cfg.scanMin + ' 分鐘內收到改期通知。', { fields: fields, ok: '改期' });
    if (!v) return;
    PB.run('sessionReschedule', { id: d.id, date: v.date, start: v.start, end: v.end, court: (courts.find((c) => c.l === v.court) || {}).v, coach: (coaches().find((c) => c.l === v.coach) || {}).v, reason: v.reason, force: v.force === true });
  };
  // v3.3：修正改期 — 改期時日期／時間填錯，直接改這一堂（不再多建一列）
  A.sesMoveFix = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    const o = PB.get('2_上課場次', s['原場次']);
    const courts = (PB.ix.courtByVenue[str(s['據點'])] || []).map((c) => ({ v: str(c['場地ID']), l: str(c['場地名稱']) }));
    const fields = [
      { k: 'date', label: '正確日期', t: 'date', req: true, value: day(s['日期']) },
      { k: 'start', label: '開始時間', t: 'time', value: str(s['開始時間']).slice(0, 5) },
      { k: 'end', label: '結束時間', t: 'time', value: str(s['結束時間']).slice(0, 5) },
      { k: 'court', label: '場地', t: 'enum', opts: courts.map((c) => c.l), value: m.courtName(s['使用場地']) },
      { k: 'coach', label: '授課教練', t: 'enum', opts: coaches().map((c) => c.l), value: m.staffName(s['授課教練']) },
      { k: 'reason', label: '改期原因（要改才填）', t: 'text', hint: '目前：' + (str(s['改期原因']) || '未填') },
      { k: 'note', label: '修正說明（記在備註）', t: 'text', hint: '例：原本誤填 11/7，應為 11/14' },
    ];
    if (isMgmt()) fields.push({ k: 'force', label: '略過可用日與場地檢查（管理層）', t: 'bool' });
    const v = await ui.ask('修正改期：' + m.sesLabel(s), '原場次 ' + esc(o ? fmtD(o['日期']) : '') + ' 改到 ' + esc(fmtD(s['日期'])) + '，日期或時間填錯時用這裡直接改，不會再多一筆改期紀錄。<br>改期通知還沒發出 → 學員只會收到一則（修正後的時間）；已經發出 → 會再收到一則時間異動。日曆約 15 分鐘內更新。<br>要改回原本的時間請用「撤銷改期」。', { fields: fields, ok: '修正' });
    if (!v) return;
    PB.run('sessionRescheduleFix', { id: d.id, date: v.date, start: v.start, end: v.end, court: (courts.find((c) => c.l === v.court) || {}).v, coach: (coaches().find((c) => c.l === v.coach) || {}).v, reason: v.reason, note: v.note, force: v.force === true });
  };
  // v3.3：撤銷改期 — 不該改期時，刪掉這一堂、原場次恢復預定
  A.sesMoveUndo = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    const o = PB.get('2_上課場次', s['原場次']);
    if (!o) return ui.toast('找不到原場次', 'bad');
    const fields = [{ k: 'note', label: '原因（記在原場次備註）', t: 'text', hint: '例：誤按改期、颱風沒來照常上課' }];
    if (isMgmt()) fields.push({ k: 'force', label: '略過原時間的場地檢查（管理層）', t: 'bool' });
    const v = await ui.ask('撤銷改期：' + m.sesLabel(s), '刪除這一堂（' + esc(fmtD(s['日期'])) + '），原場次 <b>' + esc(fmtD(o['日期']) + ' ' + m.hm(o['開始時間'], o['結束時間'])) + '</b> 恢復上課。<br>學員與教練約 ' + PB.cfg.scanMin + ' 分鐘內收到「照原時間上課」通知；日曆約 15 分鐘內更新。', { fields: fields, danger: true, ok: '撤銷改期' });
    if (!v) return;
    PB.run('sessionRescheduleUndo', { id: d.id, note: v.note, force: v.force === true });
  };
  /** 教練這天這段時間能不能排（不可排日期、同時段已有課）；可以 → '' */
  function coachBusy(coachId, dk, start, end, skipSes) {
    const p = PB.get('1_人員', coachId);
    if (p && str(p['在職狀態']) && str(p['在職狀態']) !== '在職') return str(p['在職狀態']);
    const un = PB.rows('2_教練不可排日期').find((r) => str(r['教練']) === coachId && day(r['開始日期']) && day(r['開始日期']) <= dk && (day(r['結束日期']) || day(r['開始日期'])) >= dk);
    if (un) return '登記不可排' + (str(un['原因']) ? '（' + str(un['原因']) + '）' : '');
    const mins = (t) => { const x = str(t).match(/(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : 0; };
    const hit = (PB.ix.sesByDay[dk] || []).find((x) => str(x['授課教練']) === coachId && str(x['場次ID']) !== skipSes && ['取消', '改期'].indexOf(str(x['場次狀態'])) < 0 && mins(x['開始時間']) < mins(end) && mins(start) < mins(x['結束時間']));
    return hit ? '已排 ' + m.classLabel(PB.get('2_課程班級', hit['班級'])) : '';
  }
  PB.coachBusy = coachBusy;
  A.sesCoach = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    const list = coaches().filter((c) => c.v !== str(s['授課教練'])).map((c) => {
      const why = coachBusy(c.v, day(s['日期']), s['開始時間'], s['結束時間'], str(s['場次ID']));
      return Object.assign({}, c, { why: why, l2: c.l + (why ? '（' + why + '）' : '（可排）') });
    }).sort((a, b) => (!!a.why === !!b.why ? a.l.localeCompare(b.l, 'zh-Hant') : a.why ? 1 : -1));
    const c = PB.get('2_課程班級', s['班級']);
    const formed = c && ['確定開課', '進行中'].indexOf(str(c['課程狀態'])) >= 0;
    const fields = [{ k: 'coach', label: '新教練', t: 'enum', req: true, opts: list.map((x) => x.l2), hint: '括號裡是這個時段能不能排' }];
    if (isMgmt()) fields.push({ k: 'force', label: '教練不能排也照樣指派（管理層）', t: 'bool' });
    const v = await ui.ask('換教練：' + m.sesLabel(s), '目前：' + esc(m.staffName(s['授課教練']) || '未排') + '。教練費依新教練的費率重算。' + (formed ? '新舊教練與學員約 ' + PB.cfg.scanMin + ' 分鐘內收到通知。' : '這堂還沒成班：成班後教練才會在明日課表看到，需要的話請先私訊告知。'), { fields: fields, ok: '更換' });
    if (!v) return;
    const pick = list.find((x) => x.l2 === v.coach);
    if (!pick) return;
    if (pick.why && v.force !== true) return ui.toast(pick.l + ' 不能排：' + pick.why, 'bad');
    PB.run('sessionCoach', { id: d.id, coach: pick.v, force: v.force === true });
  };
  A.sesCancel = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    const v = await ui.ask('停課：' + m.sesLabel(s), '這一堂不上、不補（要補請用「改期」）。學員與教練會收到通知。', { fields: [{ k: 'reason', label: '原因', t: 'text', req: true }], danger: true, ok: '停課' });
    if (v) PB.run('sessionCancel', { id: d.id, reason: v.reason });
  };

  // ================================================================
  // 球敘
  // ================================================================
  const Games = {
    id: 'games', label: '球敘', icon: 'ball', show: isOps,
    render(p) {
      const tab = p.tab || '近期';
      const t = today();
      const kw = str(p.q).toLowerCase();
      let list = PB.rows('2_球敘場次');
      if (tab === '近期') list = list.filter((g) => day(g['日期']) >= t && str(g['狀態']) !== '草稿');
      else if (tab === '草稿') list = list.filter((g) => str(g['狀態']) === '草稿' && day(g['日期']) >= t);
      else list = list.filter((g) => day(g['日期']) < t && day(g['日期']) >= addDays(t, -45));
      if (kw) list = list.filter((g) => m.label('2_球敘場次', g).toLowerCase().indexOf(kw) >= 0);
      list.sort((a, b) => (tab === '過去' ? -1 : 1) * byKey(day(a['日期']) + str(a['開始時間']), day(b['日期']) + str(b['開始時間'])));
      const drafts = PB.rows('2_球敘場次').filter((g) => str(g['狀態']) === '草稿' && day(g['日期']) >= t).length;
      const top = '<div class="ptop"><h1>球敘</h1><span class="sp"></span>' + (PB.forms['2_球敘場次'] ? ui.btn('新增球敘', 'gameNew', {}, 'pri', 'plus') : '') + '</div>' +
        '<div class="ptop"><div class="chips">' + ['近期', '草稿', '過去'].map((k) => '<button class="chip' + (k === tab ? ' on' : '') + '" data-act="param" data-k="tab" data-v="' + k + '">' + k + (k === '草稿' && drafts ? '<span class="c">' + drafts + '</span>' : '') + '</button>').join('') + '</div><span class="sp"></span>' +
        '<label class="search">' + PB.icon('search') + '<input placeholder="搜尋據點、日期" value="' + esc(p.q || '') + '" data-input="gameSearch"></label></div>';
      const gRow = (g) => {
        const x = m.game(g);
        return row({ act: 'openGame', id: g['球敘ID'], when: m.hm(g['開始時間']) + '<small>' + m.hm(g['結束時間']).slice(0, 5) + '</small>', t: esc(m.venueName(g['據點']) + '・' + m.gameLabel(g)) + ' ' + m.gameBadge(x.st, g) + (x.cancelPending ? ' <span class="badge info">取消處理中</span>' : ''), s: esc(x.courts.map((c) => c.name).join('、') + '・' + (str(g['費用']) !== '' ? money(g['費用']) : '未填費用') + '・場主 ' + (x.hosts.map((h) => h.name).join('、') || '未排')), r: '<span class="badge">' + x.active.length + '/' + x.limit + '</span>' + (x.wait.length ? '<span class="badge warn">候補 ' + x.wait.length + '</span>' : '') });
      };
      // 依日期分組，點日期展開（搜尋時全部展開）
      const groups = uniq(list.map((g) => day(g['日期']))).map((d) => {
        const gs = list.filter((g) => day(g['日期']) === d);
        const xs = gs.map((g) => m.game(g));
        const venues = uniq(gs.map((g) => m.venueName(g['據點'])));
        const wait = sum(xs, (x) => x.wait.length);
        return {
          id: d, title: fmtD(d) + (d === t ? '（今天）' : ''), count: gs.length,
          meta: esc(venues.join('、')) + '・報名 ' + sum(xs, (x) => x.active.length) + '/' + sum(xs, (x) => x.limit) + (wait ? ' <span class="badge warn">候補 ' + wait + '</span>' : ''),
          body: () => card(gs.map(gRow).join('')),
        };
      });
      const view = ui.groups(groups, {}, { key: 'games:' + tab, menu: false, unit: '場', forceOpen: !!kw });
      return top + (view || card(ui.empty(tab === '草稿' ? '沒有待開放的草稿' : '沒有球敘')));
    },
  };
  function openGame(id) {
    ui.sheet(() => { const g = PB.get('2_球敘場次', id); return g ? fmtD(g['日期']) + ' ' + m.venueName(g['據點']) : null; }, () => gameBody(id));
  }
  A.openGame = (d) => openGame(d.id);
  function gameBody(id) {
    const g = PB.get('2_球敘場次', id);
    const x = m.game(g);
    const t = today();
    const acts = [];
    const can = !!PB.forms['2_球敘場次'];
    if (can && x.st === '草稿') acts.push(ui.btn('開放報名', 'gameOpen', { id: id }, 'pri'));
    if (['開放報名', '已額滿'].indexOf(x.st) >= 0 && day(g['日期']) >= t) acts.push(ui.btn('後台報名', 'sigNew', { type: '球敘', target: id }, '', 'plus'), ui.btn('報名連結', 'copyLink', { type: '球敘', id: id }, 'ghost', 'link'));
    if (can && ['取消', '已結束'].indexOf(x.st) < 0 && day(g['日期']) >= t && !x.cancelPending) acts.push(ui.btn(x.st === '草稿' ? '取消草稿' : '取消球敘', 'gameCancel', { id: id }, 'bad'));
    if (can && x.st === '草稿' && !x.sigs.length) acts.push(ui.btn('刪除草稿', 'gameDelete', { id: id }, 'ghost'));
    if (can && ['草稿', '開放報名', '已額滿'].indexOf(x.st) >= 0) acts.push(ui.btn('編輯', 'gameEdit', { id: id }, 'ghost'));
    const lv = split(g['程度']).map(m.levelName).join('、');
    const courts = x.courts.map((c) => sec(c.name, c.list.length + '／' + c.cap + ' 人') + card(c.list.map((r) => sigRow(r, 'game')).join('') || ui.empty('還沒有人'))).join('');
    const noCourt = x.active.filter((r) => !split(g['使用場地']).some((c) => c === str(r['場地'])));
    return '<div class="acts">' + acts.join('') + '</div>' + kv([
      ['狀態', m.gameBadge(x.st, g) + (x.cancelPending ? ' <span class="badge info">取消處理中：系統正在通知學員</span>' : '')],
      ['時間', esc(fmtD(g['日期']) + ' ' + m.hm(g['開始時間'], g['結束時間']))],
      ['地點', esc(m.venueName(g['據點']) + '・' + x.courts.map((c) => c.name).join('、'))],
      ['類型', esc((str(g['球敘類型']) || '不限') + (lv ? '：' + lv + (str(g['球敘類型']) === '分級' ? ' 以上' : '') : '') + (str(g['球敘類型']) === 'DUPR' ? '：' + str(g['DUPR下限']) + '–' + str(g['DUPR上限']) : ''))],
      ['費用', str(g['費用']) !== '' ? esc(money(g['費用']) + '／人') : '<span class="badge bad">未填（不能開放報名）</span>'],
      ...(x.rackets !== null ? [['球拍租借', esc('已報名的人租 ' + x.rackets + ' 支') + (x.racketStock !== null ? esc('・據點庫存 ' + x.racketStock + ' 支（同時段共用）') : '')]] : []), // v3.0
      ['名額', esc('已報名 ' + x.active.length + '／上限 ' + x.limit + '・剩 ' + x.left) + (x.walkin.length ? ' <span class="badge warn">現場待確認 ' + x.walkin.length + '</span>' : '') + (x.checked ? ' <span class="badge ok">簽到 ' + x.checked + '</span>' : '')],
      ['場主', hostCell(g, x, can && ['草稿', '開放報名', '已額滿'].indexOf(x.st) >= 0 && day(g['日期']) >= t)],
      ['計分', esc((str(g['每場分數']) || '15') + ' 分' + (g['需贏2分'] === false ? '・不需贏 2 分' : ''))],
    ]) + courts + (noCourt.length ? sec('未分面', noCourt.length + ' 人') + card(noCourt.map((r) => sigRow(r, 'game')).join('')) : '') +
      (x.wait.length ? sec('候補', x.wait.length + ' 人') + card(x.wait.map((r) => sigRow(r, 'game')).join('')) : '');
  }
  // ---- v3.5：球敘場主（加／換／移除）----
  function hostCell(g, x, edit) {
    const gid = str(g['球敘ID']);
    const list = x.hosts.map((h) => {
      const locked = h.in || str(h.d['費用結算']) || num(h.d['現場收款金額']) > 0;
      return '<span class="host-i">' + esc(h.name) + (h.in ? ' <span class="badge ok">已到場</span>' : '') +
        (edit && !locked ? ' ' + btn('換人', 'hostSwap', { duty: h.d['排班ID'] }, 'ghost') + btn('移除', 'hostDel', { duty: h.d['排班ID'] }, 'ghost') : '') + '</span>';
    }).join('');
    const empty = x.hosts.length ? '' : '<span class="mut">' + (x.st === '草稿' ? '開放報名後自動排（也可以先指定）' : '未排') + '</span> ';
    return '<div class="host-list">' + list + empty + (edit ? btn('加場主', 'hostAdd', { id: gid }, '', 'plus') : '') + '</div>';
  }
  /** 可排的場主：在職人員；據點的場主排前面；同時段已在別場當場主的標出來 */
  function hostChoices(g, except) {
    const v = PB.get('1_據點', g['據點']) || {};
    const venueHosts = split(v['場主']);
    const dk = day(g['日期']);
    const mine = (PB.ix.dutyByGame[str(g['球敘ID'])] || []).map((d) => str(d['人員']));
    return PB.rows('1_人員').filter((p) => (!str(p['在職狀態']) || str(p['在職狀態']) === '在職') && mine.indexOf(str(p['人員ID'])) < 0 && str(p['人員ID']) !== except).map((p) => {
      const pid = str(p['人員ID']);
      const busy = PB.rows('2_場主排班').filter((d) => str(d['人員']) === pid && str(d['球敘']) !== str(g['球敘ID'])).map((d) => PB.get('2_球敘場次', d['球敘']))
        .find((o) => o && str(o['狀態']) !== '取消' && day(o['日期']) === dk && hm5(o['開始時間']) < hm5(g['結束時間']) && hm5(g['開始時間']) < hm5(o['結束時間']));
      const why = busy ? '同時段在' + m.venueName(busy['據點']) : '';
      const tag = venueHosts.indexOf(pid) >= 0 ? '據點場主' : '';
      return { v: pid, l: str(p['姓名']), why: why, l2: str(p['姓名']) + (tag ? '・' + tag : '') + (why ? '（' + why + '）' : '') };
    }).sort((a, b) => (!!a.why !== !!b.why ? (a.why ? 1 : -1) : (venueHosts.indexOf(b.v) >= 0) - (venueHosts.indexOf(a.v) >= 0) || a.l.localeCompare(b.l, 'zh-Hant')));
  }
  const hm5 = (v) => str(v).slice(0, 5);
  async function hostPick(title, text, g, except) {
    const list = hostChoices(g, except);
    if (!list.length) { ui.toast('沒有可以排的在職人員', 'bad'); return null; }
    const fields = [{ k: 'who', label: '場主', t: 'enum', req: true, opts: list.map((x) => x.l2), hint: '據點場主排在前面；括號是同時段已有其他球敘' }];
    if (isMgmt()) fields.push({ k: 'force', label: '同時段有其他球敘也照樣指派（管理層）', t: 'bool' });
    const v = await ui.ask(title, text, { fields: fields, ok: '確定' });
    if (!v) return null;
    const pick = list.find((x) => x.l2 === v.who);
    if (!pick) return null;
    if (pick.why && v.force !== true) { ui.toast(pick.l + ' 不能排：' + pick.why, 'bad'); return null; }
    return { staff: pick.v, force: v.force === true };
  }
  A.hostAdd = async (d) => {
    const g = PB.get('2_球敘場次', d.id);
    const r = await hostPick('加場主：' + m.gameLabel(g), esc(fmtD(g['日期']) + ' ' + m.hm(g['開始時間'], g['結束時間']) + '・' + m.venueName(g['據點'])) + '。合作方案依人員自動帶入；場主會在場主 OA 收到排班通知。', g, '');
    if (r) PB.run('gameHostAdd', { id: d.id, staff: r.staff, force: r.force });
  };
  A.hostSwap = async (d) => {
    const du = PB.get('2_場主排班', d.duty);
    const g = PB.get('2_球敘場次', du['球敘']);
    const r = await hostPick('換場主：' + m.gameLabel(g), '目前：' + esc(m.staffName(du['人員'])) + '。換人後新場主收到排班通知、原場主收到取消通知；場主費由月結依新場主的合作方案計算。', g, str(du['人員']));
    if (r) PB.run('gameHostReplace', { duty: d.duty, staff: r.staff, force: r.force });
  };
  A.hostDel = (d) => {
    const du = PB.get('2_場主排班', d.duty);
    const g = PB.get('2_球敘場次', du['球敘']);
    const left = (PB.ix.dutyByGame[str(g['球敘ID'])] || []).length - 1;
    return PB.run('gameHostRemove', { duty: d.duty }, { confirm: { title: '移除場主：' + m.staffName(du['人員']), text: '他會在場主 OA 收到「排班取消」。' + (left ? '' : '<br><b>移除後這場沒有場主，請記得補排。</b>'), danger: true, ok: '移除' } });
  };
  A.gameNew = () => ui.form('2_球敘場次', { onSaved: (id) => id && openGame(id) });
  A.gameEdit = (d) => ui.form('2_球敘場次', { id: d.id });
  A.gameOpen = (d) => PB.run('gameOpen', { ids: [d.id] }, { confirm: { title: '開放報名', text: '開放後學員就看得到並可報名；系統會排場主、建行事曆。請先核對日期、時間、據點、面數、費用、程度。', ok: '開放報名' } });
  A.gameOpenChecked = () => {
    const ids = checked('draft');
    if (!ids.length) return ui.toast('請先勾選');
    PB.run('gameOpen', { ids: ids }, { confirm: { title: '開放 ' + ids.length + ' 場球敘', text: '請確認每場的費用與場地都已核對。', ok: '開放報名' } });
  };
  A.gameCancel = (d) => {
    const x = m.game(d.id);
    return PB.run('gameCancel', { id: d.id }, { confirm: { title: x.st === '草稿' ? '取消草稿' : '取消球敘', text: x.st === '草稿' ? '草稿直接取消。' : '已報名 ' + x.active.length + ' 人、候補 ' + x.wait.length + ' 人都會收到取消通知；已付款者自動開退款待辦；場主也會收到通知。', danger: true, ok: '確定取消' } });
  };
  A.gameDelete = (d) => PB.run('gameDelete', { id: d.id }, { confirm: { title: '刪除草稿', text: '刪除後無法復原。', danger: true, ok: '刪除' } }).then((r) => r && ui.closeSheet());

  // 可用日
  A.availConfirm = (d) => PB.run('availConfirm', { ids: [d.id] });
  A.availConfirmChecked = () => { const ids = checked('avail'); if (!ids.length) return ui.toast('請先勾選'); PB.run('availConfirm', { ids: ids }); };
  A.availCancel = async (d) => {
    const v = await ui.ask('這天不能用', '系統會寄出當天受影響的課程與球敘；課程請逐堂「改期」，球敘請「取消球敘」。', { fields: [{ k: 'reason', label: '原因', t: 'text', req: true, hint: '例：學校活動借用、颱風' }], danger: true, ok: '取消這天' });
    if (v) PB.run('availCancel', { ids: [d.id], reason: v.reason });
  };

  // ================================================================
  // 學員
  // ================================================================
  const STU_FILTERS = { 全部: () => true, 課程學員: (s) => str(s['身分']) === '課程學員', 有未收: (s) => m.stu(s).owed > 0, 剩堂1以下: (s) => str(s['身分']) === '課程學員' && m.stu(s).lessons <= 1, 待合併: (s) => s['待合併'] === true && !str(s['合併至']), 跟進中: (s) => openLeads(s).length > 0 };
  // v2.6：招生跟進還沒結束的（含下次跟進日在未來的）；待處理只列「今天該跟進」的
  const openLeads = (s) => (PB.ix.leadByStu[str(s['學員ID'])] || []).filter((l) => ['已報名', '未成交'].indexOf(str(l['跟進狀態'])) < 0);
  const Students = {
    id: 'students', label: '學員', icon: 'users', show: isOps,
    render(p) {
      const f = p.f || '全部';
      const kw = str(p.q).toLowerCase();
      let list = PB.rows('1_學員').filter((s) => str(s['目前狀態']) !== '流失' || f === '全部');
      list = list.filter(STU_FILTERS[f] || (() => true));
      if (kw) list = list.filter((s) => (str(s['姓名']) + str(s['電話']).replace(/\D/g, '') + str(s['電話']) + str(s['LINE顯示名稱'])).toLowerCase().indexOf(kw.replace(/-/g, '')) >= 0);
      list.sort((a, b) => byKey(str(b['建立時間']), str(a['建立時間'])));
      const total = list.length;
      const top = '<div class="ptop"><h1>學員</h1><span class="cnt mut">' + total + ' 位</span><span class="sp"></span>' + ui.btn('新增學員', 'stuNew', {}, 'pri', 'plus') + '</div>' +
        '<div class="ptop"><div class="chips">' + Object.keys(STU_FILTERS).map((k) => '<button class="chip' + (k === f ? ' on' : '') + '" data-act="param" data-k="f" data-v="' + k + '">' + k + '</button>').join('') + '</div><span class="sp"></span>' +
        '<label class="search">' + PB.icon('search') + '<input placeholder="姓名、電話、LINE 名稱" value="' + esc(p.q || '') + '" data-input="stuSearch"></label></div>';
      const rows = list.slice(0, num(p.n) || 80).map((s) => {
        const x = m.stu(s);
        return row({ act: 'openStu', id: s['學員ID'], t: esc(str(s['姓名']) || str(s['LINE顯示名稱']) || '（未填姓名）') + (str(s['身分']) ? ' <span class="badge">' + esc(s['身分']) + '</span>' : '') + (x.guardian ? ' <span class="badge info">' + esc(m.stuName(s['管理人']) + '的' + (str(s['與管理人關係']) || '家人')) + '</span>' : '') + (s['待合併'] === true ? ' <span class="badge warn">待合併</span>' : '') + (f === '跟進中' ? (() => { const L = openLeads(s).map((l) => day(l['下次跟進日期'])).filter(Boolean).sort(); return ' <span class="badge ' + (L[0] && L[0] <= today() ? 'warn' : 'info') + '">' + (L[0] ? '下次跟進 ' + esc(fmtD(L[0])) : '跟進中') + '</span>'; })() : ''), s: esc([str(s['電話']), str(s['LINE顯示名稱']) ? 'LINE ' + s['LINE顯示名稱'] : '', m.levelName(s['程度'])].filter(Boolean).join('・')), r: (x.owed > 0 ? '<span class="badge bad">未收 ' + money(x.owed) + '</span>' : '') + (x.lessons ? '<span class="badge">剩 ' + x.lessons + ' 堂</span>' : '') });
      }).join('');
      return top + card((rows || ui.empty('找不到學員', '可以用電話或 LINE 名稱搜尋')) + (total > (num(p.n) || 80) ? '<div class="empty">' + ui.btn('顯示更多', 'param', { k: 'n', v: (num(p.n) || 80) + 200 }) + '</div>' : ''));
    },
  };
  function openStu(id) {
    ui.sheet(() => { const s = PB.get('1_學員', id); return s ? str(s['姓名']) || str(s['LINE顯示名稱']) || '學員' : null; }, () => stuBody(id));
  }
  A.openStu = (d) => { if (d.id) openStu(d.id); };
  function stuBody(id) {
    const s = PB.get('1_學員', id);
    const x = m.stu(s);
    const t = today();
    const acts = [ui.btn('後台報名', 'sigNew', { stu: id }, 'pri', 'plus'), ui.btn('新增跟進', 'leadNew', { stu: id }), ui.btn('編輯', 'stuEdit', { id: id }, 'ghost')];
    if (!x.guardian) acts.push(ui.btn('新增家人', 'stuFamily', { id: id }, 'ghost'));
    acts.push(ui.btn('通知紀錄', 'notifyOf', { id: id }, 'ghost'));
    if (s['待合併'] === true && !str(s['合併至'])) acts.push(ui.btn('合併至…', 'merge', { id: id }, 'bad'));
    const active = x.sigs.filter((r) => ['已報名', '候補', '保留中', '現場待確認'].indexOf(str(r['報名狀態'])) >= 0 && (str(r['報名類型']) === '課程' ? !!PB.get('2_課程班級', r['班級']) && ['已結束', '取消'].indexOf(str(PB.get('2_課程班級', r['班級'])['課程狀態'])) < 0 : day((PB.get('2_球敘場次', r['球敘']) || {})['日期']) >= t));
    const past = x.sigs.filter((r) => active.indexOf(r) < 0);
    const recs = x.payRecs.slice().sort((a, b) => byKey(day(b['建立日期']), day(a['建立日期'])));
    const creditOn = PB.has('3_抵用金流水');
    const CT = { 轉入: 'ok', 折抵: 'info', 退現: 'warn', 調整: '' };
    const creditRows = x.credits.slice(0, 30).map((c) => row({ t: '<span class="badge ' + (CT[str(c['類型'])] || '') + '">' + esc(c['類型']) + '</span> <span class="num">' + (num(c['金額']) > 0 ? '+' : '') + money(c['金額']) + '</span>', s: esc([fmtDT(c['建立時間']), str(c['來源報名']) && PB.get('2_報名', c['來源報名']) ? m.sigTarget(PB.get('2_報名', c['來源報名'])) : '', m.staffName(c['經手人']), str(c['備註'])].filter(Boolean).join('・')) })).join('');
    const recRows = recs.map((r) => {
      const y = m.rec(r['應收ID']);
      const b = [];
      if (!y.voided && y.left > 0) b.push(btn('收款', 'payAdd', { id: r['應收ID'] }, 'pri'), btn('提醒', 'payRemind', { ids: r['應收ID'] }, 'ghost'));
      if (!y.voided && y.left > 0 && creditOn && x.credit > 0 && str(r['付款人'] || r['學員']) === id) b.push(btn('用抵用金付', 'creditUse', { id: r['應收ID'] }));
      if (y.net > 0) b.push(btn('退款', 'refund', { id: r['應收ID'] }, 'ghost'));
      if (y.net > 0 && creditOn && sigEnded(PB.get('2_報名', r['報名']))) b.push(btn('轉抵用金', 'creditIn', { id: r['應收ID'] }, 'ghost'));
      const pays = (PB.ix.payByRec[str(r['應收ID'])] || []).map((p) => fmtD(p['收款日期']) + ' ' + money(p['金額']) + ' ' + str(p['付款方式']) + (str(p['對帳狀態']) !== '已確認' ? '（' + str(p['對帳狀態']) + '）' : '')).join('；');
      return row({ t: esc(str(r['項目說明']) || str(r['收入來源'])) + ' ' + m.payBadge(y.status) + (str(r['學員']) !== id ? ' <span class="badge info">替 ' + esc(m.stuName(r['學員'])) + ' 付</span>' : ''), s: esc('應收 ' + money(y.due) + (y.net ? '・已付 ' + money(y.net) : '') + (y.left ? '・未收 ' + money(y.left) : '') + (pays ? '・' + pays : '')), r: b.join('') });
    }).join('');
    const leaves = x.att.filter((a) => str(a['狀態']) === '請假').sort((a, b) => byKey(str(b['請假時間']), str(a['請假時間'])));
    const attRows = leaves.slice(0, 20).map((a) => {
      const mk = (PB.ix.attBySrc[str(a['出缺勤ID'])] || [])[0];
      return row({ t: esc(m.sesLabel(PB.get('2_上課場次', a['上課場次']))), s: esc('請假 ' + fmtDT(a['請假時間']) + (mk ? '・補課 ' + m.sesLabel(PB.get('2_上課場次', mk['上課場次'])) : day(a['補課期限']) ? '・補課期限 ' + fmtD(a['補課期限']) : '')), r: mk ? '<span class="badge info">已安排補課</span>' : (!day(a['補課期限']) || day(a['補課期限']) >= t) ? btn('安排補課', 'makeup', { id: a['出缺勤ID'] }) : '<span class="badge">逾期</span>' });
    }).join('');
    const leads = (PB.ix.leadByStu[id] || []).slice().sort((a, b) => byKey(day(b['跟進日期']), day(a['跟進日期'])));
    const fam = x.family.map((f) => '<a href="#" data-act="openStu" data-id="' + esc(f['學員ID']) + '">' + esc(m.stuName(f['學員ID'])) + '</a>（' + esc(str(f['與管理人關係']) || '家人') + '）').join('、');
    const friend = !str(s['LINE_userId']) ? '<span class="badge">未綁 LINE</span>' : s['好友狀態'] === false ? '<span class="badge bad">未加好友（收不到通知）</span>' : '<span class="badge ok">已加好友</span>';
    return '<div class="acts">' + acts.join('') + '</div>' +
      '<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="l">剩餘堂數</div><div class="v">' + x.lessons + '</div></div><div class="kpi' + (x.owed > 0 ? ' neg' : '') + '"><div class="l">未收金額</div><div class="v">' + money(x.owed) + '</div><div class="d">以付款人計</div></div><div class="kpi"><div class="l">報名</div><div class="v">' + x.sigs.filter((r) => str(r['報名狀態']) !== '已取消').length + '</div></div>' +
      (creditOn ? '<div class="kpi' + (x.credit > 0 ? ' pos' : '') + '"><div class="l">課程抵用金</div><div class="v">' + money(x.credit) + '</div><div class="d">不設到期日，可申請退現</div></div>' : '') + '</div>' +
      kv([
        ['電話', ui.tel(str(s['電話'])) + (!str(s['電話']) && x.guardian ? ' <span class="mut">（家長 ' + esc(m.phone(s)) + '）</span>' : '')],
        ['LINE', esc(str(s['LINE顯示名稱'])) + ' ' + friend],
        ['身分／程度', esc([str(s['身分']), m.levelName(s['程度']), str(s['DUPR雙打']) ? 'DUPR ' + s['DUPR雙打'] : ''].filter(Boolean).join('・'))],
        ['來源', esc(str(s['來源']) + (str(s['推薦人']) ? '・推薦人 ' + m.stuName(s['推薦人']) : ''))],
        ['常去據點', esc(split(s['常去據點']).map(m.venueName).join('、'))],
        ['管理人', x.guardian ? '<a href="#" data-act="openStu" data-id="' + esc(s['管理人']) + '">' + esc(m.stuName(s['管理人'])) + '</a>（' + esc(str(s['與管理人關係'])) + '）' : ''],
        ['家人', fam],
        ['生日', esc(fmtD(s['生日']))],
        ['狀態', esc(str(s['目前狀態']) + (str(s['合併至']) ? '・已合併至 ' + m.stuName(s['合併至']) : ''))],
        ['備註', esc(s['備註'])],
      ]) +
      sec('目前報名', active.length) + card(active.map((r) => row({ act: str(r['報名類型']) === '課程' ? 'openClass' : 'openGame', id: r[str(r['報名類型']) === '課程' ? '班級' : '球敘'], t: esc(m.sigTarget(r)) + ' ' + m.sigBadge(str(r['報名狀態'])) + ' ' + m.payBadge(m.sigPay(r['報名ID']).status), s: esc(str(r['報名類型']) + '・報名 ' + fmtDT(r['報名時間']) + (str(r['代報名人']) ? '・' + m.stuName(r['代報名人']) + ' 代報' : '')) })).join('') || ui.empty('沒有進行中的報名')) +
      sec('帳務', recs.length + ' 筆') + card(recRows || ui.empty('沒有應收')) +
      (creditOn && (x.credits.length || x.credit) ? sec('課程抵用金', '餘額 ' + money(x.credit), x.credit > 0 ? ui.btn('申請退現', 'creditTask', { id: id }, 'sm ghost') + ui.btn('退現（已匯款）', 'creditCash', { id: id }, 'sm') : '') + card(creditRows || ui.empty('沒有紀錄')) : '') +
      (leaves.length ? sec('請假與補課', leaves.length + ' 次') + card(attRows) : '') +
      sec('招生跟進', leads.length, ui.btn('新增', 'leadNew', { stu: id }, 'sm ghost', 'plus')) + card(leads.map((l) => row({ act: 'leadEdit', id: l['跟進ID'], t: esc(fmtD(l['跟進日期']) + '・' + str(l['跟進狀態'])), s: esc((str(l['需求']) || '') + (day(l['下次跟進日期']) ? '・下次 ' + fmtD(l['下次跟進日期']) : '')) })).join('') || ui.empty('沒有跟進紀錄')) +
      (past.length ? '<details style="margin-top:12px"><summary class="mut">過去的報名 ' + past.length + ' 筆</summary>' + card(past.slice(0, 50).map((r) => row({ t: esc(m.sigTarget(r)) + ' ' + m.sigBadge(str(r['報名狀態'])), s: esc(fmtDT(r['報名時間']) + (str(r['取消原因']) ? '・' + r['取消原因'] : '')) })).join('')) + '</details>' : '');
  }
  function sigEnded(r) {
    if (!r) return false;
    if (str(r['報名狀態']) === '已取消') return true;
    if (str(r['報名類型']) === '課程') { const c = PB.get('2_課程班級', r['班級']); return !!c && ['未成班', '取消'].indexOf(str(c['課程狀態'])) >= 0; }
    const g = PB.get('2_球敘場次', r['球敘']);
    return !!g && str(g['狀態']) === '取消';
  }
  // ---------------- 抵用金 ----------------
  A.creditIn = async (d) => {
    if (!d.id) return ui.toast('找不到已付款的應收', 'bad');
    const rec = PB.get('3_應收帳款', d.id);
    const y = m.rec(d.id);
    const payer = str(rec['付款人']) || str(rec['學員']);
    const v = await ui.ask('轉課程抵用金：' + m.stuName(payer), esc(str(rec['項目說明'])) + '<br>已收 ' + money(y.net) + '。轉入後這筆應收顯示「已轉抵用金」，' + esc(m.stuName(payer)) + ' 之後報名可以折抵；不設到期日，也可以申請退現。', {
      fields: [{ k: 'amount', label: '轉入金額', t: 'money', req: true, value: y.net }, { k: 'note', label: '備註', t: 'text', hint: '例：未成班選抵用金、成班前取消' }], ok: '轉入',
    });
    if (v) PB.run('creditIn', { rid: d.id, amount: v.amount, note: v.note, taskId: d.task || '' });
  };
  A.creditUse = async (d) => {
    const rec = PB.get('3_應收帳款', d.id);
    const payer = str(rec['付款人']) || str(rec['學員']);
    const bal = m.stu(payer).credit;
    const y = m.rec(d.id);
    const v = await ui.ask('用抵用金付：' + m.stuName(payer), esc(str(rec['項目說明'])) + '<br>未收 ' + money(y.left) + '、抵用金餘額 ' + money(bal), { fields: [{ k: 'amount', label: '折抵金額', t: 'money', req: true, value: Math.min(y.left, bal) }], ok: '折抵' });
    if (v) PB.run('creditUse', { rid: d.id, amount: v.amount });
  };
  A.creditCash = async (d) => {
    const x = m.stu(d.id);
    const v = await ui.ask('抵用金退現：' + m.stuName(d.id), '餘額 ' + money(x.credit) + '。<b>主管核准、匯款完成後再登記。</b>', {
      fields: [
        { k: 'amount', label: '退現金額', t: 'money', req: true, value: x.credit },
        { k: 'date', label: '匯款日期', t: 'date', req: true, value: today() },
        { k: 'method', label: '方式', t: 'enum', opts: '收款方式', value: '轉帳' },
        { k: 'note', label: '帳戶、核准人', t: 'text', req: true },
      ], danger: true, ok: '登記退現',
    });
    if (v) PB.run('creditCash', { payer: d.id, amount: v.amount, date: v.date, method: v.method, note: v.note, taskId: d.task || '' });
  };
  /** 學員申請退現 → 建退款待辦（核准、匯款後在待辦按「抵用金退現」） */
  A.creditTask = async (d) => {
    const x = m.stu(d.id);
    const v = await ui.ask('建立退現待辦：' + m.stuName(d.id), '抵用金餘額 ' + money(x.credit) + '。待辦會出現在「我的任務（含退款待辦）」，匯款後按「抵用金退現」完成。', { fields: [{ k: 'amount', label: '申請金額', t: 'money', req: true, value: x.credit }, { k: 'note', label: '學員提供的帳戶／原因', t: 'text' }], ok: '建立待辦' });
    if (!v) return;
    PB.run('save', { table: '4_工作任務', values: { 工作名稱: '退款｜' + m.stuName(d.id) + ' 抵用金退現 NT$' + Math.round(num(v.amount)), 工作內容: '學員：' + m.stuName(d.id) + '\n申請金額：NT$' + Math.round(num(v.amount)) + (v.note ? '\n' + v.note : '') + '\n[CREDIT ' + d.id + ']', 負責人: PB.me.id, Deadline: addDays(today(), 3), 優先級: '中', 狀態: '待處理' } });
  };
  A.stuNew = () => ui.form('1_學員', { onSaved: (id) => id && openStu(id) });
  A.stuEdit = (d) => ui.form('1_學員', { id: d.id });
  A.stuFamily = (d) => ui.form('1_學員', { values: { 管理人: d.id, 與管理人關係: '子女', 身分: str((PB.get('1_學員', d.id) || {})['身分']) }, title: '新增家人（' + m.stuName(d.id) + ' 代管）' });
  A.merge = async (d) => {
    const v = await ui.ask('合併學員：' + m.stuName(d.id), '這筆的報名、帳務、堂數會搬到你選的學員，這筆改為「流失」。兩筆都有綁 LINE 時系統不會合併。', { fields: [{ k: 'to', label: '合併到', t: 'ref', ref: '1_學員', req: true, other: true }], danger: true, ok: '合併' });
    if (!v) return;
    if (!v.to || v.to.charAt(0) === '?' || v.to === d.id) return ui.toast('請從清單選另一位學員', 'bad');
    PB.run('studentMerge', { id: d.id, into: v.to });
  };
  A.leadNew = (d) => ui.form('2_招生跟進', { values: d.stu ? { 學員: d.stu } : {} });
  A.leadEdit = (d) => ui.form('2_招生跟進', { id: d.id });
  A.taskNew = () => ui.form('4_工作任務', {});
  A.taskEdit = (d) => ui.form('4_工作任務', { id: d.id });
  A.taskDone = async (d) => {
    const v = await ui.ask('完成任務', esc(str((PB.get('4_工作任務', d.id) || {})['工作名稱'])), { fields: [{ k: 'r', label: '完成成果', t: 'text' }], ok: '完成' });
    if (v) PB.run('taskDone', { id: d.id, result: v.r });
  };
  A.taskApprove = (d) => PB.run('taskApprove', { id: d.id });
  A.taskReject = async (d) => {
    const v = await ui.ask('退回任務', '', { fields: [{ k: 'n', label: '原因', t: 'text', req: true }], danger: true, ok: '退回' });
    if (v) PB.run('taskApprove', { id: d.id, reject: true, note: v.n });
  };
  A.incNew = () => ui.form('4_異常事件', {});
  A.incEdit = (d) => ui.form('4_異常事件', { id: d.id });

  // ================================================================
  // 社群：發布資訊（公開資訊＋報名連結）
  // ================================================================
  const SRC_PLATFORM = { ig: 'Instagram', fb: 'Facebook', th: 'Threads', line: 'LINE 社群', ad: '廣告', qr: '海報 QR', host: '場主轉發' };
  const SRC_FORM = { post: '貼文', reel: 'Reels', story: '限動', bio: '個人檔案', poster: '海報' };
  function srcCode() { return PB.LS.get('pb:src') || ''; }
  function classStatusWord(c) {
    const x = m.cls(c);
    if (x.st === '籌備中') return x.used >= x.limit ? '目前額滿，可登記候補' : '招生中・達 ' + x.min + ' 人開班（開課日期確定後通知）';
    if (x.st === '確定開課') return '確定開課・' + fmtD(c['開課日期']) + ' 開課' + (x.used >= x.limit ? '・目前額滿，可登記候補' : '');
    return x.st;
  }
  function venueLine(id) {
    const v = PB.get('1_據點', id) || {};
    return str(v['據點名稱']) + (str(v['地址']) ? '（' + str(v['地址']) + '）' : str(v['地點']) ? '（' + str(v['地點']) + '）' : '');
  }
  function postText(type, row, src) {
    if (type === '課程') {
      const c = row;
      const per = str(c['計費方式']) === '每期' && num(c['總堂數']) ? '（每堂 ' + money(num(c['費用']) / num(c['總堂數'])) + '）' : '';
      return ['【課程】' + m.classLabel(c), '地點：' + venueLine(c['據點']), '時間：' + m.classWhen(c) + '・共 ' + num(c['總堂數']) + ' 堂', c['程度'] ? '程度：' + m.levelName(c['程度']) : '', '費用：' + money(c['費用']) + '／' + (str(c['計費方式']) === '每小時' ? '小時' : '期') + per, '狀態：' + classStatusWord(c), '報名：' + m.signupUrl('課程', c['班級ID'], src)].filter(Boolean).join('\n');
    }
    const g = row;
    const x = m.game(g);
    const lv = split(g['程度']).map(m.levelName).join('、');
    const kind = str(g['球敘類型']) === '新手場' ? '新手場（不限程度）' : str(g['球敘類型']) === '分級' ? '分級：' + lv + ' 以上' : str(g['球敘類型']) === 'DUPR' ? 'DUPR ' + str(g['DUPR下限']) + '–' + str(g['DUPR上限']) : '不限程度';
    return ['【球敘】' + fmtD(g['日期']) + ' ' + m.hm(g['開始時間'], g['結束時間']) + (str(g['球敘名稱']) ? '｜' + g['球敘名稱'] : ''), '地點：' + venueLine(g['據點']), '類型：' + kind, '費用：每人 ' + money(g['費用']), '名額：' + (x.st === '已額滿' || x.left <= 0 ? '目前額滿，可登記候補' : '剩 ' + x.left + ' 位'), '報名：' + m.signupUrl('球敘', g['球敘ID'], src)].join('\n');
  }
  const Publish = {
    id: 'publish', label: '發布資訊', icon: 'mega', show: isSocial,
    render(p) {
      const t = today();
      const src = srcCode();
      const cls = PB.rows('2_課程班級').filter((c) => ['籌備中', '確定開課'].indexOf(str(c['課程狀態'])) >= 0).sort((a, b) => byKey(day(a['開課日期']), day(b['開課日期'])));
      const gs = PB.rows('2_球敘場次').filter((g) => day(g['日期']) >= t && day(g['日期']) <= addDays(t, 30) && ['開放報名', '已額滿'].indexOf(str(g['狀態'])) >= 0).sort((a, b) => byKey(day(a['日期']) + str(a['開始時間']), day(b['日期']) + str(b['開始時間'])));
      const builder = '<div class="card" style="padding:12px 14px"><div class="fld-row">' +
        '<div class="fld"><label>平台</label><select id="srcP">' + Object.keys(SRC_PLATFORM).map((k) => '<option value="' + k + '"' + (src.indexOf(k + '_') === 0 ? ' selected' : '') + '>' + k + '｜' + SRC_PLATFORM[k] + '</option>').join('') + '</select></div>' +
        '<div class="fld"><label>形式</label><select id="srcF">' + Object.keys(SRC_FORM).map((k) => '<option value="' + k + '"' + (src.split('_')[1] === k ? ' selected' : '') + '>' + k + '｜' + SRC_FORM[k] + '</option>').join('') + '</select></div></div>' +
        '<div class="ptop" style="margin:4px 0 0"><div class="fld" style="margin:0;flex:1"><label>這篇內容的來源碼</label><input id="srcCode" value="' + esc(src) + '" placeholder="例：ig_reel_1105"></div>' + ui.btn('依平台＋今天產生', 'srcMake', {}, '') + ui.btn('套用', 'srcSet', {}, 'pri') + '</div>' +
        '<p class="mut" style="font-size:.8rem;margin:6px 0 0">每篇內容一個來源碼（平台_形式_月日，小寫英數與底線）；同一篇的不同場次用同一個來源碼。成效頁會依來源碼統計報名。</p></div>';
      const check = '<details style="margin:10px 0"><summary class="mut">發布前檢核</summary><div class="card" style="padding:10px 14px;font-size:.88rem"><ul style="margin:0;padding-left:18px">' +
        ['日期＋星期對得上；時間寫開始～結束', '據點完整名稱（不要只寫簡稱）；土城的公開貼文不寫學校名稱，寫「永寧捷運站步行約 7 分鐘」', '程度與類型（新手場、分級、DUPR、基礎班…）', '費用：球敘每人每場；課程每堂 × 堂數＝整期', '籌備中只能寫「招生中、達人數後開班」，不能寫已開班或開課日', '新產品、價格、異動一定先給行政客服看過', '不寫銀行帳號、個人電話、學員全名或未同意的照片'].map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div></details>';
      const item = (type, r) => {
        const isC = type === '課程';
        const title = isC ? m.classLabel(r) + '｜' + m.venueName(r['據點']) : fmtD(r['日期']) + ' ' + m.hm(r['開始時間'], r['結束時間']) + '｜' + m.venueName(r['據點']);
        const sub = isC ? m.classWhen(r) + '・' + classStatusWord(r) : m.gameLabel(r) + '・' + money(r['費用']) + '・' + (m.game(r).left > 0 ? '剩 ' + m.game(r).left + ' 位' : '額滿');
        const id = isC ? r['班級ID'] : r['球敘ID'];
        return row({ t: esc(title), s: esc(sub), r: btn('複製貼文資訊', 'copyPost', { type: type, id: id }, 'pri', 'copy') + btn('複製連結', 'copyLinkSrc', { type: type, id: id }, '', 'link') });
      };
      return '<div class="ptop"><h1>發布資訊</h1></div>' + builder + check +
        (src ? '<div class="note" style="margin:8px 0">目前來源碼：<b>' + esc(src) + '</b>（複製的連結都會帶這個來源碼）</div>' : '<div class="note warn" style="margin:8px 0">還沒設定來源碼：複製的連結不會記錄來源</div>') +
        sec('招生中的課程', cls.length) + card(cls.map((c) => item('課程', c)).join('') || ui.empty('目前沒有招生中的課程')) +
        sec('30 天內開放報名的球敘', gs.length) + card(gs.map((g) => item('球敘', g)).join('') || ui.empty('目前沒有開放報名的球敘'));
    },
  };
  A.srcMake = () => {
    const pf = document.getElementById('srcP').value;
    const fm = document.getElementById('srcF').value;
    document.getElementById('srcCode').value = pf + '_' + fm + '_' + today().slice(5).replace('-', '');
  };
  A.srcSet = () => {
    const v = str(document.getElementById('srcCode').value).toLowerCase();
    if (v && !/^[a-z0-9_]+$/.test(v)) return ui.toast('來源碼只能用小寫英文、數字、底線', 'bad');
    PB.LS.set('pb:src', v);
    PB.render();
    ui.toast(v ? '來源碼：' + v : '已清除來源碼');
  };
  A.copyPost = (d) => {
    const r = d.type === '課程' ? PB.get('2_課程班級', d.id) : PB.get('2_球敘場次', d.id);
    PB.copy(postText(d.type, r, srcCode()), '貼文資訊');
  };
  A.copyLinkSrc = (d) => PB.copy(m.signupUrl(d.type, d.id, srcCode()), '報名連結' + (srcCode() ? '（' + srcCode() + '）' : ''));

  // ================================================================
  // 社群：來源成效
  // ================================================================
  const Sources = {
    id: 'sources', label: '來源成效', icon: 'chart', show: isSocial,
    render(p) {
      const mon = p.m || today().slice(0, 7);
      const sigs = PB.rows('2_報名').filter((r) => str(r['報名時間']).slice(0, 7) === mon && str(r['報名狀態']) !== '現場待確認');
      const by = {};
      sigs.forEach((r) => {
        const k = str(r['來源代碼']) || '（未帶來源碼）';
        const o = (by[k] = by[k] || { k: k, n: 0, ok: 0, cancel: 0, nw: 0, cls: 0, game: 0, targets: {} });
        o.n += 1;
        if (str(r['報名狀態']) === '已取消') o.cancel += 1; else o.ok += 1;
        if (r['是否新人'] === true) o.nw += 1;
        if (str(r['報名類型']) === '課程') o.cls += 1; else o.game += 1;
        const tk = m.sigTarget(r);
        o.targets[tk] = (o.targets[tk] || 0) + 1;
      });
      const list = Object.keys(by).map((k) => by[k]).sort((a, b) => b.ok - a.ok);
      const months = uniq(PB.rows('2_報名').map((r) => str(r['報名時間']).slice(0, 7)).filter(Boolean).concat([today().slice(0, 7)])).sort().reverse().slice(0, 12);
      const plat = (k) => SRC_PLATFORM[k.split('_')[0]] || '';
      return '<div class="ptop"><h1>來源成效</h1><span class="sp"></span><select class="btn" data-input="srcMonth">' + months.map((x) => '<option' + (x === mon ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
        '<div class="kpis"><div class="kpi"><div class="l">' + mon + ' 報名</div><div class="v">' + sigs.length + '</div></div><div class="kpi"><div class="l">有效（未取消）</div><div class="v">' + sum(list, (o) => o.ok) + '</div></div><div class="kpi"><div class="l">新人</div><div class="v">' + sum(list, (o) => o.nw) + '</div></div><div class="kpi"><div class="l">帶來源碼的比例</div><div class="v">' + (sigs.length ? Math.round((sigs.filter((r) => str(r['來源代碼'])).length / sigs.length) * 100) : 0) + '%</div></div></div>' +
        sec('依來源碼', list.length + ' 個') + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>來源碼</th><th>平台</th><th class="num">報名</th><th class="num">有效</th><th class="num">新人</th><th class="num">課程</th><th class="num">球敘</th><th>帶來的場次</th></tr></thead><tbody>' +
        (list.map((o) => '<tr><td><b>' + esc(o.k) + '</b></td><td>' + esc(plat(o.k)) + '</td><td class="num">' + o.n + '</td><td class="num">' + o.ok + '</td><td class="num">' + o.nw + '</td><td class="num">' + o.cls + '</td><td class="num">' + o.game + '</td><td style="white-space:normal;min-width:220px;font-size:.82rem">' + esc(Object.keys(o.targets).map((t) => t + ' ×' + o.targets[t]).join('；')) + '</td></tr>').join('') || '<tr><td colspan="8" class="mut">這個月還沒有報名</td></tr>') +
        '</tbody></table></div><p class="mut" style="font-size:.8rem">只統計報名紀錄上的來源碼（不含學員個資）；成交以「有效」為準，不看粉絲數。</p>';
    },
  };
  PB.inputs.srcMonth = (v) => PB.setParam('m', v);


  // ================================================================
  // 知識庫（v2）：讀「客服知識庫」試算表（按了才讀；本機保存，下次先顯示）＋文件中心
  // 試算表新增欄位或分頁不用改程式：已知分頁有專用畫面，其他分頁照欄名顯示
  // ================================================================
  const KB = { data: null, err: '', busy: false, at: 0 };
  const KB_KEY = 'pb:kb';
  const KB_ST = { 可用: 'ok', 查詢: 'info', 轉人工: 'warn', 規劃: '' };
  const KB_TABS = [['faq', '問答'], ['tpl', '訊息模板'], ['info', '價格與據點'], ['rules', '準則與轉人工'], ['docs', '文件']];
  const KB_KNOWN = ['問答', '訊息模板', '價格', '據點', '準則', '轉人工', '設定'];
  try { const c = JSON.parse(PB.LS.get(KB_KEY) || 'null'); if (c && c.tabs) KB.data = c; } catch (e) { /* 忽略 */ }
  const kbTab = (n) => (KB.data && KB.data.tabs[n]) || [];
  async function kbLoad(fresh) {
    if (KB.busy || !PB.cfg.kb) return;
    KB.busy = true;
    if (!KB.data) PB.render();
    const r = await PB.read('kb', { ver: KB.data && !fresh ? KB.data.ver : '', fresh: !!fresh });
    KB.busy = false;
    KB.at = Date.now();
    if (r && !r.same) { KB.data = r; KB.err = ''; PB.LS.set(KB_KEY, JSON.stringify(r)); }
    if (!r && !KB.data) KB.err = '知識庫讀取失敗，請按重新讀取';
    if (fresh && r) ui.toast('已重新讀取知識庫');
    if (PB.params && location.hash.indexOf('#/kb') === 0) PB.render();
  }
  const kbShow = () => !!PB.cfg.kb || PB.has('4_文件');
  const hit = (o, kw) => !kw || Object.keys(o).map((k) => str(o[k])).join(' ').toLowerCase().indexOf(kw) >= 0;
  const nl = (t) => esc(t).replace(/\n/g, '<br>');
  const kbSet = (k) => str((kbTab('設定').find((r) => str(r['項目']) === k) || {})['內容']);
  const callout = (t) => (t ? '<div class="kb-call">' + nl(t) + '</div>' : '');
  const copyBtn = (tab, i) => btn('複製', 'kbCopy', { tab: tab, i: i }, 'ghost', 'copy');

  const Kb = {
    id: 'kb', label: '知識庫', icon: 'kb', show: kbShow,
    render(p) {
      if (PB.cfg.kb && !KB.busy && Date.now() - KB.at > 5 * 60000) setTimeout(() => kbLoad(false), 0);
      const tab = KB_TABS.some((t) => t[0] === p.tab) ? p.tab : (PB.cfg.kb ? 'faq' : 'docs');
      const extra = KB.data ? KB.data.order.filter((n) => KB_KNOWN.indexOf(n) < 0) : [];
      const tabs = KB_TABS.filter((t) => (t[0] === 'docs' ? PB.has('4_文件') : PB.cfg.kb)).concat(extra.map((n) => ['x:' + n, n]));
      const cur = p.tab && p.tab.indexOf('x:') === 0 && extra.indexOf(p.tab.slice(2)) >= 0 ? p.tab : tab;
      const ver = (kbTab('設定').find((r) => str(r['項目']) === '版本說明') || {})['內容'];
      const head = '<div class="ptop"><h1>知識庫</h1><span class="sp"></span>' +
        (PB.cfg.kb ? '<span class="mut" style="font-size:.8rem">' + (KB.busy ? '讀取中…' : KB.data ? '資料 ' + esc(str(KB.data.at).slice(5, 16)) : '') + '</span>' + ui.btn('重新讀取', 'kbReload', {}, 'sm ghost', 'refresh') : '') + '</div>' +
        (ver ? '<p class="mut" style="margin:-6px 0 10px;font-size:.82rem">' + esc(ver) + '｜內部使用，勿轉貼給學員</p>' : '') +
        '<div class="chips" style="margin-bottom:12px">' + tabs.map((t) => '<button class="chip' + (t[0] === cur ? ' on' : '') + '" data-act="kbTab" data-v="' + esc(t[0]) + '">' + esc(t[1]) + '</button>').join('') + '</div>';
      if (cur === 'docs') return head + kbDocs(p);
      if (!PB.cfg.kb) return head + '<div class="err-box">尚未設定知識庫試算表（請特助在 API 專案設定 KB_SHEET_ID）</div>';
      if (!KB.data) return head + (KB.err ? '<div class="err-box">' + esc(KB.err) + '</div>' : '<div class="loading"><span class="spin"></span>讀取知識庫…</div>');
      const kw = str(p.q).toLowerCase();
      const search = '<label class="search kb-search">' + PB.icon('search') + '<input placeholder="搜尋問題、回覆、關鍵字" value="' + esc(p.q || '') + '" data-input="kbSearch"></label>';
      if (cur === 'faq') return head + ui.safe(() => kbFaq(p, kw, search), '問答');
      if (cur === 'tpl') return head + ui.safe(() => kbTpl(kw, search), '訊息模板');
      if (cur === 'info') return head + ui.safe(() => kbInfo(kw, search), '價格與據點');
      if (cur === 'rules') return head + ui.safe(() => kbRules(), '準則與轉人工');
      return head + ui.safe(() => kbGeneric(cur.slice(2), kw, search), cur.slice(2));
    },
  };
  function kbFaq(p, kw, search) {
    const all = kbTab('問答');
    const cats = uniq(all.map((r) => str(r['分類'])).filter(Boolean));
    const list = all.map((r, i) => ({ r: r, i: i })).filter((o) => (!p.cat || str(o.r['分類']) === p.cat) && (!p.st || str(o.r['狀態']) === p.st) && hit(o.r, kw));
    const chip = (k, v, label, n) => '<button class="chip' + (str(p[k]) === v ? ' on' : '') + '" data-act="param" data-k="' + k + '" data-v="' + esc(str(p[k]) === v ? '' : v) + '">' + esc(label) + (n !== undefined ? '<span class="c">' + n + '</span>' : '') + '</button>';
    return '<div class="ptop">' + search + '<span class="sp"></span><span class="mut">' + list.length + ' 題</span></div>' +
      '<div class="chips" style="margin-bottom:6px">' + cats.map((c) => chip('cat', c, c, all.filter((r) => str(r['分類']) === c).length)).join('') + '</div>' +
      '<div class="chips" style="margin-bottom:12px">' + Object.keys(KB_ST).map((x) => chip('st', x, x)).join('') + '</div>' +
      (p.st && kbSet('狀態說明｜' + p.st) ? '<p class="mut" style="margin:-4px 0 10px;font-size:.84rem"><span class="badge ' + (KB_ST[p.st] || '') + '">' + esc(p.st) + '</span> ' + esc(kbSet('狀態說明｜' + p.st)) + '</p>' : '') +
      card(list.map((o) => {
        const r = o.r;
        const st = str(r['狀態']);
        return '<div class="kb-item"><div class="kb-q"><div class="kb-t"><b>' + esc(r['問題']) + '</b> ' + (st ? '<span class="badge ' + (KB_ST[st] || '') + '">' + esc(st) + '</span>' : '') + ' <span class="mut" style="font-size:.78rem">' + esc(str(r['編號']) + (str(r['分類']) ? '・' + str(r['分類']) : '')) + '</span></div>' + (str(r['回覆']) ? copyBtn('問答', o.i) : '') + '</div>' +
          (str(r['回覆']) ? '<div class="kb-a">' + nl(r['回覆']) + '</div>' : '') +
          (str(r['內部備註']) ? '<div class="kb-n">內部：' + nl(r['內部備註']) + '</div>' : '') + '</div>';
      }).join('') || ui.empty('找不到符合的問答', '換個關鍵字，或清除分類／狀態篩選'));
  }
  function kbTpl(kw, search) {
    const list = kbTab('訊息模板').map((r, i) => ({ r: r, i: i })).filter((o) => hit(o.r, kw));
    return '<div class="ptop">' + search + '<span class="sp"></span><span class="mut">' + list.length + ' 則</span></div>' + callout(kbSet('提醒｜模板')) +
      card(list.map((o) => '<div class="kb-item"><div class="kb-q"><div class="kb-t"><b>' + esc(o.r['名稱']) + '</b> <span class="mut" style="font-size:.78rem">' + esc(o.r['編號']) + '</span></div>' + copyBtn('訊息模板', o.i) + '</div><div class="kb-a">' + nl(o.r['內容']) + '</div></div>').join('') || ui.empty('找不到符合的模板'));
  }
  function kbTable(rows, cols, cls) {
    if (!rows.length) return ui.empty('沒有資料');
    return '<div class="tbl-wrap"><table class="tbl ' + (cls || '') + '"><thead><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + cols.map((c) => '<td>' + (c === '狀態' && str(r[c]) ? '<span class="badge ' + (KB_ST[str(r[c])] || '') + '">' + esc(r[c]) + '</span>' : nl(r[c])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  const colsOf = (rows, prefer) => uniq(prefer.filter((c) => rows.some((r) => c in r)).concat(rows.reduce((a, r) => a.concat(Object.keys(r)), [])));
  function kbInfo(kw, search) {
    const price = kbTab('價格').filter((r) => hit(r, kw));
    const venue = kbTab('據點').filter((r) => hit(r, kw));
    return '<div class="ptop">' + search + '</div>' + callout(kbSet('提醒｜價格')) +
      sec('價格基準（查核用，對外以報名頁為準）', price.length) + kbTable(price, colsOf(price, ['產品', '目前基準', '狀態', '注意']), 'kb-tbl') +
      sec('據點', venue.length) + kbTable(venue, colsOf(venue, ['據點', '地址與入口', '時段']), 'kb-tbl') + callout(kbSet('提醒｜據點'));
  }
  function kbRules() {
    const rules = kbTab('準則');
    const esc2 = kbTab('轉人工');
    const tpls = kbTab('訊息模板');
    const fi = tpls.findIndex((r) => str(r['編號']) === 'ESC' || str(r['名稱']) === '轉人工格式');
    const stNote = Object.keys(KB_ST).filter((k) => kbSet('狀態說明｜' + k));
    return sec('客服準則', rules.length) + card('<ol class="kb-rules">' + rules.map((r) => '<li>' + nl(r['內容']) + '</li>').join('') + '</ol>') +
      sec('什麼情況交給誰', esc2.length) + kbTable(esc2, colsOf(esc2, ['案件', '客服可以做', '交給誰', '不可以']), 'kb-tbl') +
      (fi >= 0 ? sec('轉人工格式') + card('<div class="kb-item"><div class="kb-q"><div class="kb-t mut">貼給特助／主理人</div>' + copyBtn('訊息模板', fi) + '</div><div class="kb-a">' + nl(tpls[fi]['內容']) + '</div></div>') : '') +
      (stNote.length ? sec('問答狀態') + card(stNote.map((k) => '<div class="kb-item"><span class="badge ' + (KB_ST[k] || '') + '">' + esc(k) + '</span> ' + esc(kbSet('狀態說明｜' + k)) + '</div>').join('')) : '');
  }
  function kbGeneric(name, kw, search) {
    const rows = kbTab(name).filter((r) => hit(r, kw));
    return '<div class="ptop">' + search + '<span class="sp"></span><span class="mut">' + rows.length + ' 筆</span></div>' + kbTable(rows, colsOf(rows, []), 'kb-tbl');
  }
  function kbDocs(p) {
    const kw = str(p.q).toLowerCase();
    const list = PB.rows('4_文件').filter((d) => str(d['連結']) && hit({ a: d['文件名稱'], b: d['類別'], c: d['版本'], e: m.venueName(d['相關據點']) }, kw))
      .sort((a, b) => byKey(str(a['類別']) + str(a['文件名稱']), str(b['類別']) + str(b['文件名稱'])));
    const cats = uniq(list.map((d) => str(d['類別']) || '其他'));
    const t = today();
    return '<div class="ptop"><label class="search kb-search">' + PB.icon('search') + '<input placeholder="文件名稱、類別、據點" value="' + esc(p.q || '') + '" data-input="kbSearch"></label><span class="sp"></span><span class="mut">' + list.length + ' 份</span></div>' +
      (cats.map((c) => sec(c, list.filter((d) => (str(d['類別']) || '其他') === c).length) + card(list.filter((d) => (str(d['類別']) || '其他') === c).map((d) => {
        const exp = day(d['合約到期日']);
        const tag = exp ? (exp < t ? '<span class="badge bad">已到期 ' + esc(fmtD(exp)) + '</span>' : exp <= addDays(t, 30) ? '<span class="badge warn">' + esc(fmtD(exp)) + ' 到期</span>' : '<span class="badge">' + esc(fmtD(exp)) + ' 到期</span>') : '';
        return '<a class="row click" href="' + esc(d['連結']) + '" target="_blank" rel="noopener"><div class="main-c"><div class="t">' + esc(d['文件名稱']) + ' ' + tag + '</div><div class="s">' + esc([str(d['版本']), str(d['相關據點']) ? m.venueName(d['相關據點']) : '', day(d['更新日期']) ? '更新 ' + fmtD(d['更新日期']) : ''].filter(Boolean).join('・')) + '</div></div><div class="r">' + PB.icon('ext') + '</div></a>';
      }).join(''))).join('') || ui.empty('沒有文件', '文件由特助在管理後台新增（只放 Google Drive 連結）'));
  }
  A.kbTab = (d) => PB.go('kb', { tab: d.v });
  A.kbReload = () => kbLoad(true);
  A.kbCopy = (d) => {
    const r = kbTab(d.tab)[Number(d.i)];
    if (r) PB.copy(str(r['回覆'] || r['內容']), d.tab === '問答' ? '回覆' : '模板');
  };
  let kbTimer;
  PB.inputs.kbSearch = (v) => { clearTimeout(kbTimer); kbTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="kbSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };

  // ================================================================
  // 出缺勤事後修正、課程日誌、通知紀錄（v2）
  // ================================================================
  A.attFix = async (d) => {
    const a = d.id ? PB.get('2_出缺勤', d.id) : null;
    const s = PB.get('2_上課場次', a ? a['上課場次'] : d.ses);
    const sid = a ? str(a['學員']) : d.stu;
    const isMk = a && str(a['補課來源']);
    const opts = isMk ? ['補課出席', '缺席'] : ['出席', '缺席', '請假'];
    const cur = a ? str(a['狀態']) : '';
    const rule = '出席、補課出席' + (PB.cfg.deductAbsent !== false ? '、缺席' : '') + '扣 1 堂；請假不扣堂（改成請假後系統會補上補課期限並通知教練）。';
    const v = await ui.ask((a ? '修正出缺勤：' : '補登出缺勤：') + m.stuName(sid), esc(m.sesLabel(s)) + (cur ? '<br>目前：<b>' + esc(cur) + '</b>' : '<br>教練點名時沒有這位學員的紀錄') + '<br><span class="mut">' + esc(rule) + '堂數會一起更新。</span>',
      { fields: [{ k: 'status', label: '改成', t: 'enum', req: true, opts: opts.filter((x) => x !== cur || !a), value: '' }, { k: 'reason', label: '修正原因（會記在備註）', t: 'text', req: true, hint: '例：教練點錯、學員事前已請假' }], ok: a ? '修正' : '補登' });
    if (!v) return;
    PB.run('attendFix', a ? { id: d.id, status: v.status, reason: v.reason } : { sessionId: d.ses, studentId: sid, status: v.status, reason: v.reason });
  };
  A.journal = async (d) => {
    const r = await PB.read('journalGet', { sessionId: d.id });
    if (!r) return;
    const s = PB.get('2_上課場次', d.id);
    const SKIP = ['日誌ID', '上課場次', '教練', '填寫時間', '_students'];
    const body = r.journals.map((j) => '<p class="mut" style="margin:0 0 6px">' + esc(m.staffName(j['教練']) + '・' + fmtDT(j['填寫時間'])) + '</p>' +
      kv(Object.keys(j).filter((k) => SKIP.indexOf(k) < 0 && str(j[k])).map((k) => [k, nl(split(j[k]).length > 1 ? split(j[k]).join('、') : j[k])])) +
      (j._students.length ? '<h4 style="margin:12px 0 6px">個別學員</h4>' + j._students.map((x) => '<div class="kb-item"><b>' + esc(m.stuName(x['學員'])) + '</b>' + (str(x['程度建議']) ? ' <span class="badge info">' + esc(x['程度建議']) + '</span>' : '') + kv(Object.keys(x).filter((k) => ['紀錄ID', '課程日誌', '學員', '程度建議'].indexOf(k) < 0 && str(x[k])).map((k) => [k, nl(x[k])])) + '</div>').join('') : '')).join('<hr>');
    ui.modal({ title: '課程日誌｜' + m.sesLabel(s), body: body || ui.empty('這堂還沒有日誌', '請提醒教練在教練官方帳號填寫；不要代填') });
  };
  A.notifyOf = async (d) => {
    const r = await PB.read('notifyQuery', { student: d.id, limit: 100 });
    if (!r) return;
    const RES = { 成功: 'ok', 失敗: 'bad', 略過: 'warn' };
    const body = '<p class="mut" style="margin:0 0 8px">共 ' + r.total + ' 則' + (r.total > r.rows.length ? '，顯示最近 ' + r.rows.length + ' 則' : '') + '（新到舊）</p>' +
      (r.rows.map((x) => '<div class="kb-item"><div class="kb-q"><b>' + esc(x['通知類型'] || '通知') + '</b> <span class="badge ' + (RES[str(x['發送結果'])] || '') + '">' + esc(x['發送結果']) + '</span><span class="sp"></span><span class="mut" style="font-size:.8rem">' + esc(fmtDT(x['發送時間']) + (str(x['官方帳號']) ? '・' + str(x['官方帳號']) : '')) + '</span></div><div class="kb-a">' + nl(x['內容']) + '</div>' + (str(x['錯誤訊息']) ? '<div class="kb-n">錯誤：' + esc(x['錯誤訊息']) + '</div>' : '') + '</div>').join('') || ui.empty('沒有通知紀錄'));
    ui.modal({ title: '通知紀錄｜' + m.stuName(d.id), body: body });
  };

  // ================================================================
  PB.app({
    app: 'ops',
    title: '營運工作台',
    version: '2.9',
    screens: [Today, Queue, Classes, Games, Students, Kb, Publish, Sources],
    links: () => (!PB.cfg.kb && PB.cfg.kbUrl ? [{ label: '知識庫', url: PB.cfg.kbUrl, icon: 'kb', mobile: true }] : []),
  });
})();
