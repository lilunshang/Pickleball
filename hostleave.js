/**
 * 理論上匹克球｜營運工作台：場主請假／代班 hostleave.js v4.29（2026/11/24）；v4.30（同日：據點固定場主請假那天、場次直接排給別人的也算已代班，原場主在場主 OA v3.22 看得到）
 * Imperfect 11/24：場主跟行政客服請假，行政客服在這裡登記並指派代班；待處理項目太多，這件事獨立一頁、一眼看懂
 *   上方「＋登記請假」：選場主、日期、原因、代班場主（可先不選）→ 一次換好他那幾天的球敘
 *   ① 還沒安排代班：請假的人還排在場上，或預設場主請假、這場還沒有場主 →「指派代班」
 *   ② 已安排代班：誰請假 → 誰代班；「換代班」「換回原場主」
 *   ③ 請假紀錄：今天以後的場主請假；「撤銷請假」（可一起換回原場主）
 * 代班場主由場主 OA 收到「代班通知」；原場主收到「這場由 X 代班」，排班頁仍看得到名單、可＋名單外報名（場主 OA v3.21）
 * 伺服器：gas/HostLeave.gs
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

  const Screen = {
    id: 'hostLeave', label: '場主請假', icon: 'swap', show: isOps,
    badge: () => { try { return lists().todo.length; } catch (e) { return 0; } },
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
      return '<div class="ptop"><h1>場主請假／代班</h1><span class="sp"></span>' + btn('登記請假', 'hlAdd', {}, 'pri', 'plus') + '</div>' + warn +
        '<p class="mut" style="font-size:.85rem;margin:0 2px 12px">場主跟你請假 → 按「登記請假」，選代班場主就一次換好。代班場主會在場主 OA 收到代班通知；原場主的排班頁仍看得到這幾場的報名名單，也能＋名單外報名。點名、收款、場主費都算代班場主。</p>' +
        sec('還沒安排代班', L.todo.length, '請假的人還排在場上，或據點預設場主請假、這場還沒有場主（系統不會自動排）') +
        card(todoRows || ui.empty('沒有要處理的 👍', '')) +
        sec('已安排代班', L.done.length) + card(doneRows || ui.empty('目前沒有代班', '')) +
        sec('請假紀錄（今天以後）', leaves.length, '場主自己在場主 OA「可排時間」登記的不可排日期也會列在這裡') + card(leaveRows || ui.empty('沒有請假', ''));
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

  PB.hostLeaveScreen = Screen;
  PB.hostLeaveTodo = () => lists().todo; // v4.31：待處理「場主請假、還沒安排代班」
})();
