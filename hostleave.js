/**
 * 理論上匹克球｜營運工作台：場主請假／代班 hostleave.js v4.29（2026/11/24）；v4.30（同日：據點固定場主請假那天、場次直接排給別人的也算已代班，原場主在場主 OA v3.22 看得到）
 * Imperfect 11/24：場主跟行政客服請假，行政客服在這裡登記並指派代班；待處理項目太多，這件事獨立一頁、一眼看懂
 *   上方「＋登記請假」：選場主、日期、原因、代班場主（可先不選）→ 一次換好他那幾天的球敘
 *   ① 還沒安排代班：請假的人還排在場上，或預設場主請假、這場還沒有場主 →「指派代班」
 *   ② 已安排代班：誰請假 → 誰代班；「換代班」「換回原場主」
 *   ③ 請假紀錄：今天以後的場主請假；「撤銷請假」（可一起換回原場主）
 * 代班場主由場主 OA 收到「代班通知」；原場主收到「這場由 X 代班」，排班頁仍看得到名單、可＋名單外報名（場主 OA v3.21）
 * 伺服器：gas/HostLeave.gs
 *
 * v4.35（2026/11/26）：選單改名「請假與可排」，分三頁
 *   場主請假（上面原本的內容）／教練請假（每堂指派代課或停課；Imperfect：代課後原教練不用看得到）／可排時間（Tammy 問怎麼看教練們的排班）
 */
(function () {
  'use strict';
  const { esc, str, split, fmtD, day, today, byKey, ui, m } = PB;
  const A = PB.acts;
  const isOps = () => PB.ws.indexOf('行政客服') >= 0 || PB.ws.indexOf('管理層') >= 0;
  const isMgmt = () => PB.ws.indexOf('管理層') >= 0;
  const btn = (label, act, data, cls, icon) => ui.btn(label, act, data, 'sm ' + (cls || ''), icon);
  const card = (inner) => '<div class="card list">' + inner + '</div>';
  const sec = (title, cnt, hint) => '<div class="sec"><h2>' + esc(title) + '</h2>' + (cnt !== undefined ? '<span class="cnt">' + cnt + '</span>' : '') + '<span class="sp"></span></div>' + (hint ? '<p class="mut" style="font-size:.82rem;margin:-4px 2px 8px">' + hint + '</p>' : '');
  const STATUS = ['草稿', '開放報名', '已額滿'];
  const hm = (v) => str(v).slice(0, 5);
  const dk = (k) => fmtD(k); // 11/30（一）
  const hasCoverCol = () => { const r = PB.rows('2_場主排班')[0]; return !r || '原場主' in r; };

  /** 場主：角色有「場主」或是某個據點的場主；在職 */
  function hostStaff() {
    const role = PB.rows('0_角色').filter((r) => /場主/.test(str(r['角色名稱']))).map((r) => str(r['角色ID']));
    const vh = {};
    PB.rows('1_據點').forEach((v) => split(v['場主']).forEach((id) => { vh[id] = (vh[id] || []).concat(str(v['據點名稱'])); }));
    return PB.rows('1_人員').filter((p) => (!str(p['在職狀態']) || str(p['在職狀態']) === '在職') && (vh[str(p['人員ID'])] || split(p['角色']).some((x) => role.indexOf(x) >= 0)))
      .map((p) => ({ v: str(p['人員ID']), l: str(p['姓名']) + (vh[str(p['人員ID'])] ? '（' + vh[str(p['人員ID'])].join('、') + '）' : '') }))
      .sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));
  }
  const isHost = (pid) => hostStaff().some((x) => x.v === pid);
  const offOn = (pid, k) => PB.rows('2_教練不可排日期').find((r) => str(r['教練']) === pid && day(r['開始日期']) && day(r['開始日期']) <= k && (day(r['結束日期']) || day(r['開始日期'])) >= k) || null;
  const needsHost = (g) => !m.game(g).hostless;
  const venueHost = (vid) => split((PB.get('1_據點', vid) || {})['場主'])[0] || '';
  const locked = (d) => str(d['簽到時間']) ? '已簽到' : str(d['費用結算']) ? '已月結' : Number(d['現場收款金額']) > 0 ? '已有現場收款' : '';

  /** 今天以後的球敘 + 場主排班，分成「還沒安排代班」「已安排代班」 */
  function lists() {
    const t = today();
    const todo = [];
    const done = [];
    const dutyBy = PB.ix.dutyByGame || {};
    PB.rows('2_球敘場次').forEach((g) => {
      const k = day(g['日期']);
      if (k < t || STATUS.indexOf(str(g['狀態'])) < 0 || !needsHost(g)) return;
      const duties = dutyBy[str(g['球敘ID'])] || [];
      duties.forEach((d) => {
        const pid = str(d['人員']);
        if (str(d['原場主'])) done.push({ g: g, d: d, k: k, orig: str(d['原場主']), sub: pid });
        else { const off = offOn(pid, k); if (off && isHost(pid)) todo.push({ g: g, d: d, k: k, orig: pid, off: off }); }
      });
      if (!duties.length) { const vh = venueHost(g['據點']); const off = vh && offOn(vh, k); if (off) todo.push({ g: g, d: null, k: k, orig: vh, off: off }); }
      // v4.30：據點固定場主（1_據點.場主 有列）那天請假、場次直接排給別人（沒記原場主）→ 也算已代班
      else {
        const hosts = duties.map((d) => str(d['人員']));
        const origs = duties.map((d) => str(d['原場主']));
        const vhs = split((PB.get('1_據點', g['據點']) || {})['場主']).filter((h) => hosts.indexOf(h) < 0 && origs.indexOf(h) < 0 && offOn(h, k));
        if (vhs.length) done.push({ g: g, d: duties[0], k: k, orig: vhs[0], sub: hosts[0], implicit: true });
      }
    });
    const sort = (a, b) => byKey(a.k + hm(a.g['開始時間']), b.k + hm(b.g['開始時間']));
    return { todo: todo.sort(sort), done: done.sort(sort) };
  }

  const gameT = (g) => esc(m.venueName(g['據點'])) + '・' + esc(m.gameLabel(g));
  const when = (x) => dk(x.k) + '<br>' + esc(hm(x.g['開始時間']) + '–' + hm(x.g['結束時間']));

  const HostTab = {
    render() {
      const L = lists();
      const t = today();
      const leaves = PB.rows('2_教練不可排日期').filter((r) => isHost(str(r['教練'])) && (day(r['結束日期']) || day(r['開始日期'])) >= t)
        .sort((a, b) => byKey(day(a['開始日期']), day(b['開始日期'])));
      const warn = hasCoverCol() ? '' : '<div class="note warn" style="margin-bottom:10px">2_場主排班 還沒有「原場主」欄：請先在試算表加這一欄，才能指派代班。</div>';
      const todoRows = L.todo.map((x) => row({
        when: when(x), id: x.g['球敘ID'],
        t: gameT(x.g) + ' <span class="badge bad">還沒安排代班</span>',
        s: esc(m.staffName(x.orig)) + ' 請假' + (str(x.off['原因']) ? '（' + esc(str(x.off['原因'])) + '）' : '') + (x.d ? '' : '・這場還沒有場主'),
        r: x.d && locked(x.d) ? '<span class="mut">' + esc(locked(x.d)) + '</span>' : btn('指派代班', 'hlAssign', { gid: x.g['球敘ID'], duty: x.d ? x.d['排班ID'] : '', orig: x.orig }, 'pri'),
      })).join('');
      const doneRows = L.done.map((x) => row({
        when: when(x), id: x.g['球敘ID'],
        t: gameT(x.g),
        s: esc(m.staffName(x.orig)) + ' 請假 → <b>' + esc(m.staffName(x.sub)) + '</b> 代班' + (x.implicit ? ' <span class="mut">（排課時直接排）</span>' : '') + (str(x.d['簽到時間']) ? ' <span class="badge ok">已到場</span>' : ''),
        r: locked(x.d) ? '<span class="mut">' + esc(locked(x.d)) + '</span>' : btn('換代班', 'hlAssign', { gid: x.g['球敘ID'], duty: x.d['排班ID'], orig: x.orig }, 'ghost') + btn('換回原場主', 'hlUndo', { duty: x.d['排班ID'], gid: x.g['球敘ID'], orig: x.orig }, 'ghost'),
      })).join('');
      const leaveRows = leaves.map((r) => {
        const a = day(r['開始日期']);
        const b = day(r['結束日期']) || a;
        const pid = str(r['教練']);
        const nTodo = L.todo.filter((x) => x.orig === pid && x.k >= a && x.k <= b).length;
        const nDone = L.done.filter((x) => x.orig === pid && x.k >= a && x.k <= b).length;
        return row({
          when: dk(a) + (a === b ? '' : '<br>～' + dk(b)),
          t: esc(m.staffName(pid)) + (str(r['原因']) ? '　<span class="mut">' + esc(str(r['原因'])) + '</span>' : ''),
          s: (nDone ? nDone + ' 場已代班' : '') + (nDone && nTodo ? '・' : '') + (nTodo ? '<b style="color:var(--bad)">' + nTodo + ' 場還沒安排</b>' : '') + (!nDone && !nTodo ? '這段期間沒有他的場次' : ''),
          r: (nTodo ? btn('一起指派', 'hlAddFor', { staff: pid, a: a, b: b }, 'ghost') : '') + btn('撤銷請假', 'hlDel', { id: r['ID'] }, 'ghost'),
        });
      }).join('');
      return '<div class="ptop"><span class="sp"></span>' + btn('登記場主請假', 'hlAdd', {}, 'pri', 'plus') + '</div>' + warn +
        '<p class="mut" style="font-size:.85rem;margin:0 2px 12px">場主跟你請假 → 按「登記請假」，選代班場主就一次換好。代班場主會在場主 OA 收到代班通知；原場主的排班頁仍看得到這幾場的報名名單，也能＋名單外報名。點名、收款、場主費都算代班場主。</p>' +
        sec('還沒安排代班', L.todo.length, '請假的人還排在場上，或據點預設場主請假、這場還沒有場主（系統不會自動排）') +
        card(todoRows || ui.empty('沒有要處理的 👍', '')) +
        sec('已安排代班', L.done.length) + card(doneRows || ui.empty('目前沒有代班', '')) +
        sec('請假紀錄（今天以後）', leaves.length, '場主自己在場主 OA「可排時間」登記的不可排日期也會列在這裡；同時是教練的人，請假也會出現在「教練請假」') + card(leaveRows || ui.empty('沒有請假', ''));
    },
  };

  function row(o) {
    return '<div class="row' + (o.id ? ' click" data-act="hlOpen" data-id="' + esc(o.id) : '') + '">' +
      (o.when !== undefined ? '<div class="when">' + o.when + '</div>' : '') +
      '<div class="main-c"><div class="t">' + (o.t || '') + '</div>' + (o.s ? '<div class="s">' + o.s + '</div>' : '') + '</div>' +
      (o.r ? '<div class="r" data-stop>' + o.r + '</div>' : '') + '</div>';
  }
  A.hlOpen = (d) => (d && d.id && A.openGame ? A.openGame(d) : null); // 點一列 → 球敘明細（ops.js）

  /** 代班人選：在職場主；同時段在別的據點、這天也請假的標出來 */
  function subChoices(games, except) {
    return hostStaff().filter((x) => x.v !== except).map((x) => {
      const why = [];
      games.forEach((g) => {
        const k = day(g['日期']);
        if (offOn(x.v, k)) why.push(dk(k) + ' 也請假');
        const busy = PB.rows('2_場主排班').filter((d) => str(d['人員']) === x.v && str(d['球敘']) !== str(g['球敘ID'])).map((d) => PB.get('2_球敘場次', d['球敘']))
          .find((o) => o && str(o['狀態']) !== '取消' && day(o['日期']) === k && str(o['據點']) !== str(g['據點']) && hm(o['開始時間']) < hm(g['結束時間']) && hm(g['開始時間']) < hm(o['結束時間']));
        if (busy) why.push(dk(k) + ' 同時段在' + m.venueName(busy['據點']));
      });
      return { v: x.v, l: x.l + (why.length ? '　⚠ ' + uniq(why).slice(0, 2).join('、') : ''), bad: why.length > 0 };
    }).sort((a, b) => (a.bad === b.bad ? 0 : a.bad ? 1 : -1));
  }
  const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);

  /** 請假期間會受影響的球敘（畫面先算給行政看；伺服器會再算一次） */
  function affected(pid, a, b) {
    const t = today();
    const from = a < t ? t : a;
    const dutyBy = PB.ix.dutyByGame || {};
    return PB.rows('2_球敘場次').filter((g) => {
      const k = day(g['日期']);
      if (k < from || k > b || STATUS.indexOf(str(g['狀態'])) < 0 || !needsHost(g)) return false;
      const ds = dutyBy[str(g['球敘ID'])] || [];
      return ds.some((d) => str(d['人員']) === pid) || (!ds.length && venueHost(g['據點']) === pid);
    }).sort((x, y) => byKey(day(x['日期']) + hm(x['開始時間']), day(y['日期']) + hm(y['開始時間'])));
  }

  async function addLeave(pre) {
    pre = pre || {};
    const hosts = hostStaff();
    if (!hosts.length) return ui.toast('沒有在職的場主', 'bad');
    const v = await ui.ask(pre.staff ? '指派代班：' + m.staffName(pre.staff) : '登記場主請假', '場主跟你請假時在這裡登記。選了代班場主，這段期間排給他的球敘會一次換好。', {
      fields: [
        { k: 'staff', label: '請假的場主', t: 'enum', req: true, opts: hosts.map((x) => x.l), value: pre.staff ? (hosts.find((x) => x.v === pre.staff) || {}).l : '' },
        { k: 'start', label: '開始日期', t: 'date', req: true, value: pre.a || today() },
        { k: 'end', label: '結束日期（只請一天可以不填）', t: 'date', value: pre.b || '' },
        { k: 'reason', label: '原因（選填）', t: 'text', value: '' },
      ],
      ok: '下一步',
    });
    if (!v) return null;
    const staff = (hosts.find((x) => x.l === v.staff) || {}).v;
    const a = v.start;
    const b = v.end || v.start;
    if (b < a) return ui.toast('結束日期不能早於開始日期', 'bad');
    const games = affected(staff, a, b);
    const list = games.map((g) => '・' + esc(fmtD(day(g['日期'])) + ' ' + hm(g['開始時間']) + '　' + m.venueName(g['據點']) + '・' + m.gameLabel(g))).join('<br>');
    const subs = subChoices(games, staff);
    const fields = games.length ? [{ k: 'sub', label: '代班場主', t: 'enum', req: true, opts: ['（先不指派）'].concat(subs.map((x) => x.l)), value: '（先不指派）', hint: '⚠ 的人那天有狀況，選了系統會跳過那幾場並告訴你' }] : [];
    if (games.length && isMgmt()) fields.push({ k: 'force', label: '同時段在別的據點也照樣指派（管理層）', t: 'bool' });
    const v2 = await ui.ask('確認：' + m.staffName(staff) + ' 請假 ' + fmtD(a) + (a === b ? '' : '～' + fmtD(b)),
      games.length ? '這段期間他有 <b>' + games.length + '</b> 場：<br>' + list : '這段期間沒有排給他的球敘（之後開的球敘，系統不會自動排他）。', { fields: fields, ok: '登記' });
    if (!v2) return null;
    const pick = subs.find((x) => x.l === v2.sub);
    return PB.run('hostLeaveAdd', { staff: staff, start: a, end: b, reason: v.reason, sub: pick ? pick.v : '', force: v2.force === true });
  }
  A.hlAdd = () => addLeave();
  A.hlAddFor = (d) => addLeave({ staff: d.staff, a: d.a, b: d.b });

  A.hlAssign = async (d) => {
    const g = PB.get('2_球敘場次', d.gid);
    if (!g) return null;
    const du = d.duty ? PB.get('2_場主排班', d.duty) : null;
    const cur = du ? str(du['人員']) : '';
    const subs = subChoices([g], d.orig).filter((x) => x.v !== cur);
    const fields = [{ k: 'sub', label: '代班場主', t: 'enum', req: true, opts: subs.map((x) => x.l) }];
    if (isMgmt()) fields.push({ k: 'force', label: '同時段在別的據點也照樣指派（管理層）', t: 'bool' });
    const v = await ui.ask((cur && cur !== d.orig ? '換代班：' : '指派代班：') + m.gameLabel(g),
      esc(fmtD(day(g['日期'])) + ' ' + hm(g['開始時間']) + '–' + hm(g['結束時間']) + '・' + m.venueName(g['據點'])) + '<br>原場主：' + esc(m.staffName(d.orig)) + (cur && cur !== d.orig ? '　目前代班：' + esc(m.staffName(cur)) : '') +
      '<br>代班場主會在場主 OA 收到代班通知（約幾分鐘內）。', { fields: fields, ok: '確定' });
    if (!v) return null;
    const pick = subs.find((x) => x.l === v.sub);
    if (!pick) return null;
    return PB.run('hostCoverSet', { gid: d.gid, duty: d.duty || '', orig: d.orig, sub: pick.v, force: v.force === true });
  };
  A.hlUndo = (d) => {
    const du = PB.get('2_場主排班', d.duty);
    if (!du) return null;
    const orig = str(du['原場主']) || d.orig; // v4.30：排課時直接排的沒有原場主欄
    const conf = { confirm: { title: '換回原場主：' + m.staffName(orig), text: '代班的 ' + esc(m.staffName(du['人員'])) + ' 會收到「排班取消」，' + esc(m.staffName(orig)) + ' 收到排班通知。', ok: '換回' } };
    return str(du['原場主']) ? PB.run('hostCoverUndo', { duty: d.duty }, conf) : PB.run('hostCoverSet', { gid: d.gid, duty: d.duty, orig: orig, sub: orig }, conf);
  };
  A.hlDel = async (d) => {
    const r = PB.get('2_教練不可排日期', d.id);
    if (!r) return null;
    const pid = str(r['教練']);
    const a = day(r['開始日期']);
    const b = day(r['結束日期']) || a;
    const n = lists().done.filter((x) => x.orig === pid && x.k >= a && x.k <= b).length;
    const v = await ui.ask('撤銷請假：' + m.staffName(pid), fmtD(a) + (a === b ? '' : '～' + fmtD(b)) + (n ? '<br>這段期間有 ' + n + ' 場已由別人代班。' : ''), {
      fields: n ? [{ k: 'restore', label: '還沒開始的代班換回 ' + m.staffName(pid), t: 'bool', value: true }] : [], danger: true, ok: '撤銷',
    });
    if (!v) return null;
    return PB.run('hostLeaveDel', { id: d.id, restore: v.restore === true });
  };

  // ================================================================
  // v4.35 教練請假／代課（伺服器 coachLeaveAdd；單堂沿用 sessionCoach／sessionCancel，帶 leaveOf 記備註）
  // ================================================================
  const SES_CLASS_SKIP = ['取消', '未成班', '已結束'];
  const inService = (pid) => { const p = PB.get('1_人員', pid); return !!p && (!str(p['在職狀態']) || str(p['在職狀態']) === '在職'); };
  function coachStaff() {
    return PB.rows('1_人員_教練').map((c) => str(c['人員ID'])).filter((id) => id && inService(id))
      .map((id) => ({ v: id, l: m.staffName(id) })).sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));
  }
  const isCoach = (pid) => !!PB.get('1_人員_教練', pid);
  const coverNote = (pid) => '代課：原教練 ' + m.staffName(pid) + ' 請假';
  const stopNote = (pid) => '停課：教練 ' + m.staffName(pid) + ' 請假';
  const sesLocked = (s) => (str(s['點名確認時間']) ? '已點名' : str(s['費用結算']) ? '已月結' : '');
  const classOf = (s) => PB.get('2_課程班級', s['班級']);
  const liveSes = (s) => { const c = classOf(s); return !!c && SES_CLASS_SKIP.indexOf(str(c['課程狀態'])) < 0; };
  const sesSort = (a, b) => byKey(day(a['日期']) + hm(a['開始時間']), day(b['日期']) + hm(b['開始時間']));

  /** 教練請假：todo＝請假那天還排他上的課；done＝請假期間已代課／已停課的（看備註） */
  function coachLists() {
    const t = today();
    const todo = [];
    const done = [];
    PB.rows('2_上課場次').forEach((s) => {
      const k = day(s['日期']);
      if (k < t || str(s['場次狀態']) !== '預定' || !liveSes(s)) return;
      const pid = str(s['授課教練']);
      const off = pid && isCoach(pid) ? offOn(pid, k) : null;
      if (off) todo.push({ s: s, k: k, orig: pid, off: off });
    });
    PB.rows('2_教練不可排日期').filter((r) => isCoach(str(r['教練'])) && (day(r['結束日期']) || day(r['開始日期'])) >= t).forEach((r) => {
      const pid = str(r['教練']);
      const a = day(r['開始日期']);
      const b = day(r['結束日期']) || a;
      PB.rows('2_上課場次').forEach((s) => {
        const k = day(s['日期']);
        if (k < t || k < a || k > b) return;
        const note = str(s['備註']);
        if (str(s['場次狀態']) === '預定' && note.indexOf(coverNote(pid)) >= 0 && str(s['授課教練']) !== pid) done.push({ s: s, k: k, orig: pid, sub: str(s['授課教練']) });
        else if (str(s['場次狀態']) === '取消' && note.indexOf(stopNote(pid)) >= 0) done.push({ s: s, k: k, orig: pid, stop: true });
      });
    });
    const uniqBy = (list) => list.filter((x, i) => list.findIndex((y) => y.s === x.s) === i);
    return { todo: todo.sort((a, b) => sesSort(a.s, b.s)), done: uniqBy(done).sort((a, b) => sesSort(a.s, b.s)) };
  }
  const sesT = (s) => { const c = classOf(s); return esc(m.venueName(s['據點'])) + '・' + esc(m.classLabel(c)) + (c && m.isSingle(c) ? ' <span class="badge">專項</span>' : ''); };
  const sesWhen = (x) => dk(x.k) + '<br>' + esc(hm(x.s['開始時間']) + '–' + hm(x.s['結束時間']));
  const formedTxt = (s) => { const c = classOf(s); return !!c && ['確定開課', '進行中'].indexOf(str(c['課程狀態'])) >= 0; };

  const CoachTab = {
    render() {
      const L = coachLists();
      const t = today();
      const leaves = PB.rows('2_教練不可排日期').filter((r) => isCoach(str(r['教練'])) && (day(r['結束日期']) || day(r['開始日期'])) >= t)
        .sort((a, b) => byKey(day(a['開始日期']), day(b['開始日期'])));
      const todoRows = L.todo.map((x) => {
        const c = classOf(x.s);
        const lk = sesLocked(x.s);
        return crow({
          when: sesWhen(x), id: x.s['場次ID'],
          t: sesT(x.s) + ' <span class="badge bad">還沒處理</span>',
          s: esc(m.staffName(x.orig)) + ' 請假' + (str(x.off['原因']) ? '（' + esc(str(x.off['原因'])) + '）' : '') + (formedTxt(x.s) ? '' : '・<span class="mut">還沒成班</span>'),
          r: lk ? '<span class="mut">' + esc(lk) + '</span>' : btn('指派代課', 'clAssign', { id: x.s['場次ID'], orig: x.orig }, 'pri') + (c && m.isSingle(c) ? '' : btn('停課', 'clStop', { id: x.s['場次ID'], orig: x.orig }, 'ghost')),
        });
      }).join('');
      const doneRows = L.done.map((x) => crow({
        when: sesWhen(x), id: x.s['場次ID'],
        t: sesT(x.s),
        s: x.stop ? esc(m.staffName(x.orig)) + ' 請假 → <b>停課</b>' : esc(m.staffName(x.orig)) + ' 請假 → <b>' + esc(m.staffName(x.sub)) + '</b> 代課',
        r: sesLocked(x.s) ? '<span class="mut">' + esc(sesLocked(x.s)) + '</span>' : x.stop ? '' : btn('換代課', 'clAssign', { id: x.s['場次ID'], orig: x.orig }, 'ghost'),
      })).join('');
      const leaveRows = leaves.map((r) => {
        const a = day(r['開始日期']);
        const b = day(r['結束日期']) || a;
        const pid = str(r['教練']);
        const nTodo = L.todo.filter((x) => x.orig === pid && x.k >= a && x.k <= b).length;
        const nDone = L.done.filter((x) => x.orig === pid && x.k >= a && x.k <= b).length;
        return row({
          when: dk(a) + (a === b ? '' : '<br>～' + dk(b)),
          t: esc(m.staffName(pid)) + (str(r['原因']) ? '　<span class="mut">' + esc(str(r['原因'])) + '</span>' : ''),
          s: (nDone ? nDone + ' 堂已處理' : '') + (nDone && nTodo ? '・' : '') + (nTodo ? '<b style="color:var(--bad)">' + nTodo + ' 堂還沒處理</b>' : '') + (!nDone && !nTodo ? '這段期間沒有他的課' : ''),
          r: (nTodo ? btn('一起處理', 'clAddFor', { staff: pid, a: a, b: b }, 'ghost') : '') + btn('撤銷請假', 'hlDel', { id: r['ID'] }, 'ghost'),
        });
      }).join('');
      return '<div class="ptop"><span class="sp"></span>' + btn('登記教練請假', 'clAdd', {}, 'pri', 'plus') + '</div>' +
        '<p class="mut" style="font-size:.85rem;margin:0 2px 12px">教練跟你請假 → 按「登記教練請假」，可以一次找同一位教練代課，或把期制課停課（之後在課程明細用「改期」補）。代課後課表直接換成代課教練，教練費算代課的人；已成班的課，新舊教練與學員會收到通知。專項課不在這裡停課，請找代課，或到課程明細取消開課。</p>' +
        sec('還沒處理', L.todo.length, '請假那天還排他上的課') + card(todoRows || ui.empty('沒有要處理的 👍', '')) +
        sec('已代課／已停課', L.done.length) + card(doneRows || ui.empty('目前沒有', '')) +
        sec('請假紀錄（今天以後）', leaves.length, '教練自己在教練 OA「可排時間」登記的不可排日期也會列在這裡') + card(leaveRows || ui.empty('沒有請假', ''));
    },
  };
  function crow(o) { return row(o).replace('data-act="hlOpen"', 'data-act="clOpen"'); }
  A.clOpen = (d) => (d && d.id && A.openSes ? A.openSes(d) : null); // 點一列 → 上課場次明細（ops.js）

  /** 代課人選：在職教練；這天請假／同時段已排課的標出來（排在後面） */
  function coachChoices(list, except) {
    return coachStaff().filter((x) => x.v !== except).map((x) => {
      const why = uniq(list.map((s) => (PB.coachBusy ? PB.coachBusy(x.v, day(s['日期']), s['開始時間'], s['結束時間'], str(s['場次ID'])) : '')).filter(Boolean));
      return { v: x.v, l: x.l + (why.length ? '　⚠ ' + why.slice(0, 2).join('、') : ''), bad: why.length > 0 };
    }).sort((a, b) => (a.bad === b.bad ? 0 : a.bad ? 1 : -1));
  }
  function coachAffected(pid, a, b) {
    const t = today();
    const from = a < t ? t : a;
    return PB.rows('2_上課場次').filter((s) => str(s['授課教練']) === pid && str(s['場次狀態']) === '預定' && day(s['日期']) >= from && day(s['日期']) <= b && liveSes(s)).sort(sesSort);
  }
  const MODES = ['先只登記請假（課之後再一堂一堂處理）', '全部由同一位教練代課', '全部停課（專項課除外）'];
  async function addCoachLeave(pre) {
    pre = pre || {};
    const cs = coachStaff();
    if (!cs.length) return ui.toast('沒有在職的教練', 'bad');
    const v = await ui.ask(pre.staff ? '處理請假：' + m.staffName(pre.staff) : '登記教練請假', '教練跟你請假時在這裡登記。下一步會列出這段期間他的課。', {
      fields: [
        { k: 'staff', label: '請假的教練', t: 'enum', req: true, opts: cs.map((x) => x.l), value: pre.staff ? m.staffName(pre.staff) : '' },
        { k: 'start', label: '開始日期', t: 'date', req: true, value: pre.a || today() },
        { k: 'end', label: '結束日期（只請一天可以不填）', t: 'date', value: pre.b || '' },
        { k: 'reason', label: '原因（選填）', t: 'text', value: '' },
      ],
      ok: '下一步',
    });
    if (!v) return null;
    const staff = (cs.find((x) => x.l === v.staff) || {}).v;
    const a = v.start;
    const b = v.end || v.start;
    if (b < a) return ui.toast('結束日期不能早於開始日期', 'bad');
    const list = coachAffected(staff, a, b);
    const lines = list.map((s) => { const c = classOf(s); return '・' + esc(fmtD(day(s['日期'])) + ' ' + hm(s['開始時間']) + '　' + m.venueName(s['據點']) + '・' + m.classLabel(c)) + (c && m.isSingle(c) ? '（專項）' : '') + (sesLocked(s) ? '（' + sesLocked(s) + '）' : ''); }).join('<br>');
    const subs = coachChoices(list, staff);
    const fields = list.length ? [
      { k: 'mode', label: '這幾堂怎麼處理', t: 'enum', req: true, opts: MODES, value: MODES[0] },
      { k: 'sub', label: '代課教練（選「同一位教練代課」才需要）', t: 'enum', opts: subs.map((x) => x.l), hint: '⚠ 的人那天有狀況，選了系統會跳過那幾堂並告訴你' },
    ] : [];
    if (list.length && isMgmt()) fields.push({ k: 'force', label: '代課教練不能排也照樣指派（管理層）', t: 'bool' });
    const v2 = await ui.ask('確認：' + m.staffName(staff) + ' 請假 ' + fmtD(a) + (a === b ? '' : '～' + fmtD(b)),
      list.length ? '這段期間他有 <b>' + list.length + '</b> 堂課：<br>' + lines : '這段期間沒有他的課（之後排課時，系統會提醒他這幾天不能排）。', { fields: fields, ok: '登記' });
    if (!v2) return null;
    const mode = v2.mode === MODES[1] ? 'sub' : v2.mode === MODES[2] ? 'stop' : '';
    const pick = subs.find((x) => x.l === v2.sub);
    if (mode === 'sub' && !pick) return ui.toast('請選代課教練', 'bad');
    return PB.run('coachLeaveAdd', { staff: staff, start: a, end: b, reason: v.reason, mode: mode, sub: pick ? pick.v : '', force: v2.force === true });
  }
  A.clAdd = () => addCoachLeave();
  A.clAddFor = (d) => addCoachLeave({ staff: d.staff, a: d.a, b: d.b });
  A.clAssign = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    if (!s) return null;
    const cur = str(s['授課教練']);
    const subs = coachChoices([s], d.orig).filter((x) => x.v !== cur);
    const fields = [{ k: 'sub', label: '代課教練', t: 'enum', req: true, opts: subs.map((x) => x.l) }];
    if (isMgmt()) fields.push({ k: 'force', label: '教練不能排也照樣指派（管理層）', t: 'bool' });
    const v = await ui.ask((cur !== d.orig ? '換代課：' : '指派代課：') + m.sesLabel(s),
      esc(m.venueName(s['據點'])) + '　原教練：' + esc(m.staffName(d.orig)) + (cur !== d.orig ? '　目前代課：' + esc(m.staffName(cur)) : '') +
      '<br>教練費依代課教練的費率重算。' + (formedTxt(s) ? '新舊教練與學員約 ' + PB.cfg.scanMin + ' 分鐘內收到通知。' : '這堂還沒成班：成班後代課教練才會在課表看到，需要的話請先私訊告知。'), { fields: fields, ok: '確定' });
    if (!v) return null;
    const pick = subs.find((x) => x.l === v.sub);
    if (!pick) return null;
    if (pick.bad && v.force !== true) return ui.toast(pick.l.replace('　⚠ ', ' 不能排：'), 'bad');
    return PB.run('sessionCoach', { id: d.id, coach: pick.v, leaveOf: d.orig, force: v.force === true });
  };
  A.clStop = async (d) => {
    const s = PB.get('2_上課場次', d.id);
    if (!s) return null;
    const v = await ui.ask('停課：' + m.sesLabel(s), esc(m.staffName(d.orig)) + ' 請假，這一堂不上。學員與教練會收到通知；要補課請之後在課程明細用「改期」。', {
      fields: [{ k: 'reason', label: '補充說明（選填）', t: 'text' }], danger: true, ok: '停課',
    });
    if (!v) return null;
    return PB.run('sessionCancel', { id: d.id, leaveOf: d.orig, reason: v.reason || '' });
  };

  // ================================================================
  // v4.35 可排時間（Tammy 問怎麼看教練們的排班）：某一天誰請假、各據點時段誰可以排；每個人登錄的每週可排時間、接下來的請假與兩週的量
  //   資料：1_人員_可排時段（場主／教練 OA「可排時間」）、2_教練不可排日期；已排＝上課場次授課教練／場主排班
  // ================================================================
  const WD = '日一二三四五六';
  const wdOf = (k) => WD[new Date(k + 'T00:00:00').getDay()];
  const addD = (k, n) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const mins = (v) => { const x = str(v).match(/(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : null; };
  const wdOrder = (w) => { const i = WD.indexOf(str(w)); return i === 0 ? 7 : i; };
  function people(role) {
    const out = {};
    if (role !== 'host') coachStaff().forEach((x) => { out[x.v] = { v: x.v, l: x.l, coach: true, host: false }; });
    if (role !== 'coach') hostStaff().forEach((x) => { out[x.v] = Object.assign(out[x.v] || { v: x.v, l: m.staffName(x.v), coach: false }, { host: true }); });
    return Object.keys(out).map((k) => out[k]).sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));
  }
  /** 他登錄的可排：{ venues: [據點ID], slots: [時段] }；沒登錄 → null */
  function availOf(pid) {
    const r = PB.get('1_人員_可排時段', pid);
    if (!r) return null;
    const venues = split(r['可排據點']);
    const slots = split(r['可排時段']).map((id) => PB.get('1_據點_時段', id)).filter(Boolean);
    if (!venues.length && !slots.length) return null;
    return { venues: venues, slots: slots };
  }
  const slotSig = (sl) => str(sl['星期']) + '|' + hm(sl['開始時間']) + '|' + hm(sl['結束時間']);
  /** 這個時段他能不能排（登錄的據點有勾；該據點沒勾時段＝整個據點都可以） */
  function canSlot(av, sl) {
    if (!av) return false;
    const vid = str(sl['據點']);
    if (av.venues.indexOf(vid) < 0) return false;
    const mine = av.slots.filter((x) => str(x['據點']) === vid);
    return !mine.length || mine.some((x) => str(x['時段ID']) === str(sl['時段ID']) || slotSig(x) === slotSig(sl));
  }
  const slotOn = (sl, k) => wdOf(k) === str(sl['星期']) && ['停用', '取消', '已結束'].indexOf(str(sl['狀態'])) < 0 && (!day(sl['生效日期']) || day(sl['生效日期']) <= k) && (!day(sl['結束日期']) || day(sl['結束日期']) >= k);
  /** 這天他已經排了什麼（課、場主排班）：[{ a, b, t, game }] */
  function busyOn(pid, k) {
    const out = [];
    ((PB.ix.sesByDay || {})[k] || []).forEach((s) => {
      if (str(s['授課教練']) === pid && ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0) out.push({ a: mins(s['開始時間']), b: mins(s['結束時間']), t: m.venueName(s['據點']) + ' ' + hm(s['開始時間']) + ' ' + m.classLabel(classOf(s)) });
    });
    PB.rows('2_場主排班').forEach((d) => {
      if (str(d['人員']) !== pid) return;
      const g = PB.get('2_球敘場次', d['球敘']);
      if (g && day(g['日期']) === k && str(g['狀態']) !== '取消') out.push({ a: mins(g['開始時間']), b: mins(g['結束時間']), t: m.venueName(g['據點']) + ' ' + hm(g['開始時間']) + ' 球敘', game: true });
    });
    return out;
  }
  const tag = (x) => (x.coach ? ' <span class="badge">教練</span>' : '') + (x.host ? ' <span class="badge">場主</span>' : '');
  const md = (k) => fmtD(k).replace(/（.）/, '');

  const AvailTab = {
    render(p) {
      const k = /^\d{4}-\d{2}-\d{2}$/.test(str(p.d)) ? str(p.d) : today();
      const role = p.r === 'coach' || p.r === 'host' ? p.r : '';
      const ps = people(role);
      const chip = (v, l) => '<button class="chip' + (role === v ? ' on' : '') + '" data-act="param" data-k="r" data-v="' + v + '">' + l + '</button>';
      const top = '<div class="ptop"><div class="chips">' + chip('', '全部') + chip('coach', '教練') + chip('host', '場主') + '</div><span class="sp"></span>' +
        '<button class="btn sm ghost" data-act="param" data-k="d" data-v="' + addD(k, -1) + '">‹</button><input type="date" class="btn" value="' + esc(k) + '" data-input="availDay" style="min-width:9.5em"><button class="btn sm ghost" data-act="param" data-k="d" data-v="' + addD(k, 1) + '">›</button></div>';
      // ① 這天請假
      const offs = ps.map((x) => ({ x: x, off: offOn(x.v, k) })).filter((y) => y.off);
      const offRows = offs.map((y) => row({ t: esc(y.x.l) + tag(y.x), s: (str(y.off['原因']) ? esc(str(y.off['原因'])) + '・' : '') + esc(md(day(y.off['開始日期'])) + (day(y.off['結束日期']) && day(y.off['結束日期']) !== day(y.off['開始日期']) ? '～' + md(day(y.off['結束日期'])) : '')) })).join('');
      // ② 這天各據點時段：誰可以排
      const slots = PB.rows('1_據點_時段').filter((sl) => slotOn(sl, k)).sort((a, b) => byKey(m.venueName(a['據點']) + hm(a['開始時間']), m.venueName(b['據點']) + hm(b['開始時間'])));
      const avs = {};
      ps.forEach((x) => { avs[x.v] = availOf(x.v); });
      const slotRows = slots.map((sl) => {
        const a = mins(sl['開始時間']);
        const b = mins(sl['結束時間']);
        const can = ps.filter((x) => !offOn(x.v, k) && canSlot(avs[x.v], sl)).map((x) => {
          const hit = busyOn(x.v, k).find((y) => y.a !== null && y.b !== null && y.a < b && a < y.b);
          return hit ? '<span class="mut">' + esc(x.l) + '（已排 ' + esc(hit.t) + '）</span>' : '<b>' + esc(x.l) + '</b>';
        });
        return row({ when: esc(hm(sl['開始時間'])) + '<br>' + esc(hm(sl['結束時間'])), t: esc(m.venueName(sl['據點'])) + (str(sl['用途']) ? '　<span class="mut">' + esc(str(sl['用途']).replace(/\s*,\s*/g, '、')) + '</span>' : ''), s: can.length ? '可以排：' + can.join('、') : '<span class="mut">沒有人登錄這個時段可以排</span>' });
      }).join('');
      const none = ps.filter((x) => !avs[x.v]).map((x) => esc(x.l));
      // ③ 每個人
      const t0 = today();
      const until = addD(t0, 60);
      const until14 = addD(t0, 13);
      const personRows = ps.map((x) => {
        const av = avs[x.v];
        let weekly = '<span class="mut">還沒在 LINE 登錄可排時間</span>';
        if (av) {
          weekly = av.venues.map((vid) => {
            const mine = av.slots.filter((sl) => str(sl['據點']) === vid).sort((a, b) => (wdOrder(a['星期']) - wdOrder(b['星期'])) || byKey(hm(a['開始時間']), hm(b['開始時間'])));
            return esc(m.venueName(vid)) + '：' + (mine.length ? esc(uniq(mine.map((sl) => '週' + str(sl['星期']) + ' ' + hm(sl['開始時間']) + '–' + hm(sl['結束時間']))).join('、')) : '整個據點都可以');
          }).join('<br>');
        }
        const offsNext = PB.rows('2_教練不可排日期').filter((r) => str(r['教練']) === x.v && (day(r['結束日期']) || day(r['開始日期'])) >= t0 && day(r['開始日期']) <= until)
          .sort((a, b) => byKey(day(a['開始日期']), day(b['開始日期']))).map((r) => md(day(r['開始日期'])) + (day(r['結束日期']) && day(r['結束日期']) !== day(r['開始日期']) ? '～' + md(day(r['結束日期'])) : ''));
        let nSes = 0;
        let nGame = 0;
        for (let d = t0; d <= until14; d = addD(d, 1)) busyOn(x.v, d).forEach((y) => { if (y.game) nGame += 1; else nSes += 1; });
        const load = [x.coach || nSes ? nSes + ' 堂課' : '', x.host || nGame ? nGame + ' 場球敘' : ''].filter(Boolean).join('・');
        return row({ t: esc(x.l) + tag(x), s: weekly + '<br><span class="mut">請假：' + (offsNext.length ? esc(offsNext.join('、')) : '沒有') + '　接下來兩週：' + esc(load || '—') + '</span>' });
      }).join('');
      return top +
        sec(fmtD(k) + ' 請假', offs.length) + card(offRows || ui.empty('這天沒有人請假', '')) +
        sec(fmtD(k) + ' 各據點時段誰可以排', slots.length, '依場主／教練在 LINE「可排時間」登錄的資料；灰字＝這天同時段已經排了別的' + (none.length ? '。還沒登錄的：' + none.join('、') : '')) + card(slotRows || ui.empty('這天沒有據點時段', '')) +
        sec('每個人的可排時間', ps.length) + card(personRows || ui.empty('沒有人', ''));
    },
  };
  PB.inputs.availDay = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) PB.setParam('d', v); };

  // ================================================================
  // v4.35 畫面：請假與可排（三個分頁）
  // ================================================================
  const TABS = [{ v: '', l: '場主請假', n: () => lists().todo.length }, { v: 'coach', l: '教練請假', n: () => coachLists().todo.length }, { v: 'avail', l: '可排時間' }];
  const Screen = {
    id: 'hostLeave', label: '請假與可排', icon: 'swap', show: isOps,
    badge: () => { try { return lists().todo.length + coachLists().todo.length; } catch (e) { return 0; } },
    render(p) {
      p = p || {};
      const tab = p.t === 'coach' || p.t === 'avail' ? p.t : '';
      const tabs = '<div class="chips">' + TABS.map((x) => {
        let n = 0;
        try { n = x.n ? x.n() : 0; } catch (e) { n = 0; }
        return '<button class="chip' + (tab === x.v ? ' on' : '') + '" data-act="param" data-k="t" data-v="' + x.v + '">' + esc(x.l) + (n ? ' <span class="badge bad">' + n + '</span>' : '') + '</button>';
      }).join('') + '</div>';
      const body = tab === 'coach' ? CoachTab.render() : tab === 'avail' ? AvailTab.render(p) : HostTab.render();
      return '<div class="ptop"><h1>請假與可排</h1></div><div class="ptop">' + tabs + '</div>' + body;
    },
  };

  PB.hostLeaveScreen = Screen;
  PB.coachLeaveTodo = () => coachLists().todo; // v4.35：待處理「教練請假、還沒安排代課」
  PB.hostLeaveTodo = () => lists().todo; // v4.31：待處理「場主請假、還沒安排代班」
})();
