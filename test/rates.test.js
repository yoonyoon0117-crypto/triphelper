'use strict';
/**
 * 네이버 환율 조회 단위 테스트 — 외부 네트워크 없이 응답 파싱·오류·캐시를 검사합니다.
 *   node --test test/rates.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  parseNaverExchange,
  fetchNaverRate,
  createNaverRateClient,
  RateLookupError,
} = require('../lib/rates');

// 네이버 증권 실제 응답 구조를 줄인 fixture
const SAMPLE = {
  exchangeInfo: {
    reutersCode: 'FX_EURKRW',
    symbolCode: 'EUR',
    name: '유럽 EUR',
    localTradedAt: '2026-11-25T10:44:33+09:00',
    closePrice: '1,472.27',
    calcPrice: '1,472.27',
    marketStatus: 'OPEN',
    stockExchangeType: { nameKor: '하나은행' },
  },
};

test('네이버 응답 파싱 — 쉼표 숫자·고시 시각·은행', () => {
  const r = parseNaverExchange(SAMPLE, 'EUR');
  assert.equal(r.currency, 'EUR');
  assert.equal(r.rate, 1472.27);
  assert.equal(r.quotedRate, 1472.27);
  assert.equal(r.baseUnit, 1);
  assert.equal(r.quotedAt, '2026-11-25T10:44:33+09:00');
  assert.equal(r.bank, '하나은행');
});

test('JPY는 100단위 고시를 1엔당 원화로 환산한다', () => {
  const r = parseNaverExchange({ exchangeInfo: { calcPrice: '843.35' } }, 'JPY');
  assert.equal(r.baseUnit, 100, '네이버는 100엔 기준으로 고시');
  assert.equal(r.quotedRate, 843.35);
  assert.equal(r.rate, 8.4335, '1엔 = 8.4335원');
});

test('VND·IDR 도 100단위 고시를 환산한다', () => {
  assert.equal(parseNaverExchange({ exchangeInfo: { calcPrice: '5.21' } }, 'VND').rate, 0.0521);
  assert.equal(parseNaverExchange({ exchangeInfo: { calcPrice: '7.37' } }, 'IDR').rate, 0.0737);
  assert.equal(parseNaverExchange({ exchangeInfo: { calcPrice: '39.57' } }, 'THB').rate, 39.57, 'THB는 1단위 고시');
});

test('calcPrice 가 없으면 closePrice 를 쓴다', () => {
  const r = parseNaverExchange({ exchangeInfo: { closePrice: '1,343.20' } }, 'USD');
  assert.equal(r.rate, 1343.2);
});

test('환율 정보가 비어 있으면 RateLookupError', () => {
  assert.throws(() => parseNaverExchange({}, 'EUR'), RateLookupError);
  assert.throws(() => parseNaverExchange({ exchangeInfo: { calcPrice: '-' } }, 'EUR'), RateLookupError);
  assert.throws(() => parseNaverExchange(null, 'EUR'), RateLookupError);
});

test('HTTP 조회 — fixture 서버의 응답을 파싱한다 (EUR·JPY)', async () => {
  const server = http.createServer((req, res) => {
    const cur = /FX_([A-Z]{3})KRW/.exec(req.url)?.[1];
    if (!cur) { res.writeHead(404); res.end('{}'); return; }
    const body = cur === 'JPY'
      ? { exchangeInfo: { calcPrice: '843.35', localTradedAt: '2026-11-25T10:44:33+09:00' } }
      : SAMPLE;
    res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const eur = await fetchNaverRate('EUR', { base });
    assert.equal(eur.rate, 1472.27);
    const jpy = await fetchNaverRate('JPY', { base });
    assert.equal(jpy.rate, 8.4335);
    assert.equal(jpy.baseUnit, 100);
  } finally {
    server.close();
  }
});

test('네이버가 오류를 주면 RateLookupError (500·404)', async () => {
  const server = http.createServer((req, res) => { res.writeHead(500); res.end('boom'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(() => fetchNaverRate('EUR', { base }), RateLookupError);
  } finally {
    server.close();
  }
});

test('연결 실패·시간 초과도 RateLookupError 로 바뀐다', async () => {
  await assert.rejects(() => fetchNaverRate('EUR', { base: 'http://127.0.0.1:1' }), RateLookupError);
  const slow = createNaverRateClient({
    timeoutMs: 30,
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }),
  });
  await assert.rejects(() => slow('EUR'), RateLookupError);
});

test('같은 통화를 연달아 불러오면 60초 캐시로 요청은 한 번만', async () => {
  let calls = 0;
  let now = 1_000_000;
  const client = createNaverRateClient({
    now: () => now,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, json: async () => SAMPLE };
    },
  });
  const a = await client('EUR');
  const b = await client('eur');
  assert.equal(a.rate, 1472.27);
  assert.equal(b.rate, 1472.27);
  assert.equal(calls, 1, '두 번째는 캐시');
  now += 61_000;
  await client('EUR');
  assert.equal(calls, 2, '60초가 지나면 다시 조회');
});
