/**
 * 理論上匹克球｜營運工作台：主檔與紀錄 data.js v4.12（2026/11/10：從管理後台移到營運工作台）
 * 原本在 admin.js（v2.6 起依功能分 4 個入口；v3.1 據點與場地左清單＋右分頁；v3.4 批次新增時段）
 * 誰能用：行政客服、管理層（社群行銷看不到這個畫面）
 * 只有管理層看得到／能改：合作方案、合作夥伴、租約（含新增租約、續約、場租）、教練費率、角色、決策紀錄、
 *   人員的請款資料，以及人員的 Email／角色／在職狀態、新增人員、課程類型的標準教練費、文件的可查看角色
 *   （伺服器也照同樣規則擋：Forms.gs 欄位 ws、Actions.gs 操作 ws，開頁資料不帶這些表）
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
  if (!A.param2) A.param2 = (d) => PB.setParam(d.k, d.v);
  // v4.12：管理層限定
  const MG = () => PB.ws.indexOf('管理層') >= 0;
  const CAN = () => MG() || PB.ws.indexOf('行政客服') >= 0;
  const MG_KEYS = ['合作方案', '合作夥伴', '租約', '教練費率', '角色', '決策紀錄'];
  const keyOk = (k) => MG() || MG_KEYS.indexOf(k) < 0;
  const MG_COLS = ['標準教練費'];
  const colsOf = (def) => (def.cols || []).filter((c) => MG() || MG_COLS.indexOf(c[0]) < 0);

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
    人員: { t: '1_人員', cols: [['姓名', (r) => r['姓名']], ['角色', (r) => split(r['角色']).map((x) => (PB.get('0_角色', x) || {})['角色名稱'] || x).join('、')], ['Email', (r) => r['Email']], ['電話', (r) => r['電話']], ['性別', (r) => str(r['性別']) || '—'], ['LINE', (r) => (str(r['LINE_userId']) ? '已綁定' : '')], ['狀態', (r) => r['在職狀態']]], // v3.9：性別
      acts: (r) => (MG() && A.staffOk && str(r['在職狀態']) === '待審核' ? btn('核准', 'staffOk', { id: r['人員ID'] }, 'pri') : '') + (MG() ? btn('請款資料', 'secret', { id: r['人員ID'] }, 'ghost') : '') }, // v4.12：請款資料只有管理層；新人員核准在管理後台「待處理」
    教練: { t: '1_人員_教練', cols: [['教練', (r) => m.staffName(r['人員ID'])], ['可教程度', (r) => split(r['可教程度']).map(m.levelName).join('、')], ['證照', (r) => r['證照']], ['擅長', (r) => str(r['擅長項目']).slice(0, 30)]] },
    合作方案: { t: '3_合作方案', cols: [['方案', (r) => r['方案名稱']], ['對象', (r) => str(r['合作對象類型']) + '：' + (str(r['合作對象類型']) === '人員' ? m.staffName(r['人員']) : str(r['合作對象類型']) === '合作夥伴' ? m.label('1_合作夥伴', PB.get('1_合作夥伴', r['合作夥伴'])) : m.venueName(r['據點']))], ['模式', (r) => str(r['合作模式']) + '・' + str(r['適用範圍'])], ['條件', (r) => planTerms(r)], ['期間', (r) => fmtD(r['生效日期']) + '～' + fmtD(r['失效日期'])]] },
    合作夥伴: { t: '1_合作夥伴', cols: [['名稱', (r) => r['名稱']], ['類型', (r) => r['類型']], ['聯絡人', (r) => r['聯絡人']], ['電話', (r) => r['電話']]] },
    程度: { t: '0_程度', cols: [['程度', (r) => r['程度名稱']], ['排序', (r) => r['排序']], ['說明', (r) => str(r['說明']).slice(0, 40)]], sort: (r) => ('000' + num(r['排序'])).slice(-3) },
    專項: { t: '0_專項', cols: [['專項', (r) => r['專項名稱']], ['建議程度', (r) => m.levelName(r['程度'])], ['人數', (r) => (str(r['人數下限']) || '5') + '–' + (str(r['人數上限']) || '6')], ['費用', (r) => (num(r['費用']) > 0 ? num(r['費用']).toLocaleString() : '依據點')], ['說明', (r) => str(r['說明']).slice(0, 40)], ['啟用', (r) => (r['是否啟用'] === false ? '停用' : '啟用')]], sort: (r) => ('000' + num((PB.get('0_程度', r['程度']) || {})['排序'])).slice(-3) + str(r['專項名稱']) },
    // v3.6：球敘類型
    球敘類型: { t: '0_球敘類型', cols: [['類型', (r) => r['類型名稱']], ['報名規則', (r) => str(r['報名規則']) || '不限'], ['學校', (r) => (num(r['學校費用']) > 0 ? money(r['學校費用']) : '—')], ['球館', (r) => (num(r['球館費用']) > 0 ? money(r['球館費用']) : '—')], ['每面人數', (r) => (str(r['每面人數下限']) || str(r['每面人數上限']) ? (str(r['每面人數下限']) || '—') + '–' + (str(r['每面人數上限']) || '依球面') : '依球面')], ['場主', (r) => (r['需要場主'] === false || str(r['需要場主']).toUpperCase() === 'FALSE' ? '無場主' : '需要')], ['限定', (r) => (str(r['限定性別']) ? '限' + str(r['限定性別']) + '性' : '—')], ['說明', (r) => str(r['說明']).slice(0, 40)], ['啟用', (r) => (r['是否啟用'] === false || str(r['是否啟用']).toUpperCase() === 'FALSE' ? '停用' : '啟用')]], sort: (r) => ('000' + num(r['排序'])).slice(-3) + str(r['類型名稱']) },
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

  // v4.12（11/10）每面每小時：按次租用＝單價；包場租約＝合約金額 ÷ 合約期間「可用」日的面時數（與後端 venueUnit_、場地成本相同）
  const hm2min = (v) => { const x = str(v).match(/(\d{1,2}):(\d{2})/); return x ? +x[1] * 60 + +x[2] : null; };
  const slotHours = (s) => {
    const a = hm2min(s['開始時間']);
    let b = hm2min(s['結束時間']);
    if (a === null || b === null) return 0;
    if (b === 23 * 60 + 59) b = 24 * 60;
    if (b <= a) b += 24 * 60;
    return Math.round((b - a) / 30) / 2;
  };
  function planUnit(p) {
    const mode = str(p['合作模式']);
    if (mode === '按次租用') return { unit: num(p['每面每小時單價']), hrs: null };
    if (mode !== '包場租約') return null;
    const from = day(p['生效日期']);
    const to = day(p['失效日期']);
    const scope = str(p['適用範圍']);
    let hrs = 0;
    (PB.ix.slotByVenue[str(p['據點'])] || []).forEach((s) => {
      if (str(s['狀態']) !== '使用中') return;
      if (scope && scope !== '全部' && split(s['用途']).indexOf(scope) < 0) return;
      const h = split(s['使用場地']).length * slotHours(s);
      (PB.ix.availBySlot[str(s['時段ID'])] || []).forEach((a) => {
        const d = day(a['日期']);
        if (str(a['狀態']) !== '可用' || (from && d < from) || (to && d > to)) return;
        hrs += h;
      });
    });
    return { unit: hrs > 0 ? num(p['合約金額']) / hrs : 0, hrs: hrs };
  }
  const unitMoney = (u) => (u.unit > 0 ? '$' + (Math.round(u.unit * 10) / 10).toLocaleString() : '—');
  /** 合作方案列下方的小字：每面每小時 $X（包場：共 N 面時） */
  const unitLine = (p) => { const u = planUnit(p); if (!u) return ''; return '<span class="vunit">每面每小時 <b>' + esc(unitMoney(u)) + '</b>' + (u.hrs !== null ? '（' + (u.hrs ? u.hrs.toLocaleString() + ' 面時' : '還沒有可用日') + '）' : '') + '</span>'; };

  // v2.6：主檔依功能分 4 個入口，入口下再選資料表；每張表有一句說明
  const DGROUPS = [
    { id: 'venue', label: '據點與場地', icon: 'pin', desc: '據點、球面、固定時段、可用日，以及場地合作條件', keys: ['據點', '合作方案', '合作夥伴', '租約', '場地', '時段', '可用日'], sub: '據點・租約・球面・時段・可用日・合作方案' },
    { id: 'course', label: '課程設定', icon: 'book', desc: '課程類型（規則）→ 課程模板（期制班預設值）／專項（單堂專項課）；球敘類型（排課看板的球敘、預設費用與人數）', keys: ['課程類型', '課程模板', '專項', '球敘類型', '程度'] },
    { id: 'staff', label: '人員與權限', icon: 'users', desc: '人員、教練資料、教練費率與角色權限', keys: ['人員', '教練', '教練費率', '角色'] },
    { id: 'record', label: '紀錄', icon: 'kb', desc: '決策紀錄、文件中心、通知紀錄', keys: ['決策紀錄', '文件', '通知紀錄'] },
  ];
  const DDESC = {
    據點: '左邊選據點、右邊分頁看這個據點的租約、球面、時段、可用日；換據點會停在同一個分頁。要看全部據點一起的表，用右上「跨據點總表」。',
    場地: '據點裡的每一面球場；類型決定能排課程或球敘。',
    時段: '據點每週固定可用的時間。按「產生可用日」依期間與週期展開待確認的日期（約 15 分鐘內完成）。',
    可用日: '時段實際能用的日期；確認「可用」後才能排課、開球敘。',
    租約: '所有據點的包場租約。新租約建議從「據點」點進該據點再按「新增租約」：① 租約（金額、簽約當天付款）② 球面（勾既有、或新增）③ 時段與日期，最後一次建立。可以貼上「20261027_光電球場_一三五1900-2100_共2面共22日(20261109~1230)_共30800(每面每時段700)」自動帶入。',
    合作方案: '場地租金、分潤、外包等合作條件（只有管理層看得到）。',
    合作夥伴: '非人員、非據點的合作對象（廠商、學校窗口等）。',
    課程類型: '課程的「規則」：標準教練費、請假上限、補課期限。每個班級、模板、教練費率都要指定一個類型。',
    課程模板: '期制班（例：兒童班 8 堂）的預設值：新增班級時選模板，自動帶入名稱、人數、費用、堂數。',
    專項: '單堂專項課的內容清單（例：握拍與正反手）。排課看板從這裡選；有填費用就用它，空白依據點類別。',
    球敘類型: '排課看板的球敘按鈕。報名規則決定系統檢查什麼（不限／分級／DUPR）；排球敘時費用依據點類別帶入學校或球館費用、人數依每面上下限 × 面數。改價只影響之後排的場次，已排好的不會變。說明會顯示在學員報名頁。',
    程度: 'L1～L3 程度分級；專項的建議程度、球敘分級都用它。',
    人員: '所有工作人員；角色決定能進哪些工作區。「請款資料」只有管理層能看。',
    教練: '教練的可教程度、證照、介紹。',
    教練費率: '個別教練、個別課程類型的教練費；沒有設定時用課程類型的標準教練費。',
    角色: '角色與工作區權限（管理層／行政客服／社群行銷）。',
    決策紀錄: '重要決定的來龍去脈與生效日期。',
    文件: '合約、手冊等文件的連結；檔案本身放在 Google 雲端硬碟。',
    通知紀錄: '系統發出的 LINE 通知與結果。',
  };
  /** v4.12：行政客服看不到管理層限定的表（入口副標也拿掉） */
  const vgrp = () => DGROUPS.map((g) => Object.assign({}, g, { keys: g.keys.filter(keyOk), sub: MG() || !g.sub ? g.sub : g.sub.split('・').filter(keyOk).join('・') })).filter((g) => g.keys.length);
  const groupOf = (k) => { const G = vgrp(); return G.find((g) => g.keys.indexOf(k) >= 0) || G[0]; };
  const dCount = (k) => (D[k] && PB.has(D[k].t) ? PB.rows(D[k].t).length : null);

  const Data = {
    id: 'data', label: '主檔與紀錄', icon: 'db', show: CAN, // v4.12：營運工作台（行政客服、管理層）
    render(p) {
      const G = vgrp();
      const g = G.find((x) => x.id === p.grp) || (D[p.k] ? groupOf(p.k) : G[0]);
      const k = D[p.k] && g.keys.indexOf(p.k) >= 0 ? p.k : g.keys[0];
      const def = D[k];
      const tabs = '<div class="dgrp">' + G.map((x) => '<button class="dgrp-b' + (x.id === g.id ? ' on' : '') + '" data-act="dataG" data-v="' + x.id + '">' + PB.icon(x.icon) + '<span><b>' + esc(x.label) + '</b><small>' + esc(x.sub || x.keys.join('・')) + '</small></span></button>').join('') + '</div>';
      const chips = '<div class="chips dsub">' + g.keys.map((x) => { const n = dCount(x); return '<button class="chip' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + x + (n !== null && !D[x].custom ? '<span class="c">' + n + '</span>' : x === '租約' && PB.has('3_合作方案') ? '<span class="c">' + PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約').length + '</span>' : '') + '</button>'; }).join('') + '</div>';
      const desc = DDESC[k] ? '<p class="ddesc">' + esc(DDESC[k]) + '</p>' : '';
      const head = (right) => '<div class="ptop"><h1>主檔與紀錄</h1><span class="sp"></span>' + (right || '') + '</div>' + tabs + (g.id === 'venue' ? venueChips(k) : chips) + (g.id === 'venue' && k !== '據點' && ALLK.indexOf(k) < 0 ? desc : '');
      // v3.1 據點與場地：據點＝左清單＋右分頁；租約／球面／時段／可用日＝跨據點總表
      if (g.id === 'venue' && k === '據點') return head(ui.btn('新增據點', 'dataNew', { t: '1_據點' }, 'pri', 'plus')) + venueSplit(p);
      if (g.id === 'venue' && ALLK.indexOf(k) >= 0) return head('') + allView(p, k);
      if (def.custom) return head('') + (def.custom === 'notify' ? notifyView(p) : def.custom === 'lease' ? leaseView(p) : availView(p));
      const kw = str(p.q).toLowerCase();
      let list = PB.rows(def.t);
      if (kw) list = list.filter((r) => colsOf(def).map((c) => str(c[1](r))).join(' ').toLowerCase().indexOf(kw) >= 0);
      if (def.sort) list = list.slice().sort((a, b) => byKey(def.sort(a), def.sort(b)));
      const key = PB.db.keys[def.t];
      const rows = list.map((r) => '<tr class="click" data-act="' + (def.open || 'dataEdit') + '" data-t="' + def.t + '" data-id="' + esc(r[key]) + '">' + colsOf(def).map((c) => '<td>' + c[2](r, c[1](r)) + '</td>').join('') + (def.acts ? '<td data-stop style="text-align:right">' + def.acts(r) + '</td>' : '') + '</tr>').join('');
      const canNew = PB.forms[def.t] && PB.forms[def.t].create;
      return head(canNew ? ui.btn('新增' + k, 'dataNew', { t: def.t }, 'pri', 'plus') : '') +
        '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="搜尋' + esc(k) + '" value="' + esc(p.q || '') + '" data-input="dataSearch"></label><span class="sp"></span><span class="mut">' + list.length + ' 筆</span></div>' +
        (PB.has(def.t) ? '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + colsOf(def).map((c) => '<th>' + esc(c[0]) + '</th>').join('') + (def.acts ? '<th></th>' : '') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' : '<div class="err-box">「' + esc(def.t) + '」沒有載入（工作表不存在或未設定試算表）</div>');
    },
  };
  // 欄位第 3 項：自訂 HTML（預設＝跳脫文字）
  Object.keys(D).forEach((k) => (D[k].cols || []).forEach((c) => { if (!c[2]) c[2] = (r, v) => esc(v); }));
  A.dataG = (d) => PB.go('data', { grp: d.v });
  A.dataK = (d) => { const o = { grp: groupOf(d.v).id, k: d.v }; const v = PB.params().v; if (o.grp === 'venue' && v) o.v = v; PB.go('data', o); };
  A.dataEdit = (d) => ui.form(d.t, { id: d.id });
  A.dataNew = (d) => ui.form(d.t, {});
  A.planEdit = (d) => ui.form('3_合作方案', { id: d.id });
  let dataTimer;
  PB.inputs.dataSearch = (v) => { clearTimeout(dataTimer); dataTimer = setTimeout(() => { PB.setParam('q', v); const el = document.querySelector('[data-input="dataSearch"]'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); } }, 250); };
  A.slotAvail = (d) => PB.run('slotGenAvail', { id: d.id }, { confirm: { title: '產生可用日', text: '依生效～結束日期與週期展開「待確認」可用日（已存在的日期略過；國定假日會標記）。產生後請到可用日確認。', ok: '產生' } });
  A.slotDrafts = (d) => PB.run('slotGenDrafts', { id: d.id }, { confirm: { title: '產生球敘草稿', text: '依這個時段之後的「可用」日，在沒被課程佔用的場地建立球敘草稿；費用與類型沿用上一場。草稿要在營運工作台確認後開放報名。', ok: '產生' } });
  A.availOf = (d) => { const s = PB.get('1_據點_時段', d.id); PB.go('data', { grp: 'venue', k: '據點', v: str(s && s['據點']), vt: '可用日', as: d.id }); };

  // 可用日已排幾場（課程場次＋球敘）
  function availUsed(a) {
    const d = day(a['日期']);
    return (PB.ix.sesByDay[d] || []).filter((x) => str(x['時段']) === str(a['時段']) && ['取消', '改期'].indexOf(str(x['場次狀態'])) < 0).length + (PB.ix.gameByDay[d] || []).filter((g) => str(g['時段']) === str(a['時段']) && str(g['狀態']) !== '取消').length;
  }
  const AV_BADGE = { 可用: 'ok', 待確認: 'warn', 取消: 'bad' };
  const avBadge = (a) => '<span class="badge ' + (AV_BADGE[str(a['狀態'])] || '') + '">' + esc(a['狀態']) + '</span>' + (str(a['取消原因']) ? ' <span class="mut">' + esc(a['取消原因']) + '</span>' : '');
  const slotVenue = (a) => { const s = PB.get('1_據點_時段', a['時段']); return str(s && s['據點']); };

  // v3.1 跨據點總表｜可用日：vid＝只看這個據點（空白＝全部，依據點分組）
  function availView(p, vid) {
    const slot = p.slot || '';
    const st = p.st || '待確認';
    const t = today();
    let list = PB.rows('1_據點_可用日').filter((a) => (!slot || str(a['時段']) === slot) && (!vid || slotVenue(a) === vid) && (st === '全部' || str(a['狀態']) === st) && (p.past === '1' || day(a['日期']) >= t));
    list = list.sort((a, b) => byKey(day(a['日期']), day(b['日期'])));
    const slots = PB.rows('1_據點_時段').filter((s) => !vid || str(s['據點']) === vid).sort((a, b) => byKey(m.venueName(a['據點']) + WDS.indexOf(str(a['星期'])), m.venueName(b['據點']) + WDS.indexOf(str(b['星期']))));
    const rowFn = (a) => {
      const s = PB.get('1_據點_時段', a['時段']);
      const used = availUsed(a);
      return '<tr><td>' + (str(a['狀態']) !== '取消' ? '<input type="checkbox" data-q="avail" value="' + esc(a['可用日ID']) + '">' : '') + '</td><td>' + esc(fmtD(a['日期'])) + (a['假日標記'] === true ? ' <span class="badge warn">假日</span>' : '') + '</td><td>' + esc(m.slotLabel(s)) + '</td><td>' + avBadge(a) + '</td><td class="num">' + (used ? used + ' 場' : '') + '</td></tr>';
    };
    const body = grpRows(list.slice(0, 400), slotVenue, rowFn, 5, vid);
    return '<div class="ptop"><select class="btn" data-input="availSlot"><option value="">全部時段</option>' + slots.map((s) => '<option value="' + esc(s['時段ID']) + '"' + (str(s['時段ID']) === slot ? ' selected' : '') + '>' + esc((vid ? '' : m.venueName(s['據點']) + '｜') + m.slotLabel(s)) + '</option>').join('') + '</select>' +
      '<div class="chips">' + ['待確認', '可用', '取消', '全部'].map((x) => '<button class="chip' + (x === st ? ' on' : '') + '" data-act="param2" data-k="st" data-v="' + x + '">' + x + '</button>').join('') + '<button class="chip' + (p.past === '1' ? ' on' : '') + '" data-act="param2" data-k="past" data-v="' + (p.past === '1' ? '' : '1') + '">含過去</button></div><span class="sp"></span>' +
      ui.btn('新增單日', 'availNew', { slot: slot }, 'sm', 'plus') + '</div>' +
      '<div class="acts">' + btn('勾選的確認可用', 'availOk', {}, 'pri') + btn('勾選的取消', 'availNo', {}, 'bad') + '<span class="mut avsel" style="align-self:center;font-size:.84rem"></span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>日期</th><th>時段</th><th>狀態</th><th class="num">已排</th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="mut">沒有資料</td></tr>') + '</tbody></table></div>' +
      (list.length > 400 ? '<p class="mut" style="font-size:.8rem">只列前 400 筆，請選據點或時段縮小範圍。</p>' : '') +
      '<p class="mut" style="font-size:.8rem">取消可用日後，系統會寄出受影響的課程與球敘；課程請在營運工作台逐堂改期，球敘請取消。</p>';
  }
  PB.inputs.availSlot = (v) => PB.setParam('slot', v);

  // ================================================================
  // 租約（v2.8）：一次登錄 球面、時段、可用日、包場合作方案、場租應付
  // ================================================================
  const WDS = '一二三四五六日';
  const wdOf = (k) => '日一二三四五六'[new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10)).getDay()];
  const pad2 = (n) => ('0' + n).slice(-2);
  // v3.1 跨據點總表｜租約：vid＝只看這個據點（空白＝全部，依據點分組）
  function leaseView(p, vid) {
    const plans = PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約' && (!vid || str(r['據點']) === vid)).sort((a, b) => byKey(day(b['生效日期']), day(a['生效日期']))) : [];
    const exp = PB.rows('3_支出');
    const t = today();
    const rowFn = (r) => {
      const pid = str(r['方案ID']);
      const ex = exp.filter((e) => str(e['備註']).indexOf('F03:' + pid + ':') >= 0);
      const paid = ex.filter((e) => str(e['付款狀態']) === '已付').length;
      const live = !day(r['失效日期']) || day(r['失效日期']) >= t;
      return '<tr class="click" data-act="dataEdit" data-t="3_合作方案" data-id="' + esc(pid) + '"><td style="white-space:normal">' + esc(r['方案名稱']) + (live ? '' : ' <span class="badge">已到期</span>') + '</td><td>' + esc(fmtD(r['生效日期']) + '～' + fmtD(r['失效日期'])) + '</td><td class="num">' + money(r['合約金額']) + unitLine(r) + '</td><td>' + (ex.length ? '<span class="badge ' + (paid === ex.length ? 'ok' : 'warn') + '">場租 ' + (paid === ex.length ? '已付' : '應付') + '</span>' : '<span class="mut">—</span>') + (str(r['合約']) ? ' <span class="fclip">📎</span>' : '') + '</td><td data-stop style="text-align:right">' + btn('續約', 'leaseNew', { copy: pid }, 'ghost') + '</td></tr>';
    };
    const body = grpRows(plans, (r) => str(r['據點']), rowFn, 5, vid);
    return '<div class="acts">' + btn('新增租約', 'leaseNew', vid ? { venue: vid } : {}, 'pri', 'plus') + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>租約</th><th>期間</th><th class="num">金額</th><th>場租</th><th></th></tr></thead><tbody>' + (body || '<tr><td colspan="5" class="mut">還沒有租約</td></tr>') + '</tbody></table></div>';
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
    LS_.v = { venue: str(d.venue), newVenue: '', area: '', wds: [], times: [['', '']], dates: '', total: '', unit: '', sign: today(), pay: '轉帳', paid: true, expect: 0, expectCourts: 0, name: '', contract: '', mode: '包場租約', scope: '全部', unitHour: '' };
    // 續約：沿用上一份租約的球面、星期、時間
    if (d.copy) {
      const plan = PB.get('3_合作方案', d.copy) || {};
      LS_.v.venue = str(plan['據點']);
      if (str(plan['合作模式']) === '按次租用') { LS_.v.mode = '按次租用'; LS_.v.unitHour = str(plan['每面每小時單價']); } // v3.7
      if (['課程', '球敘'].indexOf(str(plan['適用範圍'])) >= 0) LS_.v.scope = str(plan['適用範圍']);
      const inVenue = PB.rows('1_據點_時段').filter((x) => str(x['據點']) === LS_.v.venue);
      let slots = inVenue.filter((x) => str(x['說明']) === str(plan['方案名稱']));
      // 續約的續約：時段沿用第一份租約的名稱 → 改找期間和這份租約重疊的時段
      if (!slots.length) {
        const a = day(plan['生效日期']), b = day(plan['失效日期']) || a;
        slots = inVenue.filter((x) => a && day(x['生效日期']) && day(x['生效日期']) <= b && (!day(x['結束日期']) || day(x['結束日期']) >= a));
      }
      if (slots.length) {
        LS_.v.wds = uniq(slots.map((x) => str(x['星期'])));
        // v3.4：一份租約可能有多個時間 → 全部帶入
        LS_.v.times = uniq(slots.map((x) => str(x['開始時間']).slice(0, 5) + '|' + str(x['結束時間']).slice(0, 5))).sort().map((x) => x.split('|'));
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
      // v3.7：合作模式、適用範圍
      '<div class="fld-row"><div class="fld"><label>合作模式<b>*</b></label><select name="mode">' + [['包場租約', '包場租約（簽約付全額）'], ['按次租用', '按次租用（每月依實際場次算）']].map((o) => '<option value="' + o[0] + '"' + (v.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div><div class="fld"><label>適用範圍</label><select name="scope">' + ['全部', '課程', '球敘'].map((o) => '<option' + (v.scope === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select><span class="hint">同一個場地課程、球敘分開計價時，各登一份</span></div></div>' +
      '<div class="fld-row" data-lmode="包場租約"><div class="fld"><label>合約總額</label><input type="number" name="total" min="0"></div><div class="fld"><label>每面每時段</label><input type="number" name="unit" min="0"><span class="hint">填一個就好；兩個都填會核對</span></div></div>' +
      '<div class="fld" data-lmode="包場租約"><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="paid" checked> 簽約當天已付款（公司帳戶）</label></div>' +
      '<div class="fld" data-lmode="按次租用" hidden><label>每面每小時單價<b>*</b></label><input type="number" name="unitHour" min="0" value="' + esc(v.unitHour) + '"><span class="hint">不建場租支出；每月 1 日依上個月實際開成的課程／球敘自動算應付</span></div>' +
      '<div class="fld-row"><div class="fld"><label>付款方式</label><select name="pay">' + (PB.enums['現金轉帳'] || ['現金', '轉帳']).map((x) => '<option' + (x === '轉帳' ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select></div><div class="fld"></div></div>' +
      '<div class="fld"><label>合約檔案</label>' + ui.filesField({ k: '合約', _table: '3_合作方案' }, '', 'leasefile') + '</div></section>' +
      // ② 球面
      '<section data-ls="2" hidden><div class="fld"><label>區域</label><input name="area" list="leaseAreas" placeholder="例：綜合大樓四樓、光電球場"><datalist id="leaseAreas"></datalist><span class="hint">新增的球面會叫「區域 A」「區域 B」…</span></div>' +
      '<div class="fld"><label>這份租約用哪幾面</label><div id="lsCourts"></div><button type="button" class="btn sm" data-lease="addCourt" style="align-self:flex-start;margin-top:6px">' + PB.icon('plus') + '新增球面</button><span class="hint">新增的球面：類型 課程＋球敘、人數上限 8、啟用（之後可在據點詳情修改）</span></div></section>' +
      // ③ 時段與日期
      '<section data-ls="3" hidden><div class="fld"><label>星期<b>*</b></label><div class="multi" data-lwds>' + WDS.split('').map((w) => '<label><input type="checkbox" value="' + w + '"' + (v.wds.indexOf(w) >= 0 ? ' checked' : '') + '>' + w + '</label>').join('') + '</div></div>' +
      '<div class="fld"><label>時間<b>*</b><span class="hint" style="margin-left:6px">一天租好幾個時段就加幾列</span></label>' + trowsHtml('lease', v.times, leasePreview) + '</div>' +
      '<div class="fld"><label>日期<b>*</b></label><input name="dates" placeholder="指定日期：20261018、1101、1115　或期間：20261109~1230（依勾選的星期展開）"><span class="hint">展開後點日期可以排除（例如那天學校不借）</span></div>' +
      '<div class="note" style="font-size:.82rem">系統依「據點＋星期＋時間＋球面」找時段：已有就沿用並延長期間，沒有就新增一個（每個星期 × 每個時間一個）；每個日期寫一筆可用日（直接「可用」）。</div></section>' +
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
      if (v.mode === '按次租用') { if (!num(v.unitHour)) return '請填每面每小時單價'; }
      else if (!num(v.total) && !num(v.unit)) return '請填合約總額或每面每時段';
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
    if (box.querySelector('[data-trows="lease"]')) v.times = trowsRead('lease');
    v.wds = Array.from(box.querySelectorAll('[data-lwds] input:checked')).map((i) => i.value);
    v.dates = q('dates').value;
    v.total = q('total').value;
    v.unit = q('unit').value;
    v.sign = q('sign').value;
    v.pay = q('pay').value;
    v.paid = q('paid').checked;
    v.mode = q('mode').value; // v3.7
    v.scope = q('scope').value;
    v.unitHour = q('unitHour').value;
    box.querySelectorAll('[data-lmode]').forEach((x) => { x.style.display = x.dataset.lmode !== v.mode ? 'none' : ''; x.hidden = false; });
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
    set('area', o.area); set('dates', o.dates);
    if (o.start && o.end) { LS_.v.times = [[o.start, o.end]]; trowsSet('lease', LS_.v.times); } set('total', o.total); set('unit', o.unit); set('sign', o.sign);
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
    const tv = trowsValid(v.times || []);
    if (!tv.times.length) return { ok: false, why: '請填時間', all: all };
    if (tv.err) return { ok: false, why: tv.err, all: all };
    if (!dates.length) return { ok: false, why: '請填日期（期間要勾星期）', all: all };
    const bad = dates.filter((d) => v.wds.length && v.wds.indexOf(wdOf(d)) < 0);
    if (bad.length) return { ok: false, why: bad.map(fmtD).join('、') + ' 不是勾選的星期', all: all };
    return { ok: true, all: all, a: { venue: v.venue === '__new' ? '' : v.venue, newVenue: v.venue === '__new' ? v.newVenue : '', area: v.area, courtIds: Array.from(LS_.sel), newCourts: LS_.add.filter((c) => c.name), times: tv.times.map((t) => ({ start: t[0], end: t[1] })), dates: dates, total: num(v.total) || '', unit: num(v.unit) || '', signDate: v.sign, payMethod: v.pay, paidNow: v.paid, name: v.name, contract: v.contract, mode: v.mode, scope: v.scope, unitHour: num(v.unitHour) || '' } };
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
      const nT = Math.max(1, trowsValid(v.times || []).times.length);
      const chips = all.length ? '<div class="lease-dates">' + all.map((d) => '<button type="button" class="ldate' + (LS_.off.has(d) ? ' off' : '') + '" data-ldate="' + d + '">' + esc(fmtD(d)) + '</button>').join('') + '</div>' : '';
      const n = all.filter((d) => !LS_.off.has(d)).length;
      const cnt = '<div class="lease-cnt">共 <b>' + n + '</b> 日' + (v.expect ? (n === v.expect ? ' <span class="badge ok">與「共 ' + v.expect + ' 日」相符</span>' : ' <span class="badge warn">貼上的是共 ' + v.expect + ' 日，請點掉不租的日期</span>') : '') + (num(v.unit) && nC && n ? '・' + nC + ' 面 × ' + n + ' 日' + (nT > 1 ? ' × ' + nT + ' 個時段' : '') + ' × ' + money(v.unit) + '＝<b>' + money(num(v.unit) * nC * n * nT) + '</b>' : '') + '</div>';
      if (!args.ok) { el.innerHTML = chips + cnt + '<div class="mut" style="font-size:.84rem">' + esc(args.why) + '</div>'; return; }
      const seq = ++LS_.seq;
      el.innerHTML = chips + cnt + '<div class="mut">預覽中…</div>';
      const r = await PB.read('leasePreview', args.a);
      if (seq !== LS_.seq || !document.getElementById('leasePrev')) return;
      if (!r) { el.innerHTML = chips + cnt; return; }
      el.innerHTML = chips + cnt + '<div class="lease-plan"><b>確認登錄後會建立：</b><ul>' +
        (r.venue.isNew ? '<li>新據點「' + esc(r.venue.name) + '」</li>' : '') +
        '<li>球面：' + r.courts.map((c) => esc(c.name) + (c.isNew ? '<span class="badge info">新</span>' : '')).join('、') + '</li>' +
        '<li>時段：' + r.slots.map((s2) => '週' + s2.wd + ' ' + esc(s2.start + '–' + s2.end) + '（' + (s2.reuse ? '沿用既有時段' : '新增時段') + '，' + s2.n + ' 日' + (s2.skip ? '，其中 ' + s2.skip + ' 日已有' : '') + '）').join('、') + '</li>' +
        '<li>可用日 ' + r.avail + ' 天（直接「可用」）</li>' + (r.mode === '按次租用'
          ? '<li>合作方案「' + esc(r.plan) + '」按次租用・' + esc(r.scope) + '・每面每小時 ' + money(r.unitHour) + '・每月結算</li><li>不建場租支出；全部開成約 ' + money(r.amount) + '（' + r.courtHours + ' 面時），實際依開成的場次月結</li>'
          : '<li>租約「' + esc(r.plan) + '」' + (r.scope !== '全部' ? '（' + esc(r.scope) + '）' : '') + money(r.amount) + (r.unitHour ? '（每面每小時 ' + money(r.unitHour) + '）' : '') + '</li><li>場租支出 ' + money(r.amount) + '：' + (v.paid ? v.sign + ' 已付（' + esc(v.pay) + '）' : '應付') + '</li>') + '</ul></div>' +
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
  // v3.1 據點與場地：據點＝左邊據點清單＋右邊分頁（概要／租約／球面／時段／可用日）
  //      跨據點總表＝租約／球面／時段／可用日 全部據點一起看，上方一排據點按鈕切換
  // ================================================================
  const ALLK = ['租約', '場地', '時段', '可用日'];
  const lbl = (k) => (k === '場地' ? '球面' : k);
  const VTABS = ['概要', '租約', '球面', '時段', '可用日'];
  const VORDER = { 合作中: 0, 籌備中: 1, 暫停: 2, 已結束: 3 };
  const vGroup = (v) => ({ 籌備中: '籌備中', 暫停: '暫停', 已結束: '已停止合作' }[str(v['狀態'])] || '合作中');
  const mem = {
    get: (k) => { try { return localStorage.getItem('pb:' + k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { localStorage.setItem('pb:' + k, v || ''); } catch (e) { /* 無痕模式等 */ } },
  };
  /** 據點排序：合作中 → 籌備中 → 暫停 → 已結束（已停止合作放最下面），同組依名稱 */
  function venueList() {
    const o = (v) => (VORDER[str(v['狀態'])] === undefined ? 0 : VORDER[str(v['狀態'])]);
    return PB.rows('1_據點').slice().sort((a, b) => o(a) - o(b) || byKey(str(a['據點名稱']), str(b['據點名稱'])));
  }
  const venuePlans = (id) => (PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((p) => str(p['合作對象類型']) === '據點' && str(p['據點']) === id).sort((a, b) => byKey(day(b['生效日期']), day(a['生效日期']))) : []);
  const slotSort = (a, b) => byKey(WDS.indexOf(str(a['星期'])) + str(a['開始時間']), WDS.indexOf(str(b['星期'])) + str(b['開始時間']));
  const shortHm = (s) => (s ? m.hm(s['開始時間'], s['結束時間']).replace(/:00/g, '') : '');
  /** 一個據點的數字：球面、時段、未來可用／待確認、租約狀態 */
  function vInfo(id) {
    const t = today();
    const slots = (PB.ix.slotByVenue[id] || []).slice().sort(slotSort);
    const av = [];
    slots.forEach((s) => (PB.ix.availBySlot[str(s['時段ID'])] || []).forEach((a) => { if (day(a['日期']) >= t) av.push(a); }));
    const plans = venuePlans(id);
    const leases = plans.filter((p) => str(p['合作模式']) === '包場租約');
    const live = plans.filter((p) => day(p['生效日期']) <= t && (!day(p['失效日期']) || day(p['失效日期']) >= t));
    const lastEnd = leases.some((p) => !day(p['失效日期'])) ? '' : leases.map((p) => day(p['失效日期'])).filter(Boolean).sort().pop() || '';
    let lease = '';
    if (lastEnd && lastEnd < t) lease = 'expired';
    else if (lastEnd && lastEnd <= addDays(t, 30)) lease = 'expiring';
    return { slots: slots, courts: vCourts(id), plans: plans, live: live, leases: leases, lastEnd: lastEnd, lease: lease,
      ok: av.filter((a) => str(a['狀態']) === '可用').length, pend: av.filter((a) => str(a['狀態']) === '待確認').length };
  }
  function vFlags(v, x) {
    if (vGroup(v) === '已停止合作') return '';
    return (x.pend ? '<span class="badge warn">待確認 ' + x.pend + '</span>' : '') +
      (x.lease === 'expiring' ? '<span class="badge warn">租約將到期</span>' : x.lease === 'expired' && vGroup(v) === '合作中' ? '<span class="badge">租約已到期</span>' : '');
  }
  function curVenue(p) {
    let id = str(p.v) || mem.get('venue');
    if (!id || !PB.get('1_據點', id)) { const vs = venueList(); id = vs.length ? str(vs[0]['據點ID']) : ''; }
    return id;
  }

  // ---- 子分頁列（據點・合作方案・合作夥伴｜右邊「跨據點總表」下拉） ----
  function allCount(k) {
    if (k === '租約') return PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約').length : 0;
    if (k === '可用日') return PB.rows('1_據點_可用日').filter((a) => str(a['狀態']) !== '取消' && day(a['日期']) >= today()).length;
    return dCount(k) || 0;
  }
  function venueChips(k) {
    const isAll = ALLK.indexOf(k) >= 0;
    const main = ['據點', '合作方案', '合作夥伴'].filter(keyOk).map((x) => { const n = dCount(x); return '<button class="chip' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + x + (n !== null ? '<span class="c">' + n + '</span>' : '') + '</button>'; }).join('');
    const menu = '<details class="vall"><summary class="btn sm' + (isAll ? ' pri' : '') + '">' + PB.icon('grid') + (isAll ? '總表：' + lbl(k) : '跨據點總表') + ' ▾</summary><div class="vall-m"><div class="t">全部據點一起看</div>' +
      ALLK.filter(keyOk).map((x) => '<button class="vall-i' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + lbl(x) + '<small>' + allCount(x) + '</small></button>').join('') + '</div></details>';
    return '<div class="chips dsub vsub">' + main + '<span class="sp"></span>' + menu + '</div>';
  }
  document.addEventListener('click', (e) => { document.querySelectorAll('details.vall[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });

  // ---- 依據點分組的表格列（總表選「全部」時） ----
  function grpRows(list, vOf, rowFn, ncol, vid) {
    if (vid) return list.map(rowFn).join('');
    const by = {};
    list.forEach((r) => { const v = vOf(r); (by[v] = by[v] || []).push(r); });
    const order = venueList().map((v) => str(v['據點ID'])).filter((id) => by[id]);
    Object.keys(by).forEach((id) => { if (order.indexOf(id) < 0) order.push(id); });
    return order.map((id) => '<tr class="vgh"><td colspan="' + ncol + '"><b>' + esc(m.venueName(id) || '（沒有據點）') + '</b><span class="mut">' + by[id].length + ' 筆</span>' + (PB.get('1_據點', id) ? btn('只看這個據點', 'vPick', { v: id }, 'ghost') : '') + '</td></tr>' + by[id].map(rowFn).join('')).join('');
  }
  const genRow = (def, r) => '<tr class="click" data-act="dataEdit" data-t="' + def.t + '" data-id="' + esc(r[PB.db.keys[def.t]]) + '">' + colsOf(def).filter((c) => c[0] !== '據點').map((c) => '<td>' + c[2](r, c[1](r)) + '</td>').join('') + (def.acts ? '<td data-stop style="text-align:right">' + def.acts(r) + '</td>' : '') + '</tr>';

  // ---- 跨據點總表 ----
  function allView(p, k) {
    const vid = str(p.v) && PB.get('1_據點', p.v) ? str(p.v) : '';
    const t = today();
    const src = {
      租約: () => (PB.has('3_合作方案') ? PB.rows('3_合作方案').filter((r) => str(r['合作模式']) === '包場租約') : []),
      場地: () => PB.rows('1_據點_場地'),
      時段: () => PB.rows('1_據點_時段'),
      可用日: () => PB.rows('1_據點_可用日').filter((a) => str(a['狀態']) !== '取消' && day(a['日期']) >= t),
    }[k]();
    const vOf = k === '可用日' ? slotVenue : (r) => str(r['據點']);
    const cnt = {};
    src.forEach((r) => { const v = vOf(r); cnt[v] = (cnt[v] || 0) + 1; });
    const vs = venueList().filter((v) => cnt[str(v['據點ID'])] || vGroup(v) !== '已停止合作');
    const bar = '<div class="vbar"><span class="vbar-l">據點</span><button class="chip' + (!vid ? ' on' : '') + '" data-act="vPick" data-v="">全部<span class="c">' + src.length + '</span></button>' +
      vs.map((v) => { const id = str(v['據點ID']); return '<button class="chip' + (vid === id ? ' on' : '') + (vGroup(v) === '已停止合作' ? ' mutc' : '') + '" data-act="vPick" data-v="' + esc(id) + '">' + esc(v['據點名稱']) + '<span class="c">' + (cnt[id] || 0) + '</span></button>'; }).join('') + '</div>';
    const head = '<div class="vall-h"><b>跨據點總表</b><div class="chips">' + ALLK.filter(keyOk).map((x) => '<button class="chip' + (x === k ? ' on' : '') + '" data-act="dataK" data-v="' + x + '">' + lbl(x) + '<span class="c">' + allCount(x) + '</span></button>').join('') + '</div><span class="sp"></span>' + btn('回到據點', 'dataK', { v: '據點' }, 'ghost', 'back') + '</div>' + bar +
      (DDESC[k] && k !== '租約' ? '<p class="ddesc">' + esc(DDESC[k]) + '</p>' : '');
    if (k === '租約') return head + leaseView(p, vid);
    if (k === '可用日') return head + availView(p, vid);
    const def = D[k];
    let list = src.filter((r) => !vid || vOf(r) === vid);
    if (def.sort) list = list.slice().sort((a, b) => byKey(def.sort(a), def.sort(b)));
    const cols = colsOf(def).filter((c) => c[0] !== '據點');
    const ncol = cols.length + (def.acts ? 1 : 0);
    const addBtn = k === '場地' ? btn('新增球面', 'courtNew', { venue: vid }, 'pri', 'plus') : (vid ? btn('批次新增時段', 'slotBatch', { venue: vid }, 'pri', 'plus') : '') + btn('新增時段', 'slotNew', { venue: vid }, vid ? '' : 'pri', 'plus');
    return head + '<div class="acts">' + addBtn + '</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + (def.acts ? '<th></th>' : '') + '</tr></thead><tbody>' + (grpRows(list, vOf, (r) => genRow(def, r), ncol, vid) || '<tr><td colspan="' + ncol + '" class="mut">沒有資料</td></tr>') + '</tbody></table></div>';
  }

  // ---- 據點：左清單＋右分頁 ----
  function venueSplit(p) {
    const vs = venueList();
    if (!vs.length) return '<div class="card">' + ui.empty('還沒有據點', '按右上「新增據點」') + '</div>';
    const id = curVenue(p);
    mem.set('venue', id);
    const vtabs = VTABS.filter(keyOk); // v4.12：租約只有管理層
    const tab = vtabs.indexOf(p.vt) >= 0 ? p.vt : '概要';
    const kw = str(p.vq).toLowerCase();
    const info = {};
    vs.forEach((v) => { info[str(v['據點ID'])] = vInfo(str(v['據點ID'])); });
    let lg = null;
    let list = '';
    vs.filter((v) => !kw || (str(v['據點名稱']) + ' ' + str(v['區域'])).toLowerCase().indexOf(kw) >= 0).forEach((v) => {
      const vid = str(v['據點ID']);
      const x = info[vid];
      const g = vGroup(v);
      if (g !== lg) { list += '<div class="vl-g">' + esc(g) + '</div>'; lg = g; }
      const sub = [str(v['區域']), x.courts.length + ' 面', x.ok ? '可用 ' + x.ok + ' 天' : g === '合作中' ? '沒有可用日' : ''].filter(Boolean).join('・');
      list += '<button class="vl-i' + (vid === id ? ' on' : '') + (g === '已停止合作' ? ' off' : '') + '" data-act="vPick" data-v="' + esc(vid) + '"><span class="vl-t"><b>' + esc(v['據點名稱']) + '</b><small>' + esc(sub) + '</small></span><span class="vl-b">' + vFlags(v, x) + '</span></button>';
    });
    const bar = '<div class="vl-bar">' + vs.map((v) => { const vid = str(v['據點ID']); return '<button class="chip' + (vid === id ? ' on' : '') + (vGroup(v) === '已停止合作' ? ' mutc' : '') + '" data-act="vPick" data-v="' + esc(vid) + '">' + esc(v['據點名稱']) + (info[vid].pend && vGroup(v) !== '已停止合作' ? '<span class="vl-dot"></span>' : '') + '</button>'; }).join('') + '</div>';
    const v = PB.get('1_據點', id);
    const x = info[id];
    const cnt = { 租約: x.plans.length, 球面: x.courts.length, 時段: x.slots.length, 可用日: x.ok };
    const tabs = '<div class="vtabs">' + vtabs.map((tb) => '<button class="vtab' + (tb === tab ? ' on' : '') + '" data-act="param2" data-k="vt" data-v="' + tb + '">' + tb + (cnt[tb] !== undefined ? '<span class="c">' + cnt[tb] + '</span>' : '') + (tb === '可用日' && x.pend ? '<span class="vl-dot"></span>' : '') + '</button>').join('') + '</div>';
    const acts = [MG() ? btn('新增租約', 'leaseNew', { venue: id }, 'pri', 'plus') : '', btn('新增球面', 'courtNew', { venue: id }, MG() ? '' : 'pri', 'plus'), btn('批次新增時段', 'slotBatch', { venue: id }, '', 'plus'), btn('新增時段', 'slotNew', { venue: id }, 'ghost', 'plus'), btn('編輯據點', 'dataEdit', { t: '1_據點', id: id }, 'ghost')].join('');
    const body = { 概要: vOverview, 租約: vPlansTab, 球面: vCourtsTab, 時段: vSlotsTab, 可用日: availPane }[tab](id, p, x);
    const stBadge = '<span class="badge ' + ({ 合作中: 'ok', 籌備中: 'info', 暫停: 'warn' }[str(v['狀態'])] || '') + '">' + esc(str(v['狀態']) || '合作中') + '</span>';
    return bar + '<div class="vsplit"><aside class="vl"><div class="vl-s"><label class="search">' + PB.icon('search') + '<input data-input="vSearch" placeholder="搜尋據點" value="' + esc(p.vq || '') + '"></label></div><div class="vl-list">' + (list || '<div class="vl-g">沒有符合的據點</div>') + '</div></aside>' +
      '<section class="vp"><div class="vp-h"><h2>' + esc(v['據點名稱']) + '</h2>' + stBadge + '<span class="mut">' + esc([str(v['區域']), str(v['場主']) ? '場主 ' + m.staffName(v['場主']) : ''].filter(Boolean).join('・')) + '</span></div>' +
      '<div class="acts">' + acts + '</div>' + tabs + '<div class="vp-b">' + body + '</div></section></div>';
  }
  A.vPick = (d) => {
    if (d.v) mem.set('venue', d.v);
    const p = Object.assign({}, PB.params());
    if (d.v) p.v = d.v; else delete p.v;
    delete p.slot; delete p.as;
    PB.go('data', p);
  };
  A.vGo = (d) => { const p = Object.assign({}, PB.params(), { k: '據點', grp: 'venue', vt: d.vt }); if (d.as) p.as = d.as; else delete p.as; PB.go('data', p); };
  A.venueOpen = (d) => { mem.set('venue', d.id); PB.go('data', { grp: 'venue', k: '據點', v: d.id }); };
  let vqTimer;
  PB.inputs.vSearch = (val) => { clearTimeout(vqTimer); vqTimer = setTimeout(() => { PB.setParam('vq', val); const el = document.querySelector('[data-input="vSearch"]'); if (el) { el.focus(); el.setSelectionRange(val.length, val.length); } }, 250); };

  const tblH = (heads, rows, empty) => '<div class="tbl-wrap"><table class="tbl">' + (heads ? '<thead><tr>' + heads.map((h) => '<th' + (h.charAt(0) === '>' ? ' class="num"' : '') + '>' + esc(h.replace(/^>/, '')) + '</th>').join('') + '</tr></thead>' : '') + '<tbody>' + (rows || '<tr><td colspan="' + ((heads && heads.length) || 1) + '" class="mut">' + esc(empty) + '</td></tr>') + '</tbody></table></div>';
  function planRow(p) {
    const t = today();
    const pid = str(p['方案ID']);
    const ex = PB.rows('3_支出').filter((e) => str(e['備註']).indexOf('F03:' + pid + ':') >= 0);
    const paid = ex.length && ex.every((e) => str(e['付款狀態']) === '已付');
    const live = !day(p['失效日期']) || day(p['失效日期']) >= t;
    const amt = str(p['合作模式']) === '按次租用' ? money(p['每面每小時單價']) + '／面／時' : str(p['合約金額']) ? money(p['合約金額']) : planTerms(p);
    return '<tr class="click" data-act="dataEdit" data-t="3_合作方案" data-id="' + esc(pid) + '"><td style="white-space:normal"><b>' + esc(p['方案名稱']) + '</b><br><span class="mut" style="font-size:.8rem">' + esc(str(p['合作模式']) + '・' + fmtD(p['生效日期']) + '～' + fmtD(p['失效日期'])) + '</span></td><td class="num">' + esc(amt) + unitLine(p) + '</td><td>' + (ex.length ? '<span class="badge ' + (paid ? 'ok' : 'warn') + '">場租' + (paid ? '已付' : '應付') + '</span>' : '') + (live ? '' : ' <span class="badge">已到期</span>') + (str(p['合約']) ? ' <span class="fclip">📎</span>' : '') + '</td><td data-stop style="text-align:right">' + (str(p['合作模式']) === '包場租約' ? btn('續約', 'leaseNew', { copy: pid }, 'ghost') : '') + '</td></tr>';
  }
  function slotRow(s) {
    const t = today();
    const av = (PB.ix.availBySlot[str(s['時段ID'])] || []).filter((a) => day(a['日期']) >= t);
    const ok = av.filter((a) => str(a['狀態']) === '可用');
    const pend = av.filter((a) => str(a['狀態']) === '待確認').length;
    const last = ok.map((a) => day(a['日期'])).sort().pop();
    return '<tr class="click" data-act="dataEdit" data-t="1_據點_時段" data-id="' + esc(s['時段ID']) + '"><td><b>週' + esc(s['星期']) + ' ' + esc(m.hm(s['開始時間'], s['結束時間'])) + '</b></td><td style="white-space:normal">' + esc(split(s['使用場地']).map(m.courtName).join('、')) + '</td><td style="font-size:.84rem">' + esc(split(s['用途']).join('・')) + (str(s['狀態']) && str(s['狀態']) !== '使用中' ? ' <span class="badge">' + esc(s['狀態']) + '</span>' : '') + '</td><td style="font-size:.84rem">' + esc(fmtD(s['生效日期']) + '～' + fmtD(s['結束日期'])) + '</td><td style="font-size:.84rem">可用 <b>' + ok.length + '</b> 天' + (last ? '<br><span class="mut">到 ' + esc(fmtD(last)) + '</span>' : '') + (pend ? '<br><span class="badge warn">待確認 ' + pend + '</span>' : '') + '</td><td data-stop style="text-align:right;white-space:nowrap">' + btn('加日期', 'availAddDlg', { id: s['時段ID'] }, 'pri') + btn('看可用日', 'vGo', { vt: '可用日', as: s['時段ID'] }, 'ghost') + btn('複製到其他星期', 'slotBatch', { copy: s['時段ID'] }, 'ghost') + '</td></tr>';
  }
  function vOverview(id, p, x) {
    const v = PB.get('1_據點', id);
    const t = today();
    const activeSlots = x.slots.filter((s) => !str(s['狀態']) || str(s['狀態']) === '使用中');
    // v4.12：管理層多一格「每面每小時」（目前有效的場租方案；課程／球敘不同價時兩個都列）
    const rentNow = MG() ? x.live.filter((p) => ['包場租約', '按次租用'].indexOf(str(p['合作模式'])) >= 0) : [];
    const unitTile = rentNow.length ? [[rentNow.map((p) => unitMoney(planUnit(p)) + (rentNow.length > 1 ? '<small style="display:inline;font-size:.7rem">' + esc(str(p['適用範圍']) || '全部') + '</small>' : '')).join(' ／ '), '每面每小時（場租）', '', true]] : [];
    const stats = '<div class="vstats">' + [[x.courts.length, '球面'], [activeSlots.length, '每週時段'], [x.ok, '未來可用日'], [x.pend, '待確認', x.pend ? 'warn' : '']].concat(unitTile).map((a) => '<div' + (a[2] ? ' class="' + a[2] + '"' : '') + '><b>' + (a[3] ? a[0] : esc(a[0])) + '</b><small>' + a[1] + '</small></div>').join('') + '</div>';
    const kv2 = [['類別', esc(v['據點類別'])], ['區域', esc(v['區域'])], ['地址', esc(v['地址'])], ['交通', esc(v['交通資訊'])], ['聯絡', esc([str(v['聯絡窗口']), str(v['聯絡電話'])].filter(Boolean).join(' '))], ['可租球拍', str(v['可租球拍數']) === '' ? '' : esc(v['可租球拍數']) + ' 支'], ['簽到座標', str(v['座標']) ? esc(v['座標']) : '<span class="badge warn">未設定（現場簽到需要）</span>'], ['注意事項', esc(v['注意事項'])]].filter((a) => a[1]);
    // 需要處理
    const todo = [];
    x.slots.forEach((s) => {
      const pd = (PB.ix.availBySlot[str(s['時段ID'])] || []).filter((a) => str(a['狀態']) === '待確認' && day(a['日期']) >= t).map((a) => day(a['日期'])).sort();
      if (pd.length) todo.push(['<span class="badge warn">待確認</span> 週' + esc(s['星期']) + ' ' + esc(m.hm(s['開始時間'], s['結束時間'])) + '：' + esc(pd.slice(0, 4).map(fmtD).join('、') + (pd.length > 4 ? ' 等 ' + pd.length + ' 天' : '')), btn('去確認', 'vGo', { vt: '可用日', as: s['時段ID'] }, 'pri')]);
    });
    if (vGroup(v) !== '已停止合作' && MG()) {
      const lastLease = x.leases.filter((l) => day(l['失效日期']) === x.lastEnd)[0];
      if (x.lease === 'expiring' && lastLease) todo.push(['<span class="badge warn">租約將到期</span> ' + esc(lastLease['方案名稱']) + ' 到 ' + esc(fmtD(x.lastEnd)) + '，之後還沒有新租約', btn('續約', 'leaseNew', { copy: lastLease['方案ID'] }, 'pri')]);
      if (x.lease === 'expired' && lastLease && vGroup(v) === '合作中') todo.push(['<span class="badge">租約已到期</span> 最後一份租約到 ' + esc(fmtD(x.lastEnd)), btn('續約', 'leaseNew', { copy: lastLease['方案ID'] }, 'pri')]);
    }
    if (vGroup(v) !== '已停止合作') {
      activeSlots.forEach((s) => {
        const fut = (PB.ix.availBySlot[str(s['時段ID'])] || []).filter((a) => str(a['狀態']) !== '取消' && day(a['日期']) >= t).length;
        if (!fut && day(s['結束日期']) && day(s['結束日期']) >= t) todo.push(['週' + esc(s['星期']) + ' ' + esc(m.hm(s['開始時間'], s['結束時間'])) + ' 之後沒有可用日', btn('加日期', 'availAddDlg', { id: s['時段ID'] }, '')]);
      });
      if (!str(v['座標'])) todo.push(['簽到座標未設定，場主現場簽到需要', btn('編輯據點', 'dataEdit', { t: '1_據點', id: id }, '')]);
    }
    const livePlans = x.live.length ? x.live : x.plans.slice(0, 1);
    return stats + '<div class="vov">' + kv(kv2) + '</div>' +
      sec('需要處理', todo.length || undefined) + (todo.length ? tblH(null, todo.map((a) => '<tr><td style="white-space:normal">' + a[0] + '</td><td data-stop style="text-align:right;white-space:nowrap">' + a[1] + '</td></tr>').join(''), '') : '<p class="mut" style="margin:0;font-size:.88rem">沒有要處理的事 👍</p>') +
      (!MG() ? '' : sec(x.live.length ? '目前租約與合作方案' : '最近的租約', livePlans.length || undefined, x.plans.length > livePlans.length ? btn('全部 ' + x.plans.length + ' 份', 'param2', { k: 'vt', v: '租約' }, 'ghost') : '') + tblH(null, livePlans.map(planRow).join(''), '還沒有租約：按上方「新增租約」'));
  }
  function vPlansTab(id, p, x) {
    return tblH(['租約／合作方案', '>金額', '狀態', ''], x.plans.map(planRow).join(''), '還沒有租約：按上方「新增租約」') +
      '<p class="mut" style="font-size:.8rem">簽新約 →「新增租約」（球面、時段、可用日一次建好）；下一期 → 租約的「續約」（沿用球面與時間，填新日期與金額）。</p>';
  }
  function vCourtsTab(id, p, x) {
    const rows = x.courts.map((c) => '<tr class="click" data-act="dataEdit" data-t="1_據點_場地" data-id="' + esc(c['場地ID']) + '"><td><b>' + esc(c['場地名稱']) + '</b></td><td>' + esc(split(c['類型']).join('・')) + '</td><td class="num">' + esc(c['人數上限']) + ' 人</td><td>' + (str(c['狀態']) === '暫停使用' ? '<span class="badge warn">暫停使用</span>' : '<span class="badge ok">啟用</span>') + '</td></tr>').join('');
    return tblH(['球面', '類型', '>人數上限', '狀態'], rows, '還沒有球面：按上方「新增球面」');
  }
  function vSlotsTab(id, p, x) {
    return tblH(['時段', '球面', '用途', '期間', '可用日', ''], x.slots.map(slotRow).join(''), '還沒有時段：按上方「新增租約」或「批次新增時段」') +
      '<p class="mut" style="font-size:.8rem">時段＝每週固定的星期＋時間＋球面；同一份約多租幾天 → 時段的「加日期」；同樣的時間要用到別的星期 →「複製到其他星期」。</p>';
  }

  // ---- 據點內的可用日：月曆／清單，勾選多天一起確認或取消 ----
  function availPane(id, p, x) {
    const slots = x.slots;
    if (!slots.length) return '<div class="card">' + ui.empty('這個據點還沒有時段', '按上方「新增租約」，會一起建好時段與可用日') + '</div>';
    const as = slots.some((s) => str(s['時段ID']) === str(p.as)) ? str(p.as) : '';
    const mode = p.av === 'list' ? 'list' : 'cal';
    const past = p.past === '1';
    const xc = p.xc === '1';
    const t = today();
    const list = [];
    slots.filter((s) => !as || str(s['時段ID']) === as).forEach((s) => (PB.ix.availBySlot[str(s['時段ID'])] || []).forEach((a) => { if ((past || day(a['日期']) >= t) && (xc || str(a['狀態']) !== '取消')) list.push(a); }));
    list.sort((a, b) => byKey(day(a['日期']) + str((PB.get('1_據點_時段', a['時段']) || {})['開始時間']), day(b['日期']) + str((PB.get('1_據點_時段', b['時段']) || {})['開始時間'])));
    const chip = (label, k, v, on) => '<button class="chip' + (on ? ' on' : '') + '" data-act="param2" data-k="' + k + '" data-v="' + esc(v) + '">' + label + '</button>';
    const top = '<div class="ptop av-top"><div class="chips">' + chip('全部時段', 'as', '', !as) + slots.map((s) => chip(esc('週' + str(s['星期']) + ' ' + shortHm(s)), 'as', str(s['時段ID']), as === str(s['時段ID']))).join('') + '</div><span class="sp"></span><div class="chips">' +
      chip('含過去', 'past', past ? '' : '1', past) + chip('含取消', 'xc', xc ? '' : '1', xc) + '<span class="seg">' + chip('月曆', 'av', '', mode === 'cal') + chip('清單', 'av', 'list', mode === 'list') + '</span></div></div>';
    const addSlot = as || (slots.length === 1 ? str(slots[0]['時段ID']) : '');
    const acts = '<div class="acts av-acts">' + btn('勾選的確認可用', 'availOk', {}, 'pri') + btn('勾選的取消', 'availNo', {}, 'bad') + '<span class="mut avsel"></span><span class="sp"></span>' +
      (addSlot ? btn('加日期', 'availAddDlg', { id: addSlot }, '', 'plus') : btn('加日期', 'availAddPick', {}, '', 'plus')) + btn('新增單日', 'availNew', { slot: as }, 'ghost', 'plus') + '</div>';
    const body = !list.length ? '<div class="card">' + ui.empty('沒有可用日', '按「加日期」加入租到的日期') + '</div>' : mode === 'cal' ? availCal(list, t) : availList(list, as);
    return top + acts + body + '<p class="mut" style="font-size:.8rem">綠＝可用、黃＝待確認；點日期裡的時段可以勾選。取消可用日後，系統會寄出受影響的課程與球敘。</p>';
  }
  function availItem(a) {
    const s = PB.get('1_據點_時段', a['時段']);
    const stt = str(a['狀態']);
    const used = availUsed(a);
    const inner = '<span class="cal-t">' + esc(shortHm(s)) + '</span>' + (stt === '待確認' ? '<span class="cal-s">待確認</span>' : stt === '取消' ? '<span class="cal-s">取消</span>' : '') + (a['假日標記'] === true ? '<span class="cal-s">假日</span>' : '') + (used ? '<span class="cal-u">已排 ' + used + '</span>' : '');
    const tip = esc(fmtD(a['日期']) + ' ' + m.slotLabel(s) + (str(a['取消原因']) ? '（' + str(a['取消原因']) + '）' : ''));
    if (stt === '取消') return '<div class="cal-a x" title="' + tip + '">' + inner + '</div>';
    return '<label class="cal-a ' + (stt === '可用' ? 'ok' : 'warn') + '" title="' + tip + '"><input type="checkbox" data-q="avail" value="' + esc(a['可用日ID']) + '">' + inner + '</label>';
  }
  function availCal(list, t) {
    const byD = {};
    list.forEach((a) => { const k = day(a['日期']); (byD[k] = byD[k] || []).push(a); });
    const ds = Object.keys(byD).sort();
    let y = +ds[0].slice(0, 4);
    let mo = +ds[0].slice(5, 7);
    const end = ds[ds.length - 1].slice(0, 7);
    let out = '';
    for (let i = 0; i < 24; i++) {
      const ym = y + '-' + pad2(mo);
      if (ym > end) break;
      const off = (new Date(y, mo - 1, 1).getDay() + 6) % 7;
      const nd = new Date(y, mo, 0).getDate();
      const inM = list.filter((a) => day(a['日期']).slice(0, 7) === ym);
      let cells = '';
      for (let j = 0; j < off; j++) cells += '<div class="cal-d e"></div>';
      for (let d = 1; d <= nd; d++) {
        const k = ym + '-' + pad2(d);
        const it = byD[k] || [];
        cells += '<div class="cal-d' + (k < t ? ' past' : '') + (k === t ? ' today' : '') + (it.length ? ' has' : '') + '"><span class="cal-n">' + d + '</span>' + it.map(availItem).join('') + '</div>';
      }
      const okN = inM.filter((a) => str(a['狀態']) === '可用').length;
      const pdN = inM.filter((a) => str(a['狀態']) === '待確認').length;
      out += '<div class="cal"><div class="cal-h"><b>' + y + ' 年 ' + mo + ' 月</b><span class="mut">可用 ' + okN + (pdN ? '・<span style="color:var(--warn)">待確認 ' + pdN + '</span>' : '') + '</span><span class="sp"></span>' + (okN + pdN ? '<button class="btn sm ghost" data-act="calAll" data-ym="' + ym + '">全選這個月</button>' : '') + '</div><div class="cal-g" data-ym="' + ym + '">' + WDS.split('').map((w) => '<div class="cal-w">' + w + '</div>').join('') + cells + '</div></div>';
      mo += 1;
      if (mo > 12) { mo = 1; y += 1; }
    }
    return out;
  }
  function availList(list, as) {
    const rows = list.map((a) => {
      const s = PB.get('1_據點_時段', a['時段']);
      const used = availUsed(a);
      return '<tr><td>' + (str(a['狀態']) !== '取消' ? '<input type="checkbox" data-q="avail" value="' + esc(a['可用日ID']) + '">' : '') + '</td><td>' + esc(fmtD(a['日期'])) + (a['假日標記'] === true ? ' <span class="badge warn">假日</span>' : '') + '</td>' + (as ? '' : '<td>' + esc(shortHm(s)) + '</td>') + '<td>' + avBadge(a) + '</td><td class="num">' + (used ? used + ' 場' : '') + '</td></tr>';
    }).join('');
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>日期</th>' + (as ? '' : '<th>時段</th>') + '<th>狀態</th><th class="num">已排</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  A.availAddPick = () => ui.toast('先在上方選一個時段，再按「加日期」');
  A.calAll = (d, el) => {
    const g = document.querySelector('.cal-g[data-ym="' + d.ym + '"]');
    if (!g) return;
    const boxes = Array.from(g.querySelectorAll('input[data-q="avail"]'));
    const on = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = on; });
    availSelCount();
  };
  function availSelCount() {
    const n = document.querySelectorAll('input[data-q="avail"]:checked').length;
    document.querySelectorAll('.avsel').forEach((el) => { el.textContent = n ? '已勾選 ' + n + ' 天' : ''; });
  }
  document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('input[data-q="avail"]')) availSelCount(); });

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


  // ================================================================
  // v3.4 時間列（批次新增時段、新增租約第 3 步共用）：一列一組開始～結束，可加列、刪列、套預設
  // ================================================================
  const TPRE = { day: [['10:00', '12:00'], ['14:00', '16:00'], ['16:00', '18:00']], eve: [['18:00', '20:00'], ['20:00', '22:00']] };
  const TCB = {};
  const tHours = (t) => { const a = t[0].split(':').map(Number), b = t[1].split(':').map(Number); return t[0] && t[1] ? ((b[0] * 60 + b[1]) - (a[0] * 60 + a[1])) / 60 : 0; };
  function trowsInner(k, times) {
    return times.map((t, i) => {
      const h = tHours(t);
      return '<div class="trow"><input type="time" data-tk="' + k + '" data-ti="' + i + '" data-te="0" value="' + esc(t[0]) + '" aria-label="開始時間"><span class="mut">到</span><input type="time" data-tk="' + k + '" data-ti="' + i + '" data-te="1" value="' + esc(t[1]) + '" aria-label="結束時間">' +
        '<span class="trow-h">' + (t[0] && t[1] ? (h > 0 ? h + ' 小時' : '<span class="bad-t">結束要晚於開始</span>') : '') + '</span>' +
        (times.length > 1 ? '<button type="button" class="fdel" data-tdel="' + k + '" data-ti="' + i + '" title="刪除這個時間" aria-label="刪除這個時間">×</button>' : '') + '</div>';
    }).join('');
  }
  function trowsHtml(k, times, onChange) {
    TCB[k] = onChange;
    return '<div class="trows" data-trows="' + k + '">' + trowsInner(k, times) + '</div><div class="trow-acts"><button type="button" class="btn sm" data-tadd="' + k + '">' + PB.icon('plus') + '加一個時間</button>' +
      '<button type="button" class="btn sm ghost" data-tpre="' + k + '" data-p="day">早上＋下午（10–12、14–16、16–18）</button><button type="button" class="btn sm ghost" data-tpre="' + k + '" data-p="eve">晚上（18–20、20–22）</button></div>';
  }
  /** 從畫面讀時間列 → [[開始, 結束]…]（含沒填完的列） */
  function trowsRead(k) {
    const box = document.querySelector('[data-trows="' + k + '"]');
    if (!box) return [];
    const out = [];
    box.querySelectorAll('input[data-tk]').forEach((i) => { const r = +i.dataset.ti; out[r] = out[r] || ['', '']; out[r][+i.dataset.te] = i.value; });
    return out.filter(Boolean);
  }
  /** 填完且合理的時間（排序、去重）；重疊回傳 err */
  function trowsValid(times) {
    const ok = uniq(times.filter((t) => t[0] && t[1] && tHours(t) > 0).map((t) => t[0] + '|' + t[1])).map((x) => x.split('|')).sort((a, b) => byKey(a[0], b[0]));
    let err = '';
    for (let i = 1; i < ok.length; i++) if (ok[i][0] < ok[i - 1][1]) err = ok[i - 1][0] + '–' + ok[i - 1][1] + ' 和 ' + ok[i][0] + '–' + ok[i][1] + ' 重疊';
    return { times: ok, err: err };
  }
  function trowsSet(k, times) {
    const box = document.querySelector('[data-trows="' + k + '"]');
    if (box) box.innerHTML = trowsInner(k, times.length ? times : [['', '']]);
    if (TCB[k]) TCB[k]();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-tadd],[data-tdel],[data-tpre]');
    if (!b) return;
    e.preventDefault();
    const k = b.dataset.tadd || b.dataset.tdel || b.dataset.tpre;
    let t = trowsRead(k);
    if (b.dataset.tadd) {
      const last = t[t.length - 1];
      const s = last && last[1] ? last[1] : '';
      const h = s ? Math.min(23, +s.slice(0, 2) + 2) : 0;
      t.push(s ? [s, (h === 23 && +s.slice(0, 2) >= 22 ? '23:59' : ('0' + h).slice(-2) + s.slice(2))] : ['', '']);
    } else if (b.dataset.tdel) t.splice(+b.dataset.ti, 1);
    else t = TPRE[b.dataset.p].map((x) => x.slice());
    trowsSet(k, t);
    const ins = document.querySelectorAll('[data-trows="' + k + '"] input');
    if (b.dataset.tadd && ins.length) ins[ins.length - 2].focus();
  });
  document.addEventListener('input', (e) => {
    const i = e.target;
    if (!i || !i.dataset || !i.dataset.tk) return;
    const row = i.closest('.trow');
    const t = trowsRead(i.dataset.tk)[+i.dataset.ti];
    const hEl = row && row.querySelector('.trow-h');
    if (hEl && t) { const h = tHours(t); hEl.innerHTML = t[0] && t[1] ? (h > 0 ? h + ' 小時' : '<span class="bad-t">結束要晚於開始</span>') : ''; }
    if (TCB[i.dataset.tk]) TCB[i.dataset.tk]();
  });

  // ================================================================
  // v3.4 批次新增時段：星期 × 時間 × 日期範圍 → 時段＋可用日（直接「可用」）
  //   規則與後端 slotBatch_ 相同：同星期＋時間＋同一組球面已有時段 → 沿用；同一面時間重疊 → 跳過；取消過的日期維持取消
  // ================================================================
  const SB_ = { venue: '', wds: new Set(), off: new Set(), courts: new Set(), use: new Set(), from: '', to: '', note: '', copy: '' };
  const hm5 = (v) => str(v).slice(0, 5);
  function sbPlan() {
    const tv = trowsValid(trowsRead('sb'));
    const wds = WDS.split('').filter((w) => SB_.wds.has(w));
    const courts = Array.from(SB_.courts);
    const dates = {};
    if (SB_.from && SB_.to && SB_.from <= SB_.to) for (let d = SB_.from, n = 0; d <= SB_.to && n < 400; d = addDays(d, 1), n++) if (SB_.wds.has(wdOf(d))) (dates[wdOf(d)] = dates[wdOf(d)] || []).push(d);
    const slots = PB.rows('1_據點_時段').filter((s) => str(s['據點']) === SB_.venue && str(s['狀態']) !== '停用');
    const same = (x, y) => x.length === y.length && x.every((v) => y.indexOf(v) >= 0);
    const ovl = (a1, b1, a2, b2) => a1 < b2 && a2 < b1;
    const cells = [];
    wds.forEach((wd) => tv.times.forEach((t) => {
      const ds = (dates[wd] || []).filter((d) => !SB_.off.has(d));
      const reuse = slots.find((s) => str(s['星期']) === wd && hm5(s['開始時間']) === t[0] && hm5(s['結束時間']) === t[1] && same(split(s['使用場地']), courts));
      const c = { wd: wd, t: t, kind: reuse ? 'reuse' : 'new', n: 0, skip: 0, cancelled: 0, clash: null };
      if (!reuse) {
        const cl = slots.find((s) => str(s['星期']) === wd && ovl(t[0], t[1], hm5(s['開始時間']), hm5(s['結束時間']).replace('23:59', '24:00')) && split(s['使用場地']).some((x) => courts.indexOf(x) >= 0) &&
          (!day(s['生效日期']) || !ds.length || day(s['生效日期']) <= ds[ds.length - 1]) && (!day(s['結束日期']) || !ds.length || day(s['結束日期']) >= ds[0]));
        if (cl) { c.kind = 'clash'; c.clash = cl; } else c.n = ds.length;
      } else {
        const have = {};
        (PB.ix.availBySlot[str(reuse['時段ID'])] || []).forEach((a) => { have[day(a['日期'])] = str(a['狀態']); });
        ds.forEach((d) => { if (!have[d]) c.n += 1; else if (have[d] === '取消') c.cancelled += 1; else c.skip += 1; });
      }
      cells.push(c);
    }));
    return { tv: tv, wds: wds, cells: cells, dates: dates, total: cells.reduce((x, c) => x + c.n, 0) };
  }
  function sbDraw() {
    const el = document.getElementById('sbPrev');
    if (!el) return;
    const box = document.getElementById('sbBox');
    SB_.wds = new Set(Array.from(box.querySelectorAll('[data-sbwd] input:checked')).map((i) => i.value));
    SB_.courts = new Set(Array.from(box.querySelectorAll('[data-sbc] input:checked')).map((i) => i.value));
    SB_.use = new Set(Array.from(box.querySelectorAll('[data-sbu] input:checked')).map((i) => i.value));
    SB_.from = box.querySelector('#sbFrom').value;
    SB_.to = box.querySelector('#sbTo').value;
    SB_.note = box.querySelector('#sbNote').value.trim();
    const p = sbPlan();
    const pri = document.querySelector('.modal-f .btn.pri');
    const why = !SB_.wds.size ? '先勾星期' : !p.tv.times.length ? '請填時間' : p.tv.err ? p.tv.err : !SB_.courts.size ? '請至少勾 1 面球面' : !SB_.from || !SB_.to ? '請填日期' : SB_.from > SB_.to ? '開始日期不能晚於結束日期' : '';
    if (pri) { pri.disabled = !!why || !p.total; pri.textContent = p.total && !why ? '建立（可用日 ' + p.total + ' 天）' : '建立'; }
    if (why) { el.innerHTML = '<span class="mut">' + esc(why) + '</span>'; return; }
    const lab = { new: '新增', reuse: '沿用', clash: '重疊' };
    let mx = '<tr><th></th>' + p.wds.map((w) => '<th>週' + w + '</th>').join('') + '</tr>';
    p.tv.times.forEach((t) => {
      mx += '<tr><td class="sb-t">' + esc(t[0] + '–' + t[1]) + '</td>' + p.wds.map((w) => {
        const c = p.cells.find((x) => x.wd === w && x.t === t);
        const sub = c.kind === 'clash' ? '跳過' : c.n + ' 天' + (c.skip ? '<small>已有 ' + c.skip + '</small>' : '') + (c.cancelled ? '<small>取消 ' + c.cancelled + '</small>' : '');
        return '<td><div class="sb-c ' + c.kind + '"' + (c.clash ? ' title="和 ' + esc(m.slotLabel(c.clash)) + ' 重疊"' : '') + '><b>' + lab[c.kind] + '</b>' + sub + '</div></td>';
      }).join('') + '</tr>';
    });
    const all = uniq([].concat.apply([], Object.keys(p.dates).map((w) => p.dates[w]))).sort();
    const byM = {};
    all.forEach((d) => { (byM[d.slice(0, 7)] = byM[d.slice(0, 7)] || []).push(d); });
    const mon = Object.keys(byM).sort().map((ym) => '<div class="sb-mon"><span class="sb-mh">' + (+ym.slice(5)) + ' 月・' + byM[ym].filter((d) => !SB_.off.has(d)).length + ' 天</span><div class="lease-dates">' +
      byM[ym].map((d) => '<button type="button" class="ldate' + (SB_.off.has(d) ? ' off' : '') + '" data-sbd="' + d + '">' + esc(fmtD(d)) + '</button>').join('') + '</div></div>').join('');
    const nNew = p.cells.filter((c) => c.kind === 'new' && c.n).length;
    const nRe = p.cells.filter((c) => c.kind === 'reuse').length;
    const nCl = p.cells.filter((c) => c.kind === 'clash');
    const can = p.cells.reduce((x, c) => x + c.cancelled, 0);
    el.innerHTML = '<div class="sb-h">星期 × 時間</div><div class="tbl-wrap"><table class="sb-mx">' + mx + '</table></div>' +
      '<div class="sb-lg"><span><i class="new"></i>新增時段</span><span><i class="reuse"></i>沿用既有時段，只補日期</span><span><i class="clash"></i>和同一面的時段重疊，跳過</span></div>' +
      '<div class="sb-h">日期<span class="mut">（點一下可排除這一天）</span></div>' + (mon || '<span class="mut">範圍內沒有勾選的星期</span>') +
      '<div class="lease-plan"><b>建立後會有：</b><ul><li>新增時段 ' + nNew + ' 個' + (nRe ? '、沿用 ' + nRe + ' 個' : '') + '</li><li>可用日 <b>' + p.total + '</b> 天（直接「可用」）</li>' +
      (nCl.length ? '<li>重疊跳過 ' + nCl.length + ' 格：' + esc(uniq(nCl.map((c) => m.slotLabel(c.clash))).join('、')) + '</li>' : '') + '</ul></div>' +
      (can ? '<div class="note warn">' + can + ' 天之前取消過，維持取消；要恢復請到「可用日」分頁</div>' : '') +
      (!p.total ? '<div class="note">沒有要新增的可用日（日期都已經有了，或時段都重疊）</div>' : '');
  }
  A.slotBatch = async (d) => {
    d = d || {};
    const src = d.copy ? PB.get('1_據點_時段', d.copy) : null;
    SB_.venue = str(d.venue) || str(src && src['據點']);
    if (!SB_.venue) return ui.toast('先選一個據點', 'bad');
    SB_.off = new Set();
    SB_.copy = src ? str(src['時段ID']) : '';
    const courts = PB.rows('1_據點_場地').filter((c) => str(c['據點']) === SB_.venue).sort((a, b) => byKey(str(a['場地名稱']), str(b['場地名稱'])));
    const onC = src ? split(src['使用場地']) : courts.filter((c) => str(c['狀態']) !== '暫停使用').map((c) => str(c['場地ID']));
    const onU = src ? split(src['用途']) : ['課程', '球敘'];
    const from = src && day(src['生效日期']) > today() ? day(src['生效日期']) : today();
    const to = src && day(src['結束日期']) >= from ? day(src['結束日期']) : '';
    const times = src ? [[hm5(src['開始時間']), hm5(src['結束時間'])]] : [['', '']];
    const body = '<div id="sbBox">' +
      (src ? '<div class="note">複製 <b>' + esc(m.slotLabel(src)) + '</b> 的時間、球面、用途；勾要複製到的星期</div>' : '') +
      '<div class="fld"><label>星期<b>*</b></label><div class="sb-wds"><div class="multi" data-sbwd>' + WDS.split('').map((w) => '<label><input type="checkbox" value="' + w + '"' + (src && str(src['星期']) === w ? ' disabled' : '') + '>' + w + '</label>').join('') + '</div>' +
      '<span class="sb-q"><button type="button" class="btn sm ghost" data-sbq="12345">平日</button><button type="button" class="btn sm ghost" data-sbq="67">週末</button><button type="button" class="btn sm ghost" data-sbq="">清除</button></span></div></div>' +
      '<div class="fld"><label>時間<b>*</b><span class="hint" style="margin-left:6px">一列一個時段</span></label>' + trowsHtml('sb', times, sbDraw) + '</div>' +
      '<div class="fld-row"><div class="fld"><label for="sbFrom">可用日期<b>*</b></label><div class="sb-range"><input type="date" id="sbFrom" value="' + esc(from) + '"><span class="mut">～</span><input type="date" id="sbTo" value="' + esc(to) + '"></div></div>' +
      '<div class="fld"><label for="sbNote">說明</label><input id="sbNote" placeholder="選填，例：11–12 月平日白天"></div></div>' +
      '<div class="fld-row"><div class="fld"><label>球面<b>*</b></label><div class="multi" data-sbc>' + (courts.map((c) => '<label><input type="checkbox" value="' + esc(c['場地ID']) + '"' + (onC.indexOf(str(c['場地ID'])) >= 0 ? ' checked' : '') + '>' + esc(c['場地名稱']) + (str(c['狀態']) === '暫停使用' ? '（暫停）' : '') + '</label>').join('') || '<span class="mut">這個據點還沒有球面，請先「新增球面」</span>') + '</div></div>' +
      '<div class="fld"><label>用途</label><div class="multi" data-sbu>' + ['課程', '球敘'].map((u) => '<label><input type="checkbox" value="' + u + '"' + (onU.indexOf(u) >= 0 ? ' checked' : '') + '>' + u + '</label>').join('') + '</div></div></div>' +
      '<div id="sbPrev" class="lease-prev sb-prev"></div></div>';
    const r = await ui.modal({ title: '批次新增時段｜' + m.venueName(SB_.venue), body: body, sticky: true, onOpen: () => setTimeout(sbDraw, 0), actions: [{ label: '取消' }, { label: '建立', kind: 'pri', click: async () => {
      sbDraw();
      const p = sbPlan();
      if (p.tv.err) { ui.toast(p.tv.err, 'bad'); return false; }
      if (!p.total) { ui.toast('沒有要新增的可用日', 'bad'); return false; }
      const out = await PB.run('slotBatch', { venue: SB_.venue, wds: p.wds, times: p.tv.times.map((t) => ({ start: t[0], end: t[1] })), from: SB_.from, to: SB_.to, courtIds: Array.from(SB_.courts), use: Array.from(SB_.use), off: Array.from(SB_.off), note: SB_.note });
      return out ? true : false;
    } }] });
    if (r) PB.render();
  };
  document.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#sbBox') && !e.target.dataset.tk) sbDraw(); });
  document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#sbBox') && (e.target.id === 'sbNote')) SB_.note = e.target.value.trim(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#sbBox [data-sbd], #sbBox [data-sbq]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.sbd) { const x = b.dataset.sbd; if (SB_.off.has(x)) SB_.off.delete(x); else SB_.off.add(x); }
    else {
      const pick = b.dataset.sbq.split('').map((n) => WDS[+n - 1]);
      document.querySelectorAll('#sbBox [data-sbwd] input').forEach((i) => { if (!i.disabled) i.checked = pick.indexOf(i.value) >= 0; });
    }
    sbDraw();
  });

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

  PB.dataScreen = Data;
})();
