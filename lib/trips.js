'use strict';
/**
 * 여행 데이터 모델 — 참여자(가족/개인) 목록, 지출, 일정과 검증.
 * 참여자는 2명 이상이면 몇 명이든 되고, 이름·인원을 언제든 바꿀 수 있습니다.
 */
const crypto = require('node:crypto');
const { MODES, settleTrip } = require('./settle');

const CURRENCIES = ['EUR', 'USD', 'JPY', 'GBP', 'CHF', 'THB', 'VND', 'TWD', 'SGD', 'AUD', 'CAD', 'CNY', 'HKD', 'PHP', 'TRY', 'AED'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PARTICIPANTS = 30;

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = details && details.code;
  }
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.replace(/,/g, ''));
  return NaN;
};

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
}

function newCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

function uniqueCode(trips) {
  const used = new Set((trips || []).map((t) => t.code));
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    if (!used.has(c)) return c;
  }
  return `T${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

function isoDate(v, field, { required = true } = {}) {
  const s = str(v);
  if (!s) {
    if (required) throw new HttpError(400, `${field} 날짜가 필요합니다.`);
    return '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new HttpError(400, `${field} 날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${field} 날짜가 올바르지 않습니다.`);
  return s;
}

function count(v, field, def) {
  if (v == null || v === '') return def;
  const n = num(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field}는 숫자로 넣어 주세요.`);
  const i = Math.round(n);
  if (i < 0 || i > 20) throw new HttpError(400, `${field}는 0~20 사이로 넣어 주세요.`);
  return i;
}

/** 참여자(가족/개인) 입력 검증 */
function participantInput(raw, existing) {
  const body = raw || {};
  const base = existing || { id: newId('ptc'), type: 'group', name: '', adults: 2, kids: 0 };
  const type = (body.type || base.type) === 'person' ? 'person' : 'group';
  const name = str(body.name != null ? body.name : base.name);
  if (!name) throw new HttpError(400, '참여자 이름을 적어 주세요.');
  if (name.length > 20) throw new HttpError(400, '참여자 이름은 20자 이내로 적어 주세요.');

  if (type === 'person') {
    return { id: base.id, name, type, adults: 1, kids: 0 };
  }
  const adults = count(body.adults != null ? body.adults : base.adults, '어른 수', 2);
  const kids = count(body.kids != null ? body.kids : base.kids, '아이 수', 0);
  if (adults + kids < 1) throw new HttpError(400, '가족 인원은 어른+아이가 1명 이상이어야 해요.');
  return { id: base.id, name, type, adults, kids };
}

function defaultParticipants(template, friendCount) {
  if (template === 'friends') {
    const n = Math.min(MAX_PARTICIPANTS, Math.max(2, Math.round(Number(friendCount) || 5)));
    return Array.from({ length: n }, (_, i) => ({
      id: newId('ptc'),
      name: `친구 ${i + 1}`,
      type: 'person',
      adults: 1,
      kids: 0,
    }));
  }
  if (template === 'solo') {
    return [
      { id: newId('ptc'), name: '나', type: 'person', adults: 1, kids: 0 },
      { id: newId('ptc'), name: '동행', type: 'person', adults: 1, kids: 0 },
    ];
  }
  return [
    { id: newId('ptc'), name: 'A가족', type: 'group', adults: 2, kids: 2 },
    { id: newId('ptc'), name: 'B가족', type: 'group', adults: 2, kids: 1 },
  ];
}

function normalizeSplit(raw, participants) {
  const body = raw || {};
  const mode = MODES.includes(body.mode) ? body.mode : 'even';
  const ids = new Set(participants.map((p) => p.id));
  const split = { mode };

  if (mode === 'select') {
    const picked = Array.isArray(body.participantIds)
      ? body.participantIds.filter((id) => ids.has(id))
      : [];
    if (!picked.length) throw new HttpError(400, '함께 부담할 참여자를 한 명 이상 골라 주세요.');
    split.participantIds = [...new Set(picked)];
  }

  if (mode === 'custom') {
    const amounts = body.amounts && typeof body.amounts === 'object' ? body.amounts : null;
    if (!amounts) throw new HttpError(400, '참여자별 금액을 넣어 주세요.');
    const clean = {};
    let sum = 0;
    for (const id of ids) {
      const v = num(amounts[id]);
      if (Number.isFinite(v) && v > 0) {
        clean[id] = Math.round(v);
        sum += v;
      }
    }
    if (sum <= 0) throw new HttpError(400, '참여자별 금액을 0보다 크게 넣어 주세요.');
    split.amounts = clean;
  }

  return split;
}

function expenseInput(raw, existing, participants) {
  const base = existing || {};
  const b = raw || {};
  const title = str(b.title != null ? b.title : base.title);
  if (!title) throw new HttpError(400, '지출 항목 이름을 적어 주세요.');
  if (title.length > 60) throw new HttpError(400, '항목 이름은 60자 이내로 적어 주세요.');

  const amount = num(b.amount != null ? b.amount : base.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '금액은 0보다 큰 숫자로 넣어 주세요.');
  if (amount > 1e9) throw new HttpError(400, '금액이 너무 큽니다.');

  const currency = (b.currency || base.currency) === 'base' ? 'base' : 'local';
  const ids = new Set(participants.map((p) => p.id));
  const payerId = (b.payerId != null ? b.payerId : base.payerId);
  if (!ids.has(payerId)) throw new HttpError(400, '결제한 참여자를 골라 주세요.');

  const date = isoDate(b.date != null ? b.date : base.date, '지출');
  const memo = str(b.memo != null ? b.memo : base.memo).slice(0, 300);
  const split = normalizeSplit(b.split || base.split || { mode: 'even' }, participants);
  const sourceItineraryId = b.sourceItineraryId != null ? str(b.sourceItineraryId) : base.sourceItineraryId || null;

  return { title, amount: Math.round(amount * 100) / 100, currency, payerId, date, memo, split, sourceItineraryId };
}

function itineraryInput(raw, existing) {
  const base = existing || {};
  const b = raw || {};
  const place = str(b.place != null ? b.place : base.place);
  if (!place) throw new HttpError(400, '장소 이름을 적어 주세요.');
  if (place.length > 80) throw new HttpError(400, '장소 이름은 80자 이내로 적어 주세요.');

  const dayRaw = num(b.day != null ? b.day : base.day);
  const day = Number.isFinite(dayRaw) ? Math.round(dayRaw) : 1;
  if (day < 1 || day > 60) throw new HttpError(400, '일차는 1~60 사이로 넣어 주세요.');

  const time = str(b.time != null ? b.time : base.time);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, '시간은 24시간 형식(HH:MM)으로 넣어 주세요.');
  const region = str(b.region != null ? b.region : base.region).slice(0, 30);
  const memo = str(b.memo != null ? b.memo : base.memo).slice(0, 500);
  const mapUrl = str(b.mapUrl != null ? b.mapUrl : base.mapUrl);
  if (mapUrl && !/^https?:\/\//i.test(mapUrl)) throw new HttpError(400, '지도 링크는 http(s) 주소로 넣어 주세요.');
  if (mapUrl.length > 500) throw new HttpError(400, '지도 링크가 너무 깁니다.');

  return { day, time, place, region, memo, mapUrl };
}

function tripPatch(trip, raw) {
  const b = raw || {};
  const patch = {};
  if (b.name != null) {
    const name = str(b.name);
    if (!name) throw new HttpError(400, '여행 이름을 적어 주세요.');
    if (name.length > 60) throw new HttpError(400, '여행 이름은 60자 이내로 적어 주세요.');
    patch.name = name;
  }
  if (b.subtitle != null) patch.subtitle = str(b.subtitle).slice(0, 120);
  if (b.startDate != null) patch.startDate = isoDate(b.startDate, '시작');
  if (b.endDate != null) patch.endDate = isoDate(b.endDate, '종료');
  if (b.localCurrency != null) {
    const c = str(b.localCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) throw new HttpError(400, '현지 통화는 3글자 코드로 넣어 주세요. (예: EUR)');
    patch.localCurrency = c;
  }
  if (b.exchangeRate != null) {
    const r = num(b.exchangeRate);
    if (!Number.isFinite(r) || r <= 0 || r > 1e6) throw new HttpError(400, '환율은 0보다 큰 숫자로 넣어 주세요.');
    patch.exchangeRate = Math.round(r * 1000) / 1000;
  }
  const merged = { ...trip, ...patch };
  if (merged.startDate && merged.endDate && merged.endDate < merged.startDate) {
    throw new HttpError(400, '종료일이 시작일보다 빠를 수 없습니다.');
  }
  return patch;
}

function createTrip(raw, trips, now) {
  const b = raw || {};
  const name = str(b.name) || '새 여행';
  if (name.length > 60) throw new HttpError(400, '여행 이름은 60자 이내로 적어 주세요.');
  const today = new Date(now || Date.now()).toISOString().slice(0, 10);
  const startDate = isoDate(b.startDate || today, '시작');
  const endDate = isoDate(b.endDate || startDate, '종료');
  if (endDate < startDate) throw new HttpError(400, '종료일이 시작일보다 빠를 수 없습니다.');

  const localCurrency = str(b.localCurrency).toUpperCase() || 'EUR';
  if (!/^[A-Z]{3}$/.test(localCurrency)) throw new HttpError(400, '현지 통화는 3글자 코드로 넣어 주세요.');

  const rate = num(b.exchangeRate);
  const exchangeRate = Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1000) / 1000 : 1500;

  let participants;
  if (Array.isArray(b.participants) && b.participants.length >= 2) {
    participants = b.participants
      .slice(0, MAX_PARTICIPANTS)
      .map((p) => participantInput(p, { id: newId('ptc'), type: 'group', name: '', adults: 2, kids: 0 }));
  } else {
    participants = defaultParticipants(b.template, b.friendCount);
  }
  if (participants.length < 2) throw new HttpError(400, '참여자는 2명 이상이어야 해요.');

  const ts = new Date(now || Date.now()).toISOString();
  return {
    id: newId('trp'),
    code: uniqueCode(trips || []),
    name,
    subtitle: str(b.subtitle).slice(0, 120),
    startDate,
    endDate,
    baseCurrency: 'KRW',
    localCurrency,
    exchangeRate,
    participants,
    expenses: [],
    itinerary: [],
    version: 1,
    createdAt: ts,
    updatedAt: ts,
  };
}

function stamp(trip) {
  trip.version = (trip.version || 0) + 1;
  trip.updatedAt = new Date().toISOString();
}

const MODE_LABELS = {
  even: '똑같이 나누기',
  headcount: '전체 인원 비례',
  adults: '어른 인원 비례',
  select: '선택한 사람끼리',
  custom: '직접 금액 입력',
};

function toClient(trip) {
  const settlement = settleTrip(trip);
  return {
    ...trip,
    settlement: {
      rate: settlement.rate,
      totalKrw: settlement.totalKrw,
      totalLocal: settlement.totalLocal,
      byCurrency: settlement.byCurrency,
      participants: settlement.participants,
      transfers: settlement.transfers,
    },
    expenses: settlement.expenses
      .slice()
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : String(y.createdAt || '').localeCompare(String(x.createdAt || '')))),
    itinerary: (trip.itinerary || [])
      .slice()
      .sort((x, y) => x.day - y.day || String(x.time || '99:99').localeCompare(String(y.time || '99:99'))),
  };
}

function summary(trip) {
  return {
    id: trip.id,
    code: trip.code,
    name: trip.name,
    subtitle: trip.subtitle,
    startDate: trip.startDate,
    endDate: trip.endDate,
    localCurrency: trip.localCurrency,
    exchangeRate: trip.exchangeRate,
    participantCount: (trip.participants || []).length,
    participantNames: (trip.participants || []).map((p) => p.name),
    peopleCount: (trip.participants || []).reduce((n, p) => n + (p.type === 'person' ? 1 : (Number(p.adults) || 0) + (Number(p.kids) || 0)), 0),
    kind: (trip.participants || []).length && trip.participants.every((p) => p.type === 'person') ? 'people' : 'teams',
    expenseCount: (trip.expenses || []).length,
    itineraryCount: (trip.itinerary || []).length,
    version: trip.version,
    updatedAt: trip.updatedAt,
  };
}

function seedTrip(now) {
  const trip = createTrip(
    {
      name: '🇪🇸 스페인 마드리드 · 바르셀로나',
      subtitle: '두 가족 첫 유럽 여행',
      startDate: '2026-12-19',
      endDate: '2026-12-26',
      localCurrency: 'EUR',
      exchangeRate: 1500,
      template: 'twoFamilies',
    },
    [],
    now
  );
  const ts = new Date(now || Date.now()).toISOString();
  const [pa, pb] = trip.participants;
  trip.expenses = [
    {
      id: newId('exp'),
      title: '숙소 1박 (첫날)',
      amount: 180,
      currency: 'local',
      payerId: pa.id,
      date: '2026-12-19',
      memo: '예시 지출 — 지우고 쓰셔도 돼요',
      split: { mode: 'even' },
      sourceItineraryId: null,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: newId('exp'),
      title: '공항에서 시내까지 택시',
      amount: 45000,
      currency: 'base',
      payerId: pb.id,
      date: '2026-12-19',
      memo: '예시 지출 — 인원 비례로 나눠요',
      split: { mode: 'headcount' },
      sourceItineraryId: null,
      createdAt: ts,
      updatedAt: ts,
    },
  ];
  trip.itinerary = [
    {
      id: newId('itn'),
      day: 1,
      time: '14:00',
      place: '마드리드 바라하스 공항',
      region: '마드리드',
      memo: '예시 일정 — 입국 후 렌터카 픽업, 숙소 체크인 15:00',
      mapUrl: '',
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: newId('itn'),
      day: 2,
      time: '10:00',
      place: '프라도 미술관',
      region: '마드리드',
      memo: '예시 일정 — 오전 입장, 아이들은 무료',
      mapUrl: '',
      createdAt: ts,
      updatedAt: ts,
    },
  ];
  return trip;
}

module.exports = {
  CURRENCIES,
  HttpError,
  MODE_LABELS,
  MAX_PARTICIPANTS,
  newId,
  uniqueCode,
  createTrip,
  tripPatch,
  expenseInput,
  itineraryInput,
  participantInput,
  defaultParticipants,
  normalizeSplit,
  toClient,
  summary,
  seedTrip,
  stamp,
  isoDate,
  count,
};
