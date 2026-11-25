'use strict';
/**
 * API 통합 테스트 — 실제 서버를 임시 데이터 폴더로 띄워 검사합니다.
 *   node --test test/api.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonStore } = require('../lib/store');
const { createApp } = require('../server');
const { seedTrip } = require('../lib/trips');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-helper-test-'));
const store = new JsonStore(path.join(dir, 'data'));
let server;
let base;

test.before(async () => {
  await store.load();
  await store.write((state) => { state.trips.push(seedTrip()); });
  const app = createApp(store);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
});

async function call(pathname, { method = 'GET', body } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

async function newTrip(body) {
  const { status, data } = await call('/api/trips', { method: 'POST', body });
  assert.equal(status, 201);
  return data;
}

test('health / meta', async () => {
  const h = await call('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  const m = await call('/api/meta');
  assert.ok(m.data.currencies.includes('EUR'));
  assert.deepEqual(m.data.splitModes.map((x) => x.id), ['even', 'headcount', 'adults', 'select', 'custom']);
});

test('기본 시드: 스페인 여행 · 두 가족이 준비되어 있다', async () => {
  const { data } = await call('/api/trips');
  assert.ok(data.trips.length >= 1);
  const seeded = data.trips.find((t) => t.name.includes('스페인'));
  assert.ok(seeded, '기본 여행이 있어야 한다');
  assert.deepEqual(seeded.participantNames, ['A가족', 'B가족']);
  assert.equal(seeded.localCurrency, 'EUR');
  assert.equal(seeded.exchangeRate, 1500);

  const full = await call(`/api/trips/${seeded.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.data.participants.length, 2);
  assert.equal(full.data.participants[0].type, 'group');
  assert.equal(full.data.itinerary.length, 2);
  assert.deepEqual(full.data.expenses, [], '기본 시드에는 예시 지출이 없다');
  assert.equal(full.data.settlement.totalKrw, 0);
  assert.equal(full.data.settlement.transfers.length, 0, '지출이 없으면 송금도 없다');

  // 지출을 직접 넣으면 두 가족 정산이 계산된다
  const [a] = full.data.participants;
  const added = await call(`/api/trips/${seeded.id}/expenses`, {
    method: 'POST',
    body: { title: '숙소', amount: 180, currency: 'local', payerId: a.id, date: '2026-12-19', split: { mode: 'even' } },
  });
  assert.equal(added.status, 201);
  assert.equal(added.data.settlement.totalKrw, 270000);
  assert.equal(added.data.settlement.transfers.length, 1, '지출을 넣으면 두 가족 정산이 계산된다');
  const removed = await call(`/api/trips/${seeded.id}/expenses/${added.data.expenses[0].id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.expenses.length, 0, '검증 후 시드는 지출 0건으로 되돌린다');
});

test('공유 코드로 여행 조회 + /t/:code 페이지', async () => {
  const { data } = await call('/api/trips');
  const t = data.trips[0];
  const byCode = await call(`/api/trips/${t.code}`);
  assert.equal(byCode.status, 200);
  assert.equal(byCode.data.id, t.id);

  const page = await fetch(`${base}/t/${t.code}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Trip helper/);
  assert.match(html, /apple-mobile-web-app-title/);
});

test('manifest 와 sw.js, 아이콘 제공', async () => {
  const man = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(man.status, 200);
  const json = await man.json();
  assert.equal(json.name, 'Trip helper✈️');
  assert.equal(json.short_name, 'Trip helper✈️');

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);

  for (const icon of ['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
    const r = await fetch(base + icon);
    assert.equal(r.status, 200, icon);
    assert.equal(r.headers.get('content-type'), 'image/png');
  }
});

test('친구 5명 여행 만들기 → 참여자 5명', async () => {
  const trip = await newTrip({
    name: '🇯🇵 오사카 친구 여행',
    subtitle: '우정 여행',
    startDate: '2027-01-10',
    endDate: '2027-01-13',
    localCurrency: 'JPY',
    exchangeRate: 9.2,
    template: 'friends',
    friendCount: 5,
  });
  assert.equal(trip.participants.length, 5);
  assert.deepEqual(trip.participants.map((p) => p.type), ['person', 'person', 'person', 'person', 'person']);
  assert.equal(trip.participants[0].name, '친구 1');
  assert.match(trip.code, /^[A-Z0-9]{5,6}$/);
  assert.deepEqual(trip.expenses, []);
});

test('지출 추가: 현지 통화 환산 + 균등 분담', async () => {
  const trip = await newTrip({
    name: '테스트 여행 A', startDate: '2027-02-01', endDate: '2027-02-03', localCurrency: 'EUR', exchangeRate: 1500, template: 'twoFamilies',
  });
  const [a, b] = trip.participants;
  const { status, data } = await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '숙소', amount: 180, currency: 'local', payerId: a.id, date: '2027-02-01', split: { mode: 'even' } },
  });
  assert.equal(status, 201);
  assert.equal(data.settlement.totalKrw, 270000);
  assert.equal(data.settlement.participants.find((p) => p.id === a.id).burden, 135000);
  assert.equal(data.settlement.participants.find((p) => p.id === b.id).burden, 135000);
  assert.equal(data.settlement.transfers[0].from.id, b.id);
  assert.equal(data.settlement.transfers[0].to.id, a.id);
  assert.equal(data.settlement.transfers[0].amount, 135000);
  assert.equal(data.expenses[0].krw, 270000);
  assert.deepEqual(data.expenses[0].burden, { [a.id]: 135000, [b.id]: 135000 });
});

test('인원 비례 → 참여자 인원을 바꾸면 부담액이 즉시 재계산된다', async () => {
  const trip = await newTrip({
    name: '테스트 여행 B', startDate: '2027-03-01', endDate: '2027-03-03', localCurrency: 'KRW', exchangeRate: 1, template: 'twoFamilies',
  });
  const [a, b] = trip.participants;
  await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '렌터카', amount: 280000, currency: 'base', payerId: b.id, date: '2027-03-01', split: { mode: 'headcount' } },
  });
  let full = (await call(`/api/trips/${trip.id}`)).data;
  const beforeA = full.settlement.participants.find((p) => p.id === a.id).burden;

  const patched = await call(`/api/trips/${trip.id}/participants/${a.id}`, { method: 'PATCH', body: { kids: 0 } });
  assert.equal(patched.status, 200);
  const afterA = patched.data.settlement.participants.find((p) => p.id === a.id).burden;
  assert.notEqual(beforeA, afterA);
  assert.equal(afterA, Math.round((280000 * 2) / 5));
  assert.equal(
    patched.data.settlement.participants.reduce((s, p) => s + p.burden, 0),
    280000
  );
});

test('참여자 호칭 변경이 정산·지출에 반영된다', async () => {
  const trip = await newTrip({
    name: '호칭 테스트', startDate: '2027-04-01', endDate: '2027-04-02', localCurrency: 'KRW', exchangeRate: 1, template: 'twoFamilies',
  });
  const [a, b] = trip.participants;
  await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '식사', amount: 60000, currency: 'base', payerId: a.id, date: '2027-04-01', split: { mode: 'even' } },
  });
  const renamed = await call(`/api/trips/${trip.id}/participants/${a.id}`, { method: 'PATCH', body: { name: '김家' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.participants.find((p) => p.id === a.id).name, '김家');
  assert.ok(renamed.data.settlement.participants.some((p) => p.name === '김家'));
  assert.equal(renamed.data.settlement.transfers[0].to.name, '김家');
  assert.equal(renamed.data.expenses[0].payerId, a.id);

  const tripRenamed = await call(`/api/trips/${trip.id}/participants/${b.id}`, { method: 'PATCH', body: { name: '박家' } });
  assert.equal(tripRenamed.data.participants.map((p) => p.name).join(','), '김家,박家');
});

test('참여자 추가·삭제, 지출이 걸린 참여자는 409 후 이관', async () => {
  const trip = await newTrip({
    name: '이관 테스트', startDate: '2027-05-01', endDate: '2027-05-02', localCurrency: 'KRW', exchangeRate: 1, template: 'friends', friendCount: 3,
  });
  const added = await call(`/api/trips/${trip.id}/participants`, { method: 'POST', body: { name: '친구 4', type: 'person' } });
  assert.equal(added.status, 201);
  assert.equal(added.data.participants.length, 4);
  const [f1, f2, f3, f4] = added.data.participants;

  await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '택시', amount: 40000, currency: 'base', payerId: f2.id, date: '2027-05-01', split: { mode: 'select', participantIds: [f2.id, f3.id] } },
  });

  const blocked = await call(`/api/trips/${trip.id}/participants/${f2.id}`, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'PARTICIPANT_IN_USE');

  const moved = await call(`/api/trips/${trip.id}/participants/${f2.id}?reassignTo=${f4.id}`, { method: 'DELETE' });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.participants.length, 3);
  assert.ok(!moved.data.participants.some((p) => p.id === f2.id));
  assert.equal(moved.data.expenses[0].payerId, f4.id);
  assert.ok(moved.data.expenses[0].split.participantIds.includes(f4.id));
  assert.equal(moved.data.settlement.participants.reduce((s, p) => s + p.burden, 0), 40000);
  assert.ok(f1 && f3);
});

test('참여자는 최소 2명 유지', async () => {
  const trip = await newTrip({ name: '최소 인원', startDate: '2027-06-01', endDate: '2027-06-02', template: 'twoFamilies' });
  const [a] = trip.participants;
  const res = await call(`/api/trips/${trip.id}/participants/${a.id}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /최소 2명/);
});

test('지출 수정·삭제와 분담 방식 변경', async () => {
  const trip = await newTrip({ name: '수정 테스트', startDate: '2027-07-01', endDate: '2027-07-02', localCurrency: 'EUR', exchangeRate: 1400, template: 'twoFamilies' });
  const [a, b] = trip.participants;
  const created = await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '커피', amount: 10, currency: 'local', payerId: a.id, date: '2027-07-01', split: { mode: 'even' } },
  });
  const exp = created.data.expenses[0];
  assert.equal(exp.krw, 14000);

  const patched = await call(`/api/trips/${trip.id}/expenses/${exp.id}`, {
    method: 'PATCH',
    body: { title: '커피와 케이크', amount: 20, split: { mode: 'custom', amounts: { [a.id]: 20000, [b.id]: 8000 } } },
  });
  assert.equal(patched.status, 200);
  const updated = patched.data.expenses[0];
  assert.equal(updated.title, '커피와 케이크');
  assert.equal(updated.krw, 28000);
  assert.deepEqual(updated.burden, { [a.id]: 20000, [b.id]: 8000 });

  const del = await call(`/api/trips/${trip.id}/expenses/${exp.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal(del.data.expenses.length, 0);
  assert.equal(del.data.settlement.totalKrw, 0);
});

test('지출 검증 오류', async () => {
  const trip = await newTrip({ name: '검증 테스트', startDate: '2027-08-01', endDate: '2027-08-02', template: 'twoFamilies' });
  const [a] = trip.participants;
  const base = { title: 'x', amount: 1000, currency: 'base', payerId: a.id, date: '2027-08-01' };

  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, amount: 0 } })).status, 400);
  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, title: '' } })).status, 400);
  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, payerId: 'nope' } })).status, 400);
  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, date: '8/1' } })).status, 400);
  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, split: { mode: 'select', participantIds: [] } } })).status, 400);
  assert.equal((await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: { ...base, split: { mode: 'custom', amounts: {} } } })).status, 400);
});

test('환율 변경 시 현지 통화 지출이 다시 계산된다', async () => {
  const trip = await newTrip({ name: '환율 테스트', startDate: '2027-09-01', endDate: '2027-09-02', localCurrency: 'EUR', exchangeRate: 1500, template: 'twoFamilies' });
  const [a] = trip.participants;
  await call(`/api/trips/${trip.id}/expenses`, {
    method: 'POST',
    body: { title: '호텔', amount: 100, currency: 'local', payerId: a.id, date: '2027-09-01', split: { mode: 'even' } },
  });
  const patched = await call(`/api/trips/${trip.id}`, { method: 'PATCH', body: { exchangeRate: 1600 } });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.settlement.totalKrw, 160000);
});

test('일정 CRUD + 구글지도 링크', async () => {
  const trip = await newTrip({ name: '일정 테스트', startDate: '2027-10-01', endDate: '2027-10-03', template: 'twoFamilies' });
  const created = await call(`/api/trips/${trip.id}/itinerary`, {
    method: 'POST',
    body: { day: 2, time: '09:30', place: '사그라다 파밀리아', region: '바르셀로나', memo: '예약 10:00', mapUrl: 'https://maps.app.goo.gl/example' },
  });
  assert.equal(created.status, 201);
  const item = created.data.itinerary[0];
  assert.equal(item.day, 2);
  assert.equal(item.time, '09:30');
  assert.equal(item.mapUrl, 'https://maps.app.goo.gl/example');

  const bad = await call(`/api/trips/${trip.id}/itinerary`, { method: 'POST', body: { day: 1, place: 'x', mapUrl: 'javascript:alert(1)' } });
  assert.equal(bad.status, 400);

  const badTime = await call(`/api/trips/${trip.id}/itinerary`, { method: 'POST', body: { day: 1, place: 'x', time: '25:00' } });
  assert.equal(badTime.status, 400);

  const patched = await call(`/api/trips/${trip.id}/itinerary/${item.id}`, { method: 'PATCH', body: { memo: '예약 10:30' } });
  assert.equal(patched.data.itinerary[0].memo, '예약 10:30');

  const del = await call(`/api/trips/${trip.id}/itinerary/${item.id}`, { method: 'DELETE' });
  assert.equal(del.data.itinerary.length, 0);
});

test('폴링: 버전이 같으면 unchanged, 바뀌면 전체 데이터', async () => {
  const trip = await newTrip({ name: '폴링 테스트', startDate: '2027-11-01', endDate: '2027-11-02', template: 'twoFamilies' });
  const same = await call(`/api/trips/${trip.id}/poll?version=${trip.version}`);
  assert.equal(same.data.unchanged, true);
  assert.equal(same.data.version, trip.version);

  await call(`/api/trips/${trip.id}/itinerary`, { method: 'POST', body: { day: 1, place: '공항' } });
  const changed = await call(`/api/trips/${trip.id}/poll?version=${trip.version}`);
  assert.equal(changed.data.unchanged, undefined);
  assert.equal(changed.data.id, trip.id);
  assert.ok(changed.data.version > trip.version);
});

test('동시에 여러 지출을 넣어도 유실 없이 저장된다', async () => {
  const trip = await newTrip({ name: '동시성 테스트', startDate: '2027-12-01', endDate: '2027-12-02', template: 'twoFamilies' });
  const [a] = trip.participants;
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => call(`/api/trips/${trip.id}/expenses`, {
      method: 'POST',
      body: { title: `동시 ${i}`, amount: 1000 + i, currency: 'base', payerId: a.id, date: '2027-12-01', split: { mode: 'even' } },
    }))
  );
  assert.ok(results.every((r) => r.status === 201));
  const full = (await call(`/api/trips/${trip.id}`)).data;
  assert.equal(full.expenses.length, 10);
  assert.equal(full.settlement.totalKrw, 10000 + (0 + 9) * 10 / 2);
});

test('여행 삭제', async () => {
  const trip = await newTrip({ name: '삭제 테스트', startDate: '2028-01-01', endDate: '2028-01-02', template: 'twoFamilies' });
  const del = await call(`/api/trips/${trip.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await call(`/api/trips/${trip.id}`)).status, 404);
});

test('파일로 원자 저장되고 다시 불러올 수 있다', async () => {
  const file = path.join(dir, 'data', 'trips.json');
  assert.ok(fs.existsSync(file));
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(raw.trips.length >= 2);
  const fresh = new JsonStore(path.dirname(file));
  await fresh.load();
  assert.equal(fresh.snapshot().trips.length, raw.trips.length);
  assert.ok(fresh.snapshot().trips.every((t) => Array.isArray(t.participants) && t.participants.length >= 2));
});

test('없는 여행/지출은 404, 잘못된 JSON 은 400', async () => {
  assert.equal((await call('/api/trips/trp_none')).status, 404);
  const trip = await newTrip({ name: '404 테스트', startDate: '2028-02-01', endDate: '2028-02-02', template: 'twoFamilies' });
  assert.equal((await call(`/api/trips/${trip.id}/expenses/exp_none`, { method: 'PATCH', body: {} })).status, 404);
  const bad = await fetch(`${base}/api/trips`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
});
