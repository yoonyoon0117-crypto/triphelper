/* Trip helper✈️ — 프론트엔드 (빌드 없이 도는 바닐라 JS) */
(() => {
  'use strict';

  const API = '/api';
  const LS_LAST = 'trip-helper:last';
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
    tab: 'settle',
    version: 0,
    sheetOpen: false,
    syncing: false,
    lastSync: null,
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
  const todayIso = () => isoOf(new Date());
  const dayCount = (trip) => {
    if (!trip || !trip.startDate || !trip.endDate) return 1;
    const diff = Math.round((parseD(trip.endDate) - parseD(trip.startDate)) / 86400000) + 1;
    return Math.max(1, Math.min(60, diff));
  };
  const dayDate = (trip, day) => addDays(trip.startDate, Math.max(0, day - 1));
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
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || '요청을 처리하지 못했어요.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
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

  function applyTrip(trip, { soft = false } = {}) {
    const sameTrip = state.trip && state.trip.id === trip.id;
    state.trip = trip;
    state.version = trip.version;
    state.lastSync = new Date();
    localStorage.setItem(LS_LAST, trip.code);
    renderHeader();
    if (!sameTrip) state.tab = 'settle';
    renderTabs();
    // 설정 탭에서 입력하는 중이면 자동 동기화가 화면(입력값)을 갈아엎지 않게 한다
    const focused = document.activeElement;
    const typing = focused && focused.closest && focused.closest('#view') && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName);
    if (!(soft && state.tab === 'settings' && typing)) renderView();
    if (!soft && !sameTrip) window.scrollTo({ top: 0 });
    const url = `/t/${trip.code}`;
    if (location.pathname !== url) history.replaceState({}, '', url);
    setSync('ok');
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
          <span class="summary-item"><svg viewBox="0 0 24 24"><path d="M4 7h13l3 5-3 5H4z"/><path d="M8 11v3M12 11v3"/></svg>1 ${esc(t.localCurrency)} = ${nf(t.exchangeRate, 2)}원</span>`}
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
    const days = Math.max(dayCount(t), ...items.map((i) => i.day));
    const byDay = new Map();
    for (const it of items) {
      if (!byDay.has(it.day)) byDay.set(it.day, []);
      byDay.get(it.day).push(it);
    }
    const blocks = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, list]) => `
      <div class="day-block fade-in">
        <div class="day-banner">
          <span class="day-badge">Day ${day}</span>
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
      </div>`).join('');
    return `<div class="section-title"><h3>일정</h3><span class="hint">${items.length}개 · ${byDay.size}일</span></div>` + addBtn + blocks;
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
            <button class="btn primary" data-act="save-settings">여행 정보 저장</button>
          </div>
        </section>
      </div>

      <div class="settings-block">
        <div class="section-title"><h3>참여자</h3><span class="hint">${t.participants.length}팀 · ${totalHeads()}명</span></div>
        <section class="card list">${rows}</section>
        <button class="btn soft" data-act="new-participant">＋ 참여자 추가</button>
      </div>

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
    const cur = $('#stCur');
    if (cur) cur.addEventListener('change', () => {
      const label = $('#stRateLabel');
      if (label) label.textContent = `환율 (1 ${cur.value} = ?원)`;
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
        const list = (await api('/trips')).trips;
        state.trips = list;
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
  async function syncNow() {
    if (!state.trip || state.syncing || document.hidden || state.sheetOpen) return;
    state.syncing = true;
    setSync('syncing');
    try {
      const data = await api(`/trips/${state.trip.id}/poll?version=${state.version}`);
      if (data && data.unchanged === true) {
        setSync('ok');
      } else if (data && data.id) {
        applyTrip(data, { soft: true });
      }
    } catch (err) {
      if (err.status === 404) {
        toast('이 여행이 삭제되었어요.', true);
        const list = (await api('/trips').catch(() => ({ trips: [] }))).trips;
        state.trips = list;
        if (list.length) applyTrip(await api(`/trips/${list[0].id}`));
        else { resetToEmpty(); setTimeout(openNewTripSheet, 320); }
      } else {
        setSync('off');
      }
    } finally {
      state.syncing = false;
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(syncNow, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
    window.addEventListener('focus', () => syncNow());
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => setSync('off'));
  }

  async function refreshNow() {
    const btn = $('#btnRefresh');
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
        case 'add-plan': if (!state.trip) openNewTripSheet(); else openItinerarySheet({ preset: { day: 1 } }); break;
        case 'delete-trip': confirmDeleteTrip(); break;
        case 'edit-expense': openExpenseSheet({ expenseId: id }); break;
        case 'edit-itinerary': openItinerarySheet({ itemId: id }); break;
        case 'itn-to-expense': {
          const it = state.trip.itinerary.find((x) => x.id === id);
          if (it) openExpenseSheet({ preset: { title: it.place, date: dayDate(state.trip, it.day), sourceItineraryId: it.id, memo: '' } });
          break;
        }
        case 'edit-participant': openParticipantSheet(id); break;
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
  async function boot() {
    bindGlobal();
    renderTabs();
    let entryCode = null;
    const m = location.pathname.match(/^\/t\/([A-Za-z0-9]+)/);
    if (m) entryCode = m[1].toUpperCase();
    const q = new URLSearchParams(location.search).get('trip');
    if (q) entryCode = q.toUpperCase();
    const last = localStorage.getItem(LS_LAST);

    try {
      state.meta = await api('/meta');
    } catch { /* 기본값 유지 */ }

    try {
      const { trips } = await api('/trips');
      state.trips = trips;
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
        applyTrip(await api(`/trips/${target.id}`));
      } else {
        resetToEmpty();
        openNewTripSheet();
      }
      if (entryCode && !target) toast('그 여행 코드를 찾지 못했어요.');
    } catch (err) {
      $('#view').innerHTML = `<section class="card empty"><div class="emo">😢</div><div class="t">불러오지 못했어요</div><div class="s">${esc(err.message)}</div><div style="margin-top:12px"><button class="btn primary" onclick="location.reload()">다시 시도</button></div></section>`;
      setSync('off');
    }

    startPolling();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
      });
    }
  }

  boot();
})();
