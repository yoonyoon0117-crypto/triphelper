'use strict';
/**
 * 네이버 환율(매매기준율) 조회.
 *
 *   네이버 증권 공개 API — https://api.stock.naver.com/marketindex/exchange/FX_{통화}KRW
 *   → exchangeInfo.calcPrice 가 매매기준율(하나은행 고시), localTradedAt 이 고시 시각.
 *
 *   네이버는 JPY·VND·IDR 을 100단위로 고시하므로(예: 100 JPY = 843.08원),
 *   앱이 쓰는 '1단위 = ?원' 값으로 환산해 함께 돌려줍니다.
 *
 *   테스트에서는 NAVER_EXCHANGE_API_BASE 로 로컬 fixture 서버를 가리켜 외부 네트워크 없이 검증합니다.
 */
const QUOTE_UNITS = { JPY: 100, VND: 100, IDR: 100 };
const DEFAULT_BASE = 'https://api.stock.naver.com';
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_TTL_MS = 60 * 1000;

class RateLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLookupError';
  }
}

const toNumber = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v == null ? '' : v).replace(/[,\s원]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const round = (n, digits = 6) => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

/** 네이버 환율 응답(JSON) → { currency, rate, quotedRate, baseUnit, quotedAt, bank } */
function parseNaverExchange(payload, currency) {
  const info = payload && payload.exchangeInfo;
  if (!info) throw new RateLookupError('네이버 응답에 환율 정보가 없어요.');
  const quoted = toNumber(info.calcPrice != null ? info.calcPrice : info.closePrice);
  if (!(quoted > 0)) throw new RateLookupError('네이버 응답의 환율 값이 비어 있어요.');
  const baseUnit = QUOTE_UNITS[currency] || 1;
  return {
    currency,
    rate: round(quoted / baseUnit), // 1단위 = ?원 (앱에 저장·적용하는 값)
    quotedRate: quoted, // 네이버 고시 그대로 (100 JPY = 843.08원 등)
    baseUnit,
    quotedAt: info.localTradedAt || null,
    bank: (info.stockExchangeType && info.stockExchangeType.nameKor) || null,
    marketStatus: info.marketStatus || null,
  };
}

function apiBase(base) {
  return String(base || process.env.NAVER_EXCHANGE_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
}

/** 네이버에 실제 요청해 한 통화의 환율을 가져옵니다. 실패하면 RateLookupError. */
async function fetchNaverRate(currency, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, base } = {}) {
  const code = String(currency || '').toUpperCase();
  const url = `${apiBase(base)}/marketindex/exchange/FX_${code}KRW`;
  if (typeof fetchImpl !== 'function') throw new RateLookupError('fetch 를 쓸 수 없는 환경이에요.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'User-Agent': 'TripHelper/1.0',
      },
    });
    if (!res || !res.ok) throw new RateLookupError(`네이버 응답이 올바르지 않아요. (${res ? res.status : 'no response'})`);
    const payload = await res.json();
    return parseNaverExchange(payload, code);
  } catch (err) {
    if (err instanceof RateLookupError) throw err;
    if (err && err.name === 'AbortError') throw new RateLookupError('네이버 응답이 늦어 시간 초과됐어요.');
    throw new RateLookupError('네이버에 연결하지 못했어요.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 짧은 캐시(기본 60초)를 붙인 조회 함수를 만듭니다.
 *   같은 통화를 연달아 눌러도 네이버를 반복 호출하지 않습니다.
 */
function createNaverRateClient(options = {}) {
  const ttlMs = options.ttlMs != null ? options.ttlMs : DEFAULT_TTL_MS;
  const now = options.now || Date.now;
  const cache = new Map();
  return async function lookup(currency) {
    const code = String(currency || '').toUpperCase();
    const hit = cache.get(code);
    const at = now();
    if (hit && at - hit.at < ttlMs) return hit.value;
    const value = await fetchNaverRate(code, options);
    cache.set(code, { at, value });
    return value;
  };
}

module.exports = {
  QUOTE_UNITS,
  RateLookupError,
  parseNaverExchange,
  fetchNaverRate,
  createNaverRateClient,
};
