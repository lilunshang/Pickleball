/**
 * 理論上匹克球｜內部網頁 acttype.js v4.36（2026/11/26：活動種類 — 一個表單新增／修改，存檔前先看快照）
 *   大類 球敘 → 0_球敘類型；單堂課 → 0_專項；期制課 → 0_課程模板（後端 TypeSetup.gs）
 *   表單只放要先確認的：人數、收費（學校／球館可分開）、場地成本與人力成本（勾「另外指定」才展開，只有管理層）、報名頁分頁
 *   球拍租借不用設定：快照會寫出租借方式與金額（球敘每支 $50、自由球敘不提供、課程免費借用）
 *   入口：主檔與紀錄 → 課程設定 → 活動種類（同時是定價總覽）；排課看板下方「＋ 新增活動種類」
 */
(function () {
  'use strict';
  const { esc, str, num, money, byKey, ui, m } = PB;
  const A = PB.acts;
  const MG = () => (PB.ws || []).indexOf('管理層') >= 0;
  const KINDS = {
    球敘: { t: '0_球敘類型', key: '球敘ID', name: '類型名稱', cat: '球敘', lo: '每面人數下限', hi: '每面人數上限' },
    單堂課: { t: '0_專項', key: '專項ID', name: '專項名稱', cat: '專項課', lo: '人數下限', hi: '人數上限' },
    期制課: { t: '0_課程模板', key: '模板ID', name: '模板名稱', cat: '期制課', lo: '人數下限', hi: '人數上限' },
  };
  const off = (v) => v === false || str(v).toUpperCase() === 'FALSE';
  const on = (v) => v === true || str(v).toUpperCase() === 'TRUE';
  const singleTypeId = () => str((PB.rows('0_課程類型').find((t) => str(t['課程類型']) === (PB.cfg.singleType || '單堂專項')) || {})['類型ID']);
  const cats = () => (PB.has('0_報名分類') ? PB.rows('0_報名分類') : []).slice().sort((a, b) => num(a['排序']) - num(b['排序']));
  const catName = (id) => { const c = id && PB.has('0_報名分類') ? PB.get('0_報名分類', id) : null; return c ? str(c['分類名稱']) : ''; };
  const kindOfTable = (t) => Object.keys(KINDS).find((k) => KINDS[k].t === t);
  const coachOpts = () => PB.rows('1_人員_教練').map((r) => ({ v: str(r['人員ID']), l: m.staffName(r['人員ID']) })).sort((a, b) => byKey(a.l, b.l));

  // ---------------- 表單 ----------------
  const fld = (label, inner, hint, n, hide) => '<div class="fld"' + (n ? ' data-box="' + n + '"' : '') + (hide ? ' style="display:none"' : '') + '><label>' + label + '</label>' + inner + (hint ? '<span class="hint">' + esc(hint) + '</span>' : '') + '</div>';
  const inp = (n, v, type, ph) => '<input data-n="' + n + '" type="' + (type || 'text') + '" value="' + esc(v === undefined || v === null ? '' : v) + '"' + (type === 'number' ? ' step="any" inputmode="decimal" min="0"' : '') + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>';
  const sel = (n, v, opts, blank) => '<select data-n="' + n + '">' + (blank !== undefined ? '<option value="">' + esc(blank) + '</option>' : '') + opts.map((o) => '<option value="' + esc(o.v) + '"' + (str(o.v) === str(v) ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + '</select>';
  const chk = (n, v, label) => '<label style="display:flex;gap:8px;align-items:flex-start;color:var(--ink);font-size:.92rem;margin:6px 0"><input type="checkbox" data-n="' + n + '"' + (v ? ' checked' : '') + ' style="margin-top:3px"> <span>' + esc(label) + '</span></label>';
  const head = (t, sub) => '<div style="margin:16px 0 2px;font-weight:700;border-top:1px solid var(--line);padding-top:12px">' + esc(t) + (sub ? '<span class="mut" style="font-weight:400;font-size:.82rem;margin-left:6px">' + esc(sub) + '</span>' : '') + '</div>';
  const note = (t) => '<p class="mut" style="margin:4px 0;font-size:.88rem">' + esc(t) + '</p>';
  const two = (a, b) => '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + a + b + '</div>';

  function formBody(st) {
    const K = KINDS[st.kind];
    const v = st.v;
    const isNew = !st.id;
    let h = '';
    if (isNew && !st.copy) h += fld('大類', '<div class="chips">' + Object.keys(KINDS).map((k) => '<button type="button" class="chip' + (k === st.kind ? ' on' : '') + '" data-kind="' + k + '">' + k + '</button>').join('') + '</div>', st.kind === '球敘' ? '有場主（或自由球敘），人數依面數算' : st.kind === '單堂課' ? '一堂一堂報名（例：專項課、陪練）' : '多堂一期（例：兒童班）');
    else h += note('大類：' + st.kind);
    h += fld('名稱<b>*</b>', inp('name', v[K.name]));
    // 報名頁分頁
    const copts = [{ v: '', l: K.cat + '（預設）' }].concat(cats().filter((c) => !off(c['是否啟用']) || str(c['分類ID']) === str(v['報名分類'])).map((c) => ({ v: str(c['分類ID']), l: str(c['分類名稱']) }))).concat([{ v: '__new', l: '＋ 新增分頁…' }]);
    h += fld('報名頁分頁', sel('cat', st.newCatPick ? '__new' : v['報名分類'], copts) + '<input data-n="newCat" placeholder="新分頁名稱（例：陪練）" value="' + esc(st.newCat || '') + '" style="margin-top:6px;' + (st.newCatPick ? '' : 'display:none') + '">', '學員報名頁放在哪個分頁');
    if (st.kind === '單堂課') h += fld('建議程度<b>*</b>', sel('程度', v['程度'], PB.rows('0_程度').slice().sort((a, b) => num(a['排序']) - num(b['排序'])).map((r) => ({ v: str(r['程度ID']), l: str(r['程度名稱']) })), '請選擇'), '報名頁顯示「建議程度」，不擋報名');
    if (st.kind === '期制課') h += fld('課程類型<b>*</b>', sel('課程類型', v['課程類型'], PB.rows('0_課程類型').filter((t) => str(t['類型ID']) !== singleTypeId()).map((r) => ({ v: str(r['類型ID']), l: str(r['課程類型']) })), '請選擇'), '請假上限、補課規則照課程類型');
    if (st.kind === '球敘') {
      h += fld('報名規則', sel('報名規則', v['報名規則'] || '不限', ['不限', '分級', 'DUPR'].map((x) => ({ v: x, l: x }))), '不限＝不檢查；分級＝依程度；DUPR＝依分數區間');
      h += fld('限定性別', sel('限定性別', v['限定性別'], [{ v: '女', l: '只限女性' }], '不限'));
    }
    if (st.kind !== '期制課') h += fld('報名頁說明', '<textarea data-n="說明">' + esc(v['說明'] || '') + '</textarea>');

    // 人數
    h += head('人數', st.kind === '球敘' ? '每一面' : '');
    h += two(fld(st.kind === '球敘' ? '每面成團人數' : '成班人數（下限）', inp('lo', v[K.lo], 'number', st.kind === '球敘' ? '例：4' : '空白＝5')),
      fld(st.kind === '球敘' ? '每面額滿人數' : '額滿人數（上限）', inp('hi', v[K.hi], 'number', st.kind === '球敘' ? '例：8' : '空白＝6')));
    h += note('下限填 1＝一人就成' + (st.kind === '球敘' ? '團' : '班'));

    // 收費
    h += head('收費');
    if (st.kind === '期制課') {
      const how = str(v['計費方式']) || '每期';
      h += fld('計費方式', '<div class="chips">' + ['每期', '每堂', '每小時'].map((x) => '<button type="button" class="chip' + (x === how ? ' on' : '') + '" data-how="' + x + '">' + x + '</button>').join('') + '</div>', how === '每期' ? '整期一個價，要填總堂數' : how === '每堂' ? '一堂一個價，總堂數固定 1 堂' : '費用 × 每堂時數');
      h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' + fld('費用（' + (how === '每期' ? '整期' : how === '每堂' ? '每堂' : '每小時') + '）', inp('費用', v['費用'], 'number')) +
        fld('總堂數' + (how === '每期' ? '<b>*</b>' : ''), how === '每堂' ? '<div class="ro">1</div>' : inp('總堂數', v['總堂數'], 'number', how === '每小時' ? '空白＝1' : '')) + fld('每堂時數', inp('每堂時數', v['每堂時數'], 'number', '例：2')) + '</div>';
    } else {
      const fa = st.kind === '球敘' ? '學校費用' : '費用';
      const s = v[fa], g = v['球館費用'];
      if (st.split === undefined) st.split = str(g) !== '' && str(s) !== str(g);
      const unit = st.kind === '球敘' ? '場' : '堂';
      h += fld('收費方式', '<div class="chips"><button type="button" class="chip' + (!st.split ? ' on' : '') + '" data-split="0">一個價格</button><button type="button" class="chip' + (st.split ? ' on' : '') + '" data-split="1">學校、球館分開</button></div>');
      h += st.split ? two(fld('學校（每人每' + unit + '）', inp('price', s, 'number', st.kind === '單堂課' ? '空白＝1,000' : '')), fld('球館（每人每' + unit + '）', inp('gym', g, 'number', st.kind === '單堂課' ? '空白＝1,200' : '')))
        : fld('每人每' + unit, inp('price', s, 'number', st.kind === '單堂課' ? '空白＝依據點 學校 1,000／球館 1,200' : ''));
    }

    // 場地成本
    if (st.kind === '球敘') h += head('場地成本') + note('依據點「球敘」的合作方案（不用設定）');
    else if (MG()) {
      const how = str(v['場地成本歸類']);
      if (st.costOn === undefined) st.costOn = !!how && how !== '依大類';
      h += head('場地成本') + chk('costOn', st.costOn, '另外指定（預設：依據點「課程」的合作方案）');
      const pick = how && how !== '依大類' ? how : '球敘';
      h += '<div data-box="cost"' + (st.costOn ? '' : ' style="display:none"') + '>' + fld('照什麼算', sel('場地成本歸類', pick, [{ v: '球敘', l: '照據點「球敘」的合作方案（例：匹克立 $500／面／小時）' }, { v: '課程', l: '照據點「課程」的合作方案' }, { v: '自訂', l: '自訂每面每小時金額' }])) +
        fld('每面每小時', inp('場地成本每小時', v['場地成本每小時'], 'number'), '', 'costAmt', pick !== '自訂') + '</div>';
    }

    // 人力成本
    if (st.kind === '球敘') {
      if (st.laborOn === undefined) st.laborOn = off(v['需要場主']);
      h += head('人力成本') + chk('laborOn', st.laborOn, '另外指定（預設：自動排場主；學校據點場主費依人數級距，球館據點沒有場主費）');
      h += '<div data-box="labor"' + (st.laborOn ? '' : ' style="display:none"') + '>' + chk('noHost', off(v['需要場主']), '不需要場主（自由球敘：不排場主、沒有場主費、不提供球拍）') + '</div>';
    } else if (MG()) {
      if (st.laborOn === undefined) st.laborOn = str(v['教練費']) !== '' || !!str(v['預設教練']) || on(v['不套用小班規則']);
      h += head('人力成本') + chk('laborOn', st.laborOn, '另外指定（預設：教練費照課程類型標準' + (st.kind === '單堂課' ? '；3–4 人時教練只教 1 小時' : '') + '）');
      h += '<div data-box="labor"' + (st.laborOn ? '' : ' style="display:none"') + '>' +
        two(fld('教練費', inp('教練費', v['教練費'], 'number', '空白＝標準')), fld('計價', sel('教練費計價', v['教練費計價'] || '每場', [{ v: '每場', l: '每場固定' }, { v: '每小時', l: '每小時（× 上課時數）' }]))) +
        (st.kind === '單堂課' ? chk('不套用小班規則', on(v['不套用小班規則']), '人少時也照上面的教練費（不套用 3–4 人教練只教 1 小時）') : '') +
        fld('預設教練', sel('預設教練', v['預設教練'], coachOpts(), '（不指定）'), '排課時自動帶入，可以再換') + '</div>';
    } else {
      h += head('場地成本、人力成本') + note('依目前設定（教練費、場地成本只有管理層能改）') + fld('預設教練', sel('預設教練', v['預設教練'], coachOpts(), '（不指定）'), '排課時自動帶入，可以再換');
    }

    h += head('球拍租借') + note('每個活動都能租借，學員報名時自己勾選；租借方式與金額寫在存檔前的快照');
    if (!isNew) h += head('狀態') + chk('active', !off(v['是否啟用']), '啟用（取消勾選＝排課看板不再出現，已排好的不受影響）');
    return h;
  }

  /** 從表單讀回 st.v（目標表的欄名）；切換大類／計費方式時先讀，重畫後不會掉資料 */
  function readForm(el, st) {
    const K = KINDS[st.kind];
    const g = (n) => { const x = el.querySelector('[data-n="' + n + '"]'); return x ? (x.type === 'checkbox' ? x.checked : x.value.trim()) : undefined; };
    const v = st.v;
    const set = (k, x) => { if (x !== undefined) v[k] = x; };
    set(K.name, g('name'));
    const c = g('cat');
    if (c !== undefined) { st.newCatPick = c === '__new'; st.newCat = st.newCatPick ? (g('newCat') || '') : ''; if (!st.newCatPick) v['報名分類'] = c; }
    ['程度', '課程類型', '報名規則', '限定性別', '說明', '費用', '總堂數', '每堂時數', '教練費', '教練費計價', '預設教練', '場地成本歸類', '場地成本每小時'].forEach((k) => set(k, g(k)));
    set(K.lo, g('lo'));
    set(K.hi, g('hi'));
    if (st.kind !== '期制課') {
      const fa = st.kind === '球敘' ? '學校費用' : '費用';
      set(fa, g('price'));
      if (st.split) set('球館費用', g('gym'));
      else v['球館費用'] = st.kind === '球敘' ? v[fa] : ''; // 一個價格：球敘學校＝球館；單堂課球館空白＝跟費用一樣
    }
    if (g('costOn') !== undefined) st.costOn = g('costOn');
    if (g('laborOn') !== undefined) st.laborOn = g('laborOn');
    if (st.kind === '球敘') { const nh = g('noHost'); if (nh !== undefined) v['需要場主'] = !(st.laborOn && nh); }
    if (st.kind === '單堂課') set('不套用小班規則', g('不套用小班規則'));
    const act = g('active');
    if (act !== undefined) v['是否啟用'] = act;
  }

  /** 送到後端的欄位：沒勾「另外指定」→ 成本欄清空（回到預設） */
  function payload(st) {
    const K = KINDS[st.kind];
    const v = Object.assign({}, st.v);
    const keep = [K.name, '報名分類', K.lo, K.hi, '是否啟用', '預設教練'];
    if (st.kind === '球敘') keep.push('報名規則', '限定性別', '說明', '學校費用', '球館費用', '需要場主');
    if (st.kind === '單堂課') keep.push('程度', '說明', '費用', '球館費用');
    if (st.kind === '期制課') keep.push('課程類型', '費用', '計費方式', '總堂數', '每堂時數');
    if (st.kind !== '球敘' && MG()) {
      keep.push('場地成本歸類', '場地成本每小時', '教練費', '教練費計價');
      if (st.kind === '單堂課') keep.push('不套用小班規則');
      if (!st.costOn) { v['場地成本歸類'] = ''; v['場地成本每小時'] = ''; } else if (v['場地成本歸類'] !== '自訂') v['場地成本每小時'] = '';
      if (!st.laborOn) { v['教練費'] = ''; v['教練費計價'] = ''; v['預設教練'] = ''; if (st.kind === '單堂課') v['不套用小班規則'] = false; }
    }
    if (st.kind === '期制課' && !v['計費方式']) v['計費方式'] = '每期';
    if (st.kind === '期制課' && v['計費方式'] === '每堂') v['總堂數'] = 1;
    if (st.kind === '球敘' && !st.laborOn) v['需要場主'] = true;
    const out = {};
    keep.forEach((k) => { if (v[k] !== undefined) out[k] = v[k]; });
    if (!st.id && out['是否啟用'] === undefined) out['是否啟用'] = true;
    return out;
  }

  function bind(el, st, rerender) {
    el.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => { readForm(el, st); st.kind = b.dataset.kind; st.split = undefined; st.costOn = undefined; st.laborOn = undefined; rerender(); }));
    el.querySelectorAll('[data-how]').forEach((b) => b.addEventListener('click', () => { readForm(el, st); st.v['計費方式'] = b.dataset.how; if (b.dataset.how === '每堂') st.v['總堂數'] = 1; rerender(); }));
    el.querySelectorAll('[data-split]').forEach((b) => b.addEventListener('click', () => { readForm(el, st); st.split = b.dataset.split === '1'; if (!st.split) st.v['球館費用'] = ''; rerender(); }));
    const cs = el.querySelector('[data-n="cat"]');
    if (cs) cs.addEventListener('change', () => { const n = el.querySelector('[data-n="newCat"]'); n.style.display = cs.value === '__new' ? '' : 'none'; if (cs.value === '__new') n.focus(); });
    const tg = (n, box) => { const x = el.querySelector('[data-n="' + n + '"]'); if (x) x.addEventListener('change', () => { const b = el.querySelector('[data-box="' + box + '"]'); if (b) b.style.display = x.checked ? '' : 'none'; }); };
    tg('costOn', 'cost');
    tg('laborOn', 'labor');
    const ck = el.querySelector('[data-n="場地成本歸類"]');
    if (ck) ck.addEventListener('change', () => { const b = el.querySelector('[data-box="costAmt"]'); if (b) b.style.display = ck.value === '自訂' ? '' : 'none'; });
  }

  function snapHtml(snap) {
    return '<p style="margin:0 0 6px">請確認剛剛設定的內容，按「確認寫入」才會存起來。</p>' + snap.map((s) => '<div style="margin:12px 0 4px;font-weight:700">' + esc(s.title) + '</div><div class="at-snap" style="display:grid;grid-template-columns:7em 1fr;gap:4px 10px;font-size:.92rem">' + s.rows.map((r) => '<span class="mut">' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span>').join('') + '</div>').join('');
  }

  /**
   * 開表單：o { kind, id（修改）, copy（複製這一列的 ID）, onSaved(id) }
   * 流程：表單 →（儲存）後端檢查＋快照 →（確認寫入）存檔；「返回修改」回到表單、資料不會掉
   * 修改時改到價格／教練費 → 跟一般表單一樣問要不要套用到已排好的（PB.ripple／PB.link）
   */
  PB.actType = async (o) => {
    o = o || {};
    const K0 = KINDS[o.kind] || KINDS['單堂課'];
    const src = o.id ? PB.get(K0.t, o.id) : o.copy ? PB.get(K0.t, o.copy) : null;
    if ((o.id || o.copy) && !src) { ui.toast('資料已不存在，請重新整理', 'bad'); return null; }
    const st = { kind: KINDS[o.kind] ? o.kind : '單堂課', id: o.id || '', copy: !!o.copy, v: Object.assign({}, src || {}), newCat: '', newCatPick: false };
    if (o.copy) { delete st.v[K0.key]; st.v[K0.name] = str(st.v[K0.name]) + '（複製）'; st.v['是否啟用'] = true; }
    for (;;) {
      let snap = null;
      let send = null;
      const ok = await ui.modal({
        title: (st.id ? '修改' : o.copy ? '複製' : '新增') + '活動種類',
        body: '<div data-at>' + formBody(st) + '</div>',
        sticky: true,
        onOpen: (el) => {
          const root = el.querySelector('[data-at]');
          const rerender = () => { root.innerHTML = formBody(st); bind(root, st, rerender); };
          bind(root, st, rerender);
        },
        actions: [{ label: '取消' }, {
          label: '儲存', kind: 'pri',
          click: async (el) => {
            readForm(el, st);
            if (st.newCatPick && !st.newCat) { ui.toast('請填新分頁的名稱', 'bad'); return false; }
            send = { kind: st.kind, id: st.id, values: payload(st), newCat: st.newCatPick ? st.newCat : '' };
            const r = await PB.read('typePreview', send);
            if (!r) return false;
            snap = r.snapshot;
            return true;
          },
        }],
      });
      if (!ok) return null;
      let saved = null;
      const go = await ui.modal({
        title: '確認' + (st.id ? '修改' : '新增') + '：' + str(st.v[KINDS[st.kind].name]),
        body: snapHtml(snap),
        sticky: true,
        actions: [{ label: '返回修改', value: 'back' }, {
          label: '確認寫入', kind: 'pri',
          click: async () => {
            const r = await PB.run('typeSave', send);
            if (!r) return false;
            saved = r.data;
            return true;
          },
        }],
      });
      if (go === 'back') continue;
      if (!saved) return null;
      const t = KINDS[st.kind].t;
      if (st.id && saved.changed) {
        if (PB.RIPPLE_TABLES.indexOf(t) >= 0) await PB.ripple();
        if ((PB.LINK_KEYS[t] || []).some((k) => saved.changed.indexOf(k) >= 0)) await PB.link(t, saved.id);
      }
      if (o.onSaved) o.onSaved(saved.id);
      return saved.id;
    }
  };

  A.actNew = (d) => PB.actType({ kind: d.v || '單堂課' });
  A.actEdit = (d) => PB.actType({ kind: kindOfTable(d.t), id: d.id });
  A.actCopy = (d) => PB.actType({ kind: kindOfTable(d.t), copy: d.id });
  A.actFilter = (d) => PB.setParam('ak', d.v);

  // ---------------- 清單（同時是定價總覽） ----------------
  const priceText = (kind, r) => {
    if (kind === '期制課') { const how = str(r['計費方式']) || '每期'; return str(r['費用']) ? money(r['費用']) + '／' + (how === '每期' ? '期（' + num(r['總堂數']) + ' 堂）' : how === '每堂' ? '堂' : '小時') : '—'; }
    const s = num(kind === '球敘' ? r['學校費用'] : r['費用']), g = num(r['球館費用']);
    if (kind === '單堂課' && !s && !g) { const p = PB.cfg.specPrice || { 學校: 1000, 球館: 1200 }; return '依據點 ' + money(p['學校']) + '／' + money(p['球館']); }
    if (s && (!g || g === s)) return money(s);
    return (s ? '學校 ' + money(s) : '學校 —') + '・' + (g ? '球館 ' + money(g) : '球館 —');
  };
  const peopleText = (kind, r) => { const K = KINDS[kind]; const lo = str(r[K.lo]), hi = str(r[K.hi]); return (kind === '球敘' ? '每面 ' : '') + (lo || (kind === '球敘' ? '—' : '5')) + '–' + (hi || (kind === '球敘' ? '依球面' : '6')); };
  const costText = (kind, r) => { if (kind === '球敘') return '球敘方案'; const h = str(r['場地成本歸類']); return h === '自訂' ? '自訂 ' + money(r['場地成本每小時']) + '／時' : h === '球敘' ? '照球敘方案' : '預設'; };
  const laborText = (kind, r) => {
    if (kind === '球敘') return off(r['需要場主']) ? '無場主' : '場主費級距';
    const f = str(r['教練費']) !== '' ? money(r['教練費']) + (str(r['教練費計價']) === '每小時' ? '／時' : '／場') : '標準';
    return f + (kind === '單堂課' && on(r['不套用小班規則']) ? '・不套小班' : '') + (str(r['預設教練']) ? '・' + m.staffName(r['預設教練']) : '');
  };
  const racketText = (kind, r) => (kind === '球敘' ? (off(r['需要場主']) ? '不提供' : money(num(PB.cfg.racketFee) || 50) + '／支') : '免費借用');

  PB.actTypeView = (p) => {
    const want = KINDS[p.ak] ? p.ak : '';
    const mg = MG();
    const kinds = Object.keys(KINDS).filter((k) => !want || k === want);
    const filt = '<div class="chips" style="margin:6px 0 10px">' + [['', '全部']].concat(Object.keys(KINDS).map((k) => [k, k])).map((x) => '<button class="chip' + (x[0] === want ? ' on' : '') + '" data-act="actFilter" data-v="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
    const kw = str(p.q).toLowerCase();
    const body = kinds.map((k) => {
      const K = KINDS[k];
      if (!PB.has(K.t)) return '';
      let list = PB.rows(K.t);
      if (k === '期制課') list = list.filter((t) => str(t['課程類型']) !== singleTypeId());
      if (kw) list = list.filter((r) => str(r[K.name]).toLowerCase().indexOf(kw) >= 0);
      list = list.slice().sort((a, b) => byKey((off(a['是否啟用']) ? '1' : '0') + str(a[K.name]), (off(b['是否啟用']) ? '1' : '0') + str(b[K.name])));
      const cols = ['名稱', '報名頁分頁', '人數', '收費'].concat(mg ? ['場地成本', '人力成本'] : []).concat(['球拍', '狀態', '']);
      const rows = list.map((r) => '<tr class="click" data-act="actEdit" data-t="' + K.t + '" data-id="' + esc(r[K.key]) + '"><td><b>' + esc(r[K.name]) + '</b></td><td>' + esc(catName(r['報名分類']) || K.cat) + '</td><td>' + esc(peopleText(k, r)) + '</td><td>' + esc(priceText(k, r)) + '</td>' +
        (mg ? '<td>' + esc(costText(k, r)) + '</td><td>' + esc(laborText(k, r)) + '</td>' : '') + '<td>' + esc(racketText(k, r)) + '</td><td>' + (off(r['是否啟用']) ? '<span class="badge">停用</span>' : '<span class="badge ok">啟用</span>') + '</td>' +
        '<td data-stop style="text-align:right">' + ui.btn('複製', 'actCopy', { t: K.t, id: r[K.key] }, 'sm ghost') + '</td></tr>').join('');
      return '<div class="sec"><h2>' + esc(k) + '</h2><span class="cnt">' + list.length + '</span><span class="sp"></span>' + ui.btn('新增' + k, 'actNew', { v: k }, 'sm', 'plus') + '</div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="mut">沒有資料</td></tr>') + '</tbody></table></div>';
    }).join('');
    return '<div class="ptop"><label class="search">' + PB.icon('search') + '<input placeholder="搜尋名稱" value="' + esc(p.q || '') + '" data-input="dataSearch"></label><span class="sp"></span>' + ui.btn('新增活動種類', 'actNew', { v: want || '單堂課' }, 'pri', 'plus') + '</div>' + filt + body;
  };
})();
