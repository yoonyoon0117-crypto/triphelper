'use strict';
/**
 * 4자리 입장 비밀번호(PIN) 테스트 — 설정·검증·미인증 401 차단·중복 setup 409·변경 시 토큰 무효.
 *   node --test test/pin.test.js
 *
 * 주의: 실제 사용하는 비밀번호는 절대 여기에 쓰지 않는다(테스트 전용 임의 숫자만).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { JsonStore } = require('../lib/store');
const { createApp } = require('../server');
const { seedTrip } = require('../lib/trips');
const { PinGate } = require('../lib/pin');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-pin-test-'));
const PIN_A = '4271'; // 테스트 전용
const PIN_B = '9083'; // 테스트 전용

let server;
let base;
let gate;

async function bootApp() {
  const dataDir = path.join(tmpRoot, 'data');
  const store = new JsonStore(dataDir);
  await store.load();
  await store.write((state) => { state.trips.push(seedTrip()); });
  gate = new PinGate({ dataDir: path.join(tmpRoot, 'pin'), envPin: '' });
  const app = createApp(store, { pin: gate, rateLookup: async () => ({ rate: 1500, quotedRate: 1500, baseUnit: 1, quotedAt: null }) });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
}

test.before(bootApp);
test.after(() => { if (server) server.close(); });

async function call(pathname, { method = 'GET', body, token, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['X-Trip-Pin-Token'] = token;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + pathname, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, res };
}

test('1. PIN 미설정이면 잠금 없이 바로 열린다 (기존 흐름 호환)', async () => {
  const status = await call('/api/pin/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.data, { locked: false, unlocked: true });

  const trips = await call('/api/trips');
  assert.equal(trips.status, 200);
  assert.ok(trips.data.trips.length >= 1);
  assert.equal((await call('/api/exchange-rate?currency=EUR')).status, 200);
});

test('2. PIN 은 4자리 숫자만, 첫 1회만 설정된다', async () => {
  for (const bad of ['12', 'abc', '12345', '', null]) {
    const r = await call('/api/pin/setup', { method: 'POST', body: { pin: bad } });
    assert.equal(r.status, 400, `${bad} → 400`);
    assert.equal(r.data.code, 'PIN_FORMAT');
  }

  const ok = await call('/api/pin/setup', { method: 'POST', body: { pin: PIN_A } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.locked, true);
  assert.equal(ok.data.unlocked, true);
  assert.match(ok.data.token, /^p1\.[\w-]+\.[\w-]+$/, '설정 직후 서명 토큰 발급');
  assert.ok(ok.res.headers.get('set-cookie').includes('trip_pin='), 'HttpOnly 쿠키도 함께');
  assert.match(ok.res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.res.headers.get('set-cookie'), /SameSite=Lax/);

  const status = await call('/api/pin/status');
  assert.deepEqual(status.data, { locked: true, unlocked: false }, '토큰 없이 조회하면 아직 잠김');
  const withToken = await call('/api/pin/status', { token: ok.data.token });
  assert.deepEqual(withToken.data, { locked: true, unlocked: true });
});

test('3. 이미 설정된 뒤에는 외부인이 덮어쓸 수 없다 (409)', async () => {
  const again = await call('/api/pin/setup', { method: 'POST', body: { pin: '1111' } });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'PIN_ALREADY_SET');
  assert.match(again.data.error, /이미 비밀번호가 설정/);

  // 409 이후에도 원래 비밀번호가 그대로 동작한다
  const verify = await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_A } });
  assert.equal(verify.status, 200);
});

test('4. PIN 이 켜지면 여행 데이터·환율은 인증 없이 401', async () => {
  const trips = await call('/api/trips');
  assert.equal(trips.status, 401);
  assert.equal(trips.data.code, 'PIN_REQUIRED');
  assert.equal((await call('/api/trips', { method: 'POST', body: { name: '몰래 만들기' } })).status, 401);
  assert.equal((await call('/api/trips/trp_x')).status, 401);
  assert.equal((await call('/api/trips/trp_x/poll')).status, 401);
  assert.equal((await call('/api/exchange-rate?currency=EUR')).status, 401);

  // 잠금 화면이 뜰 수 있도록 health·정적 파일은 열려 있다
  assert.equal((await call('/api/health')).status, 200);
  const code = (await (async () => {
    const store = new JsonStore(path.join(tmpRoot, 'data'));
    await store.load();
    return store.snapshot().trips[0].code;
  })());
  const page = await fetch(`${base}/t/${code}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Trip helper/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200, '잠금 화면 스크립트는 내려온다');
});

test('5. 잘못된 PIN 은 401 안내, 맞으면 토큰(헤더·쿠키 모두 인정)', async () => {
  const wrong = await call('/api/pin/verify', { method: 'POST', body: { pin: '0000' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error, '비밀번호가 맞지 않아요.');

  const right = await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_A } });
  assert.equal(right.status, 200);
  const token = right.data.token;
  assert.ok(token);

  assert.equal((await call('/api/trips', { token })).status, 200);
  assert.equal((await call('/api/trips', { cookie: `trip_pin=${token}` })).status, 200, 'HttpOnly 쿠키로도 인증');
  assert.equal((await call('/api/trips', { token: `${token}x` })).status, 401, '변조 토큰은 401');
  assert.equal((await call('/api/trips', { token: 'p1.abc.def' })).status, 401);
  assert.equal((await call('/api/trips', { token: '' })).status, 401);
});

test('6. PIN 변경은 현재 PIN 확인 후 — 바꾸면 기존 토큰이 모두 무효', async () => {
  const before = await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_A } });
  const oldToken = before.data.token;

  const wrong = await call('/api/pin/change', { method: 'POST', body: { currentPin: '0000', pin: PIN_B } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.code, 'PIN_WRONG');
  assert.equal((await call('/api/pin/change', { method: 'POST', body: { currentPin: PIN_A, pin: '99' } })).status, 400, '새 PIN 형식 검사');

  const changed = await call('/api/pin/change', { method: 'POST', body: { currentPin: PIN_A, pin: PIN_B } });
  assert.equal(changed.status, 200);
  const newToken = changed.data.token;
  assert.ok(newToken && newToken !== oldToken);

  assert.equal((await call('/api/trips', { token: newToken })).status, 200, '새 토큰은 유효');
  assert.equal((await call('/api/trips', { token: oldToken })).status, 401, '예전 토큰은 즉시 무효');

  assert.equal((await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_A } })).status, 401, '예전 PIN 불가');
  assert.equal((await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_B } })).status, 200, '새 PIN 가능');
});

test('7. pin.json 에는 평문 PIN 이 남지 않는다 (salt + hash)', async () => {
  const file = path.join(tmpRoot, 'pin', 'pin.json');
  assert.ok(fs.existsSync(file));
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PIN_A), '이전 PIN 평문 없음');
  assert.ok(!raw.includes(PIN_B), '현재 PIN 평문 없음');
  const saved = JSON.parse(raw);
  assert.match(saved.salt, /^[0-9a-f]{32}$/);
  assert.match(saved.hash, /^[0-9a-f]{64}$/);
});

test('8. 토큰 만료·APP_PIN 환경변수 동작', async () => {
  // 만료된 토큰은 다시 잠근다
  const expiring = new PinGate({ dataDir: path.join(tmpRoot, 'expiring'), envPin: '', tokenTtlMs: 1 });
  await expiring.setup(PIN_A);
  const token = expiring.issueToken();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(expiring.checkToken(token), false, '만료 토큰은 무효');

  // APP_PIN 환경변수만으로도 잠긴다(파일 없이)
  const envGate = new PinGate({ dataDir: path.join(tmpRoot, 'env'), envPin: '1357' });
  assert.equal(envGate.locked, true);
  assert.equal(envGate.verify('1357'), true);
  assert.equal(envGate.verify('0000'), false);
  await assert.rejects(envGate.setup(PIN_A), (err) => err.status === 409);

  // 형식이 잘못된 APP_PIN 은 무시하고 열어 둔다(앱이 잠기지 않음)
  const badEnv = new PinGate({ dataDir: path.join(tmpRoot, 'env-bad'), envPin: 'abcd' });
  assert.equal(badEnv.locked, false);
});

test('9. 무차별 대입은 잠시 막는다 (1분 10회 초과 → 429)', async () => {
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const r = await call('/api/pin/verify', { method: 'POST', body: { pin: String(1000 + i) } });
    seen.push(r.status);
  }
  assert.ok(seen.includes(429), `연속 실패 후 429: ${seen.join(',')}`);
  const blocked = await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_B } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.res.headers.get('retry-after'), '60');

  // 성공하면 실패 카운터가 초기화된다
  gate.failures.clear();
  assert.equal((await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_B } })).status, 200);
});

test('10. PIN 미설정 서버에서는 change 가 400 안내', async () => {
  const open = new PinGate({ dataDir: path.join(tmpRoot, 'open'), envPin: '' });
  await assert.rejects(open.change('0000', PIN_A), (err) => err.status === 400 && err.code === 'PIN_NOT_SET');
});

test('11. 일정 미리보기·한 번에 등록 API 도 PIN 없이는 막힌다', async () => {
  gate.failures.clear();
  const store = new JsonStore(path.join(tmpRoot, 'data'));
  await store.load();
  const trip = store.snapshot().trips[0];
  const before = (trip.itinerary || []).length;

  const text = 'Day 1 10:00 프라도 미술관';
  assert.equal((await call(`/api/trips/${trip.id}/itinerary/parse`, { method: 'POST', body: { text } })).status, 401, '미리보기 401');
  assert.equal((await call(`/api/trips/${trip.id}/itinerary/bulk`, { method: 'POST', body: { items: [{ day: 1, place: '몰래 등록' }] } })).status, 401, '벌크 등록 401');

  const token = (await call('/api/pin/verify', { method: 'POST', body: { pin: PIN_B } })).data.token;
  const parsed = await call(`/api/trips/${trip.id}/itinerary/parse`, { method: 'POST', body: { text }, token });
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data.items[0].place, '프라도 미술관');

  const bulk = await call(`/api/trips/${trip.id}/itinerary/bulk`, { method: 'POST', body: { items: parsed.data.items }, token });
  assert.equal(bulk.status, 201);
  assert.equal(bulk.data.added, 1);
  assert.equal(bulk.data.itinerary.length, before + 1);
});
