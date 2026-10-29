/**
 * 理論上匹克球｜內部網頁共用程式 common.js v2.3（2026/10/26）
 *   PB.api   呼叫 GAS（登入、載入、操作）
 *   PB.db    資料（開頁一次載入；操作後就地更新）
 *   PB.m     業務計算（付款狀態、班級人數、球敘名額、學員堂數…，與學員 OA 同規則）
 *   PB.ui    畫面元件（提示、對話框、詳情面板、表單）
 *   PB.app() 外框、選單、路由；各畫面在 ops.js／admin.js 定義
 * 原則：每個畫面、每個區塊各自 try/catch，一處出錯只顯示該處錯誤，其他照常可用。
 */
(function () {
  'use strict';
  const C = window.APP_CONFIG || {};
  const PB = (window.PB = { acts: {}, inputs: {} });
  const TZ = 'Asia/Taipei';

  // ================================================================
  // 工具
  // ================================================================
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
  const split = (v) => (Array.isArray(v) ? v : str(v).split(/\s*,\s*/)).map(str).filter(Boolean);
  const num = (v) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v));
  const money = (n) => (n < 0 ? '−' : '') + 'NT$' + Math.round(Math.abs(num(n))).toLocaleString('en-US');
  const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const today = () => fmtKey.format(new Date());
  const nowText = () => today() + ' ' + fmtTime.format(new Date());
  const addDays = (key, n) => {
    const p = key.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.toISOString().slice(0, 10);
  };
  const wd = (key) => {
    const p = str(key).slice(0, 10).split('-').map(Number);
    return p.length === 3 && p[0] ? '日一二三四五六'.charAt(new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()) : '';
  };
  const day = (v) => str(v).slice(0, 10);
  const fmtD = (v) => (day(v) ? +day(v).slice(5, 7) + '/' + +day(v).slice(8, 10) + '（' + wd(v) + '）' : '');
  const fmtDT = (v) => (str(v).length > 10 ? fmtD(v) + ' ' + str(v).slice(11, 16) : fmtD(v));
  const monthOf = (v) => str(v).slice(0, 7);
  const daysBetween = (a, b) => Math.round((Date.parse(day(b)) - Date.parse(day(a))) / 86400000);
  const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
  const sum = (a, f) => a.reduce((s, x) => s + num(f ? f(x) : x), 0);
  const groupBy = (rows, col) => {
    const m = {};
    rows.forEach((r) => {
      const k = str(r[col]);
      if (k) (m[k] = m[k] || []).push(r);
    });
    return m;
  };
  const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  Object.assign(PB, { esc, str, split, num, money, today, nowText, addDays, wd, day, fmtD, fmtDT, monthOf, daysBetween, uniq, sum, groupBy, byKey, cfg: C });

  const ICON = {
    today: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    ball: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="12" cy="12.5" r=".8"/><circle cx="9" cy="16" r=".8"/><circle cx="15" cy="16" r=".8"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
    link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    kb: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
    mega: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 8a5 5 0 0 1 0 8"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.9 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5v1.5M12 16v1.5"/>',
  };
  PB.icon = (n) => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (ICON[n] || '') + '</svg>';

  // 安全存取 localStorage（私密視窗、被封鎖時不讓程式停下）
  const LS = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };
  PB.LS = LS;

  // ================================================================
  // API
  // ================================================================
  class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  PB.api = {
    get token() { return LS.get('pb:token') || ''; },
    set token(t) { if (t) LS.set('pb:token', t); else LS.del('pb:token'); },
    async post(body, timeout) {
      if (!C.GAS_URL || /填入/.test(C.GAS_URL)) throw new ApiError('SETUP', '尚未設定 config.js 的 GAS_URL');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout || 45000);
      let res;
      try {
        res = await fetch(C.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        throw new ApiError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', e.name === 'AbortError' ? '連線逾時，請再試一次' : '網路連線失敗，請檢查網路');
      } finally {
        clearTimeout(timer);
      }
      let j;
      try { j = await res.json(); } catch (e) { throw new ApiError('BAD_RESPONSE', '伺服器回應格式錯誤（GAS 是否已部署新版本？）'); }
      if (!j.ok) throw new ApiError(j.code || 'ERROR', j.message || '發生錯誤');
      return j.data;
    },
    login: (idToken) => PB.api.post({ a: 'login', app: PB.appId, idToken: idToken }),
    boot: () => PB.api.post({ a: 'boot', app: PB.appId, t: PB.api.token }),
    ops: (ops) => PB.api.post({ a: 'ops', app: PB.appId, t: PB.api.token, ops: ops }, 60000),
  };
  /** 測試用：GAS 編輯器執行 testToken() 取得憑證後，在主控台執行 PB.useToken('…') */
  PB.useToken = (t) => { PB.api.token = t; location.reload(); };

  // ================================================================
  // 資料
  // ================================================================
  const db = (PB.db = { t: {}, by: {}, keys: {} });
  PB.rows = (t) => db.t[t] || [];
  PB.get = (t, id) => (db.by[t] && id !== undefined && id !== null ? db.by[t][str(id)] : undefined) || null;
  PB.has = (t) => !!db.t[t] && !db.missing[t];

  function loadBoot(b) {
    PB.boot = b;
    PB.me = b.me;
    PB.ws = b.me.ws || [];
    PB.forms = b.forms || {};
    PB.enums = b.enums || {};
    Object.assign(C, { liff: b.cfg.liff }, b.cfg);
    db.keys = b.keys || {};
    db.t = {};
    db.by = {};
    db.missing = {};
    db.cols = {};
    Object.keys(b.tables).forEach((name) => {
      const p = b.tables[name];
      db.cols[name] = p.cols || [];
      if (p.missing) db.missing[name] = true;
      db.t[name] = (p.rows || []).map((r) => {
        const o = {};
        p.cols.forEach((c, i) => { o[c] = r[i]; });
        return o;
      });
      indexTable(name);
    });
    db.at = b.at;
    rebuild();
  }

  function indexTable(name) {
    const k = db.keys[name];
    const m = {};
    if (k) db.t[name].forEach((r) => { m[str(r[k])] = r; });
    db.by[name] = m;
  }

  function upsert(name, row) {
    if (!db.t[name]) return;
    const k = db.keys[name];
    const id = str(row[k]);
    const old = db.by[name][id];
    if (old) Object.assign(old, row);
    else { db.t[name].push(row); db.by[name][id] = row; }
    row && Object.keys(row).forEach((c) => { if (db.cols[name] && db.cols[name].indexOf(c) < 0) db.cols[name].push(c); });
  }
  function removeRow(name, id) {
    if (!db.t[name]) return;
    const r = db.by[name][str(id)];
    if (!r) return;
    db.t[name].splice(db.t[name].indexOf(r), 1);
    delete db.by[name][str(id)];
  }

  function applyOut(out) {
    if (!out) return;
    Object.keys(out.patch || {}).forEach((t) => out.patch[t].forEach((r) => upsert(t, r)));
    Object.keys(out.removed || {}).forEach((t) => out.removed[t].forEach((id) => removeRow(t, id)));
    rebuild();
    saveSnapshot();
  }
  PB.applyOut = applyOut;

  // 本機快取：上次的資料先顯示，背景再更新（登出或 24 小時後清除）
  let saveTimer = null;
  function snapKey() { return 'pb:snap:' + PB.appId; }
  function saveSnapshot() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!PB.boot) return;
      const tables = {};
      Object.keys(db.t).forEach((n) => {
        const cols = db.cols[n] || [];
        tables[n] = { cols: cols, rows: db.t[n].map((o) => cols.map((c) => (o[c] === undefined ? '' : o[c]))), missing: !!db.missing[n] };
      });
      const snap = Object.assign({}, PB.boot, { tables: tables, at: db.at });
      if (!LS.set(snapKey(), JSON.stringify({ saved: Date.now(), email: PB.me.email, boot: snap }))) LS.del(snapKey());
    }, 1500);
  }
  function loadSnapshot() {
    const raw = LS.get(snapKey());
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (Date.now() - s.saved > 24 * 3600000) return null;
      const tokEmail = tokenEmail();
      if (tokEmail && s.email !== tokEmail) return null;
      return s.boot;
    } catch (e) { return null; }
  }
  function tokenEmail() {
    try {
      const p = PB.api.token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p)))).e;
    } catch (e) { return ''; }
  }

  // ================================================================
  // 業務計算（與學員 OA v3.9 同規則）
  // ================================================================
  const ix = (PB.ix = {});
  const m = (PB.m = {});
  function rebuild() {
    const R = PB.rows;
    ix.sigByClass = groupBy(R('2_報名').filter((r) => str(r['報名類型']) === '課程'), '班級');
    ix.sigByGame = groupBy(R('2_報名').filter((r) => str(r['報名類型']) === '球敘'), '球敘');
    ix.sigByStu = groupBy(R('2_報名'), '學員');
    ix.recBySig = groupBy(R('3_應收帳款'), '報名');
    ix.recByStu = groupBy(R('3_應收帳款'), '學員');
    ix.recByPayer = groupBy(R('3_應收帳款'), '付款人');
    ix.payByRec = groupBy(R('3_收款明細'), '應收款項');
    ix.sesByClass = groupBy(R('2_上課場次'), '班級');
    Object.keys(ix.sesByClass).forEach((k) => ix.sesByClass[k].sort((a, b) => byKey(day(a['日期']) + str(a['開始時間']), day(b['日期']) + str(b['開始時間']))));
    ix.sesByDay = groupBy(R('2_上課場次').map((s) => Object.assign(s, { _d: day(s['日期']) })), '_d');
    ix.gameByDay = groupBy(R('2_球敘場次').map((g) => Object.assign(g, { _d: day(g['日期']) })), '_d');
    ix.attBySes = groupBy(R('2_出缺勤'), '上課場次');
    ix.attByStu = groupBy(R('2_出缺勤'), '學員');
    ix.attBySrc = groupBy(R('2_出缺勤'), '補課來源');
    ix.dutyByGame = groupBy(R('2_場主排班'), '球敘');
    ix.lessonByStu = groupBy(R('3_堂數流水'), '學員');
    ix.stuByGuardian = groupBy(R('1_學員'), '管理人');
    ix.journalBySes = groupBy(R('2_課程日誌'), '上課場次');
    ix.leadByStu = groupBy(R('2_招生跟進'), '學員');
    ix.slotByVenue = groupBy(R('1_據點_時段'), '據點');
    ix.courtByVenue = groupBy(R('1_據點_場地'), '據點');
    ix.availBySlot = groupBy(R('1_據點_可用日'), '時段');
    ix.creditByPayer = groupBy(R('3_抵用金流水'), '付款人');
    ix.recCache = {};
    ix.sigCache = {};
    if (PB.onRebuild) PB.onRebuild();
  }
  PB.rebuild = rebuild;

  // ---- 名稱 ----
  const nameOf = (t, col) => (id) => { const r = PB.get(t, id); return r ? str(r[col]) : str(id); };
  m.stuName = (id) => { const s = PB.get('1_學員', id); return s ? str(s['姓名']) || str(s['LINE顯示名稱']) || '（未填姓名）' : str(id); };
  m.staffName = nameOf('1_人員', '姓名');
  m.venueName = nameOf('1_據點', '據點名稱');
  m.courtName = nameOf('1_據點_場地', '場地名稱');
  m.levelName = nameOf('0_程度', '程度名稱');
  m.typeName = nameOf('0_課程類型', '課程類型');
  m.coachName = (id) => m.staffName(id);
  m.hm = (s, e) => str(s).slice(0, 5) + (e ? '–' + str(e).slice(0, 5).replace('23:59', '24:00') : '');
  m.slotLabel = (s) => (s ? '週' + str(s['星期']) + ' ' + m.hm(s['開始時間'], s['結束時間']) + '｜' + split(s['用途']).join('・') : '');
  m.classLabel = (c) => (c ? str(c['課程名稱']) + (str(c['期別']) ? ' ' + str(c['期別']) : '') : '');
  m.classWhen = (c) => (c ? '週' + split(c['上課星期']).join('、') + ' ' + m.hm(c['開始時間'], c['結束時間']) : '');
  // v3.6：球敘類型（0_球敘類型；2_球敘場次.球敘類型 存 球敘ID，舊資料的「不限／新手場／分級／DUPR」照舊能讀）
  const GAME_LEGACY = { '': ['一般球敘', '不限'], 不限: ['一般球敘', '不限'], 新手場: ['新手友善球敘', '不限'], 分級: ['分級球敘', '分級'], DUPR: ['DUPR 球敘', 'DUPR'] };
  const gNorm = (s) => str(s).replace(/\s+/g, '').toUpperCase();
  const gFromRow = (r) => ({
    id: str(r['球敘ID']), name: str(r['類型名稱']) || '球敘', rule: ['不限', '分級', 'DUPR'].indexOf(str(r['報名規則'])) >= 0 ? str(r['報名規則']) : '不限',
    desc: str(r['說明']), school: num(r['學校費用']), gym: num(r['球館費用']), min: num(r['每面人數下限']), max: num(r['每面人數上限']),
    sort: num(r['排序']), active: r['是否啟用'] !== false && str(r['是否啟用']).toUpperCase() !== 'FALSE',
    host: r['需要場主'] !== false && str(r['需要場主']).toUpperCase() !== 'FALSE', // v3.7
  });
  m.gameTypes = (all) => PB.rows('0_球敘類型').map(gFromRow).filter((t) => all || t.active).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));
  m.gameType = (v) => {
    v = str(v);
    const rows = PB.rows('0_球敘類型');
    const r = rows.find((x) => str(x['球敘ID']) === v) || (v && rows.find((x) => gNorm(x['類型名稱']) === gNorm(v)));
    if (r) return gFromRow(r);
    const lg = GAME_LEGACY[v];
    if (lg) { const hit = rows.find((x) => gNorm(x['類型名稱']) === gNorm(lg[0])); return hit ? gFromRow(hit) : { id: v, name: lg[0], rule: lg[1], desc: '', school: 0, gym: 0, min: 0, max: 0, sort: 99, active: true, legacy: true, host: true }; }
    return { id: v, name: v || '球敘', rule: '不限', desc: '', school: 0, gym: 0, min: 0, max: 0, sort: 99, active: false, unknown: true, host: true };
  };
  m.gameTypeName = (v) => m.gameType(v).name;
  /** 類型＋規則細節（分級：L2 以上／DUPR 3–4） */
  m.gameKind = (g) => {
    const t = m.gameType(g['球敘類型']);
    const lv = split(g['程度']).map(m.levelName).join('、');
    if (t.rule === '分級') return t.name + (lv ? '：' + lv + ' 以上' : '');
    if (t.rule === 'DUPR') return t.name + (str(g['DUPR下限']) || str(g['DUPR上限']) ? '：' + str(g['DUPR下限']) + '–' + str(g['DUPR上限']) : '');
    return t.name;
  };
  m.gameLabel = (g) => (g ? str(g['球敘名稱']) || m.gameTypeName(g['球敘類型']) : '');
  m.sesLabel = (s) => {
    if (!s) return '';
    const c = PB.get('2_課程班級', s['班級']);
    return fmtD(s['日期']) + ' ' + m.hm(s['開始時間']) + '｜' + m.classLabel(c) + (m.isMakeupSes(s) ? ' 期末補課堂' : s['第幾堂'] && !m.isSingle(c) ? ' 第' + s['第幾堂'] + '堂' : '');
  };
  /** v2.6：期末補課堂（期制班 第幾堂 > 總堂數；學員 OA L04 為請假的學員自動加的）。只有排了補課的學員要來 */
  m.isMakeupSes = (s) => {
    if (!s) return false;
    const c = PB.get('2_課程班級', s['班級']);
    const total = num(c && c['總堂數']);
    return !!c && !m.isSingle(c) && total > 0 && num(s['第幾堂']) > total;
  };
  /** 參照欄位的顯示文字 */
  m.label = (t, r) => {
    if (!r) return '';
    switch (t) {
      case '1_學員': { const p = str(r['電話']); return (str(r['姓名']) || str(r['LINE顯示名稱']) || '（未填姓名）') + (p ? '｜' + p.slice(-3) : str(r['LINE顯示名稱']) && str(r['姓名']) ? '｜' + str(r['LINE顯示名稱']) : ''); }
      case '1_人員': return str(r['姓名']);
      case '1_人員_教練': return m.staffName(r['人員ID']);
      case '1_據點': return str(r['據點名稱']);
      case '1_據點_場地': return str(r['場地名稱']) + (str(r['人數上限']) ? '（' + r['人數上限'] + ' 人）' : '');
      case '1_據點_時段': return m.slotLabel(r);
      case '1_據點_可用日': return fmtD(r['日期']) + '｜' + m.slotLabel(PB.get('1_據點_時段', r['時段'])) + '｜' + str(r['狀態']);
      case '0_程度': return str(r['程度名稱']);
      case '0_課程類型': return str(r['課程類型']);
      case '0_課程模板': return str(r['模板名稱']);
      case '0_專項': return str(r['專項名稱']) + (str(r['程度']) ? '｜' + m.levelName(r['程度']) : '');
      case '0_球敘類型': return str(r['類型名稱']) + (r['是否啟用'] === false || str(r['是否啟用']).toUpperCase() === 'FALSE' ? '（停用）' : '');
      case '0_角色': return str(r['角色名稱']);
      case '0_教練費率': return m.staffName(r['教練']) + '｜' + m.typeName(r['課程類型']) + '｜' + str(r['基準']);
      case '1_合作夥伴': return str(r['名稱']);
      case '3_合作方案': return str(r['方案名稱']);
      case '2_課程班級': return m.isSingle(r) ? '專項｜' + m.singleLabel(r) + '｜' + m.venueName(r['據點']) : m.classLabel(r) + '｜' + m.venueName(r['據點']) + '｜' + m.classWhen(r);
      case '2_球敘場次': return fmtD(r['日期']) + ' ' + m.hm(r['開始時間']) + '｜' + m.venueName(r['據點']) + '｜' + m.gameLabel(r);
      case '2_上課場次': return m.sesLabel(r);
      default: return str(r[db.keys[t]]);
    }
  };

  // ---- 帳務 ----
  const IGNORE = () => (C.payIgnore || ['有誤', '作廢', '退回']);
  /** 一筆應收：應收、已確認、待確認、退款、未收、狀態 */
  m.rec = (rid) => {
    if (ix.recCache[rid]) return ix.recCache[rid];
    const r = PB.get('3_應收帳款', rid) || {};
    let confirmed = 0, pending = 0, refund = 0, wrong = 0, credit = 0;
    (ix.payByRec[str(rid)] || []).forEach((p) => {
      const st = str(p['對帳狀態']);
      const a = num(p['金額']);
      if (IGNORE().indexOf(st) >= 0) { if (st === '有誤') wrong += a; return; }
      if (a < 0 && str(p['付款方式']) === '轉抵用金') credit += a;
      else if (a < 0) refund += a;
      else if (st === '待確認') pending += a;
      else confirmed += a;
    });
    const due = num(r['應收金額']);
    const net = confirmed + pending + refund + credit;
    const voided = r['作廢'] === true;
    const left = voided ? 0 : Math.max(0, due - net);
    let status = '未收';
    if (voided) status = '作廢';
    else if (credit < 0 && net <= 0) status = '已轉抵用金';
    else if (refund < 0 && net <= 0) status = '已退款';
    else if (due > 0 && net >= due) status = pending > 0 ? '已付（待對帳）' : '已收';
    else if (net > 0) status = '部分付款';
    else if (due === 0) status = '免付';
    return (ix.recCache[rid] = { due, confirmed, pending, refund, credit, wrong, net, left, status, voided });
  };
  /** 一筆報名的帳務合計（不含作廢）；firstPaid＝首堂／全額已付清（待確認算已付） */
  m.sigPay = (sid) => {
    if (ix.sigCache[sid]) return ix.sigCache[sid];
    const recs = (ix.recBySig[str(sid)] || []).filter((r) => r['作廢'] !== true);
    const o = { recs: recs, due: 0, net: 0, left: 0, pending: 0, firstPaid: false };
    recs.forEach((r) => {
      const x = m.rec(r['應收ID']);
      o.due += x.due; o.net += x.net; o.left += x.left; o.pending += x.pending;
    });
    const first = recs.filter((r) => ['首堂', '全額', ''].indexOf(str(r['款項類別'])) >= 0);
    o.firstPaid = first.length > 0 && first.every((r) => m.rec(r['應收ID']).left <= 0);
    o.status = !recs.length ? '尚無應收' : o.left <= 0 ? (o.pending > 0 ? '已付（待對帳）' : '已付清') : o.net > 0 ? '部分付款' : '未付';
    return (ix.sigCache[sid] = o);
  };
  /**
   * v3.0：一筆報名實收裡的球拍租借（全歸公司、不分潤）
   * 現場租拍＝收入來源「球拍租借」的應收；線上租拍費（2_報名.租拍費）含在報名費應收裡，收款先算報名費、再算租拍費
   */
  m.sigRacket = (sid) => {
    const r = PB.get('2_報名', sid);
    const fee = r ? Math.max(0, num(r['租拍費'])) : 0;
    return sum((ix.recBySig[str(sid)] || []).filter((x) => x['作廢'] !== true), (x) => {
      const net = m.rec(x['應收ID']).net;
      if (str(x['收入來源']) === '球拍租借') return net;
      return fee ? Math.max(0, Math.min(fee, net - Math.max(0, num(x['應收金額']) - fee))) : 0;
    });
  };
  m.payBadge = (st) => {
    const k = { 已收: 'ok', 已付清: 'ok', '已付（待對帳）': 'info', 部分付款: 'warn', 未收: 'bad', 未付: 'bad', 已退款: '', 已轉抵用金: 'info', 作廢: '', 免付: 'ok', 尚無應收: '' }[st];
    return '<span class="badge ' + (k || '') + '">' + esc(st) + '</span>';
  };

  // ---- 班級 ----
  /** 單堂專項課：有填專項，或課程類型＝單堂專項 */
  m.isSingle = (c) => {
    if (!c) return false;
    if (str(c['專項'])) return true;
    const t = PB.get('0_課程類型', c['課程類型']);
    return !!t && str(t['課程類型']) === (C.singleType || '單堂專項');
  };
  m.specName = (id) => { const s = PB.get('0_專項', id); return s ? str(s['專項名稱']) : ''; };
  m.cls = (c) => {
    if (typeof c === 'string') c = PB.get('2_課程班級', c);
    if (!c) return null;
    const sigs = ix.sigByClass[str(c['班級ID'])] || [];
    const by = (st) => sigs.filter((r) => str(r['報名狀態']) === st);
    const active = by('已報名');
    const hold = by('保留中');
    const wait = by('候補').sort((a, b) => num(a['候補順位']) - num(b['候補順位']));
    const ses = ix.sesByClass[str(c['班級ID'])] || [];
    const live = ses.filter((s) => ['取消', '改期'].indexOf(str(s['場次狀態'])) < 0);
    const t = today();
    const limit = num(c['人數上限']) || C.classMax || 6;
    const min = num(c['人數下限']) || C.classMin || 5;
    const paid = active.filter((r) => m.sigPay(r['報名ID']).firstPaid).length;
    const start = day(c['開課日期']);
    const single = m.isSingle(c);
    const decide = start ? addDays(start, -(single ? (C.singleDecideDays || 3) : (C.confirmDays || 7))) : '';
    const decideAt = single && decide ? decide + ' ' + (C.singleDecideTime || '12:00') : '';
    const st = str(c['課程狀態']);
    const openAt = str(c['開放報名時間']).slice(0, 16);
    return {
      single: single, decideAt: decideAt, openAt: openAt, notOpen: !!openAt && openAt > nowText(),
      need: Math.max(0, min - paid),
      // 單堂：決定時間已過仍籌備中（排程沒處理到）
      late: single && st === '籌備中' && !!decideAt && nowText() >= decideAt,
      c: c, sigs: sigs, active: active, hold: hold, wait: wait, ses: ses, live: live,
      done: live.filter((s) => str(s['場次狀態']) === '已完成').length,
      total: num(c['總堂數']) || live.length,
      next: live.find((s) => str(s['場次狀態']) === '預定' && day(s['日期']) >= t) || null,
      limit: limit, min: min, paid: paid, used: active.length + hold.length, decide: decide,
      canDecide: st === '籌備中' && !!start && (single || t >= decide || paid >= min), // v3.5：已付達人數下限就能確認成班（原本要額滿）
      pending: !!str(c['開班動作']) && !str(c['開班處理時間']),
      st: st,
    };
  };
  /** 單堂專項課的短標題：11/7（六）08:00 握拍與正手 */
  m.singleLabel = (c) => (c ? fmtD(c['開課日期']) + ' ' + m.hm(c['開始時間']) + ' ' + str(c['課程名稱']) : '');
  m.classBadge = (st) => '<span class="badge ' + ({ 籌備中: 'warn', 確定開課: 'brand', 進行中: 'ok', 已結束: '', 未成班: 'bad', 取消: 'bad' }[st] || '') + '">' + esc(st || '未設定') + '</span>';

  // ---- 球敘 ----
  m.game = (g) => {
    if (typeof g === 'string') g = PB.get('2_球敘場次', g);
    if (!g) return null;
    const sigs = ix.sigByGame[str(g['球敘ID'])] || [];
    const active = sigs.filter((r) => str(r['報名狀態']) === '已報名');
    const walkin = sigs.filter((r) => str(r['報名狀態']) === '現場待確認');
    const wait = sigs.filter((r) => str(r['報名狀態']) === '候補').sort((a, b) => num(a['候補順位']) - num(b['候補順位']));
    const courts = split(g['使用場地']);
    // v3.7：有場主的類型每場保留 1 個名額給場主（佔第一面）；cap／limit 都是「學員可報」
    const hostless = !m.gameType(g['球敘類型']).host;
    const hostSeat = hostless ? 0 : C.hostSeat === undefined ? 1 : num(C.hostSeat);
    const cap = Math.max(0, sum(courts, (id) => (PB.get('1_據點_場地', id) || {})['人數上限']) - hostSeat);
    const limit = num(g['人數上限']) ? Math.max(0, num(g['人數上限']) - hostSeat) : cap;
    const perCourt = courts.map((id, i) => {
      const c = PB.get('1_據點_場地', id) || {};
      const list = active.concat(walkin).filter((r) => str(r['場地']) === id);
      return { id: id, name: str(c['場地名稱']) || id, cap: Math.max(0, num(c['人數上限']) - (i === 0 ? hostSeat : 0)), list: list };
    });
    const hosts = (ix.dutyByGame[str(g['球敘ID'])] || []).map((d) => ({ d: d, name: m.staffName(d['人員']), in: !!str(d['簽到時間']) }));
    // v3.0：球拍租借（2_報名 有 租拍數 欄才顯示）
    const rkOn = sigs.some((r) => '租拍數' in r);
    const venue = PB.get('1_據點', g['據點']) || {};
    return {
      rackets: rkOn ? sum(active.concat(walkin), (r) => num(r['租拍數'])) : null,
      racketStock: rkOn && str(venue['可租球拍數']) !== '' ? num(venue['可租球拍數']) : null,
      g: g, sigs: sigs, active: active, walkin: walkin, wait: wait, courts: perCourt, cap: cap, limit: limit, hostless: hostless, hostSeat: hostSeat,
      left: Math.max(0, limit - active.length - walkin.length),
      checked: active.filter((r) => str(r['簽到時間'])).length,
      hosts: hosts,
      cancelPending: !!str(g['取消請求時間']) && !str(g['取消處理時間']),
      st: str(g['狀態']),
    };
  };
  m.gameBadge = (st, g) => (st === '草稿' && g && str(g['開放報名時間']) ? '<span class="badge info">' + esc(str(g['開放報名時間']).slice(5, 16).replace('-', '/')) + ' 自動開放</span>' : '<span class="badge ' + ({ 草稿: 'warn', 開放報名: 'ok', 已額滿: 'brand', 已結束: '', 取消: 'bad' }[st] || '') + '">' + esc(st) + '</span>');

  // ---- 學員 ----
  m.stu = (s) => {
    if (typeof s === 'string') s = PB.get('1_學員', s);
    if (!s) return null;
    const id = str(s['學員ID']);
    const lessons = sum(ix.lessonByStu[id] || [], (x) => x['堂數']);
    const payRecs = (ix.recByPayer[id] || []).concat((ix.recByStu[id] || []).filter((r) => !str(r['付款人'])));
    const owed = sum(payRecs.filter((r) => r['作廢'] !== true), (r) => m.rec(r['應收ID']).left);
    const sigs = (ix.sigByStu[id] || []).slice().sort((a, b) => byKey(str(b['報名時間']), str(a['報名時間'])));
    const family = ix.stuByGuardian[id] || [];
    const guardian = str(s['管理人']) ? PB.get('1_學員', s['管理人']) : null;
    const credits = (ix.creditByPayer[id] || []).slice().sort((a, b) => byKey(str(b['建立時間']), str(a['建立時間'])));
    return { s: s, id: id, lessons: lessons, owed: owed, payRecs: payRecs, sigs: sigs, family: family, guardian: guardian, att: ix.attByStu[id] || [], credits: credits, credit: sum(credits, (x) => x['金額']) };
  };
  m.phone = (s) => { const p = str(s && s['電話']) || str(s && s['管理人'] && (PB.get('1_學員', s['管理人']) || {})['電話']); return p; };
  m.sigTarget = (r) => (str(r['報名類型']) === '課程' ? m.label('2_課程班級', PB.get('2_課程班級', r['班級'])) : m.label('2_球敘場次', PB.get('2_球敘場次', r['球敘'])));
  m.sigBadge = (st) => '<span class="badge ' + ({ 已報名: 'ok', 候補: 'warn', 保留中: 'info', 已取消: '', 現場待確認: 'warn' }[st] || '') + '">' + esc(st) + '</span>';
  /** 報名連結（學員 LIFF；與 AppSheet 報名連結欄同格式）＋來源代碼 */
  m.signupUrl = (type, id, src) => (C.liff || '') + '?type=' + (type === '課程' ? 'class' : 'game') + '&id=' + encodeURIComponent(id) + (src ? '&src=' + encodeURIComponent(src) : '');

  // ================================================================
  // 畫面元件
  // ================================================================
  const ui = (PB.ui = {});
  ui.toast = (msg, kind, ms) => {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms || (kind === 'bad' ? 6000 : 3800));
  };
  ui.safe = (fn, where) => {
    try { return fn(); } catch (e) {
      console.error(where, e);
      return '<div class="err-box">「' + esc(where || '這個區塊') + '」顯示失敗：' + esc(e.message) + '。其他功能不受影響，請截圖回報特助。</div>';
    }
  };
  /**
   * 分區清單（待處理等）：上方選單選一區只看那一區；「全部」時每區可展開／收合（記在這台裝置）
   * groups：[{ id, title, count, hint, right, body:()=>HTML }]（count 0 的不列出，除非正在選它）
   * o：{ param:'g', key:'queue' }；body 只有展開時才計算
   */
  ui.groups = (groups, p, o) => {
    o = o || {};
    const k = o.param || 'g';
    const sel = str(p[k]);
    const saved = groupOpen(o.key);
    const shown = groups.filter((g) => g.count > 0 || g.id === sel);
    if (!shown.length) return '';
    const total = groups.reduce((n, g) => n + (g.count || 0), 0);
    const chip = (id, label, n) => '<button class="chip' + (id === sel ? ' on' : '') + '" data-act="param" data-k="' + k + '" data-v="' + esc(id) + '">' + esc(label) + (n !== undefined ? '<span class="c">' + n + '</span>' : '') + '</button>';
    const menu = o.menu === false ? '' : '<div class="chips grp-menu">' + chip('', '全部', total) + shown.map((g) => chip(g.id, g.title, g.count)).join('') + '</div>';
    const one = shown.find((g) => g.id === sel);
    const head = (g, isOpen, toggle) => '<div class="sec grp-h' + (toggle ? ' click' : '') + '"' + (toggle ? ' data-act="grpToggle" data-key="' + esc(o.key) + '" data-id="' + esc(g.id) + '" role="button" aria-expanded="' + isOpen + '"' : '') + '>' +
      (toggle ? '<span class="grp-arrow' + (isOpen ? ' on' : '') + '">' + PB.icon('chev') + '</span>' : '') + '<h2>' + esc(g.title) + '</h2><span class="cnt">' + g.count + ' ' + (o.unit || '件') + '</span>' + (g.meta ? '<span class="grp-meta">' + g.meta + '</span>' : '') + '<span class="sp"></span>' + (isOpen && g.right ? '<span data-stop>' + g.right + '</span>' : '') + '</div>';
    const body = (g) => (g.hint ? '<div class="s mut grp-hint">' + esc(g.hint) + '</div>' : '') + ui.safe(g.body, g.title);
    if (one) return menu + head(one, true, false) + (one.count ? body(one) : '<div class="card">' + ui.empty('這區都處理完了', '') + '</div>');
    const open = o.forceOpen ? shown.map((g) => g.id) : saved || [shown[0].id]; // 第一次使用：展開第一區
    return menu + '<div class="grp-bar"><button class="btn sm ghost" data-act="grpAll" data-key="' + esc(o.key) + '" data-ids="' + esc(shown.map((g) => g.id).join(',')) + '" data-v="1">全部展開</button><button class="btn sm ghost" data-act="grpAll" data-key="' + esc(o.key) + '" data-ids="" data-v="0">全部收合</button></div>' +
      shown.map((g) => { const isOpen = open.indexOf(g.id) >= 0; return '<div class="grp' + (isOpen ? ' on' : '') + '">' + head(g, isOpen, true) + (isOpen ? body(g) : '') + '</div>'; }).join('');
  };
  function groupOpen(key) {
    try { const v = LS.get('pb:open:' + PB.appId + ':' + key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function groupSave(key, list) { LS.set('pb:open:' + PB.appId + ':' + key, JSON.stringify(list)); }
  PB.acts.param = (d) => PB.setParam(d.k, d.v);
  PB.acts.grpToggle = (d) => {
    const cur = document.querySelectorAll('.grp.on [data-act="grpToggle"]');
    const list = groupOpen(d.key) || Array.from(cur).map((el) => el.dataset.id);
    const i = list.indexOf(d.id);
    if (i >= 0) list.splice(i, 1); else list.push(d.id);
    groupSave(d.key, list);
    PB.render();
  };
  PB.acts.grpAll = (d) => { groupSave(d.key, d.v === '1' ? split(d.ids.replace(/,/g, ' , ')) : []); PB.render(); };
  ui.empty = (title, sub) => '<div class="empty"><b>' + esc(title) + '</b>' + esc(sub || '') + '</div>';
  ui.btn = (label, act, data, cls, icon) => '<button class="btn ' + (cls || '') + '" data-act="' + act + '"' + Object.keys(data || {}).map((k) => ' data-' + k + '="' + esc(data[k]) + '"').join('') + '>' + (icon ? PB.icon(icon) : '') + esc(label) + '</button>';
  ui.tel = (p) => (p ? '<a href="tel:' + esc(p) + '" class="nowrap">' + esc(p) + '</a>' : '<span class="mut">沒有電話</span>');

  /** 對話框；body 可以是 HTML 字串。actions：[{label, kind, click:(el)=>Promise|false}] */
  ui.modal = (o) => new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-h">' + esc(o.title || '') + '</div><div class="modal-b">' + (o.body || '') + '</div><div class="modal-f"></div></div>';
    const foot = bg.querySelector('.modal-f');
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    (o.actions || [{ label: '關閉' }]).forEach((a) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (a.kind || '');
      b.textContent = a.label;
      b.onclick = async () => {
        if (!a.click) return close(a.value === undefined ? false : a.value);
        b.disabled = true;
        try {
          const r = await a.click(bg.querySelector('.modal-b'));
          if (r !== false) close(r === undefined ? true : r);
        } finally { b.disabled = false; }
      };
      foot.appendChild(b);
    });
    bg.addEventListener('click', (e) => { if (e.target === bg && !o.sticky) close(false); });
    document.body.appendChild(bg);
    if (o.onOpen) o.onOpen(bg.querySelector('.modal-b'));
    const first = bg.querySelector('input,select,textarea');
    if (first && window.innerWidth > 640) setTimeout(() => first.focus(), 30);
  });

  /**
   * 確認框（可帶輸入欄）。fields：[{k,label,t,req,value,opts,hint}] → 回傳 {k:v} 或 false
   */
  ui.ask = (title, text, o) => {
    o = o || {};
    const fields = o.fields || [];
    const body = (text ? '<p style="margin:4px 0 8px">' + text + '</p>' : '') + fields.map((f) => fieldHtml(f, f.value, {})).join('');
    return ui.modal({
      title: title,
      body: body,
      sticky: fields.length > 0,
      actions: [
        { label: '取消' },
        {
          label: o.ok || '確定', kind: o.danger ? 'bad fill' : 'pri',
          click: (el) => {
            const v = readFields(el, fields);
            const miss = fields.filter((f) => f.req && (v[f.k] === '' || (Array.isArray(v[f.k]) && !v[f.k].length)));
            if (miss.length) { ui.toast('請填寫：' + miss.map((f) => f.label || f.k).join('、'), 'bad'); return false; }
            return v;
          },
        },
      ],
      onOpen: (el) => bindForm(el, fields, {}),
    });
  };

  // ---- 詳情面板（右側滑出；瀏覽器「上一頁」可關閉） ----
  let sheetFn = null;
  ui.sheet = (titleFn, bodyFn) => {
    let bg = document.querySelector('.sheet-bg');
    if (!bg) {
      bg = document.createElement('div');
      bg.className = 'sheet-bg';
      bg.onclick = () => history.back();
      const sh = document.createElement('div');
      sh.className = 'sheet';
      sh.innerHTML = '<div class="sheet-h"><button class="icon-btn" data-act="sheetClose" aria-label="返回">' + PB.icon('back') + '</button><h3></h3><span class="sheet-x"></span></div><div class="sheet-b"></div>';
      document.body.appendChild(bg);
      document.body.appendChild(sh);
    }
    const wasOpen = !!sheetFn;
    sheetFn = { title: titleFn, body: bodyFn };
    renderSheet();
    bg.classList.add('on');
    document.querySelector('.sheet').classList.add('on');
    if (!wasOpen) history.pushState({ pbSheet: 1 }, '');
    document.querySelector('.sheet-b').scrollTop = 0;
  };
  function renderSheet() {
    if (!sheetFn) return;
    const sh = document.querySelector('.sheet');
    let title = '';
    try { title = sheetFn.title(); } catch (e) { title = '詳情'; }
    if (title === null) return closeSheetNow(); // 資料已不存在
    sh.querySelector('h3').textContent = title;
    sh.querySelector('.sheet-b').innerHTML = ui.safe(sheetFn.body, '詳情');
  }
  function closeSheetNow() {
    sheetFn = null;
    const bg = document.querySelector('.sheet-bg');
    if (bg) bg.classList.remove('on');
    const sh = document.querySelector('.sheet');
    if (sh) sh.classList.remove('on');
  }
  ui.closeSheet = () => { if (sheetFn) history.back(); };
  window.addEventListener('popstate', () => { if (sheetFn) closeSheetNow(); });
  PB.acts.sheetClose = () => ui.closeSheet();

  // ---- 表單 ----
  const OPT = (f) => {
    if (Array.isArray(f.opts)) return f.opts;
    const e = PB.enums[f.opts];
    return Array.isArray(e) ? e : [];
  };
  function refOptions(f, vals) {
    let rows = PB.rows(f.ref);
    if (f.where) Object.keys(f.where).forEach((c) => {
      const w = f.where[c];
      const v = w.charAt(0) === '$' ? vals[w.slice(1)] : w;
      rows = rows.filter((r) => !v || str(r[c]) === str(v));
    });
    if (f.has) Object.keys(f.has).forEach((c) => { rows = rows.filter((r) => !str(r[c]) || split(r[c]).indexOf(f.has[c]) >= 0); });
    if (f.ref === '1_人員') rows = rows.filter((r) => ['在職', ''].indexOf(str(r['在職狀態'])) >= 0 || split(vals[f.k]).indexOf(str(r['人員ID'])) >= 0);
    // v3.6：球敘類型只列啟用的（加上目前選的），依排序
    if (f.ref === '0_球敘類型') {
      rows = rows.filter((r) => m.gameType(r['球敘ID']).active || str(r['球敘ID']) === str(vals[f.k]));
      return rows.map((r) => m.gameType(r['球敘ID'])).sort((a, b) => a.sort - b.sort).map((t) => ({ v: t.id, l: t.name + (t.active ? '' : '（停用）') }));
    }
    const k = db.keys[f.ref];
    return rows.map((r) => ({ v: str(r[k]), l: m.label(f.ref, r) })).sort((a, b) => a.l.localeCompare(b.l, 'zh-Hant'));
  }
  function fieldHtml(f, v, vals, before) {
    const id = 'f_' + Math.random().toString(36).slice(2, 8);
    const req = f.req ? '<b>*</b>' : '';
    const locked = before && (f.ro === true || (f.ro === 'edit') || f.canEdit === false || (f.lock && !Object.keys(f.lock).every((c) => f.lock[c].indexOf(str(before[c])) >= 0)));
    const hint = f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '';
    const hide = f.when && !whenOk(f.when, vals) ? ' style="display:none"' : '';
    const wrap = (inner) => '<div class="fld" data-k="' + esc(f.k) + '"' + hide + '><label for="' + id + '">' + esc(f.label || f.k) + req + '</label>' + inner + hint + '</div>';
    if ((locked || f.t === 'ro') && f.t === 'files') return wrap('<div class="ro">' + (ui.fileList(v) || '—') + '</div>');
    if (locked || f.t === 'ro') return wrap('<div class="ro">' + esc(displayVal(f, v)) + '</div>');
    const val = v === undefined || v === null ? '' : v;
    const t = f.t;
    if (t === 'files') return wrap(ui.filesField(f, val, id, before));
    if (t === 'long') return wrap('<textarea id="' + id + '" name="' + esc(f.k) + '">' + esc(val) + '</textarea>');
    if (t === 'bool') return '<div class="fld" data-k="' + esc(f.k) + '"' + hide + '><label style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" name="' + esc(f.k) + '"' + (val === true || val === 'true' ? ' checked' : '') + '> ' + esc(f.label || f.k) + '</label>' + hint + '</div>';
    if (t === 'ref' && f.ref === '1_據點_時段') return wrap(slotPicker(f, val, vals, id));
    if (t === 'enum' || t === 'ref') {
      const opts = t === 'ref' ? refOptions(f, vals) : (f.dep ? (PB.enums[f.opts] || {})[vals[f.dep]] || [] : OPT(f)).map((o) => ({ v: o, l: o }));
      const cur = split(val);
      if (f.multi) {
        return wrap('<div class="multi" id="' + id + '" data-multi="' + esc(f.k) + '">' + (opts.length ? opts.map((o) => '<label><input type="checkbox" value="' + esc(o.v) + '"' + (cur.indexOf(o.v) >= 0 ? ' checked' : '') + '>' + esc(o.l) + '</label>').join('') : '<span class="mut">沒有可選的項目</span>') + '</div>');
      }
      if (f.other || (t === 'ref' && opts.length > 60)) {
        const list = id + '_l';
        const shown = t === 'ref' ? (opts.find((o) => o.v === str(val)) || { l: str(val) }).l : str(val);
        return wrap('<input id="' + id + '" name="' + esc(f.k) + '" list="' + list + '" value="' + esc(shown) + '" autocomplete="off" placeholder="' + (t === 'ref' ? '輸入姓名或電話搜尋' : '') + '"' + (t === 'ref' ? ' data-ref="' + esc(f.ref) + '"' : '') + '><datalist id="' + list + '">' + opts.map((o) => '<option value="' + esc(o.l) + '">').join('') + '</datalist>');
      }
      return wrap('<select id="' + id + '" name="' + esc(f.k) + '"><option value="">' + (f.req ? '請選擇' : '（不指定）') + '</option>' + opts.map((o) => '<option value="' + esc(o.v) + '"' + (o.v === str(val) ? ' selected' : '') + '>' + esc(o.l) + '</option>').join('') + (str(val) && !opts.some((o) => o.v === str(val)) ? '<option value="' + esc(val) + '" selected>' + esc(displayVal(f, val)) + '</option>' : '') + '</select>');
    }
    const type = { num: 'number', money: 'number', date: 'date', time: 'time', dt: 'datetime-local', phone: 'tel' }[t] || 'text';
    const shown = t === 'dt' ? str(val).replace(' ', 'T') : t === 'time' ? str(val).slice(0, 5) : val;
    return wrap('<input id="' + id + '" type="' + type + '" name="' + esc(f.k) + '" value="' + esc(shown) + '"' + (type === 'number' ? ' step="any" inputmode="decimal"' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + '>');
  }
  /**
   * 時段選擇：依星期分列，每列是該天的時段按鈕（只列「使用中」與已選的時段）
   * 多選 → data-multi（checkbox）；單選 → data-radio（radio）
   */
  const WEEK = '一二三四五六日';
  function slotPicker(f, val, vals, id) {
    const cur = split(val);
    const venue = str(vals['據點']);
    const k = db.keys['1_據點_時段'];
    let rows = PB.rows('1_據點_時段');
    if (f.where) Object.keys(f.where).forEach((c) => { const w = f.where[c]; const v = w.charAt(0) === '$' ? vals[w.slice(1)] : w; rows = rows.filter((r) => !v || str(r[c]) === str(v)); });
    if (f.has) Object.keys(f.has).forEach((c) => { rows = rows.filter((r) => !str(r[c]) || split(r[c]).indexOf(f.has[c]) >= 0); });
    rows = rows.filter((r) => ['使用中', ''].indexOf(str(r['狀態'])) >= 0 || cur.indexOf(str(r[k])) >= 0);
    rows.sort((a, b) => byKey(WEEK.indexOf(str(a['星期'])) + str(a['開始時間']) + m.venueName(a['據點']), WEEK.indexOf(str(b['星期'])) + str(b['開始時間']) + m.venueName(b['據點'])));
    const kind = f.multi ? 'checkbox' : 'radio';
    const name = id + '_s';
    const days = uniq(rows.map((r) => str(r['星期'])));
    const sum = '<div class="slot-sum">' + slotSummary(cur) + '</div>';
    if (!rows.length) return '<div class="slots" id="' + id + '" data-' + (f.multi ? 'multi' : 'radio') + '="' + esc(f.k) + '"><span class="mut">' + (venue || !f.where ? '沒有可選的時段（只列「使用中」）' : '請先選據點') + '</span></div>';
    return '<div class="slots" id="' + id + '" data-' + (f.multi ? 'multi' : 'radio') + '="' + esc(f.k) + '"' + (f.max ? ' data-max="' + f.max + '"' : '') + '>' + sum +
      days.map((d) => '<div class="slot-row"><div class="slot-d">週' + esc(d || '?') + '</div><div class="slot-c">' + rows.filter((r) => str(r['星期']) === d).map((r) => {
        const v = str(r[k]);
        const courts = split(r['使用場地']).length;
        const sub = [venue ? '' : m.venueName(r['據點']), courts ? courts + ' 面' : '', str(r['狀態']) && str(r['狀態']) !== '使用中' ? str(r['狀態']) : ''].filter(Boolean).join('・');
        return '<label class="slot"><input type="' + kind + '" name="' + name + '" value="' + esc(v) + '"' + (cur.indexOf(v) >= 0 ? ' checked' : '') + '><span><b>' + esc(m.hm(r['開始時間'], r['結束時間'])) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span></label>';
      }).join('') + '</div></div>').join('') + '</div>';
  }
  function slotSummary(ids) {
    const list = ids.map((x) => PB.get('1_據點_時段', x)).filter(Boolean);
    return list.length ? '已選 ' + list.length + ' 個：' + esc(list.map((r) => '週' + str(r['星期']) + ' ' + m.hm(r['開始時間'], r['結束時間'])).join('、')) : '<span class="mut">尚未選擇</span>';
  }
  // ---- v2.7 上傳照片／PDF（欄位型別 files：值＝雲端硬碟網址，一行一個） ----
  const fileId = (u) => (str(u).match(/\/d\/([\w-]{20,})/) || str(u).match(/[?&]id=([\w-]{20,})/) || [])[1] || '';
  const isUrl = (u) => /^https?:\/\//.test(str(u));
  /**
   * v3.2 縮圖：剛上傳的用手機上那張圖（本機預覽）；其他的向後端 fileThumbs 要（後端讀雲端硬碟，不靠瀏覽器登入的 Google 帳號）
   * 畫面上先放 <img data-fid>，畫完後 PB.loadThumbs() 一次要齊（同一頁只發一個請求；拿過的記在記憶體）
   */
  const thumbMem = {};   // 檔案ID → dataUrl／本機預覽網址；'' ＝沒有縮圖
  const thumbAsk = new Set();
  let thumbTimer = 0;
  const thumbImg = (id) => {
    const src = thumbMem[id];
    if (src) return '<img alt="" src="' + esc(src) + '">';
    if (src === '') return '<span>檔案</span>';
    return '<img alt="" data-fid="' + esc(id) + '" class="fload">';
  };
  PB.loadThumbs = () => {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(async () => {
      const ids = uniq(Array.from(document.querySelectorAll('img[data-fid]')).map((i) => i.dataset.fid).filter((id) => !(id in thumbMem) && !thumbAsk.has(id))).slice(0, 30);
      if (!ids.length) return;
      ids.forEach((id) => thumbAsk.add(id));
      let got = {};
      try {
        const out = await PB.api.ops([{ op: 'fileThumbs', args: { ids: ids } }]);
        got = (out.results[0] && out.results[0].ok && out.results[0].data.thumbs) || {};
      } catch (e) { /* 拿不到就顯示「檔案」 */ }
      ids.forEach((id) => {
        thumbAsk.delete(id);
        if (got[id]) thumbMem[id] = got[id];
        document.querySelectorAll('img[data-fid="' + id + '"]').forEach((img) => {
          if (got[id]) { img.src = got[id]; img.removeAttribute('data-fid'); img.classList.remove('fload'); } else img.replaceWith(Object.assign(document.createElement('span'), { textContent: '檔案' }));
        });
      });
      if (document.querySelector("img[data-fid]")) PB.loadThumbs(); // 超過 30 個時再要下一批
    }, 60);
  };
  new MutationObserver(() => { if (document.querySelector('img[data-fid]')) PB.loadThumbs(); }).observe(document.body, { childList: true, subtree: true });
  /** 唯讀顯示：縮圖＋連結（AppSheet 上傳的相對路徑只顯示檔名） */
  ui.fileList = (v) => str(v).split('\n').map(str).filter(Boolean).map((u) => isUrl(u)
    ? '<a class="fthumb" href="' + esc(u) + '" target="_blank" rel="noopener" title="開啟">' + (fileId(u) ? thumbImg(fileId(u)) : '<span>檔案</span>') + '</a>'
    : '<span class="fthumb ftxt" title="AppSheet 上傳的檔案">' + esc(u.split('/').pop()) + '</span>').join('');
  ui.filesField = (f, val, id, before) => {
    const table = (before && before._table) || f._table || '';
    return '<div class="files" data-files="' + esc(f.k) + '"><input type="hidden" name="' + esc(f.k) + '" value="' + esc(val) + '">' +
      '<div class="fthumbs">' + filesInner(val) + '</div>' +
      '<label class="btn sm fadd">' + PB.icon('plus') + '新增照片／PDF<input type="file" accept="image/*,application/pdf" multiple data-upload="' + esc(f.k) + '" data-table="' + esc(table) + '" hidden></label>' +
      '<span class="fbusy mut"></span></div>';
  };
  function filesInner(val) {
    return str(val).split('\n').map(str).filter(Boolean).map((u, i) => '<span class="fitem">' + ui.fileList(u) + '<button type="button" class="fdel" data-fdel="' + i + '" aria-label="移除" title="從這筆移除（檔案仍留在雲端硬碟）">×</button></span>').join('');
  }
  /** 照片縮到長邊 1600px（JPEG 0.82），PDF 原檔 */
  async function shrink(file) {
    if (!/^image\//.test(file.type) || /gif/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s);
      c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch (e) { return file; }
  }
  const toB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  /** 上傳一個檔案 → 網址（失敗回傳 ''）；table／field 決定權限與資料夾 */
  PB.upload = async (table, field, file) => {
    const f = await shrink(file);
    if (f.size > 10 * 1024 * 1024) { ui.toast(file.name + ' 超過 10MB', 'bad'); return ''; }
    const out = await PB.runMany([{ op: 'fileUpload', args: { table: table, field: field, name: file.name, mime: f.type || 'image/jpeg', data: await toB64(f) } }], { quiet: true });
    const r = out && out.results[0];
    if (!r || !r.ok) { ui.toast((r && r.message) || '上傳失敗', 'bad'); return ''; }
    return r.data.url;
  };
  document.addEventListener('change', async (e) => {
    const inp = e.target.closest && e.target.closest('input[data-upload]');
    if (!inp || !inp.files || !inp.files.length) return;
    const box = inp.closest('.files');
    const hid = box.querySelector('input[type=hidden]');
    const busy = box.querySelector('.fbusy');
    const files = Array.from(inp.files);
    inp.value = '';
    for (let i = 0; i < files.length; i++) {
      busy.textContent = '上傳中 ' + (i + 1) + '／' + files.length + '…';
      const url = await PB.upload(inp.dataset.table, inp.dataset.upload, files[i]);
      // v3.2：剛上傳的直接用本機的圖當縮圖（雲端硬碟要過一會兒才產生縮圖）
      if (url && fileId(url) && /^image\//.test(files[i].type)) { try { thumbMem[fileId(url)] = URL.createObjectURL(files[i]); } catch (e) { /* 舊瀏覽器 */ } }
      if (url) { hid.value = str(hid.value).split('\n').concat(url).map(str).filter(Boolean).join('\n'); box.querySelector('.fthumbs').innerHTML = filesInner(hid.value); }
    }
    busy.textContent = '';
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-fdel]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const box = b.closest('.files');
    const hid = box.querySelector('input[type=hidden]');
    const list = str(hid.value).split('\n').map(str).filter(Boolean);
    list.splice(Number(b.dataset.fdel), 1);
    hid.value = list.join('\n');
    box.querySelector('.fthumbs').innerHTML = filesInner(hid.value);
  }, true);

  function displayVal(f, v) {
    if (f.t === 'ref') return split(v).map((id) => m.label(f.ref, PB.get(f.ref, id)) || id).join('、');
    if (f.t === 'money') return v === '' ? '' : money(v);
    if (f.t === 'bool') return v === true ? '是' : '否';
    if (f.t === 'date') return fmtD(v);
    if (f.t === 'dt') return fmtDT(v);
    if (f.t === 'files') return str(v).split('\n').filter(Boolean).length + ' 個檔案';
    return Array.isArray(v) ? v.join('、') : str(v);
  }
  function whenOk(when, vals) {
    return Object.keys(when).every((c) => (when[c] === '*' ? !!str(vals[c]) : when[c].rule ? when[c].rule.indexOf(m.gameType(vals[c]).rule) >= 0 : when[c].indexOf(str(vals[c])) >= 0));
  }
  function readFields(el, fields) {
    const v = {};
    fields.forEach((f) => {
      const box = el.querySelector('.fld[data-k="' + CSS.escape(f.k) + '"]');
      if (!box || box.style.display === 'none') return;
      if (box.querySelector('.ro')) return;
      const multi = box.querySelector('[data-multi]');
      if (multi) { v[f.k] = Array.from(multi.querySelectorAll('input:checked')).map((i) => i.value); return; }
      const radio = box.querySelector('[data-radio]');
      if (radio) { const c = radio.querySelector('input:checked'); v[f.k] = c ? c.value : ''; return; }
      const inp = box.querySelector('input,select,textarea');
      if (!inp) return;
      if (inp.type === 'checkbox') v[f.k] = inp.checked;
      else if (inp.dataset.ref) {
        const opts = refOptions(f, v);
        const hit = opts.find((o) => o.l === inp.value) || opts.find((o) => o.v === inp.value);
        v[f.k] = hit ? hit.v : inp.value ? '?' + inp.value : '';
      } else if (f.t === 'dt') v[f.k] = inp.value.replace('T', ' ');
      else v[f.k] = inp.value;
    });
    return v;
  }
  function bindForm(el, fields, before) {
    const refresh = () => {
      const vals = Object.assign({}, before || {}, readFieldsLoose(el, fields));
      fields.forEach((f) => {
        const box = el.querySelector('.fld[data-k="' + CSS.escape(f.k) + '"]');
        if (!box) return;
        if (f.when) box.style.display = whenOk(f.when, vals) ? '' : 'none';
        // 依其他欄過濾的選項（where／dep）→ 重畫這一欄
        const deps = Object.keys(f.where || {}).map((c) => str(f.where[c]).slice(1)).concat(f.dep ? [f.dep] : []);
        if (deps.length && box.dataset.depv !== deps.map((d) => str(vals[d])).join('|')) {
          const first = box.dataset.depv === undefined;
          box.dataset.depv = deps.map((d) => str(vals[d])).join('|');
          if (!first) {
            const tmp = document.createElement('div');
            tmp.innerHTML = fieldHtml(f, f.dep ? vals[f.k] : '', vals, before);
            const nb = tmp.firstChild;
            nb.dataset.depv = box.dataset.depv;
            box.replaceWith(nb);
          }
        }
      });
    };
    // fill：選了參照（例如課程模板）→ 帶入其他空白欄位
    const fillFrom = (e) => {
      fields.filter((f) => f.fill).forEach((f) => {
        const box = el.querySelector('.fld[data-k="' + CSS.escape(f.k) + '"]');
        if (!box || !box.contains(e.target)) return;
        const src = PB.get(f.ref, readFieldsLoose(el, [f])[f.k]);
        if (!src) return;
        Object.keys(f.fill).forEach((k) => {
          const inp = el.querySelector('.fld[data-k="' + CSS.escape(k) + '"] input, .fld[data-k="' + CSS.escape(k) + '"] select');
          if (inp && !inp.value && str(src[f.fill[k]])) inp.value = str(src[f.fill[k]]);
        });
      });
    };
    // 時段選擇：上限、已選摘要
    const slotChange = (e) => {
      const box = e.target.closest && e.target.closest('.slots');
      if (!box) return;
      const max = Number(box.dataset.max || 0);
      const on = Array.from(box.querySelectorAll('input:checked'));
      if (max && on.length > max) { e.target.checked = false; ui.toast('最多選 ' + max + ' 個', 'bad'); }
      const sum = box.querySelector('.slot-sum');
      if (sum) sum.innerHTML = slotSummary(Array.from(box.querySelectorAll('input:checked')).map((i) => i.value));
    };
    el.addEventListener('change', (e) => { slotChange(e); fillFrom(e); refresh(); });
    el.addEventListener('input', (e) => { if (e.target.tagName === 'SELECT') refresh(); });
    refresh();
  }
  function readFieldsLoose(el, fields) {
    try { return readFields(el, fields); } catch (e) { return {}; }
  }
  PB.form = { fieldHtml: fieldHtml, readFields: readFields, bindForm: bindForm, displayVal: displayVal };

  /**
   * 依後端表單規格新增／修改一筆資料
   * o：{ id, values（預設值）, title, onSaved(id), only:[欄位] }
   */
  ui.form = async (table, o) => {
    o = o || {};
    const spec = PB.forms[table];
    if (!spec) return ui.toast('沒有「' + table + '」的編輯權限', 'bad');
    const before = o.id ? PB.get(table, o.id) : null;
    if (o.id && !before) return ui.toast('資料已不存在，請重新整理', 'bad');
    let fields = spec.fields.filter((f) => !f.optional || (db.cols[table] || []).indexOf(f.k) >= 0);
    if (o.only) fields = fields.filter((f) => o.only.indexOf(f.k) >= 0);
    fields = fields.map((f) => (f.t === 'files' ? Object.assign({ _table: table }, f) : f)); // v2.7：上傳要知道是哪張表
    const init = Object.assign({}, before || defaultsOf(fields), o.values || {});
    const body = fields.map((f) => fieldHtml(f, init[f.k], init, before)).join('');
    let savedId = null;
    const ok = await ui.modal({
      title: o.title || (before ? '編輯' : '新增') + spec.title,
      body: body,
      sticky: true,
      actions: [{ label: '取消' }, {
        label: '儲存', kind: 'pri',
        click: async (el) => {
          const vals = readFields(el, fields);
          const bad = Object.keys(vals).filter((k) => str(vals[k]).charAt(0) === '?');
          if (bad.length) { ui.toast(bad.join('、') + ' 找不到符合的選項，請從清單選', 'bad'); return false; }
          const merged = Object.assign({}, init, vals);
          const miss = fields.filter((f) => f.req && (!f.when || whenOk(f.when, merged)) && !(before && f.lock && !Object.keys(f.lock).every((c) => f.lock[c].indexOf(str(before[c])) >= 0)) && (Array.isArray(merged[f.k]) ? !merged[f.k].length : !str(merged[f.k])));
          if (miss.length) { ui.toast('請填寫：' + miss.map((f) => f.label || f.k).join('、'), 'bad'); return false; }
          const r = await PB.run('save', { table: table, id: o.id || '', values: Object.assign({}, o.values || {}, vals) });
          if (!r) return false;
          savedId = (r.data && r.data.id) || o.id;
          return true;
        },
      }],
      onOpen: (el) => bindForm(el, fields, before),
    });
    if (ok && o.onSaved) o.onSaved(savedId);
    return ok ? savedId : null;
  };
  function defaultsOf(fields) {
    const o = {};
    fields.forEach((f) => {
      if (f.def === undefined) return;
      o[f.k] = f.def === 'today' ? today() : f.def === 'now' ? nowText() : f.def === 'me' ? PB.me.id : f.def;
    });
    return o;
  }

  // ================================================================
  // 執行操作（1 個請求；成功後就地更新畫面）
  // ================================================================
  /**
   * PB.run(op, args, { confirm:{title,text,danger}, quiet })
   * 回傳 { data, notes } 或 null（失敗時已顯示提示）
   */
  PB.run = async (op, args, o) => {
    o = o || {};
    if (o.confirm) {
      const ok = await ui.ask(o.confirm.title, o.confirm.text, { danger: o.confirm.danger, ok: o.confirm.ok });
      if (!ok) return null;
    }
    const r = await PB.runMany([{ op: op, args: args }], o);
    if (!r) return null;
    const res = r.results[0];
    if (!res.ok) {
      ui.toast(res.message || '操作失敗', 'bad');
      if (res.code === 'CONFLICT') PB.refresh(true);
      return null;
    }
    return { data: res.data, notes: r.notes };
  };
  PB.runMany = async (ops, o) => {
    o = o || {};
    setSync('busy', '儲存中…');
    try {
      const out = await PB.api.ops(ops);
      applyOut(out);
      setSync('ok');
      PB.render();
      const ok = out.results.every((x) => x.ok);
      if (!o.quiet && out.notes && out.notes.length) ui.toast(out.notes.join('\n'), ok ? 'ok' : '', 6000);
      (out.warnings || []).forEach((w) => console.warn(w));
      if (ops.length > 1) out.results.filter((x) => !x.ok).forEach((x) => ui.toast(x.message, 'bad'));
      return out;
    } catch (e) {
      setSync('err', '儲存失敗');
      handleError(e);
      return null;
    }
  };
  /** 唯讀查詢（不顯示「儲存中」、不重畫）：回傳 data 或 null（失敗時已提示） */
  PB.read = async (op, args) => {
    try {
      const out = await PB.api.ops([{ op: op, args: args || {} }]);
      const r = out.results[0];
      if (!r.ok) { ui.toast(r.message || '讀取失敗', 'bad'); return null; }
      return r.data;
    } catch (e) {
      handleError(e);
      return null;
    }
  };
  function handleError(e) {
    if (e.code === 'AUTH' || e.code === 'NOT_STAFF' || e.code === 'NO_ACCESS') {
      if (e.code === 'AUTH') PB.api.token = '';
      showLogin(e.message);
      return;
    }
    ui.toast(e.message || String(e), 'bad');
  }
  PB.copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); ui.toast('已複製' + (what || '')); } catch (e) {
      window.prompt('複製下面的文字：', text);
    }
  };

  // ================================================================
  // 外框、選單、路由
  // ================================================================
  let APPDEF = null;
  let current = { id: '', params: {} };
  PB.app = (def) => {
    APPDEF = def;
    PB.appId = def.app;
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      // v2.6：列裡的勾選框、按鈕區用 data-stop 擋「打開整列」；不能用 onclick=stopPropagation（會把裡面按鈕的點擊一起擋掉）
      const stop = e.target.closest('[data-stop]');
      if (stop && stop !== el && el.contains(stop)) return;
      const fn = PB.acts[el.dataset.act];
      if (!fn) return;
      e.preventDefault();
      e.stopPropagation();
      Promise.resolve(fn(el.dataset, el, e)).catch((err) => { console.error(err); ui.toast(err.message || String(err), 'bad'); });
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (el && PB.inputs[el.dataset.input]) PB.inputs[el.dataset.input](el.value, el, e);
    });
    window.addEventListener('hashchange', () => { closeSheetNow(); readHash(); renderMain(); document.getElementById('main') && (document.getElementById('main').scrollTop = 0); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && PB.boot && Date.now() - lastSync > 5 * 60000) PB.refresh(true);
    });
    start();
  };
  function readHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [id, q] = h.split('?');
    current = { id: id || '', params: Object.fromEntries(new URLSearchParams(q || '')) };
  }
  PB.go = (id, params) => {
    const q = new URLSearchParams(params || {}).toString();
    location.hash = '#/' + id + (q ? '?' + q : '');
  };
  PB.params = () => current.params;
  PB.setParam = (k, v) => {
    const p = Object.assign({}, current.params);
    if (v === '' || v === undefined || v === null) delete p[k]; else p[k] = v;
    history.replaceState(null, '', '#/' + current.id + (Object.keys(p).length ? '?' + new URLSearchParams(p) : ''));
    current.params = p;
    renderMain();
  };
  function screens() {
    return APPDEF.screens.filter((s) => !s.show || s.show());
  }
  function renderShell() {
    const root = document.getElementById('app');
    const other = PB.appId === 'ops' ? (PB.ws.indexOf('管理層') >= 0 && C.adminUrl ? { url: C.adminUrl, label: '管理後台' } : null) : null;
    root.innerHTML = '<div class="app">' +
      '<header class="head"><div class="brand">理論上<small>' + esc(APPDEF.title) + '</small></div><div class="sp"></div>' +
      '<div class="sync" id="sync"><span class="dot"></span><span class="txt"></span></div>' +
      '<button class="icon-btn" data-act="refresh" title="重新整理" aria-label="重新整理">' + PB.icon('refresh') + '</button>' +
      '<button class="icon-btn" data-act="userMenu" title="' + esc(PB.me.name) + '" aria-label="帳號">' + PB.icon('user') + '</button></header>' +
      '<nav class="nav" id="nav"></nav>' +
      '<main class="main" id="main"><div id="banner"></div><div class="page" id="page"></div></main></div>';
    APPDEF.otherLink = other;
  }
  function renderNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const list = screens();
    nav.innerHTML = list.map((s) => {
      let n = 0;
      try { n = s.badge ? s.badge() : 0; } catch (e) { n = 0; }
      return '<a href="#/' + s.id + '" class="' + (current.id === s.id ? 'on' : '') + '">' + PB.icon(s.icon) + '<span>' + esc(s.label) + '</span>' + (n ? '<span class="n">' + (n > 99 ? '99+' : n) + '</span>' : '') + '</a>';
    }).join('') + '<hr>' + (APPDEF.links ? APPDEF.links().map((l) => '<a class="ext' + (l.mobile ? '' : ' desk') + '" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + PB.icon(l.icon || 'ext') + '<span>' + esc(l.label) + '</span></a>').join('') : '') +
      (APPDEF.otherLink ? '<a class="ext desk" href="' + esc(APPDEF.otherLink.url) + '">' + PB.icon('swap') + '<span>' + esc(APPDEF.otherLink.label) + '</span></a>' : '');
  }
  function renderMain() {
    if (!PB.boot) return;
    const list = screens();
    let s = list.find((x) => x.id === current.id);
    if (!s) { s = list[0]; current = { id: s.id, params: {} }; }
    renderNav();
    const page = document.getElementById('page');
    page.innerHTML = ui.safe(() => s.render(current.params), s.label);
    if (s.after) try { s.after(page, current.params); } catch (e) { console.error(e); }
  }
  PB.render = () => {
    renderMain();
    renderSheet();
    renderBanner();
  };
  let lastSync = 0;
  function setSync(state, text) {
    const el = document.getElementById('sync');
    if (!el) return;
    el.className = 'sync ' + (state === 'ok' ? '' : state);
    el.querySelector('.txt').textContent = text || (db.at ? '更新 ' + str(db.at).slice(11, 16) : '');
  }
  function renderBanner() {
    const el = document.getElementById('banner');
    if (!el) return;
    const w = (PB.boot && PB.boot.warnings) || [];
    el.innerHTML = (PB.stale ? '<div class="banner' + (PB.stale === 'err' ? ' bad' : '') + '">' + (PB.stale === 'err' ? '無法連線，顯示的是 ' + esc(fmtDT(db.at)) + ' 的資料（不能儲存）。' : '顯示上次的資料，正在更新…') + '</div>' : '') +
      (w.length ? '<div class="banner">部分資料未載入：' + esc(w.slice(0, 3).join('；')) + (w.length > 3 ? '…' : '') + '（相關功能暫停，其他照常）</div>' : '');
  }

  PB.acts.refresh = () => PB.refresh(false);
  PB.acts.userMenu = async () => {
    const r = await ui.modal({
      title: PB.me.name,
      body: '<dl class="kv"><dt>帳號</dt><dd>' + esc(PB.me.email) + '</dd><dt>角色</dt><dd>' + esc(PB.me.roles.join('、')) + '</dd><dt>工作區</dt><dd>' + esc(PB.ws.join('、')) + '</dd><dt>資料時間</dt><dd>' + esc(fmtDT(db.at)) + '</dd><dt>版本</dt><dd>網頁 ' + esc(APPDEF.version || '') + '／後端 ' + esc(C.version || '') + '</dd></dl>',
      actions: [{ label: '登出', kind: 'bad', value: 'out' }].concat(APPDEF.otherLink ? [{ label: '前往' + APPDEF.otherLink.label, value: 'go' }] : []).concat([{ label: '關閉' }]),
    });
    if (r === 'out') logout();
    if (r === 'go') location.href = APPDEF.otherLink.url;
  };
  function logout() {
    PB.api.token = '';
    LS.del(snapKey());
    try { if (window.google && google.accounts) google.accounts.id.disableAutoSelect(); } catch (e) { /* 忽略 */ }
    location.hash = '';
    location.reload();
  }

  PB.refresh = async (silent) => {
    if (!PB.api.token) return;
    setSync('busy', '更新中…');
    try {
      const b = await PB.api.boot();
      lastSync = Date.now();
      PB.stale = false;
      loadBoot(b);
      saveSnapshot();
      setSync('ok');
      PB.render();
      if (!silent) ui.toast('已更新');
    } catch (e) {
      if (['AUTH', 'NOT_STAFF', 'NO_ACCESS'].indexOf(e.code) >= 0) return handleError(e);
      PB.stale = PB.boot ? 'err' : false;
      setSync('err', '無法連線');
      renderBanner();
      if (!PB.boot) showFatal(e.message);
      else if (!silent) ui.toast(e.message, 'bad');
    }
  };

  // ================================================================
  // 啟動與登入
  // ================================================================
  function start() {
    readHash();
    if (!C.GAS_URL || /填入/.test(C.GAS_URL)) return showFatal('尚未設定 config.js 的 GAS_URL（見 README）');
    if (!PB.api.token) return showLogin();
    const snap = loadSnapshot();
    if (snap) {
      try {
        loadBoot(snap);
        PB.stale = true;
        renderShell();
        PB.render();
        setSync('busy', '更新中…');
      } catch (e) { console.error(e); PB.boot = null; }
    }
    if (!PB.boot) document.getElementById('app').innerHTML = '<div class="loading"><span class="spin"></span>載入中…</div>';
    PB.api.boot().then((b) => {
      lastSync = Date.now();
      PB.stale = false;
      const first = !PB.boot;
      loadBoot(b);
      saveSnapshot();
      if (first) renderShell();
      PB.render();
      setSync('ok');
    }).catch((e) => {
      if (['AUTH', 'NOT_STAFF', 'NO_ACCESS'].indexOf(e.code) >= 0) return handleError(e);
      if (PB.boot) { PB.stale = 'err'; setSync('err', '無法連線'); renderBanner(); }
      else showFatal(e.message);
    });
  }

  function showFatal(msg) {
    document.getElementById('app').innerHTML = '<div class="login"><div class="card"><h1>理論上｜' + esc(APPDEF.title) + '</h1><p>' + esc(msg) + '</p><button class="btn pri" onclick="location.reload()">重新載入</button></div></div>';
  }

  function showLogin(msg) {
    closeSheetNow();
    document.getElementById('app').innerHTML = '<div class="login"><div class="card"><h1>理論上｜' + esc(APPDEF.title) + '</h1>' +
      '<p>' + (msg ? '<span style="color:var(--bad)">' + esc(msg) + '</span><br>' : '') + '請用人員資料登記的 Google 帳號登入</p>' +
      '<div class="gbtn" id="gbtn"><span class="spin"></span></div><p style="margin-top:14px;font-size:.8rem" id="gmsg"></p></div></div>';
    if (!C.GOOGLE_CLIENT_ID || /填入/.test(C.GOOGLE_CLIENT_ID)) {
      document.getElementById('gbtn').innerHTML = '<span class="mut">尚未設定 config.js 的 GOOGLE_CLIENT_ID</span>';
      return;
    }
    const init = () => {
      google.accounts.id.initialize({ client_id: C.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: !msg, cancel_on_tap_outside: false });
      const box = document.getElementById('gbtn');
      box.innerHTML = '';
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'zh-TW', width: 260 });
      if (!msg) google.accounts.id.prompt();
    };
    if (window.google && google.accounts && google.accounts.id) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    s.onerror = () => { document.getElementById('gbtn').innerHTML = '<span class="mut">Google 登入元件載入失敗，請檢查網路</span>'; };
    document.head.appendChild(s);
  }

  async function onCredential(resp) {
    const msg = document.getElementById('gmsg');
    if (msg) msg.innerHTML = '<span class="spin" style="display:inline-block;vertical-align:-4px"></span> 驗證中…';
    try {
      const r = await PB.api.login(resp.credential);
      PB.api.token = r.token;
      lastSync = Date.now();
      PB.stale = false;
      loadBoot(r.boot);
      saveSnapshot();
      renderShell();
      PB.render();
      setSync('ok');
    } catch (e) {
      if (msg) msg.innerHTML = '<span style="color:var(--bad)">' + esc(e.message) + '</span>';
    }
  }
})();
