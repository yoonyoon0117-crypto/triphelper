/* Trip helper✈️ — 프론트엔드 (빌드 없이 도는 바닐라 JS) */
(() => {
  'use strict';

  const API = '/api';
  const LS_LAST = 'trip-helper:last';
  const LS_PIN = 'trip-helper:pin-token';
  // 오프라인에서도 마지막 내용을 볼 수 있게 여행 목록·상세를 폰에 저장하는 키
  const LS_OFFLINE = 'triphelper_offline_cache_v1';
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  // 트렌디한 파스텔 틴트 팔레트 — 배경 / 은은한 테두리 / 선명한 포인트 글자
  const PALETTE = [
    { bg: '#E7F3FD', line: '#C9E4F8', ink: '#1467A3' }, // 스카이블루
    { bg: '#F0ECFE', line: '#DBD2FA', ink: '#5B43B8' }, // 라일락
    { bg: '#E5F7F2', line: '#C4EADD', ink: '#177563' }, // 민트
    { bg: '#FFF2E6', line: '#FADCC0', ink: '#A85D22' }, // 피치
    { bg: '#FDECF2', line: '#F8D3DF', ink: '#B23A5B' }, // 로즈
    { bg: '#FDF7DC', line: '#F2E4AC', ink: '#8A6A15' }, // 레몬
    { bg: '#EAF0FE', line: '#D3DEFB', ink: '#3A55B5' }, // 페리윙클
    { bg: '#EAF4EE', line: '#CFE7DA', ink: '#2E7A57' }, // 세이지
  ];
  const SYMBOLS = {
    KRW: '₩', EUR: '€', USD: '$', JPY: '¥', GBP: '£', CHF: 'CHF ', THB: '฿', VND: '₫', TWD: 'NT$',
    SGD: 'S$', AUD: 'A$', CAD: 'C$', CNY: '¥', HKD: 'HK$', PHP: '₱', TRY: '₺', AED: 'AED ',
  };

  const state = {
    trip: null,
    trips: [],
    tab: 'plan',
    version: 0,
    sheetOpen: false,
    syncing: false,
    lastSync: null,
    pinLocked: false,
    offline: false,
    offlineSavedAt: null,
    showPastDays: false,
    meta: { currencies: ['EUR', 'USD', 'JPY', 'GBP', 'THB', 'VND', 'TWD', 'SGD', 'AUD', 'CAD', 'CNY'] },
  };

  // ── 작은 도구들 ──────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, max = 0) => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: max });
  const won = (n) => `₩${nf(Math.round(Number(n) || 0))}`;
  const wonShort = (n) => {
    const v = Math.round(Number(n) || 0);
    const abs = Math.abs(v);
    if (abs >= 100000000) return `${nf(v / 100000000, 1)}억`;
    if (abs >= 10000) return `${nf(v / 10000, abs % 10000 === 0 ? 0 : 1)}만`;
    return nf(v);
  };
  function money(amount, currency) {
    const n = Number(amount) || 0;
    const sym = SYMBOLS[currency] || `${currency} `;
    const digits = Number.isInteger(n) ? 0 : 2;
    return `${sym}${nf(n, digits)}`;
  }
  const numOf = (v) => {
    if (typeof v === 'number') return v;
    return Number(String(v == null ? '' : v).replace(/[,\s₩원]/g, '')) || 0;
  };

  const parseD = (s) => {
    const [y, m, d] = String(s || '').split('-').map(Number);
    return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
  };
  const isoOf = (date) => date.toISOString().slice(0, 10);
  const addDays = (s, n) => {
    const d = parseD(s);
    d.setUTCDate(d.getUTCDate() + n);
    return isoOf(d);
  };
  const md = (s) => {
    const d = parseD(s);
    return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
  };
  const mdw = (s) => {
    const d = parseD(s);
    return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
  };
  // 기기 로컬 날짜(YYYY-MM-DD) — 해외에서도 폰 시간이 현지로 바뀌므로 현지 날짜와 일치한다.
  // (toISOString() 은 UTC 기준이라 한국·스페인에서 새벽에 하루 어긋난다.)
  const todayIso = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayCount = (trip) => {
    if (!trip || !trip.startDate || !trip.endDate) return 1;
    const diff = Math.round((parseD(trip.endDate) - parseD(trip.startDate)) / 86400000) + 1;
    return Math.max(1, Math.min(60, diff));
  };
  const dayDate = (trip, day) => addDays(trip.startDate, Math.max(0, day - 1));
  // 여행 기간 중이면 오늘이 몇 일차인지(todayDay) 알려 준다. 시작 전·기간 외에는 null.
  const tripTodayDay = (trip) => {
    if (!trip || !trip.startDate || !trip.endDate) return null;
    const today = todayIso();
    if (today < trip.startDate || today > trip.endDate) return null;
    const day = Math.round((parseD(today) - parseD(trip.startDate)) / 86400000) + 1;
    return Math.min(Math.max(1, day), Math.max(1, dayCount(trip)));
  };
  const defaultExpenseDate = () => {
    const t = todayIso();
    if (!state.trip) return t;
    if (t < state.trip.startDate) return state.trip.startDate;
    if (t > state.trip.endDate) return state.trip.endDate;
    return t;
  };
  const initial = (name) => {
    const s = String(name || '').trim();
    const digit = s.match(/\d{1,2}/);
    if (digit && s.length <= 10) return digit[0];
    const clean = s.replace(/^[^\w가-힣]+/, '');
    return (clean[0] || '?').toUpperCase();
  };
  const paletteOf = (id) => {
    const idx = Math.max(0, (state.trip?.participants || []).findIndex((p) => p.id === id));
    return PALETTE[idx % PALETTE.length];
  };
  const avatar = (name, id, size = 30) => {
    const c = paletteOf(id);
    const extra = size !== 30
      ? `width:${size}px;height:${size}px;border-radius:${Math.max(6, Math.round(size * 0.37))}px;font-size:${Math.round(size * 0.45)}px;`
      : '';
    return `<span class="avatar" style="background:${c.bg};border-color:${c.line};color:${c.ink};${extra}">${esc(initial(name))}</span>`;
  };
  const personLabel = (p) => (p.type === 'person' ? '개인' : `어른 ${p.adults}·아이 ${p.kids}`);
  const headsOf = (p) => (p.type === 'person' ? 1 : (Number(p.adults) || 0) + (Number(p.kids) || 0));
  const totalHeads = () => (state.trip?.participants || []).reduce((s, p) => s + headsOf(p), 0);
  const allPersons = () => (state.trip?.participants || []).every((p) => p.type === 'person');
  const peopleText = () => {
    const list = state.trip?.participants || [];
    if (!list.length) return '';
    if (allPersons()) return `${list.length}명`;
    if (list.length === 2) return list.map((p) => p.name).join(' · ');
    return `${list.length}팀 · ${totalHeads()}명`;
  };
  const findPerson = (id) => (state.trip?.participants || []).find((p) => p.id === id) || { id, name: '알 수 없음', type: 'person', adults: 1, kids: 0 };
  const personName = (id) => findPerson(id).name;

  function toast(msg, isError) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast is-on${isError ? ' err' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  // ── 서버 통신 ────────────────────────────────────────────
  const pinToken = () => {
    try { return localStorage.getItem(LS_PIN) || ''; } catch { return ''; }
  };
  const setPinToken = (token) => {
    try {
      if (token) localStorage.setItem(LS_PIN, token);
      else localStorage.removeItem(LS_PIN);
    } catch { /* 저장 실패해도 이번 방문은 열린 상태 */ }
  };
  const pinHeaders = () => {
    const t = pinToken();
    return t ? { 'X-Trip-Pin-Token': t } : {};
  };

  // ── 오프라인 저장(캐시) ─────────────────────────────────────
  // 온라인에서 받은 여행 목록·상세를 폰(localStorage)에 저장해 두고,
  // 인터넷이 끊겨도 한 번 잠금을 푼 기기라면 그대로 보여 준다.
  //   · 서버 목록을 받을 때마다 목록을 똑같이 맞춘다(다른 기기에서 지운 여행도 정리)
  //   · 여행을 삭제하면 그 여행은 폰에서도 바로 지운다(남은 여행이 없으면 키 자체 삭제)
  //   · 비밀번호가 바뀜·무효(401)면 토큰과 함께 저장 내용도 지운다
  const emptyCache = () => ({ v: 1, savedAt: null, meta: null, trips: [], tripsById: {} });
  function cacheRead() {
    try {
      const raw = localStorage.getItem(LS_OFFLINE);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.trips) || !data.tripsById || typeof data.tripsById !== 'object') return null;
      return data;
    } catch { return null; }
  }
  function cacheWrite(data) {
    try { localStorage.setItem(LS_OFFLINE, JSON.stringify(data)); } catch { /* 용량 부족 등 — 없어도 앱은 돈다 */ }
  }
  function cacheClear() {
    try { localStorage.removeItem(LS_OFFLINE); } catch { /* ignore */ }
  }
  const summaryOfTrip = (t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    subtitle: t.subtitle,
    startDate: t.startDate,
    endDate: t.endDate,
    localCurrency: t.localCurrency,
    exchangeRate: t.exchangeRate,
    participantCount: (t.participants || []).length,
    participantNames: (t.participants || []).map((p) => p.name),
    version: t.version,
    updatedAt: t.updatedAt,
  });
  function cacheSaveMeta(meta) {
    if (!meta) return;
    const prev = cacheRead() || emptyCache();
    cacheWrite({ ...prev, v: 1, meta });
  }
  // 서버 여행 목록과 폰 저장 목록을 똑같이 맞춘다.
  function cacheSaveList(trips) {
    const list = Array.isArray(trips) ? trips : [];
    if (!list.length) { cacheClear(); return; } // 남은 여행이 없으면 저장 키 자체를 지운다
    const prev = cacheRead() || emptyCache();
    const ids = new Set(list.map((t) => t.id));
    const tripsById = {};
    for (const [id, trip] of Object.entries(prev.tripsById)) if (ids.has(id)) tripsById[id] = trip;
    cacheWrite({ ...prev, v: 1, savedAt: new Date().toISOString(), trips: list, tripsById });
  }
  function cacheSaveTrip(trip) {
    if (!trip || !trip.id) return;
    const prev = cacheRead() || emptyCache();
    const trips = (prev.trips || []).filter((t) => t.id !== trip.id);
    trips.push(summaryOfTrip(trip));
    cacheWrite({
      ...prev,
      v: 1,
      savedAt: new Date().toISOString(),
      trips,
      tripsById: { ...prev.tripsById, [trip.id]: trip },
    });
  }
  // 여행 삭제 — 폰에 저장한 그 여행도 바로 지운다.
  function cacheRemoveTrip(id) {
    const prev = cacheRead();
    if (!prev) return;
    const trips = (prev.trips || []).filter((t) => t.id !== id);
    const tripsById = { ...prev.tripsById };
    delete tripsById[id];
    if (!trips.length && !Object.keys(tripsById).length) { cacheClear(); return; }
    cacheWrite({ ...prev, trips, tripsById, savedAt: new Date().toISOString() });
  }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { ...pinHeaders() };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: Object.keys(headers).length ? headers : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // 네트워크가 끊김 — 저장이 필요한 작업이면 튕기지 않고 친절하게 알린다
      markOffline();
      const offlineErr = new Error(method === 'GET'
        ? (path.startsWith('/exchange-rate') ? '인터넷이 연결되면 환율을 불러올 수 있어요.' : '인터넷이 연결되지 않았어요. 연결되면 다시 불러올게요.')
        : '인터넷이 연결되면 저장할 수 있어요.');
      offlineErr.offline = true;
      throw offlineErr;
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      // 토큰이 만료됐거나 PIN 이 바뀌면 → 잠금 화면을 다시 띄우고 폰에 저장한 내용도 지운다
      if (res.status === 401 && data && (data.code === 'PIN_REQUIRED' || data.code === 'PIN_WRONG')) {
        setPinToken(null);
        cacheClear();
        if (!lock.open) openLock('비밀번호를 다시 한 번 입력해 주세요.');
      }
      const err = new Error((data && data.error) || '요청을 처리하지 못했어요.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ── 4자리 입장 비밀번호 잠금 화면 ──────────────────────
  const lock = { open: false, digits: '', busy: false };

  function paintLockDots() {
    $$('#lockDots .lock-dot').forEach((el, i) => el.classList.toggle('is-on', i < lock.digits.length));
  }
  function setLockMsg(text, isErr) {
    const el = $('#lockMsg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-err', Boolean(isErr));
  }
  function openLock(message) {
    lock.open = true;
    lock.digits = '';
    setLockMsg(message || '');
    paintLockDots();
    const el = $('#lockScreen');
    if (el) {
      el.classList.add('is-open');
      el.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('is-locked');
  }
  function closeLock() {
    lock.open = false;
    lock.digits = '';
    const el = $('#lockScreen');
    if (el) {
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('is-locked');
  }
  function shakeLock() {
    const card = $('#lockScreen .lock-card');
    if (!card) return;
    card.classList.remove('is-shaking');
    void card.offsetWidth;
    card.classList.add('is-shaking');
    setTimeout(() => card.classList.remove('is-shaking'), 460);
  }

  async function submitPin() {
    if (lock.busy || lock.digits.length !== 4) return;
    lock.busy = true;
    setLockMsg('');
    try {
      const res = await fetch(`${API}/pin/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...pinHeaders() },
        body: JSON.stringify({ pin: lock.digits }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setLockMsg((data && data.error) || '비밀번호가 맞지 않아요.', true);
        shakeLock();
        lock.digits = '';
        paintLockDots();
        return;
      }
      setPinToken(data && data.token);
      state.pinLocked = true;
      closeLock();
      await startApp();
    } catch {
      setLockMsg('연결이 잠시 불안해요. 다시 시도해 주세요.', true);
      shakeLock();
      lock.digits = '';
      paintLockDots();
    } finally {
      lock.busy = false;
    }
  }

  function pressLockKey(key) {
    if (!lock.open) return;
    if (key === 'del') {
      lock.digits = lock.digits.slice(0, -1);
      setLockMsg('');
      paintLockDots();
      return;
    }
    if (!/^\d$/.test(key) || lock.digits.length >= 4) return;
    lock.digits += key;
    setLockMsg('');
    paintLockDots();
    if (lock.digits.length === 4) setTimeout(submitPin, 90);
  }

  function bindLock() {
    const pad = $('#lockPad');
    if (pad) pad.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-key]');
      if (btn) pressLockKey(btn.dataset.key);
    });
    document.addEventListener('keydown', (e) => {
      if (!lock.open) return;
      if (/^\d$/.test(e.key)) pressLockKey(e.key);
      else if (e.key === 'Backspace') { e.preventDefault(); pressLockKey('del'); }
      else if (e.key === 'Enter') submitPin();
    });
  }

  async function fetchPinStatus() {
    try {
      const res = await fetch(`${API}/pin/status`, { headers: pinHeaders() });
      if (!res.ok) return null;
      return await res.json();
    } catch { return undefined; } // 네트워크 자체가 끊김(오프라인) — 잠금 여부를 알 수 없음
  }

  // ── 정산 계산(미리보기용 — 서버와 같은 규칙) ──────────────
  function distribute(total, entries) {
    const out = {};
    const rows = entries.map((e) => ({ id: e.id, weight: Math.max(0, Number(e.weight) || 0) }));
    const wsum = rows.reduce((s, r) => s + r.weight, 0);
    if (wsum <= 0) { rows.forEach((r) => { out[r.id] = 0; }); return out; }
    let assigned = 0;
    const calc = rows.map((r) => {
      const exact = (total * r.weight) / wsum;
      const base = Math.floor(exact);
      assigned += base;
      return { id: r.id, base, frac: exact - base, weight: r.weight };
    });
    let rest = total - assigned;
    calc.filter((r) => r.weight > 0).sort((a, b) => b.frac - a.frac || b.weight - a.weight)
      .forEach((r) => { if (rest > 0) { r.base += 1; rest -= 1; } });
    calc.forEach((r) => { out[r.id] = r.base; });
    return out;
  }

  function weightsFor(split, participants) {
    const s = split || { mode: 'even' };
    const ids = new Set(participants.map((p) => p.id));
    if (s.mode === 'headcount') return participants.map((p) => ({ id: p.id, weight: headsOf(p) }));
    if (s.mode === 'adults') return participants.map((p) => ({ id: p.id, weight: p.type === 'person' ? 1 : Number(p.adults) || 0 }));
    if (s.mode === 'select') {
      const picked = (s.participantIds || []).filter((id) => ids.has(id));
      const list = picked.length ? picked : participants.map((p) => p.id);
      return participants.map((p) => ({ id: p.id, weight: list.includes(p.id) ? 1 : 0 }));
    }
    if (s.mode === 'custom') {
      const amounts = s.amounts || {};
      const rows = participants.map((p) => ({ id: p.id, weight: Math.max(0, Number(amounts[p.id]) || 0) }));
      return rows.some((r) => r.weight > 0) ? rows : participants.map((p) => ({ id: p.id, weight: 1 }));
    }
    return participants.map((p) => ({ id: p.id, weight: 1 }));
  }

  function previewBurden(draft) {
    const rate = Number(state.trip.exchangeRate) || 0;
    const krw = draft.currency === 'base' ? Math.round(numOf(draft.amount)) : Math.round(numOf(draft.amount) * rate);
    return { krw, burden: distribute(krw, weightsFor(draft.split, state.trip.participants)) };
  }

  // ── 서버 상태 반영 ───────────────────────────────────────
  let syncKind = 'ok';
  let syncText = '자동 동기화';

  function applyTrip(trip, { soft = false, fromCache = false } = {}) {
    const sameTrip = state.trip && state.trip.id === trip.id;
    state.trip = trip;
    state.version = trip.version;
    state.lastSync = new Date();
    if (!fromCache) {
      localStorage.setItem(LS_LAST, trip.code);
      cacheSaveTrip(trip); // 온라인에서 받은 최신 내용을 폰에도 저장
    }
    renderHeader();
    if (!sameTrip) state.tab = 'plan';
    if (!sameTrip) state.showPastDays = false;
    if (!sameTrip) { fx.preview = null; fx.local = ''; fx.krw = ''; }
    // 다른 여행으로 바꾸면 붙여넣기 초안도 비운다 (일차는 그 여행 기간으로 계산되므로)
    if (!sameTrip && bulkDraft.parsed) { bulkDraft.text = ''; bulkDraft.parsed = null; bulkDraft.selected = null; bulkDraft.mode = 'append'; }
    renderTabs();
    // 설정·환율 탭에서 입력하는 중이면 자동 동기화가 화면(입력값)을 갈아엎지 않게 한다
    const focused = document.activeElement;
    const typing = focused && focused.closest && focused.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName);
    if (!(soft && (state.tab === 'settings' || state.tab === 'rate') && typing)) renderView();
    if (!soft && !sameTrip) window.scrollTo({ top: 0 });
    const url = `/t/${trip.code}`;
    if (location.pathname !== url) history.replaceState({}, '', url);
    if (fromCache) {
      markOffline(state.offlineSavedAt);
    } else {
      setSync('ok');
      clearOffline();
    }
  }

  // ── 오프라인 표시 ─────────────────────────────────────────
  function offlineWhenLabel() {
    const at = state.offlineSavedAt || (cacheRead() && cacheRead().savedAt);
    if (!at) return '';
    try { return `${new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장분`; } catch { return ''; }
  }
  function paintOffline() {
    const bar = $('#offlineBar');
    if (!bar) return;
    bar.hidden = !state.offline;
    bar.setAttribute('aria-hidden', state.offline ? 'false' : 'true');
    const when = $('#offlineWhen');
    if (when) when.textContent = state.offline ? offlineWhenLabel() : '';
  }
  function markOffline(savedAt) {
    state.offline = true;
    if (savedAt) state.offlineSavedAt = savedAt;
    else if (state.offlineSavedAt == null) state.offlineSavedAt = (cacheRead() && cacheRead().savedAt) || null;
    paintOffline();
    if (syncKind !== 'off') setSync('off');
  }
  function clearOffline() {
    if (!state.offline) return;
    state.offline = false;
    paintOffline();
  }

  function setSync(kind, text) {
    syncKind = kind;
    syncText = text || (kind === 'syncing' ? '맞추는 중' : kind === 'off' ? '오프라인' : '자동 동기화');
    paintSync();
  }
  function paintSync() {
    const el = $('#syncBadge');
    const txt = $('#syncText');
    if (!el || !txt) return; // 동기화 표시는 설정 탭에 있어요
    el.classList.toggle('is-syncing', syncKind === 'syncing');
    el.classList.toggle('is-off', syncKind === 'off');
    txt.textContent = syncText;
  }

  // ── 렌더: 헤더 ───────────────────────────────────────────
  function renderHeader() {
    const t = state.trip;
    if (!t) return;
    $('#tripName').textContent = t.name;
    $('#tripMeta').textContent = `${md(t.startDate)} – ${md(t.endDate)} · ${dayCount(t)}일 · ${peopleText()}`;
  }

  function stripHtml() {
    const t = state.trip;
    if (!t) return '';
    return t.participants.map((p) => `
      <button class="person-chip" data-act="edit-participant" data-id="${p.id}">
        ${avatar(p.name, p.id, 21)}
        <span class="name">${esc(p.name)}</span>
        ${p.type === 'person' ? '' : `<span class="count">${headsOf(p)}명</span>`}
      </button>`).join('') + `
      <button class="person-chip is-add" data-act="new-participant">＋ 참여자</button>`;
  }

  function renderTabs() {
    $$('#tabbar .tab').forEach((b) => {
      const on = b.dataset.tab === state.tab;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  // ── 렌더: 정산 ───────────────────────────────────────────
  function renderSettle() {
    const t = state.trip;
    const s = t.settlement;

    const transferSum = s.transfers.reduce((a, x) => a + x.amount, 0);
    const perHead = totalHeads() > 0 ? s.totalKrw / totalHeads() : 0;
    const fxSub = s.byCurrency.filter((c) => c.currency !== t.baseCurrency).map((c) => `≈ ${money(c.amount, c.currency)}`).join(' · ');

    const summary = `
      <section class="trip-summary fade-in">
        <div class="summary-row">
          <span class="summary-item"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/></svg>${md(t.startDate)} – ${md(t.endDate)} · ${dayCount(t)}일</span>
          ${t.localCurrency === t.baseCurrency ? '' : `<span class="summary-sep"></span>
          <button class="summary-item summary-link" data-act="go-rate" aria-label="환율 계산기 열기"><svg viewBox="0 0 24 24"><path d="M4 7h13l3 5-3 5H4z"/><path d="M8 11v3M12 11v3"/></svg>1 ${esc(t.localCurrency)} = ${nf(t.exchangeRate, 2)}원<span class="arr">›</span></button>`}
        </div>
        <div class="people-strip" id="peopleStrip">${stripHtml()}</div>
      </section>`;

    const heroRows = s.transfers.map((x) => `
      <div class="transfer">
        <span class="who">${avatar(x.from.name, x.from.id, 20)}<span class="name">${esc(x.from.name)}</span></span>
        <span class="arrow">→</span>
        <span class="who to"><span class="name">${esc(x.to.name)}</span>${avatar(x.to.name, x.to.id, 20)}</span>
        <span class="amount krw">${won(x.amount)}</span>
      </div>`).join('');

    const boxes = `
      <div class="stat-boxes">
        <div class="stat-box"><span class="k">총 지출</span><span class="v krw">${won(s.totalKrw)}</span><span class="s">${t.expenses.length}건${fxSub ? ` · ${fxSub}` : ''}</span></div>
        <div class="stat-box"><span class="k">1인당 평균</span><span class="v krw">${won(perHead)}</span><span class="s">${totalHeads()}명 기준</span></div>
        <div class="stat-box"><span class="k">송금 안내</span><span class="v">${s.transfers.length ? `${s.transfers.length}건` : '없음'}</span><span class="s">${s.transfers.length ? '최소 송금' : '정산 끝'}</span></div>
      </div>`;

    const hero = `
      <section class="hero fade-in">
        <div class="hero-label">${s.transfers.length ? '정산할 금액' : '정산 상태'}</div>
        <div class="hero-amount krw">${s.transfers.length ? won(transferSum) : '딱 맞아요😆'}</div>
        <div class="hero-sub">${s.transfers.length
          ? (s.transfers.length === 1 ? '한 번만 보내면 정산 끝!' : `${s.transfers.length}번 송금하면 딱 맞아요`)
          : (s.totalKrw ? '서로 보낼 돈이 없어요 🎉' : '첫 지출을 기록해 보세요')}</div>
        ${boxes}
        ${s.transfers.length ? `<div class="hero-list">${heroRows}</div>` : `<div class="hero-empty">${s.totalKrw ? '모두 제 몫만큼 냈어요. 계산할 게 없습니다.' : '지출을 추가하면 누가 누구에게 얼마 보내면 되는지 바로 알려드려요.'}</div>`}
      </section>`;

    const addBtn = `<button class="btn-cta" id="btnAdd" data-act="add-expense">＋ 지출 추가하기</button>`;

    const peopleRows = s.participants.map((p) => {
      const net = Math.round(p.net);
      const cls = net > 0 ? 'plus' : net < 0 ? 'minus' : 'zero';
      const label = net > 0 ? `받을 ${won(net)}` : net < 0 ? `보낼 ${won(-net)}` : '딱 맞음';
      const detail = (p.paid || p.burden) ? `냈어요 ${won(p.paid)} · 부담 ${won(p.burden)}` : '아직 지출 없음';
      return `
        <div class="prow">
          ${avatar(p.name, p.id)}
          <div class="who">
            <div class="name">${esc(p.name)}<span class="tag">${p.type === 'person' ? '개인' : `어른${p.adults}·아이${p.kids}`}</span></div>
            <div class="detail">${detail}</div>
          </div>
          <div class="net ${cls}">${label}</div>
        </div>`;
    }).join('');

    const peopleCard = `
      <section class="card fade-in">
        <div class="section-title" style="padding:13px 14px 9px">
          <h3>참여자별 정산</h3>
          <span class="hint">1인당 부담도 함께 계산</span>
        </div>
        <div class="people-list">${peopleRows}</div>
      </section>`;

    const expenses = t.expenses;
    const expenseTitle = `<div class="section-title"><h3>지출 내역</h3><span class="hint">${expenses.length}건</span></div>`;
    let expenseSection;
    if (!expenses.length) {
      expenseSection = expenseTitle + `
        <section class="card empty fade-in">
          <div class="emo">🧾</div>
          <div class="t">아직 지출이 없어요</div>
          <div class="s">위의 지출 추가하기 버튼으로 첫 지출을 기록해 보세요.</div>
        </section>`;
    } else {
      const groups = new Map();
      for (const e of expenses) {
        if (!groups.has(e.date)) groups.set(e.date, []);
        groups.get(e.date).push(e);
      }
      const blocks = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([date, list]) => `
        <div class="day-head">
          <span class="d">${mdw(date)}</span>
          <span class="w">${list.length}건</span>
          <span class="line"></span>
        </div>
        <section class="card exp-list">
          ${list.map((e) => {
            const payer = findPerson(e.payerId);
            const rate = Number(t.exchangeRate) || 0;
            const second = e.currency === 'base'
              ? (rate > 0 ? `≈ ${money(e.krw / rate, t.localCurrency)}` : '')
              : won(e.krw);
            return `
            <button class="exp" data-act="edit-expense" data-id="${e.id}">
              ${avatar(payer.name, payer.id)}
              <div class="body">
                <div class="t">${esc(e.title)}${e.memo ? '<span class="memo-dot"></span>' : ''}</div>
                <div class="sub">${esc(payer.name)} 결제 · ${modeLabel(e.split)}</div>
              </div>
              <div class="amt">
                <div class="a">${money(e.amount, e.currency === 'base' ? t.baseCurrency : t.localCurrency)}</div>
                <div class="b krw">${second}</div>
              </div>
            </button>`;
          }).join('')}
        </section>`).join('');
      expenseSection = expenseTitle + blocks;
    }

    // 순서: 정산할 금액 → ＋ 지출 추가하기 → 지출 내역 → 참여자별 정산(맨 아래)
    return summary + hero + addBtn + expenseSection + peopleCard;
  }

  function modeLabel(split) {
    const s = split || { mode: 'even' };
    const n = state.trip ? state.trip.participants.length : 2;
    switch (s.mode) {
      case 'headcount': return '인원 비례';
      case 'adults': return '어른 비례';
      case 'select': return `${(s.participantIds || []).length}명끼리`;
      case 'custom': return '직접 지정';
      default: {
        const unit = allPersons() ? '명' : '팀';
        return n === 2 ? '반반' : `${n}${unit} 똑같이`;
      }
    }
  }

  // ── 렌더: 환율 계산기 ────────────────────────────────
  // 네이버에서 방금 불러온 환율(저장 전)과 계산기 입력값을 여기에 둔다
  const fx = { preview: null, loading: false, local: '', krw: '' };

  const fxRate = () => {
    const t = state.trip;
    if (!t) return 0;
    const p = fx.preview;
    if (p && p.currency === t.localCurrency) return Number(p.rate) || 0;
    return Number(t.exchangeRate) || 0;
  };
  const fxRateLine = (rate, cur) => (rate > 0 ? `1 ${cur} = ${nf(rate, 2)}원` : '환율을 먼저 넣어 주세요');
  const fxWhen = (iso) => {
    const d = new Date(iso || '');
    if (!iso || Number.isNaN(d.getTime())) return '방금';
    return `${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  // 통화 단위에 맞는 빠른 금액 칩 (€5 · ¥1,000 …)
  const fxChipAmounts = (rate) => {
    if (rate >= 100) return [5, 10, 20, 50, 100];
    if (rate >= 1) return [100, 500, 1000, 5000];
    return [1000, 5000, 10000, 50000];
  };
  const fmtLocal = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return '';
    return nf(n, Number.isInteger(n) ? 0 : 2);
  };
  // 환율이 바뀌면 마지막에 고친 입력값을 기준으로 반대쪽을 다시 계산
  const fxRecalc = () => {
    const rate = fxRate();
    if (!(rate > 0)) return;
    if (numOf(fx.local) > 0) fx.krw = String(Math.round(numOf(fx.local) * rate));
    else if (numOf(fx.krw) > 0) fx.local = String(Math.round((numOf(fx.krw) / rate) * 100) / 100);
  };

  function renderRates() {
    const t = state.trip;
    const cur = t.localCurrency;
    const rate = fxRate();
    const savedRate = Number(t.exchangeRate) || 0;
    const preview = fx.preview && fx.preview.currency === cur ? fx.preview : null;
    const sym = SYMBOLS[cur] || `${cur} `;
    fxRecalc();

    const naver = preview ? `
        <div class="fx-naver fade-in" id="rateNaver">
          <div class="fx-naver-top">
            <span class="fx-badge">네이버 환율</span>
            <span class="fx-when">${esc(fxWhen(preview.quotedAt || preview.fetchedAt))} 기준</span>
          </div>
          <div class="fx-naver-val" id="rateNaverValue">${fxRateLine(preview.rate, cur)}</div>
          <div class="fx-naver-actions">
            <button class="btn small primary" data-act="rate-save">이 환율 저장</button>
            <button class="btn small" data-act="rate-dismiss">닫기</button>
          </div>
        </div>` : '';

    return `
      <div class="section-title"><h3>환율 계산기</h3><span class="hint">쇼핑할 때 바로</span></div>
      <section class="card card-pad fx-card fade-in">
        <div class="fx-rate-row">
          <div class="fx-rate-main">
            <span class="fx-k">저장된 환율</span>
            <span class="fx-v" id="fxRateValue">${fxRateLine(savedRate, cur)}</span>
            <span class="fx-s">${preview ? '지금은 네이버 환율로 계산 중' : '설정 탭 여행 정보에 저장된 값'}</span>
          </div>
          <button class="btn small soft" id="btnRateFetch" data-act="rate-fetch">${fx.loading ? '불러오는 중…' : '네이버 환율 불러오기'}</button>
        </div>
        ${naver}
      </section>

      <section class="card card-pad fx-calc fade-in">
        <div class="fx-field">
          <span class="fx-cur">${esc(cur)}</span>
          <input class="fx-input" id="cvLocal" inputmode="decimal" autocomplete="off" value="${esc(fmtLocal(numOf(fx.local)))}" placeholder="0" aria-label="${esc(cur)} 금액" />
        </div>
        <div class="fx-swap" aria-hidden="true"><span>⇅</span></div>
        <div class="fx-field">
          <span class="fx-cur">₩</span>
          <input class="fx-input" id="cvKrw" inputmode="numeric" autocomplete="off" value="${esc(fmtLocal(numOf(fx.krw)))}" placeholder="0" aria-label="원화 금액" />
        </div>
        <div class="chips fx-chips" id="cvChips">
          ${fxChipAmounts(rate).map((n) => `<button class="chip" data-act="rate-chip" data-amount="${n}">${sym}${nf(n)}</button>`).join('')}
        </div>
        <div class="fx-actions">
          <button class="btn small" data-act="rate-clear">C 초기화</button>
          <button class="btn small primary" data-act="rate-to-expense">＋ 이 금액 지출 추가</button>
        </div>
        <div class="note" id="cvNote">${rate > 0 ? `1 ${esc(cur)} = ${nf(rate, 2)}원 기준으로 계산해요.` : '환율을 넣으면 바로 계산돼요.'}</div>
      </section>

      <div class="note fx-tip">💱 네이버 환율은 매매기준율(하나은행 고시)이에요. 카드 결제 금액은 수수료·환전 스프레드 때문에 조금 다를 수 있어요.</div>
    `;
  }

  function bindRates() {
    const localEl = $('#cvLocal');
    const krwEl = $('#cvKrw');

    const fromLocal = (raw) => {
      const rate = fxRate();
      fx.local = raw;
      const val = numOf(raw);
      const krw = val > 0 && rate > 0 ? Math.round(val * rate) : 0;
      fx.krw = krw > 0 ? String(krw) : '';
      if (krwEl) krwEl.value = krw > 0 ? nf(krw) : '';
    };
    const fromKrw = (raw) => {
      const rate = fxRate();
      fx.krw = raw;
      const val = numOf(raw);
      const local = val > 0 && rate > 0 ? Math.round((val / rate) * 100) / 100 : 0;
      fx.local = local > 0 ? String(local) : '';
      if (localEl) localEl.value = local > 0 ? fmtLocal(local) : '';
    };

    if (localEl) localEl.addEventListener('input', () => {
      const clean = localEl.value.replace(/[^\d.]/g, '');
      if (clean !== localEl.value) localEl.value = clean;
      fromLocal(clean);
    });
    if (krwEl) krwEl.addEventListener('input', () => {
      const clean = krwEl.value.replace(/[^\d]/g, '');
      if (clean !== krwEl.value) krwEl.value = clean;
      fromKrw(clean);
    });

    $$('#cvChips [data-act="rate-chip"]').forEach((b) => b.addEventListener('click', () => {
      const amount = Number(b.dataset.amount) || 0;
      const text = nf(amount);
      if (localEl) localEl.value = text;
      fromLocal(text);
    }));

    const on = (act, fn) => {
      const el = $(`#view [data-act="${act}"]`);
      if (el) el.addEventListener('click', fn);
    };
    on('rate-clear', () => {
      fx.local = ''; fx.krw = '';
      if (localEl) localEl.value = '';
      if (krwEl) krwEl.value = '';
    });
    on('rate-fetch', fetchNaverRate);
    on('rate-save', saveNaverRate);
    on('rate-dismiss', () => { fx.preview = null; renderView(); });
    on('rate-to-expense', () => {
      const amount = numOf(fx.local);
      if (!(amount > 0)) { toast('먼저 금액을 입력해 주세요.', true); if (localEl) localEl.focus(); return; }
      openExpenseSheet({ preset: { amount: String(amount), currency: 'local' } });
    });
  }

  async function fetchNaverRate() {
    const t = state.trip;
    if (!t || fx.loading) return;
    const cur = t.localCurrency;
    fx.loading = true;
    const btn = $('#btnRateFetch');
    if (btn) { btn.textContent = '불러오는 중…'; btn.disabled = true; }
    try {
      const data = await api(`/exchange-rate?currency=${encodeURIComponent(cur)}`);
      fx.preview = { ...data, currency: data.currency || cur };
      fx.loading = false;
      renderView();
      toast(`네이버 환율 ${nf(data.rate, 2)}원을 불러왔어요.`);
    } catch (err) {
      fx.loading = false;
      if (btn) { btn.textContent = '네이버 환율 불러오기'; btn.disabled = false; }
      toast(err.message, true);
    }
  }

  async function saveNaverRate() {
    const t = state.trip;
    const p = fx.preview;
    if (!t || !p) return;
    if (p.currency !== t.localCurrency) { fx.preview = null; renderView(); return; }
    try {
      const trip = await api(`/trips/${t.id}`, { method: 'PATCH', body: { exchangeRate: Number(p.rate) } });
      fx.preview = null;
      applyTrip(trip);
      toast(`네이버 환율 ${nf(Number(trip.exchangeRate), 2)}원을 여행 환율로 저장했어요.`);
    } catch (err) { toast(err.message, true); }
  }
  // ── 렌더: 일정 ───────────────────────────────────────────
  function mapHref(item) {
    if (item.mapUrl) return item.mapUrl;
    const q = [item.place, item.region].filter(Boolean).join(' ');
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }

  function renderPlan() {
    const t = state.trip;
    const items = t.itinerary;
    const addBtn = `<button class="btn-cta" id="btnAdd" data-act="add-plan">＋ 일정 추가하기</button>`;
    if (!items.length) {
      return addBtn + `
        <section class="card empty fade-in">
          <div class="emo">🗺️</div>
          <div class="t">일정이 비어 있어요</div>
          <div class="s">숙소·맛집·예약을 날짜별로 모아 두면<br>이동할 때 지도 버튼 한 번으로 열 수 있어요.</div>
        </section>`;
    }
    const byDay = new Map();
    for (const it of items) {
      if (!byDay.has(it.day)) byDay.set(it.day, []);
      byDay.get(it.day).push(it);
    }
    const ordered = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
    // 여행 진행 중이면 지난 날 일정은 접어 두고 오늘 일정이 맨 위에 오게 한다.
    const todayDay = tripTodayDay(t);
    const past = todayDay ? ordered.filter(([day]) => day < todayDay) : [];
    const upcoming = todayDay ? ordered.filter(([day]) => day >= todayDay) : ordered;
    const showPast = Boolean(todayDay && past.length && state.showPastDays);
    const blockHtml = ([day, list]) => `
      <div class="day-block fade-in${day === todayDay ? ' is-today' : ''}">
        <div class="day-banner">
          <span class="day-badge">Day ${day}</span>
          ${day === todayDay ? '<span class="day-today">오늘</span>' : ''}
          <span class="day-date">${mdw(dayDate(t, day))}</span>
        </div>
        ${list.map((it) => `
          <section class="card itn">
            <div class="itn-top">
              <span class="itn-time">${it.time ? esc(it.time) : '시간 미정'}</span>
              <div class="itn-main">
                <div class="itn-place">${esc(it.place)}</div>
                ${it.region ? `<span class="itn-region">${esc(it.region)}</span>` : ''}
              </div>
              <button class="icon-btn" data-act="edit-itinerary" data-id="${it.id}" aria-label="일정 수정">
                <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14 6 4 4"/></svg>
              </button>
            </div>
            ${it.memo ? `<div class="itn-memo">${esc(it.memo)}</div>` : ''}
            <div class="itn-actions">
              <a class="mini-btn" href="${esc(mapHref(it))}" target="_blank" rel="noopener noreferrer">구글지도로 열기 ↗</a>
              <button class="mini-btn ghost" data-act="itn-to-expense" data-id="${it.id}">＋ 이 일정 지출 기록</button>
            </div>
          </section>`).join('')}
      </div>`;
    const title = `<div class="section-title"><h3>일정</h3><span class="hint">${items.length}개 · ${byDay.size}일</span></div>`;
    if (!past.length) return title + addBtn + ordered.map(blockHtml).join('');

    const pastCount = past.reduce((n, [, list]) => n + list.length, 0);
    const toggle = `<button class="past-toggle" data-act="toggle-past" aria-expanded="${showPast ? 'true' : 'false'}">
        <span>지난 일정 ${past.length}일 (${pastCount}개)</span>
        <span class="past-toggle-state">${showPast ? '접기 ▴' : '보기 ▾'}</span>
      </button>`;
    // 접었을 때: 오늘·앞으로 일정 먼저 → 맨 아래 1줄 토글로 지난 일정 열기
    // 펼쳤을 때: 날짜 순서대로 전부 + 맨 위 토글로 다시 접기
    if (showPast) return title + addBtn + toggle + ordered.map(blockHtml).join('');
    const quiet = upcoming.length ? '' : '<div class="plan-note">오늘 이후 일정이 아직 없어요. 아래에서 지난 일정을 볼 수 있어요.</div>';
    return title + addBtn + quiet + upcoming.map(blockHtml).join('') + toggle;
  }

  function renderView() {
    if (!state.trip) {
      $('#view').innerHTML = `<section class="card empty"><div class="emo">✈️</div><div class="t">여행을 준비해 볼까요?</div><div class="s">첫 여행을 만들면 링크 하나로 함께 쓸 수 있어요.</div><div style="margin-top:14px"><button class="btn primary" data-act="new-trip">여행 만들기</button></div></section>`;
      renderTabs();
      return;
    }
    const y = window.scrollY;
    if (state.tab === 'plan') {
      $('#view').innerHTML = renderPlan();
    } else if (state.tab === 'rate') {
      $('#view').innerHTML = renderRates();
      bindRates();
    } else if (state.tab === 'settings') {
      $('#view').innerHTML = renderSettings();
      bindSettings();
    } else {
      $('#view').innerHTML = renderSettle();
    }
    paintSync();
    renderTabs();
    if (y > 0) window.scrollTo({ top: y });
  }

  function resetToEmpty() {
    state.trip = null;
    state.version = 0;
    localStorage.removeItem(LS_LAST);
    $('#tripName').textContent = '여행이 없어요';
    $('#tripMeta').textContent = '새 여행을 만들어 시작해 보세요';
    renderView();
    renderTabs();
  }

  // ── 시트 공통 ────────────────────────────────────────────
  function openSheet(title, html) {
    $('#sheetTitle').textContent = title;
    $('#sheetBody').innerHTML = html;
    $('#sheetLayer').classList.add('is-open');
    $('#sheetLayer').setAttribute('aria-hidden', 'false');
    state.sheetOpen = true;
    document.body.style.overflow = 'hidden';
    $('#sheetBody').scrollTop = 0;
  }
  function closeSheet() {
    $('#sheetLayer').classList.remove('is-open');
    $('#sheetLayer').setAttribute('aria-hidden', 'true');
    state.sheetOpen = false;
    document.body.style.overflow = '';
    setTimeout(() => { if (!state.sheetOpen) { $('#sheetBody').innerHTML = ''; } }, 320);
    syncNow();
  }
  const sheetBody = () => $('#sheetBody');

  // ── 시트: 여행 전환 ──────────────────────────────────────
  async function openTripSheet() {
    let trips = state.trips;
    try {
      trips = (await api('/trips')).trips;
      state.trips = trips;
      cacheSaveList(trips);
    } catch { /* 목록 실패해도 현재 여행으로 */ }
    const rows = trips.map((t) => `
      <button class="list-row ${state.trip && t.id === state.trip.id ? 'is-on' : ''}" data-act="switch-trip" data-id="${t.id}">
        <div class="body">
          <div class="t">${esc(t.name)}</div>
          <div class="s">${t.subtitle ? `${esc(t.subtitle)} · ` : ''}${md(t.startDate)} – ${md(t.endDate)} · ${t.kind === 'people' ? `${t.peopleCount}명` : `${t.participantCount}팀`} · 지출 ${t.expenseCount}건</div>
        </div>
        ${state.trip && t.id === state.trip.id ? '<span class="end"><svg viewBox="0 0 24 24" style="width:20px;height:20px;color:#1a79b8"><path d="m5 13 4 4L19 7"/></svg></span>' : '<span class="end">›</span>'}
      </button>`).join('');
    openSheet('여행 선택', `
      <section class="card list">${rows || '<div class="empty"><div class="s">아직 여행이 없어요.</div></div>'}</section>
      <button class="btn primary" data-act="new-trip">＋ 새 여행 만들기</button>
      <div class="note">📱 아이폰은 사파리에서 이 페이지를 열고 <b>공유 → 홈 화면에 추가</b>를 누르면 앱처럼 쓸 수 있어요.</div>
    `);
  }

  // ── 시트: 새 여행 ────────────────────────────────────────
  function openNewTripSheet() {
    const t = todayIso();
    const currencies = state.meta.currencies;
    openSheet('새 여행', `
      <div class="field"><label>여행 이름</label>
        <input class="input" id="ntName" placeholder="예: 🇯🇵 오사카 3박 4일" maxlength="60" /></div>
      <div class="field"><label>한 줄 메모 (선택)</label>
        <input class="input" id="ntSub" placeholder="예: 친구 5명 우정 여행" maxlength="120" /></div>
      <div class="input-row">
        <div class="field" style="flex:1"><label>시작일</label><input class="input" id="ntStart" type="date" value="${addDays(t, 14)}" /></div>
        <div class="field" style="flex:1"><label>종료일</label><input class="input" id="ntEnd" type="date" value="${addDays(t, 17)}" /></div>
      </div>
      <div class="input-row">
        <div class="field" style="flex:1"><label>현지 통화</label>
          <select class="input" id="ntCur">
            ${currencies.map((c) => `<option value="${c}" ${c === 'EUR' ? 'selected' : ''}>${c}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1"><label id="ntRateLabel">환율 (1 EUR = ?원)</label>
          <input class="input" id="ntRate" inputmode="decimal" value="1500" /></div>
      </div>
      <div class="field"><span class="field-label">누구와 함께 가나요?</span>
        <div class="seg" id="ntTemplate">
          <button class="is-on" data-tpl="twoFamilies">두 가족</button>
          <button data-tpl="friends">친구·여행 메이트</button>
        </div>
      </div>
      <div id="ntFriendBox" style="display:none">
        <div class="stepper"><span class="lab">함께 가는 인원</span>
          <button data-act="nt-minus">−</button><span class="n" id="ntCount">5</span><button data-act="nt-plus">＋</button>
        </div>
      </div>
      <div class="note" id="ntHint">A가족(어른2·아이2), B가족(어른2·아이1)로 시작해요. 이름과 인원은 만든 뒤에도 자유롭게 바꿀 수 있어요.</div>
      <div class="actions"><button class="btn primary" data-act="create-trip">여행 만들기</button></div>
    `);

    const box = $('#ntFriendBox');
    let template = 'twoFamilies';
    let count = 5;
    $('#ntCur').addEventListener('change', (e) => { $('#ntRateLabel').textContent = `환율 (1 ${e.target.value} = ?원)`; });
    $$('#ntTemplate button').forEach((b) => b.addEventListener('click', () => {
      template = b.dataset.tpl;
      $$('#ntTemplate button').forEach((x) => x.classList.toggle('is-on', x === b));
      box.style.display = template === 'friends' ? '' : 'none';
      $('#ntHint').textContent = template === 'friends'
        ? `친구 ${count}명이 1/N로 나눠 쓰는 여행으로 시작해요. 이름은 만든 뒤에 바꿀 수 있어요.`
        : 'A가족(어른2·아이2), B가족(어른2·아이1)로 시작해요. 이름과 인원은 만든 뒤에도 자유롭게 바꿀 수 있어요.';
    }));
    $$('#sheetBody [data-act="nt-plus"], #sheetBody [data-act="nt-minus"]').forEach((b) => b.addEventListener('click', () => {
      count = Math.min(30, Math.max(2, count + (b.dataset.act === 'nt-plus' ? 1 : -1)));
      $('#ntCount').textContent = count;
      $('#ntHint').textContent = `친구 ${count}명이 1/N로 나눠 쓰는 여행으로 시작해요. 이름은 만든 뒤에 바꿀 수 있어요.`;
    }));

    $('#sheetBody [data-act="create-trip"]').addEventListener('click', async () => {
      const name = $('#ntName').value.trim();
      if (!name) { toast('여행 이름을 적어 주세요.', true); $('#ntName').focus(); return; }
      const body = {
        name,
        subtitle: $('#ntSub').value.trim(),
        startDate: $('#ntStart').value,
        endDate: $('#ntEnd').value,
        localCurrency: $('#ntCur').value,
        exchangeRate: numOf($('#ntRate').value) || 1500,
        template,
        friendCount: count,
      };
      try {
        const trip = await api('/trips', { method: 'POST', body });
        state.trip = null;
        applyTrip(trip);
        state.trips = (await api('/trips')).trips;
        closeSheet();
        toast('새 여행을 만들었어요 ✈️');
      } catch (err) {
        toast(err.message, true);
      }
    });
  }

  // ── 시트: 참여자 추가/수정 ───────────────────────────────
  function openParticipantSheet(pid) {
    const t = state.trip;
    const existing = pid ? t.participants.find((p) => p.id === pid) : null;
    const draft = existing
      ? { ...existing }
      : { name: `친구 ${t.participants.length + 1}`, type: 'person', adults: 1, kids: 0 };
    if (draft.type === 'person') { draft.adults = 1; draft.kids = 0; }

    openSheet(existing ? '참여자 수정' : '참여자 추가', `
      <div class="field"><label>이름 / 호칭</label>
        <input class="input" id="ptName" value="${esc(draft.name)}" maxlength="20" placeholder="예: A가족, 김서연, 친구 3" /></div>
      <div class="field"><span class="field-label">형태</span>
        <div class="seg" id="ptType">
          <button data-type="group" class="${draft.type === 'group' ? 'is-on' : ''}">가족 / 팀</button>
          <button data-type="person" class="${draft.type === 'person' ? 'is-on' : ''}">개인</button>
        </div>
      </div>
      <div id="ptCounts" style="display:${draft.type === 'group' ? 'flex' : 'none'};flex-direction:column;gap:9px">
        <div class="stepper"><span class="lab">어른</span>
          <button data-act="pt-a-minus">−</button><span class="n" id="ptAdults">${draft.adults}</span><button data-act="pt-a-plus">＋</button></div>
        <div class="stepper"><span class="lab">아이</span>
          <button data-act="pt-k-minus">−</button><span class="n" id="ptKids">${draft.kids}</span><button data-act="pt-k-plus">＋</button></div>
      </div>
      <div class="note" id="ptHint">${draft.type === 'group'
        ? '가족 단위로 인원 비례 분담을 쓸 수 있어요. 이름은 정산·지출 화면에 그대로 나타나요.'
        : '개인 단위는 1명으로 계산해요. 친구 여행에 딱 맞아요.'}</div>
      <div class="actions">
        ${existing ? '<button class="btn danger" data-act="delete-participant">삭제</button>' : ''}
        <button class="btn primary" data-act="save-participant">${existing ? '저장' : '추가'}</button>
      </div>
    `);

    let count = { adults: Number(draft.adults) || 0, kids: Number(draft.kids) || 0 };
    let type = draft.type;

    $$('#ptType button').forEach((b) => b.addEventListener('click', () => {
      type = b.dataset.type;
      $$('#ptType button').forEach((x) => x.classList.toggle('is-on', x === b));
      $('#ptCounts').style.display = type === 'group' ? 'flex' : 'none';
      $('#ptHint').textContent = type === 'group'
        ? '가족 단위로 인원 비례 분담을 쓸 수 있어요. 이름은 정산·지출 화면에 그대로 나타나요.'
        : '개인 단위는 1명으로 계산해요. 친구 여행에 딱 맞아요.';
    }));
    const bindStep = (act, key, el) => $(`#sheetBody [data-act="${act}"]`).addEventListener('click', () => {
      count[key] = Math.min(20, Math.max(0, count[key] + (act.endsWith('plus') ? 1 : -1)));
      $(el).textContent = count[key];
    });
    bindStep('pt-a-plus', 'adults', '#ptAdults');
    bindStep('pt-a-minus', 'adults', '#ptAdults');
    bindStep('pt-k-plus', 'kids', '#ptKids');
    bindStep('pt-k-minus', 'kids', '#ptKids');

    $('#sheetBody [data-act="save-participant"]').addEventListener('click', async () => {
      const name = $('#ptName').value.trim();
      if (!name) { toast('이름을 적어 주세요.', true); return; }
      if (type === 'group' && count.adults + count.kids < 1) { toast('어른+아이를 1명 이상으로 해 주세요.', true); return; }
      const body = { name, type, adults: type === 'person' ? 1 : count.adults, kids: type === 'person' ? 0 : count.kids };
      try {
        const trip = existing
          ? await api(`/trips/${t.id}/participants/${existing.id}`, { method: 'PATCH', body })
          : await api(`/trips/${t.id}/participants`, { method: 'POST', body });
        applyTrip(trip);
        closeSheet();
        toast(existing ? '참여자 정보를 바꿨어요' : '참여자를 추가했어요');
      } catch (err) { toast(err.message, true); }
    });

    const delBtn = $('#sheetBody [data-act="delete-participant"]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (t.participants.length <= 2) { toast('참여자는 최소 2명이 남아야 해요.', true); return; }
      try {
        const trip = await api(`/trips/${t.id}/participants/${existing.id}`, { method: 'DELETE' });
        applyTrip(trip);
        closeSheet();
        toast('참여자를 삭제했어요');
      } catch (err) {
        if (err.status === 409 && err.data && err.data.code === 'PARTICIPANT_IN_USE') {
          openReassignSheet(existing, err.data.usage || {});
        } else {
          toast(err.message, true);
        }
      }
    });
  }

  function openReassignSheet(person, usage) {
    const others = state.trip.participants.filter((p) => p.id !== person.id);
    openSheet('지출 옮기고 삭제', `
      <div class="note warn"><b>${esc(person.name)}</b> 님이 들어간 지출이 있어요.<br>
        결제한 지출 ${usage.payerCount || 0}건 · 함께 부담하는 지출 ${usage.splitCount || 0}건<br>
        아래에서 지출을 넘길 사람을 골라 주세요.</div>
      <div class="chips" id="raChips">
        ${others.map((p, i) => `<button class="chip ${i === 0 ? 'is-on' : ''}" data-id="${p.id}">${avatar(p.name, p.id, 18)}${esc(p.name)}</button>`).join('')}
      </div>
      <div class="actions">
        <button class="btn" data-act="close-sheet">취소</button>
        <button class="btn danger" data-act="ra-confirm">옮기고 삭제</button>
      </div>
    `);
    let target = others[0] ? others[0].id : '';
    $$('#raChips .chip').forEach((b) => b.addEventListener('click', () => {
      target = b.dataset.id;
      $$('#raChips .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    }));
    $('#sheetBody [data-act="ra-confirm"]').addEventListener('click', async () => {
      try {
        const trip = await api(`/trips/${state.trip.id}/participants/${person.id}?reassignTo=${encodeURIComponent(target)}`, { method: 'DELETE' });
        applyTrip(trip);
        closeSheet();
        toast('지출을 옮기고 참여자를 삭제했어요');
      } catch (err) { toast(err.message, true); }
    });
  }

  // ── 설정 탭 ──────────────────────────────────────────────
  function lastSyncLabel() {
    if (!state.lastSync) return '—';
    try {
      return new Date(state.lastSync).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    } catch { return '—'; }
  }

  // ── 설정: 일정 한 번에 붙여넣기 ───────────────────────────
  // 붙여넣은 메모·카톡 일정을 일차·시간·장소·메모로 나눠 미리 보여 주고,
  // 고른 항목만 한 번에 등록한다. 파싱은 브라우저(/itinerary-parser.js)에서 하므로 오프라인에서도 미리보기가 된다.
  const bulkDraft = { text: '', parsed: null, selected: null, mode: 'append', busy: false };

  const BULK_PLACEHOLDER = [
    '12/27(일) 마드리드 : 톨레도 근교여행',
    '09:15 -> 09:49 마드리드 -> 톨레도',
    '10:00~12:00 구시가지 관광',
    '  - 소코도베르 광장으로 이동',
    '19:00 저녁식사 @Restaurante Sol (예약)',
  ].join('\n');

  function bulkDaysLabel() {
    const stats = (bulkDraft.parsed && bulkDraft.parsed.stats) || {};
    const days = Array.isArray(stats.days) ? stats.days : [];
    if (!days.length) return '';
    return days.length === 1 ? `Day ${days[0]}` : `Day ${days[0]}~${days[days.length - 1]}`;
  }

  function bulkPreviewHtml() {
    const parsed = bulkDraft.parsed;
    if (!parsed) return '';
    const items = parsed.items || [];
    const selected = bulkDraft.selected instanceof Set ? bulkDraft.selected : new Set();
    if (!items.length) {
      return '<div class="note warn">일정을 찾지 못했어요. 12/27 · Day 1 · 1일차 같은 날짜나 10:00 장소처럼 시간이 들어간 줄을 넣어 보세요.</div>';
    }
    const rows = items.map((it, i) => `
      <label class="bulk-item${selected.has(i) ? '' : ' is-off'}">
        <input type="checkbox" class="bulk-check" data-idx="${i}"${selected.has(i) ? ' checked' : ''} />
        <span class="bulk-body">
          <span class="bulk-top">
            <span class="bulk-day">Day ${it.day}</span>
            <span class="bulk-time">${it.time ? esc(it.time) : '시간 미정'}</span>
            <span class="bulk-place">${esc(it.place)}</span>
          </span>
          ${it.memo ? `<span class="bulk-memo">${esc(it.memo)}</span>` : ''}
        </span>
      </label>`).join('');
    const noteLines = (parsed.stats && parsed.stats.noteLines) || 0;
    const skipped = noteLines ? `<div class="bulk-hint">참고 메모로 본 ${noteLines}줄은 일정에 넣지 않았어요.</div>` : '';
    const now = state.trip.itinerary.length;
    return `
      <div class="bulk-summary">
        <b>총 ${items.length}개 일정</b>
        <span class="bulk-sep"></span>
        <span>${bulkDaysLabel()}</span>
        <span class="bulk-sep"></span>
        <span id="bulkPickCount">${selected.size}개 선택</span>
      </div>
      <div class="bulk-list">${rows}</div>
      ${skipped}
      <div class="radio-list bulk-modes">
        <button class="radio ${bulkDraft.mode === 'append' ? 'is-on' : ''}" data-act="bulk-mode" data-mode="append">
          <span class="dot"></span>
          <span class="body"><span class="t">기존 일정 뒤에 추가</span><span class="s">지금 ${now}개 일정은 그대로 둬요</span></span>
        </button>
        <button class="radio ${bulkDraft.mode === 'replace' ? 'is-on' : ''}" data-act="bulk-mode" data-mode="replace">
          <span class="dot"></span>
          <span class="body"><span class="t">기존 일정 지우고 새로 채우기</span><span class="s">이 여행의 일정 ${now}개를 지우고 새로 넣어요</span></span>
        </button>
      </div>
      <button class="btn primary" data-act="bulk-apply">일정에 반영하기</button>`;
  }

  function renderBulkPreview() {
    const box = $('#bulkPreview');
    if (box) box.innerHTML = bulkPreviewHtml();
  }

  function paintBulkCount() {
    const el = $('#bulkPickCount');
    if (el) el.textContent = `${bulkDraft.selected instanceof Set ? bulkDraft.selected.size : 0}개 선택`;
  }

  async function previewBulk() {
    const t = state.trip;
    if (!t) return;
    const el = $('#bulkText');
    const text = (el ? el.value : bulkDraft.text || '').trim();
    if (!text) {
      toast('먼저 일정을 붙여넣어 주세요.', true);
      if (el) el.focus();
      return;
    }
    bulkDraft.text = text;
    const box = $('#bulkPreview');
    if (box) box.innerHTML = '<div class="bulk-loading">일정을 정리하는 중…</div>';
    let parsed = null;
    try {
      const parser = window.ItineraryParser;
      if (parser && typeof parser.parseItinerary === 'function') {
        parsed = parser.parseItinerary(text, { startDate: t.startDate, endDate: t.endDate });
      } else {
        // 예전 캐시로 파서 파일이 없을 때는 서버 파서를 쓴다 (결과는 같음)
        parsed = await api(`/trips/${t.id}/itinerary/parse`, { method: 'POST', body: { text } });
      }
    } catch (err) {
      if (box) box.innerHTML = '';
      toast(err.offline ? '오프라인 상태예요. 인터넷이 연결되면 일정을 정리할 수 있어요.' : err.message, true);
      return;
    }
    bulkDraft.parsed = parsed;
    bulkDraft.selected = new Set(((parsed && parsed.items) || []).map((_, i) => i));
    renderBulkPreview();
    if (!bulkDraft.selected.size) toast('일정을 찾지 못했어요. 날짜·시간이 들어간 줄을 넣어 보세요.', true);
  }

  function setBulkMode(mode) {
    bulkDraft.mode = mode === 'replace' ? 'replace' : 'append';
    renderBulkPreview();
  }

  async function applyBulk() {
    const t = state.trip;
    const parsed = bulkDraft.parsed;
    if (!t || !parsed) { toast('먼저 일정 미리보기를 눌러 주세요.', true); return; }
    const selected = bulkDraft.selected instanceof Set ? bulkDraft.selected : new Set();
    const items = (parsed.items || [])
      .filter((_, i) => selected.has(i))
      .map((it) => ({ day: it.day, time: it.time, place: it.place, region: it.region, memo: it.memo }));
    if (!items.length) { toast('반영할 일정을 하나 이상 골라 주세요.', true); return; }
    if (bulkDraft.busy) return;
    // 기존 일정을 지우는 선택은 되돌릴 수 없으니 한 번 더 묻는다
    if (bulkDraft.mode === 'replace' && t.itinerary.length) {
      openConfirm({
        title: '기존 일정을 지울까요?',
        message: `지금 있는 일정 ${t.itinerary.length}개를 지우고, 고른 ${items.length}개로 새로 채워요. 되돌릴 수 없어요.`,
        confirmLabel: '지우고 채우기',
        onConfirm: async () => {
          const done = await runBulkApply(items);
          if (done) closeSheet();
        },
      });
      return;
    }
    await runBulkApply(items);
  }

  async function runBulkApply(items) {
    const t = state.trip;
    if (!t || bulkDraft.busy) return false;
    bulkDraft.busy = true;
    const btn = $('#view [data-act="bulk-apply"]');
    if (btn) { btn.disabled = true; btn.textContent = '반영하는 중…'; }
    try {
      const trip = await api(`/trips/${t.id}/itinerary/bulk`, {
        method: 'POST',
        body: { items, replaceExisting: bulkDraft.mode === 'replace' },
      });
      bulkDraft.text = '';
      bulkDraft.parsed = null;
      bulkDraft.selected = null;
      bulkDraft.mode = 'append';
      state.tab = 'plan';
      applyTrip(trip);
      window.scrollTo({ top: 0 });
      toast(`일정 ${items.length}개를 등록했어요 🗺️`);
      return true;
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '일정에 반영하기'; }
      if (err.offline) toast('오프라인 상태예요. 인터넷이 연결되면 일정을 등록할 수 있어요.', true);
      else toast(err.message, true);
      return false;
    } finally {
      bulkDraft.busy = false;
    }
  }

  function renderSettings() {
    const t = state.trip;
    const shareUrl = `${location.origin}/t/${t.code}`;
    const currencies = [...new Set([...state.meta.currencies, t.localCurrency])];
    const rows = t.participants.map((p) => `
      <button class="list-row" data-act="edit-participant" data-id="${p.id}">
        ${avatar(p.name, p.id)}
        <div class="body">
          <div class="t">${esc(p.name)}</div>
          <div class="s">${personLabel(p)} · ${headsOf(p)}명</div>
        </div>
        <span class="end">수정 ›</span>
      </button>`).join('');

    return `
      <div class="settings-block fade-in">
        <div class="section-title"><h3>여행 정보</h3><span class="hint">저장하면 함께 보는 사람에게도 반영</span></div>
        <section class="card card-pad">
          <div class="form-grid">
            <div class="field"><label for="stName">여행 이름</label>
              <input class="input" id="stName" value="${esc(t.name)}" maxlength="60" /></div>
            <div class="field"><label for="stSub">한 줄 메모</label>
              <input class="input" id="stSub" value="${esc(t.subtitle || '')}" maxlength="120" placeholder="예: 두 가족 첫 유럽 여행" /></div>
            <div class="input-row">
              <div class="field" style="flex:1"><label for="stStart">시작일</label><input class="input" id="stStart" type="date" value="${t.startDate}" /></div>
              <div class="field" style="flex:1"><label for="stEnd">종료일</label><input class="input" id="stEnd" type="date" value="${t.endDate}" /></div>
            </div>
            <div class="input-row">
              <div class="field" style="flex:1"><label for="stCur">현지 통화</label>
                <select class="input" id="stCur">
                  ${currencies.map((c) => `<option value="${c}" ${c === t.localCurrency ? 'selected' : ''}>${c}</option>`).join('')}
                </select></div>
              <div class="field" style="flex:1"><label id="stRateLabel" for="stRate">환율 (1 ${esc(t.localCurrency)} = ?원)</label>
                <input class="input" id="stRate" inputmode="decimal" value="${t.exchangeRate}" /></div>
            </div>
            <div class="note">환율을 바꾸면 현지 통화 지출이 모두 새 환율로 다시 계산돼요.</div>
            <button class="btn small soft st-rate-btn" data-act="st-rate-fetch">네이버 환율 불러오기</button>
            <button class="btn primary" data-act="save-settings">여행 정보 저장</button>
          </div>
        </section>
      </div>

      <div class="settings-block">
        <div class="section-title"><h3>일정 한 번에 붙여넣기</h3><span class="hint">지금 ${t.itinerary.length}개 일정</span></div>
        <section class="card card-pad bulk-card">
          <div class="field">
            <label for="bulkText">일정 텍스트</label>
            <textarea class="input bulk-textarea" id="bulkText" rows="6" spellcheck="false" placeholder="${esc(BULK_PLACEHOLDER)}">${esc(bulkDraft.text)}</textarea>
          </div>
          <button class="btn soft bulk-preview-btn" data-act="bulk-preview">일정 미리보기</button>
          <div id="bulkPreview">${bulkPreviewHtml()}</div>
          <div class="note">메모·카톡에 적어 둔 그대로 붙여넣으면 일차·시간·장소로 나눠요. <b>12/27(일)</b>·<b>Day 1</b>·<b>1일차</b> 같은 표기를 알아보고, 들여쓴 줄·하위 불릿은 그 일정의 메모로 넣습니다.</div>
        </section>
      </div>

      <div class="settings-block">
        <div class="section-title"><h3>참여자</h3><span class="hint">${t.participants.length}팀 · ${totalHeads()}명</span></div>
        <section class="card list">${rows}</section>
        <button class="btn soft" data-act="new-participant">＋ 참여자 추가</button>
      </div>

      ${state.pinLocked ? `
      <div class="settings-block">
        <div class="section-title"><h3>입장 비밀번호</h3><span class="hint">4자리</span></div>
        <section class="card card-pad pin-card">
          <div class="pin-fields">
            <div class="field"><label for="stPinCur">현재 비밀번호</label>
              <input class="input pin-input" id="stPinCur" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" aria-label="현재 입장 비밀번호 4자리" /></div>
            <div class="field"><label for="stPinNew">새 비밀번호</label>
              <input class="input pin-input" id="stPinNew" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••" aria-label="새 입장 비밀번호 4자리" /></div>
          </div>
          <button class="btn soft st-pin-btn" data-act="change-pin">비밀번호 변경</button>
          <div class="note">바꾸면 지금까지 열어 둔 기기는 모두 잠기고, 새 비밀번호를 한 번 더 입력해야 열려요.</div>
        </section>
      </div>` : ''}

      <div class="settings-block">
        <div class="section-title"><h3>함께 쓰는 링크</h3><span class="hint">로그인 없이 공유</span></div>
        <section class="card card-pad" style="display:flex;flex-direction:column;gap:9px">
          <div class="share-box">
            <span class="code-badge">${esc(t.code)}</span>
            <span class="url">${esc(shareUrl)}</span>
            <button class="btn small primary" data-act="copy-link">복사</button>
          </div>
          <div class="note">링크를 받은 사람은 로그인 없이 같은 보드를 보고 고칠 수 있어요. 필요한 사람에게만 보내 주세요.</div>
        </section>
      </div>

      <div class="settings-block">
        <div class="section-title"><h3>자동 동기화</h3><span class="hint">5초마다</span></div>
        <section class="card card-pad" style="display:flex;flex-direction:column;gap:9px">
          <div class="row-between">
            <span class="sync" id="syncBadge"><span class="sync-dot"></span><span id="syncText">자동 동기화</span></span>
            <span class="hint" style="font-size:11.5px;font-weight:400">마지막 ${lastSyncLabel()}</span>
          </div>
          <div class="note">한쪽 폰에서 지출·일정을 바꾸면 다른 폰에 5초 안에 반영돼요. 입력하던 화면은 방해하지 않아요.</div>
          <div class="note">인터넷이 없을 때도 마지막으로 저장한 내용을 볼 수 있어요. 여행을 삭제하면 폰에 저장된 그 여행도 함께 지워지고, 입장 비밀번호를 바꾸면 폰 저장 내용도 지워져요.</div>
        </section>
      </div>

      <div class="settings-block">
        <div class="section-title"><h3>여행 관리</h3></div>
        <section class="card list">
          <button class="list-row" data-act="new-trip">
            <div class="body"><div class="t">새 여행 만들기</div><div class="s">다음 여행을 따로 만들어요</div></div>
            <span class="end">›</span>
          </button>
          <button class="list-row danger" data-act="delete-trip">
            <div class="body"><div class="t">여행 삭제</div><div class="s">지출과 일정이 함께 사라져요</div></div>
            <span class="end">›</span>
          </button>
        </section>
      </div>`;
  }

  function bindSettings() {
    const cur = $('#stCur');    if (cur) cur.addEventListener('change', () => {
      const label = $('#stRateLabel');
      if (label) label.textContent = `환율 (1 ${cur.value} = ?원)`;
    });

    // 입장 비밀번호 변경 — 현재 4자리 확인 후 교체(바꾸면 다른 기기 토큰은 모두 무효)
    const pinCur = $('#stPinCur');
    const pinNew = $('#stPinNew');
    [pinCur, pinNew].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', () => {
        const clean = el.value.replace(/[^\d]/g, '').slice(0, 4);
        if (clean !== el.value) el.value = clean;
      });
    });
    const pinBtn = $('#view [data-act="change-pin"]');
    if (pinBtn) pinBtn.addEventListener('click', async () => {
      const currentPin = (pinCur && pinCur.value || '').trim();
      const newPin = (pinNew && pinNew.value || '').trim();
      if (!/^\d{4}$/.test(currentPin)) { toast('현재 비밀번호 4자리를 넣어 주세요.', true); pinCur.focus(); return; }
      if (!/^\d{4}$/.test(newPin)) { toast('새 비밀번호 4자리를 넣어 주세요.', true); pinNew.focus(); return; }
      if (currentPin === newPin) { toast('지금과 다른 비밀번호로 정해 주세요.', true); pinNew.focus(); return; }
      pinBtn.disabled = true;
      try {
        const res = await fetch(`${API}/pin/change`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...pinHeaders() },
          body: JSON.stringify({ currentPin, pin: newPin }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error((data && data.error) || '비밀번호를 바꾸지 못했어요.');
        }
        setPinToken(data && data.token);
        state.pinLocked = true;
        if (pinCur) pinCur.value = '';
        if (pinNew) pinNew.value = '';
        toast('입장 비밀번호를 바꿨어요');
      } catch (err) {
        toast(err.message, true);
      } finally {
        pinBtn.disabled = false;
      }
    });

    const saveBtn = $('#view [data-act="save-settings"]');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      const t = state.trip;
      const body = {
        name: $('#stName').value.trim(),
        subtitle: $('#stSub').value.trim(),
        startDate: $('#stStart').value,
        endDate: $('#stEnd').value,
        localCurrency: $('#stCur').value,
        exchangeRate: numOf($('#stRate').value),
      };
      if (!body.name) { toast('여행 이름을 적어 주세요.', true); $('#stName').focus(); return; }
      if (!(body.exchangeRate > 0)) { toast('환율을 0보다 크게 넣어 주세요.', true); $('#stRate').focus(); return; }
      try {
        const trip = await api(`/trips/${t.id}`, { method: 'PATCH', body });
        applyTrip(trip);
        toast('여행 정보를 저장했어요');
      } catch (err) { toast(err.message, true); }
    });

    // 설정 탭에서도 네이버 환율을 바로 채울 수 있다 (저장은 아래 ‘여행 정보 저장’으로 확정)
    const stFetch = $('#view [data-act="st-rate-fetch"]');
    if (stFetch) stFetch.addEventListener('click', async () => {
      const t = state.trip;
      const currency = $('#stCur') ? $('#stCur').value : t.localCurrency;
      const label = stFetch.textContent;
      stFetch.textContent = '불러오는 중…';
      stFetch.disabled = true;
      try {
        const data = await api(`/exchange-rate?currency=${encodeURIComponent(currency)}`);
        const input = $('#stRate');
        if (input) input.value = nf(data.rate, 2);
        toast(`네이버 환율(${nf(data.rate, 2)}원)을 불러왔어요. 저장을 누르면 반영돼요.`);
      } catch (err) {
        toast(err.message, true);
      } finally {
        stFetch.textContent = label;
        stFetch.disabled = false;
      }
    });

    // 일정 붙여넣기 — 입력한 글은 초안으로 기억해 두고(자동 동기화로 화면이 다시 그려져도 유지),
    // 체크를 풀면 반영에서 빠집니다.
    const bulkText = $('#bulkText');
    if (bulkText) bulkText.addEventListener('input', () => { bulkDraft.text = bulkText.value; });
    const bulkBox = $('#bulkPreview');
    if (bulkBox) {
      bulkBox.addEventListener('change', (e) => {
        const box = e.target && e.target.closest ? e.target.closest('.bulk-check') : null;
        if (!box) return;
        const idx = Number(box.dataset.idx);
        if (!(bulkDraft.selected instanceof Set)) bulkDraft.selected = new Set();
        if (box.checked) bulkDraft.selected.add(idx);
        else bulkDraft.selected.delete(idx);
        const row = box.closest('.bulk-item');
        if (row) row.classList.toggle('is-off', !box.checked);
        paintBulkCount();
      });
    }

    const copyBtn = $('#view [data-act="copy-link"]');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const shareUrl = `${location.origin}/t/${state.trip.code}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        toast('공유 링크를 복사했어요');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = shareUrl;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); toast('공유 링크를 복사했어요'); } catch { toast(shareUrl); }
        ta.remove();
      }
    });
  }

  function confirmDeleteTrip() {
    const t = state.trip;
    if (!t) return;
    openConfirm({
      title: '여행을 삭제할까요?',
      message: `‘${esc(t.name)}’의 지출 ${t.expenses.length}건과 일정 ${t.itinerary.length}건이 함께 사라져요. 되돌릴 수 없어요.`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        await api(`/trips/${t.id}`, { method: 'DELETE' });
        cacheRemoveTrip(t.id); // 폰에 저장해 둔 이 여행도 바로 지운다
        const list = (await api('/trips')).trips;
        state.trips = list;
        cacheSaveList(list);
        closeSheet();
        if (list.length) {
          applyTrip(await api(`/trips/${list[0].id}`));
        } else {
          resetToEmpty();
          setTimeout(openNewTripSheet, 320);
        }
        toast('여행을 삭제했어요');
      },
    });
  }

  // ── 시트: 지출 ───────────────────────────────────────────
  function openExpenseSheet({ expenseId = null, preset = {} } = {}) {
    const t = state.trip;
    const existing = expenseId ? t.expenses.find((e) => e.id === expenseId) : null;
    const rate = Number(t.exchangeRate) || 1;
    const draft = existing
      ? {
        id: existing.id,
        title: existing.title,
        amount: existing.amount,
        currency: existing.currency,
        payerId: existing.payerId,
        date: existing.date,
        memo: existing.memo || '',
        split: JSON.parse(JSON.stringify(existing.split || { mode: 'even' })),
        sourceItineraryId: existing.sourceItineraryId || null,
      }
      : {
        title: preset.title || '',
        amount: preset.amount || '',
        currency: preset.currency || 'local',
        payerId: preset.payerId || t.participants[0].id,
        date: preset.date || defaultExpenseDate(),
        memo: preset.memo || '',
        split: { mode: 'even' },
        sourceItineraryId: preset.sourceItineraryId || null,
      };

    // 직접 금액 입력값(현재 통화 단위)
    const customInputs = {};
    if (draft.split.mode === 'custom') {
      for (const p of t.participants) {
        const base = Number(draft.split.amounts?.[p.id] || 0);
        customInputs[p.id] = base ? String((draft.currency === 'base' ? base : base / rate).toFixed(base % rate === 0 ? 0 : 2)) : '';
      }
    }
    if (draft.split.mode === 'select' && !draft.split.participantIds?.length) {
      draft.split.participantIds = t.participants.map((p) => p.id);
    }

    const currencyLabel = draft.currency === 'base' ? '원' : t.localCurrency;

    openSheet(existing ? '지출 수정' : '지출 추가', `
      <div class="field"><label>무엇에 썼나요?</label>
        <input class="input" id="exTitle" value="${esc(draft.title)}" maxlength="60" placeholder="예: 저녁 식사, 택시, 숙소" /></div>
      <div class="field"><label>금액</label>
        <div class="input-row">
          <input class="input" id="exAmount" inputmode="decimal" value="${draft.amount === '' ? '' : draft.amount}" placeholder="0" style="flex:2" />
          <div class="seg" id="exCur" style="flex:1.2">
            <button data-cur="${t.localCurrency}" data-val="local" class="${draft.currency === 'local' ? 'is-on' : ''}">${t.localCurrency}</button>
            <button data-cur="KRW" data-val="base" class="${draft.currency === 'base' ? 'is-on' : ''}">원</button>
          </div>
        </div>
        <div class="note" id="exConv"></div>
      </div>
      <div class="field"><span class="field-label">누가 결제했나요?</span>
        <div class="chips" id="exPayers">
          ${t.participants.map((p) => `<button class="chip ${p.id === draft.payerId ? 'is-on' : ''}" data-id="${p.id}">${avatar(p.name, p.id, 18)}${esc(p.name)}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>날짜</label>
        <input class="input" id="exDate" type="date" value="${draft.date}" /></div>
      <div class="field"><span class="field-label">어떻게 나눌까요?</span>
        <div class="radio-list" id="exModes"></div>
      </div>
      <div id="exExtra"></div>
      <div class="note good" id="exPreview"></div>
      <div class="field"><label>메모 (선택)</label>
        <input class="input" id="exMemo" value="${esc(draft.memo)}" maxlength="300" placeholder="예: 예약번호, 영수증 메모" /></div>
      <div class="actions">
        ${existing ? '<button class="btn danger" data-act="delete-expense">삭제</button>' : ''}
        <button class="btn primary" data-act="save-expense">${existing ? '저장' : '기록하기'}</button>
      </div>
    `);

    const modeDefs = [
      { id: 'even', t: '똑같이 나누기 (1/N)', s: `${t.participants.length}팀에게 똑같이` },
      { id: 'headcount', t: '전체 인원 비례 (어른+아이)', s: `${totalHeads()}명 기준으로 나누기` },
      { id: 'adults', t: '어른 인원 비례', s: `${t.participants.reduce((a, p) => a + (p.type === 'person' ? 1 : p.adults), 0)}명 기준으로 나누기` },
      { id: 'select', t: '선택한 사람끼리만', s: '택시·커피처럼 같이 쓴 사람만 체크' },
      { id: 'custom', t: '직접 금액 입력', s: '사람마다 낼 금액을 직접 지정' },
    ];

    function renderModes() {
      $('#exModes').innerHTML = modeDefs.map((m) => `
        <button class="radio ${draft.split.mode === m.id ? 'is-on' : ''}" data-mode="${m.id}">
          <span class="dot"></span>
          <span class="body"><span class="t">${m.t}</span><span class="s">${m.s}</span></span>
        </button>`).join('');
      $$('#exModes .radio').forEach((b) => b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        if (mode === 'select') {
          draft.split = { mode, participantIds: draft.split.mode === 'select' ? draft.split.participantIds : t.participants.map((p) => p.id) };
        } else if (mode === 'custom') {
          if (draft.split.mode !== 'custom' || !Object.keys(customInputs).length) {
            const { burden } = previewBurden(draft);
            for (const p of t.participants) {
              const base = burden[p.id] || 0;
              const v = draft.currency === 'base' ? base : base / rate;
              customInputs[p.id] = String(Number(v.toFixed(2)));
            }
          }
          draft.split = { mode: 'custom' };
        } else {
          draft.split = { mode };
        }
        renderModes();
        renderExtra();
        renderPreview();
      }));
    }

    function renderExtra() {
      const box = $('#exExtra');
      if (draft.split.mode === 'select') {
        box.innerHTML = `<div class="check-list">
          ${t.participants.map((p) => {
            const on = (draft.split.participantIds || []).includes(p.id);
            return `<button class="check-row ${on ? 'is-on' : ''}" data-sel="${p.id}">
              <span class="box"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>
              <span class="nm">${esc(p.name)}</span>
              <span class="amt" data-share="${p.id}"></span>
            </button>`;
          }).join('')}
        </div><div class="note">체크한 사람에게 똑같이 1/N로 나눠요.</div>`;
        $$('#exExtra [data-sel]').forEach((b) => b.addEventListener('click', () => {
          const id = b.dataset.sel;
          const list = new Set(draft.split.participantIds || []);
          if (list.has(id)) list.delete(id); else list.add(id);
          if (!list.size) { toast('한 명은 남겨 주세요.', true); return; }
          draft.split.participantIds = [...list];
          b.classList.toggle('is-on', list.has(id));
          renderPreview();
        }));
      } else if (draft.split.mode === 'custom') {
        box.innerHTML = `<div class="amount-list">
          ${t.participants.map((p) => `
            <div class="amount-row">
              <span class="nm">${esc(p.name)}</span>
              <input class="input" data-amt="${p.id}" inputmode="decimal" value="${customInputs[p.id] || ''}" placeholder="0" />
              <span class="amt" style="min-width:20px;font-size:12px;font-weight:400;color:#8397a6">${currencyLabel}</span>
            </div>`).join('')}
        </div>`;
        $$('#exExtra [data-amt]').forEach((inp) => inp.addEventListener('input', () => {
          customInputs[inp.dataset.amt] = inp.value;
          renderPreview();
        }));
        // 나머지 자동 채우기
        const totalC = numOf(draft.amount);
        box.insertAdjacentHTML('afterbegin', `<button class="mini-btn accent" data-act="fill-rest" style="margin-bottom:8px">마지막 사람에게 나머지 채우기</button>`);
        $('#exExtra [data-act="fill-rest"]').addEventListener('click', () => {
          const ids = t.participants.map((p) => p.id);
          const last = ids[ids.length - 1];
          let used = 0;
          for (const id of ids.slice(0, -1)) used += numOf(customInputs[id]);
          customInputs[last] = String(Number(Math.max(0, totalC - used).toFixed(2)));
          $$('#exExtra [data-amt]').forEach((inp) => { inp.value = customInputs[inp.dataset.amt] || ''; });
          renderPreview();
        });
      } else {
        box.innerHTML = '';
      }
    }

    function renderConv() {
      const v = numOf(draft.amount);
      if (!v) { $('#exConv').textContent = draft.currency === 'base' ? '원화로 기록해요' : `${t.localCurrency}로 기록해요`; return; }
      $('#exConv').textContent = draft.currency === 'base'
        ? `원화 ${won(v)}${rate ? ` · 현지 약 ${money(v / rate, t.localCurrency)}` : ''}`
        : `${money(v, t.localCurrency)} · 원화 약 ${won(v * rate)} (1 ${t.localCurrency} = ${nf(rate, 2)}원)`;
    }

    function renderPreview() {
      const { krw, burden } = previewBurden(draft);
      const rows = t.participants.filter((p) => burden[p.id] > 0 || draft.split.mode !== 'select')
        .map((p) => `${esc(p.name)} ${won(burden[p.id] || 0)}`);
      const el = $('#exPreview');
      el.innerHTML = krw ? `나눠 내면 — ${rows.join(' · ')}` : '금액을 입력하면 나눠 낼 금액을 보여드려요';
      if (draft.split.mode === 'custom' && krw) {
        const entered = t.participants.reduce((s, p) => s + numOf(customInputs[p.id]), 0);
        const enteredBase = draft.currency === 'base' ? entered : entered * rate;
        if (Math.abs(enteredBase - krw) > 1) {
          el.classList.add('warn');
          el.innerHTML += `<br>입력 합계가 총액과 달라 비율대로 맞춰 계산했어요.`;
        } else {
          el.classList.remove('warn');
        }
      }
      $$('#exExtra [data-share]').forEach((span) => {
        span.textContent = won(burden[span.dataset.share] || 0);
      });
    }

    renderModes();
    renderExtra();
    renderConv();
    renderPreview();

    $('#exTitle').addEventListener('input', (e) => { draft.title = e.target.value; });
    $('#exAmount').addEventListener('input', (e) => { draft.amount = e.target.value; renderConv(); renderPreview(); });
    $('#exDate').addEventListener('change', (e) => { draft.date = e.target.value; });
    $('#exMemo').addEventListener('input', (e) => { draft.memo = e.target.value; });
    $$('#exCur button').forEach((b) => b.addEventListener('click', () => {
      if (draft.currency === b.dataset.val) return;
      const prev = draft.currency;
      draft.currency = b.dataset.val;
      $$('#exCur button').forEach((x) => x.classList.toggle('is-on', x === b));
      // 직접 금액 입력값은 통화가 바뀌면 환산
      if (draft.split.mode === 'custom' && rate) {
        for (const id of Object.keys(customInputs)) {
          const v = numOf(customInputs[id]);
          const base = prev === 'base' ? v : v * rate;
          customInputs[id] = String(Number((draft.currency === 'base' ? base : base / rate).toFixed(2)));
        }
        renderExtra();
      }
      renderConv();
      renderPreview();
    }));
    $$('#exPayers .chip').forEach((b) => b.addEventListener('click', () => {
      draft.payerId = b.dataset.id;
      $$('#exPayers .chip').forEach((x) => x.classList.toggle('is-on', x === b));
    }));

    $('#sheetBody [data-act="save-expense"]').addEventListener('click', async () => {
      const title = draft.title.trim();
      const amount = numOf(draft.amount);
      if (!title) { toast('무엇에 썼는지 적어 주세요.', true); $('#exTitle').focus(); return; }
      if (!(amount > 0)) { toast('금액을 넣어 주세요.', true); $('#exAmount').focus(); return; }
      const split = JSON.parse(JSON.stringify(draft.split));
      if (split.mode === 'custom') {
        const amounts = {};
        for (const p of t.participants) {
          const v = numOf(customInputs[p.id]);
          if (v > 0) amounts[p.id] = draft.currency === 'base' ? Math.round(v) : Math.round(v * rate);
        }
        split.amounts = amounts;
      }
      const body = {
        title,
        amount,
        currency: draft.currency,
        payerId: draft.payerId,
        date: draft.date,
        memo: draft.memo.trim(),
        split,
        sourceItineraryId: draft.sourceItineraryId,
      };
      try {
        const trip = existing
          ? await api(`/trips/${t.id}/expenses/${existing.id}`, { method: 'PATCH', body })
          : await api(`/trips/${t.id}/expenses`, { method: 'POST', body });
        applyTrip(trip);
        closeSheet();
        toast(existing ? '지출을 수정했어요' : '지출을 기록했어요 ✍️');
      } catch (err) { toast(err.message, true); }
    });

    const delBtn = $('#sheetBody [data-act="delete-expense"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      openConfirm({
        title: '지출을 삭제할까요?',
        message: `‘${existing.title}’ ${money(existing.amount, existing.currency === 'base' ? t.baseCurrency : t.localCurrency)} 기록이 사라져요.`,
        confirmLabel: '삭제',
        onConfirm: async () => {
          const trip = await api(`/trips/${t.id}/expenses/${existing.id}`, { method: 'DELETE' });
          applyTrip(trip);
          closeSheet();
          toast('지출을 삭제했어요');
        },
      });
    });
  }

  // ── 시트: 일정 ───────────────────────────────────────────
  function openItinerarySheet({ itemId = null, preset = {} } = {}) {
    const t = state.trip;
    const existing = itemId ? t.itinerary.find((i) => i.id === itemId) : null;
    const maxDay = Math.max(dayCount(t), existing ? existing.day : 1);
    const draft = existing
      ? { ...existing }
      : {
        day: preset.day || 1,
        time: preset.time || '',
        place: preset.place || '',
        region: preset.region || '',
        memo: preset.memo || '',
        mapUrl: preset.mapUrl || '',
      };

    openSheet(existing ? '일정 수정' : '일정 추가', `
      <div class="input-row">
        <div class="field" style="flex:1"><label>일차</label>
          <select class="input" id="itDay">
            ${Array.from({ length: Math.max(maxDay, draft.day) }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === draft.day ? 'selected' : ''}>Day ${d} · ${md(dayDate(t, d))}</option>`).join('')}
          </select></div>
        <div class="field" style="flex:1"><label>시간 (선택)</label>
          <input class="input" id="itTime" type="time" value="${esc(draft.time || '')}" /></div>
      </div>
      <div class="field"><label>장소</label>
        <input class="input" id="itPlace" value="${esc(draft.place)}" maxlength="80" placeholder="예: 프라도 미술관, 숙소 이름" /></div>
      <div class="field"><label>지역 / 태그 (선택)</label>
        <input class="input" id="itRegion" value="${esc(draft.region)}" maxlength="30" placeholder="예: 마드리드, 바르셀로나" /></div>
      <div class="field"><label>메모 (선택)</label>
        <textarea class="input" id="itMemo" maxlength="500" placeholder="예: 예약번호, 체크포인트, 아이들 간식 챙기기">${esc(draft.memo)}</textarea></div>
      <div class="field"><label>구글지도 링크 (선택)</label>
        <input class="input" id="itMap" value="${esc(draft.mapUrl)}" placeholder="붙여넣지 않으면 장소 이름으로 검색해요" /></div>
      <div class="note" id="itHint"></div>
      <div class="actions">
        ${existing ? '<button class="btn danger" data-act="delete-itinerary">삭제</button>' : ''}
        <button class="btn primary" data-act="save-itinerary">${existing ? '저장' : '추가'}</button>
      </div>
    `);

    const hint = () => {
      const place = $('#itPlace').value.trim();
      const region = $('#itRegion').value.trim();
      $('#itHint').innerHTML = $('#itMap').value.trim()
        ? '입력한 링크로 지도를 열어요.'
        : `지도 버튼을 누르면 <b>${esc([place, region].filter(Boolean).join(' ') || '장소 이름')}</b>(으)로 구글지도를 열어요.`;
    };
    hint();
    ['#itPlace', '#itRegion', '#itMap'].forEach((sel) => $(sel).addEventListener('input', hint));

    $('#sheetBody [data-act="save-itinerary"]').addEventListener('click', async () => {
      const place = $('#itPlace').value.trim();
      if (!place) { toast('장소를 적어 주세요.', true); $('#itPlace').focus(); return; }
      const body = {
        day: Number($('#itDay').value),
        time: $('#itTime').value,
        place,
        region: $('#itRegion').value.trim(),
        memo: $('#itMemo').value.trim(),
        mapUrl: $('#itMap').value.trim(),
      };
      try {
        const trip = existing
          ? await api(`/trips/${t.id}/itinerary/${existing.id}`, { method: 'PATCH', body })
          : await api(`/trips/${t.id}/itinerary`, { method: 'POST', body });
        applyTrip(trip);
        closeSheet();
        toast(existing ? '일정을 수정했어요' : '일정을 추가했어요 🗺️');
      } catch (err) { toast(err.message, true); }
    });

    const delBtn = $('#sheetBody [data-act="delete-itinerary"]');
    if (delBtn) delBtn.addEventListener('click', () => {
      openConfirm({
        title: '일정을 삭제할까요?',
        message: `‘${existing.place}’ 일정이 사라져요.`,
        confirmLabel: '삭제',
        onConfirm: async () => {
          const trip = await api(`/trips/${t.id}/itinerary/${existing.id}`, { method: 'DELETE' });
          applyTrip(trip);
          closeSheet();
          toast('일정을 삭제했어요');
        },
      });
    });
  }

  // ── 시트: 확인 ───────────────────────────────────────────
  function openConfirm({ title, message, confirmLabel = '확인', onConfirm }) {
    openSheet(title, `
      <div class="note warn">${message}</div>
      <div class="actions">
        <button class="btn" data-act="close-sheet">취소</button>
        <button class="btn danger" data-act="confirm-yes">${esc(confirmLabel)}</button>
      </div>
    `);
    $('#sheetBody [data-act="confirm-yes"]').addEventListener('click', async () => {
      try { await onConfirm(); } catch (err) { toast(err.message, true); }
    });
  }

  // ── 동기화 ───────────────────────────────────────────────
  let pollTimer = null;
  let pollingStarted = false;
  let syncingOnline = false;
  async function syncNow() {
    if (!state.trip || state.syncing || document.hidden || state.sheetOpen || lock.open) return;
    state.syncing = true;
    if (syncKind !== 'off') setSync('syncing');
    try {
      const data = await api(`/trips/${state.trip.id}/poll?version=${state.version}`);
      if (data && data.unchanged === true) {
        setSync('ok');
        clearOffline();
      } else if (data && data.id) {
        applyTrip(data, { soft: true });
      }
    } catch (err) {
      if (err.status === 404) {
        toast('이 여행이 삭제되었어요.', true);
        const list = (await api('/trips').catch(() => ({ trips: [] }))).trips;
        state.trips = list;
        cacheSaveList(list);
        if (list.length) applyTrip(await api(`/trips/${list[0].id}`));
        else { resetToEmpty(); setTimeout(openNewTripSheet, 320); }
      } else if (err.offline) {
        markOffline();
      } else {
        setSync('off');
      }
    } finally {
      state.syncing = false;
    }
  }

  // 다시 온라인이 되면 목록·현재 여행을 서버 기준으로 맞추고 배지를 지운다.
  async function resyncAfterOnline() {
    if (syncingOnline) return;
    syncingOnline = true;
    try {
      if (!state.trip) {
        if (state.offline) await startApp();
        return;
      }
      const { trips } = await api('/trips');
      state.trips = trips;
      cacheSaveList(trips); // 서버 목록과 폰 저장 목록을 똑같이 맞춘다
    } catch { /* 아직 불안정하면 다음 폴링에서 다시 시도 */ }
    finally {
      syncingOnline = false;
    }
    await syncNow();
  }

  function startPolling() {
    if (pollingStarted) return;
    pollingStarted = true;
    clearInterval(pollTimer);
    pollTimer = setInterval(syncNow, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
    window.addEventListener('focus', () => syncNow());
    window.addEventListener('online', () => { resyncAfterOnline(); });
    window.addEventListener('offline', () => markOffline());
  }

  async function refreshNow() {
    const btn = $('#btnRefresh');
    if (lock.open) return;
    if (!state.trip) { window.location.reload(); return; }
    btn.classList.add('is-spinning');
    try {
      applyTrip(await api(`/trips/${state.trip.id}`));
      toast('최신 상태로 불러왔어요');
    } catch (err) {
      toast(err.message, true);
    } finally {
      setTimeout(() => btn.classList.remove('is-spinning'), 520);
    }
  }

  // ── 이벤트 ───────────────────────────────────────────────
  function bindGlobal() {
    document.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (act && act.dataset.act === 'close-sheet') { closeSheet(); return; }

      const tab = e.target.closest('#tabbar .tab');
      if (tab) {
        if (state.tab !== tab.dataset.tab) {
          state.tab = tab.dataset.tab;
          window.scrollTo({ top: 0 });
          renderView();
        }
        return;
      }

      if (!act) return;
      const { act: a, id } = act.dataset;
      switch (a) {
        case 'add-expense': if (!state.trip) openNewTripSheet(); else openExpenseSheet({}); break;
        case 'go-rate':
          if (state.tab !== 'rate') { state.tab = 'rate'; window.scrollTo({ top: 0 }); renderView(); }
          break;
        case 'add-plan': if (!state.trip) openNewTripSheet(); else openItinerarySheet({ preset: { day: tripTodayDay(state.trip) || 1 } }); break;
        case 'toggle-past':
          state.showPastDays = !state.showPastDays;
          renderView();
          window.scrollTo({ top: 0 });
          break;
        case 'delete-trip': confirmDeleteTrip(); break;
        case 'edit-expense': openExpenseSheet({ expenseId: id }); break;
        case 'edit-itinerary': openItinerarySheet({ itemId: id }); break;
        case 'itn-to-expense': {
          const it = state.trip.itinerary.find((x) => x.id === id);
          if (it) openExpenseSheet({ preset: { title: it.place, date: dayDate(state.trip, it.day), sourceItineraryId: it.id, memo: '' } });
          break;
        }
        case 'edit-participant': openParticipantSheet(id); break;
        case 'bulk-preview': previewBulk(); break;
        case 'bulk-mode': setBulkMode(act.dataset.mode); break;
        case 'bulk-apply': applyBulk(); break;
        case 'new-participant': openParticipantSheet(null); break;
        case 'new-trip': openNewTripSheet(); break;
        case 'switch-trip': {
          api(`/trips/${id}`).then((trip) => {
            state.trip = null;
            applyTrip(trip);
            closeSheet();
            toast('여행을 바꿨어요');
          }).catch((err) => toast(err.message, true));
          break;
        }
        default: break;
      }
    });

    $('#btnTripSwitch').addEventListener('click', openTripSheet);
    $('#btnRefresh').addEventListener('click', refreshNow);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sheetOpen) closeSheet(); });
  }

  // ── 시작 ─────────────────────────────────────────────────
  // PIN 잠금을 통과한 뒤(또는 잠금이 없을 때) 실제 데이터를 불러온다.
  // 인터넷이 끊겨 있으면 폰에 저장해 둔 마지막 내용으로 바로 연다.
  function finishBoot() {
    startPolling();
    if ('serviceWorker' in navigator) {
      // startApp()의 비동기 작업 뒤에는 'load'가 이미 지나갔을 수 있어, 늦지 않게 바로 등록한다.
      const registerSw = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
      if (document.readyState === 'complete') registerSw();
      else window.addEventListener('load', registerSw, { once: true });
    }
  }

  function showOfflineNotice() {
    $('#tripName').textContent = '오프라인 상태예요';
    $('#tripMeta').textContent = '인터넷이 연결되면 다시 불러올게요';
    markOffline();
    $('#view').innerHTML = `<section class="card empty"><div class="emo">📶</div><div class="t">오프라인 상태예요</div><div class="s">인터넷이 연결되면 다시 열어 주세요. 잠금을 한 번 푼 기기라면 저장해 둔 여행을 바로 볼 수 있어요.</div><div style="margin-top:12px"><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`;
  }

  // 폰에 저장해 둔 내용으로 화면을 그린다(오프라인 모드).
  function openFromCache(cached, prefer) {
    const trips = (cached && Array.isArray(cached.trips)) ? cached.trips : [];
    if (!trips.length) { showOfflineNotice(); return false; }
    state.trips = trips;
    state.offlineSavedAt = cached.savedAt || null;
    const want = String(prefer || '');
    let target = trips.find((t) => t.code === want.toUpperCase() || t.id === want) || trips[0] || null;
    if (!target) { showOfflineNotice(); return false; }
    const full = (cached.tripsById || {})[target.id];
    if (!full) { showOfflineNotice(); return false; }
    state.offline = true;
    applyTrip(full, { fromCache: true });
    return true;
  }

  async function startApp() {
    renderTabs();
    let entryCode = null;
    const m = location.pathname.match(/^\/t\/([A-Za-z0-9]+)/);
    if (m) entryCode = m[1].toUpperCase();
    const q = new URLSearchParams(location.search).get('trip');
    if (q) entryCode = q.toUpperCase();
    const last = localStorage.getItem(LS_LAST);

    try {
      state.meta = await api('/meta');
      cacheSaveMeta(state.meta);
    } catch (err) {
      const cached = cacheRead();
      if (err.offline && cached && cached.meta) state.meta = { ...state.meta, ...cached.meta };
    }

    let trips;
    try {
      ({ trips } = await api('/trips'));
      state.trips = trips;
      // 서버 목록과 폰 저장 목록을 똑같이 맞춘다 — 다른 기기에서 지운 여행은 폰에서도 사라진다
      cacheSaveList(trips);
    } catch (err) {
      if (err.status === 401) return; // 잠금 화면이 이미 떠 있음
      const cached = cacheRead();
      if (err.offline && cached && cached.trips.length) openFromCache(cached, entryCode || last);
      else if (err.offline) showOfflineNotice();
      else {
        $('#view').innerHTML = `<section class="card empty"><div class="emo">😢</div><div class="t">불러오지 못했어요</div><div class="s">${esc(err.message)}</div><div style="margin-top:12px"><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`;
        setSync('off');
      }
      finishBoot();
      return;
    }

    let target = null;
    if (entryCode) target = trips.find((t) => t.code === entryCode) || null;
    if (!target) {
      // 코드로 못 찾으면 전체 여행에서 코드 검색
      if (entryCode) {
        for (const s of trips) {
          try {
            const full = await api(`/trips/${s.id}`);
            if (full.code === entryCode) { target = s; break; }
          } catch { /* skip */ }
        }
      }
    }
    if (!target && last) target = trips.find((t) => t.code === last) || null;
    if (!target) target = trips[0] || null;

    if (target) {
      try {
        applyTrip(await api(`/trips/${target.id}`));
      } catch (err) {
        if (err.status === 401) return;
        const cached = cacheRead();
        if (err.offline && cached && (cached.tripsById || {})[target.id]) openFromCache(cached, target.code);
        else if (err.offline) showOfflineNotice();
        else {
          $('#view').innerHTML = `<section class="card empty"><div class="emo">😢</div><div class="t">불러오지 못했어요</div><div class="s">${esc(err.message)}</div><div style="margin-top:12px"><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`;
          setSync('off');
        }
      }
    } else {
      resetToEmpty();
      openNewTripSheet();
    }
    if (entryCode && !target) toast('그 여행 코드를 찾지 못했어요.');

    finishBoot();
  }

  async function boot() {
    bindGlobal();
    bindLock();
    renderTabs();
    paintOffline();
    // 입장 비밀번호가 설정된 서버라면 먼저 잠금 화면을 띄운다(정적 파일만 내려오고 여행 데이터는 401).
    const status = await fetchPinStatus();
    state.pinLocked = Boolean(status && status.locked);
    if (status === undefined) {
      // 오프라인 — 잠금 여부를 물어볼 수 없다.
      // 한 번 잠금을 푼 기기(토큰·저장 내용 있음)면 잠금 화면으로 막지 않고 저장해 둔 내용으로 연다.
      await startApp();
      return;
    }
    if (status && status.locked && !status.unlocked) {
      openLock();
      return;
    }
    await startApp();
  }

  boot();
})();
