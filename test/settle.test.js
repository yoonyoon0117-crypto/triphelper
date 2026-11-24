'use strict';
/**
 * 정산 계산 단위 테스트
 *   node --test test/settle.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { distribute, splitExpense, minimizeTransfers, settleTrip } = require('../lib/settle');

const families = {
  participants: [
    { id: 'a', name: 'A가족', type: 'group', adults: 2, kids: 2 },
    { id: 'b', name: 'B가족', type: 'group', adults: 2, kids: 1 },
  ],
};
const friends = {
  participants: Array.from({ length: 5 }, (_, i) => ({ id: `f${i + 1}`, name: `친구 ${i + 1}`, type: 'person', adults: 1, kids: 0 })),
};

const baseTrip = (over) => ({
  baseCurrency: 'KRW',
  localCurrency: 'EUR',
  exchangeRate: 1500,
  participants: families.participants,
  expenses: [],
  itinerary: [],
  ...over,
});

const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);

test('distribute: 정수 합계가 정확히 유지된다 (최대 잔여법)', () => {
  const out = distribute(1000, [{ id: 'a', weight: 1 }, { id: 'b', weight: 1 }, { id: 'c', weight: 1 }]);
  assert.equal(sum(out), 1000);
  assert.deepEqual(Object.values(out).sort(), [333, 333, 334]);

  const out2 = distribute(270000, [{ id: 'a', weight: 4 }, { id: 'b', weight: 3 }]);
  assert.equal(out2.a + out2.b, 270000);
  assert.equal(out2.a, 154286);
  assert.equal(out2.b, 115714);
});

test('distribute: 가중치 합이 0이면 전부 0', () => {
  const out = distribute(500, [{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }]);
  assert.deepEqual(out, { a: 0, b: 0 });
});

test('현지 통화 환산: EUR 180 × 1500 = 270,000원', () => {
  const out = splitExpense({ amount: 180, currency: 'local', split: { mode: 'even' } }, families.participants, 1500);
  assert.equal(out.krw, 270000);
  assert.deepEqual(out.burden, { a: 135000, b: 135000 });
});

test('원화 지출은 환율을 곱하지 않는다', () => {
  const out = splitExpense({ amount: 45000, currency: 'base', split: { mode: 'even' } }, families.participants, 1500);
  assert.equal(out.krw, 45000);
  assert.deepEqual(out.burden, { a: 22500, b: 22500 });
});

test('가족 반반(1:1) — 인원이 달라도 절반씩', () => {
  const out = splitExpense({ amount: 100000, currency: 'base', split: { mode: 'even' } }, families.participants, 1500);
  assert.deepEqual(out.burden, { a: 50000, b: 50000 });
});

test('전체 인원 비례(어른+아이) — 4명 : 3명', () => {
  const out = splitExpense({ amount: 270000, currency: 'base', split: { mode: 'headcount' } }, families.participants, 1500);
  assert.deepEqual(out.burden, { a: 154286, b: 115714 });
  assert.equal(sum(out.burden), 270000);
});

test('어른 인원 비례 — 어른 2 : 2 는 반반', () => {
  const out = splitExpense({ amount: 90000, currency: 'base', split: { mode: 'adults' } }, families.participants, 1500);
  assert.deepEqual(out.burden, { a: 45000, b: 45000 });
});

test('어른이 한쪽에만 있으면 어른 비례는 전액 부담', () => {
  const p = [
    { id: 'a', name: '어른팀', type: 'group', adults: 2, kids: 0 },
    { id: 'b', name: '아이팀', type: 'group', adults: 0, kids: 2 },
  ];
  const out = splitExpense({ amount: 30000, currency: 'base', split: { mode: 'adults' } }, p, 1500);
  assert.deepEqual(out.burden, { a: 30000, b: 0 });
});

test('특정 멤버만 부담(체크) — 고른 3명이 1/3씩', () => {
  const out = splitExpense(
    { amount: 90000, currency: 'base', split: { mode: 'select', participantIds: ['f1', 'f2', 'f3'] } },
    friends.participants,
    1500
  );
  assert.deepEqual(out.burden, { f1: 30000, f2: 30000, f3: 30000, f4: 0, f5: 0 });
});

test('직접 금액 입력 — 입력 비율대로, 합계가 다르면 비율로 맞춘다', () => {
  const exact = splitExpense(
    { amount: 120000, currency: 'base', split: { mode: 'custom', amounts: { a: 80000, b: 40000 } } },
    families.participants,
    1500
  );
  assert.deepEqual(exact.burden, { a: 80000, b: 40000 });

  const scaled = splitExpense(
    { amount: 120000, currency: 'base', split: { mode: 'custom', amounts: { a: 2, b: 1 } } },
    families.participants,
    1500
  );
  assert.deepEqual(scaled.burden, { a: 80000, b: 40000 });
  assert.equal(sum(scaled.burden), 120000);
});

test('참여자 수 변경 시 인원 비례 부담이 즉시 바뀐다', () => {
  const expenses = [{ id: 'e1', title: '숙소', amount: 300000, currency: 'base', payerId: 'a', date: '2026-12-19', split: { mode: 'headcount' } }];
  const before = settleTrip(baseTrip({ expenses }));
  assert.equal(before.participants.find((p) => p.id === 'a').burden, Math.round((300000 * 4) / 7));

  const changed = baseTrip({
    participants: [
      { id: 'a', name: 'A가족', type: 'group', adults: 2, kids: 0 },
      { id: 'b', name: 'B가족', type: 'group', adults: 2, kids: 1 },
    ],
    expenses,
  });
  const after = settleTrip(changed);
  const a = after.participants.find((p) => p.id === 'a');
  const b = after.participants.find((p) => p.id === 'b');
  assert.equal(a.burden + b.burden, 300000);
  assert.notEqual(a.burden, before.participants.find((p) => p.id === 'a').burden);
  assert.equal(a.burden, Math.round((300000 * 2) / 5));
});

test('두 가족: 차액만큼 한 번 송금', () => {
  const trip = baseTrip({
    expenses: [
      { id: 'e1', title: '숙소', amount: 180, currency: 'local', payerId: 'a', date: '2026-12-19', split: { mode: 'even' } },
      { id: 'e2', title: '택시', amount: 45000, currency: 'base', payerId: 'b', date: '2026-12-19', split: { mode: 'headcount' } },
    ],
  });
  const s = settleTrip(trip);
  // 총 315,000원. A 부담 135,000 + 25,714 = 160,714 / B 부담 135,000 + 19,286 = 154,286
  assert.equal(s.totalKrw, 315000);
  assert.equal(s.participants.find((p) => p.id === 'a').paid, 270000);
  assert.equal(s.transfers.length, 1);
  const t = s.transfers[0];
  assert.equal(t.from.id, 'b');
  assert.equal(t.to.id, 'a');
  assert.equal(t.amount, s.participants.find((p) => p.id === 'a').net);
});

test('친구 5명: 5명 균등 + 3명만 부담 → 최소 송금 목록', () => {
  const trip = {
    baseCurrency: 'KRW',
    localCurrency: 'KRW',
    exchangeRate: 1,
    participants: friends.participants,
    itinerary: [],
    expenses: [
      { id: 'e1', title: '숙소', amount: 300000, currency: 'base', payerId: 'f1', date: '2026-12-01', split: { mode: 'even' } },
      { id: 'e2', title: '택시', amount: 90000, currency: 'base', payerId: 'f2', date: '2026-12-01', split: { mode: 'select', participantIds: ['f1', 'f2', 'f3'] } },
    ],
  };
  const s = settleTrip(trip);
  assert.equal(s.totalKrw, 390000);
  assert.equal(s.transfers.length, 3);
  assert.ok(s.transfers.length <= friends.participants.length - 1);

  const netById = Object.fromEntries(s.participants.map((p) => [p.id, p.net]));
  assert.equal(netById.f1, 210000);
  assert.equal(netById.f2, 0);
  assert.equal(netById.f3, -90000);
  assert.equal(netById.f4, -60000);
  assert.equal(netById.f5, -60000);
  assert.equal(s.transfers.reduce((a, t) => a + t.amount, 0), 210000);
  assert.ok(s.transfers.every((t) => t.from.id !== 'f1'));
  assert.ok(s.transfers.every((t) => t.to.id === 'f1'));
});

test('최소 송금: 어떤 조합이든 참여자 수 - 1건 이하이고 모두 0으로 정리된다', () => {
  const rows = [
    { id: 'a', name: 'A', net: 123456 },
    { id: 'b', name: 'B', net: -23456 },
    { id: 'c', name: 'C', net: -50000 },
    { id: 'd', name: 'D', net: -50000 },
  ];
  const transfers = minimizeTransfers(rows);
  assert.ok(transfers.length <= rows.length - 1);
  const balance = Object.fromEntries(rows.map((r) => [r.id, r.net]));
  for (const t of transfers) {
    balance[t.from.id] += t.amount;
    balance[t.to.id] -= t.amount;
  }
  for (const v of Object.values(balance)) assert.ok(Math.abs(v) < 1, `잔액이 남음: ${v}`);
});

test('지출이 없으면 송금 없음', () => {
  const s = settleTrip(baseTrip());
  assert.equal(s.totalKrw, 0);
  assert.deepEqual(s.transfers, []);
  assert.equal(s.participants.length, 2);
});

test('혼합 통화 합계와 통화별 합계', () => {
  const trip = baseTrip({
    expenses: [
      { id: 'e1', title: '숙소', amount: 200, currency: 'local', payerId: 'a', date: '2026-12-19', split: { mode: 'even' } },
      { id: 'e2', title: '기념품', amount: 30000, currency: 'base', payerId: 'b', date: '2026-12-20', split: { mode: 'even' } },
    ],
  });
  const s = settleTrip(trip);
  assert.equal(s.totalKrw, 330000);
  assert.deepEqual(
    s.byCurrency.sort((x, y) => x.currency.localeCompare(y.currency)),
    [{ currency: 'EUR', amount: 200 }, { currency: 'KRW', amount: 30000 }]
  );
  assert.equal(s.participants.reduce((a, p) => a + p.burden, 0), 330000);
});

test('여러 지출에서도 부담 합계 = 총 지출 (반올림 누적 없음)', () => {
  const expenses = Array.from({ length: 37 }, (_, i) => ({
    id: `e${i}`,
    title: `지출 ${i}`,
    amount: 1234 + i * 37,
    currency: 'base',
    payerId: i % 2 ? 'a' : 'b',
    date: '2026-12-19',
    split: { mode: i % 3 === 0 ? 'headcount' : i % 3 === 1 ? 'adults' : 'even' },
  }));
  const s = settleTrip(baseTrip({ expenses }));
  const total = s.participants.reduce((a, p) => a + p.burden, 0);
  assert.equal(total, s.totalKrw);
  assert.equal(s.participants.reduce((a, p) => a + p.net, 0), 0);
});
