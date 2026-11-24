'use strict';
/**
 * 정산 계산 — 참여자 수와 관계없이 동작하는 순수 함수 모음.
 *  · 모든 금액은 기준 통화(KRW) 정수로 환산
 *  · 지출마다 부담액을 참여자별로 나눔(최대 잔여법으로 합계 오차 0)
 *  · 참여자별 차액을 최소 송금 목록으로 정리
 */

const MODES = ['even', 'headcount', 'adults', 'select', 'custom'];

function toBase(amount, currency, rate) {
  const n = Number(amount) || 0;
  if (currency === 'base') return Math.round(n);
  return Math.round(n * (Number(rate) || 0));
}

/** 사람 수(가족은 어른+아이, 개인은 1명) */
function heads(p) {
  if (!p) return 0;
  if (p.type === 'person') return 1;
  return (Number(p.adults) || 0) + (Number(p.kids) || 0);
}

/** 어른 수(개인은 1명) */
function adultsOf(p) {
  if (!p) return 0;
  if (p.type === 'person') return 1;
  return Number(p.adults) || 0;
}

/**
 * 정수 total 을 가중치대로 나눔 — 합계가 정확히 total 이 되도록 최대 잔여법 사용.
 * @returns {Object<string, number>} id → 금액
 */
function distribute(total, entries) {
  const out = {};
  const positive = entries.map((e) => ({ id: e.id, weight: Math.max(0, Number(e.weight) || 0) }));
  const wsum = positive.reduce((s, e) => s + e.weight, 0);
  if (wsum <= 0) {
    for (const e of positive) out[e.id] = 0;
    return out;
  }
  let assigned = 0;
  const rows = positive.map((e) => {
    const exact = (total * e.weight) / wsum;
    const base = Math.floor(exact);
    assigned += base;
    return { id: e.id, base, frac: exact - base, weight: e.weight };
  });
  let rest = total - assigned;
  const order = rows.filter((r) => r.weight > 0).sort((x, y) => y.frac - x.frac || y.weight - x.weight);
  for (let i = 0; i < order.length && rest > 0; i++, rest--) order[i].base += 1;
  for (const r of rows) out[r.id] = r.base;
  return out;
}

/** 지출의 분담 가중치 목록 */
function weightsFor(split, participants) {
  const s = split || { mode: 'even' };
  const ids = new Set(participants.map((p) => p.id));
  switch (s.mode) {
    case 'headcount':
      return participants.map((p) => ({ id: p.id, weight: heads(p) }));
    case 'adults':
      return participants.map((p) => ({ id: p.id, weight: adultsOf(p) }));
    case 'select': {
      const chosen = (s.participantIds || []).filter((id) => ids.has(id));
      const list = chosen.length ? chosen : participants.map((p) => p.id);
      return participants.map((p) => ({ id: p.id, weight: list.includes(p.id) ? 1 : 0 }));
    }
    case 'custom': {
      const amounts = s.amounts || {};
      const weights = participants.map((p) => ({ id: p.id, weight: Math.max(0, Number(amounts[p.id]) || 0) }));
      return weights.some((w) => w.weight > 0) ? weights : participants.map((p) => ({ id: p.id, weight: 1 }));
    }
    case 'even':
    default:
      return participants.map((p) => ({ id: p.id, weight: 1 }));
  }
}

/** 지출 하나의 참여자별 부담액(기준 통화) */
function splitExpense(expense, participants, rate) {
  const krw = toBase(expense.amount, expense.currency, rate);
  return { krw, burden: distribute(krw, weightsFor(expense.split, participants)) };
}

/**
 * 차액(net) 목록 → 최소 송금 목록.
 * 가장 큰 채무자와 가장 큰 채권자를 맞붙이는 방식(그리디)으로 참여자 수 - 1 건 이하.
 */
function minimizeTransfers(rows) {
  const creditors = rows.filter((r) => r.net > 0).map((r) => ({ id: r.id, name: r.name, left: r.net })).sort((a, b) => b.left - a.left);
  const debtors = rows.filter((r) => r.net < 0).map((r) => ({ id: r.id, name: r.name, left: -r.net })).sort((a, b) => b.left - a.left);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const amount = Math.min(creditors[i].left, debtors[j].left);
    const rounded = Math.round(amount);
    if (rounded >= 1) {
      transfers.push({
        from: { id: debtors[j].id, name: debtors[j].name },
        to: { id: creditors[i].id, name: creditors[i].name },
        amount: rounded,
      });
    }
    creditors[i].left -= amount;
    debtors[j].left -= amount;
    if (creditors[i].left < 1) i += 1;
    if (debtors[j].left < 1) j += 1;
  }
  return transfers.sort((a, b) => b.amount - a.amount);
}

/**
 * 여행 전체 정산
 * @param {object} trip
 */
function settleTrip(trip) {
  const rate = Number(trip.exchangeRate) || 0;
  const participants = (trip.participants || []).map((p) => ({ ...p }));
  const acc = new Map(participants.map((p) => [p.id, { paid: 0, burden: 0 }]));
  const byCurrency = new Map();
  let totalKrw = 0;
  const expenses = [];

  for (const e of trip.expenses || []) {
    const { krw, burden } = splitExpense(e, participants, rate);
    totalKrw += krw;
    if (acc.has(e.payerId)) acc.get(e.payerId).paid += krw;
    for (const p of participants) acc.get(p.id).burden += Math.round(burden[p.id] || 0);
    const key = e.currency === 'base' ? trip.baseCurrency : trip.localCurrency;
    byCurrency.set(key, (byCurrency.get(key) || 0) + (Number(e.amount) || 0));
    expenses.push({ ...e, krw, burden });
  }

  const rows = participants.map((p) => {
    const t = acc.get(p.id) || { paid: 0, burden: 0 };
    const people = heads(p);
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      adults: p.type === 'person' ? 1 : Number(p.adults) || 0,
      kids: p.type === 'person' ? 0 : Number(p.kids) || 0,
      people,
      paid: t.paid,
      burden: t.burden,
      net: t.paid - t.burden,
      perPerson: people > 0 ? Math.round(t.burden / people) : t.burden,
    };
  });

  const transfers = minimizeTransfers(rows);

  return {
    rate,
    baseCurrency: trip.baseCurrency,
    localCurrency: trip.localCurrency,
    totalKrw,
    totalLocal: rate > 0 ? totalKrw / rate : 0,
    byCurrency: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
    participants: rows,
    // 예전 이름 호환(2인 정산 화면에서 쓰던 필드)
    transfer: transfers[0] || null,
    transfers,
    expenses,
  };
}

module.exports = { MODES, toBase, heads, adultsOf, distribute, weightsFor, splitExpense, minimizeTransfers, settleTrip };
