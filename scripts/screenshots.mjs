#!/usr/bin/env node
/**
 * 실제 모바일 화면(390×844) 스크린샷 생성 — 산출물용.
 *   npm run screenshots
 * 저장: /workspace/downloads/family-trip-screens/*.png
 *       + family-trip-app/docs/screenshots/*.png (README용 영문 이름)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
const OUT = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.join(WORKSPACE, 'downloads', 'family-trip-screens');
const DOCS = path.join(ROOT, 'docs', 'screenshots');

const BROWSERS = path.join(WORKSPACE, '.tools', 'pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(BROWSERS)) process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
const LIBS = path.join(WORKSPACE, '.tools', 'libs');
if (fs.existsSync(LIBS)) process.env.LD_LIBRARY_PATH = [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const { chromium } = require('playwright');

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

// README에 쓰는 영문 이름 (같은 화면을 docs/screenshots 에도 저장)
const ALIAS = {
  '01-정산.png': '01-settle.png',
  '03-일정.png': '03-plan.png',
  '03b-환율-계산기.png': '04-rate.png',
  '05-설정.png': '05-settings.png',
  '05b-설정-일정-붙여넣기.png': '06-settings-paste.png',
  '11-친구5명-정산.png': '10-friends.png',
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-shots-'));
const port = 3600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;

const call = async (p, opts = {}) => {
  const r = await fetch(base + p, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r.json();
};

// 네이버 환율 fixture — 스크린샷도 외부 네트워크 없이 같은 화면을 만든다
const FX_FIXTURE = { EUR: '1,472.27', USD: '1,343.20', JPY: '843.35' };
const fxServer = http.createServer((req, res) => {
  const cur = (/FX_([A-Z]{3})KRW/.exec(req.url || '') || [])[1] || 'EUR';
  res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
  res.end(JSON.stringify({
    exchangeInfo: {
      calcPrice: FX_FIXTURE[cur] || FX_FIXTURE.EUR,
      localTradedAt: '2026-11-25T10:44:33+09:00',
      marketStatus: 'OPEN',
      stockExchangeType: { nameKor: '하나은행' },
    },
  }));
});
await new Promise((r) => fxServer.listen(0, '127.0.0.1', r));
const FX_BASE = `http://127.0.0.1:${fxServer.address().port}`;

const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NAVER_EXCHANGE_API_BASE: FX_BASE },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* wait */ }
    await sleep(200);
  }
  throw new Error('서버 시작 실패');
}

let browser;
try {
  await waitServer();

  // ── 스페인 여행 데이터 채우기 ────────────────────────
  const { trips } = await call('/api/trips');
  const spain = trips.find((t) => t.name.includes('스페인'));
  let trip = await call(`/api/trips/${spain.id}`);
  const [A, B] = trip.participants;

  // 화면용으로 지출을 자연스러운 예시로 채웁니다(임시 데이터 폴더라 실제 사용자 데이터는 건드리지 않음).
  for (const e of trip.expenses) await call(`/api/trips/${trip.id}/expenses/${e.id}`, { method: 'DELETE' });
  const expenses = [
    { title: '숙소 3박 (마드리드)', amount: 520, currency: 'local', payerId: A.id, date: '2026-12-19', memo: '예약번호 ESP-2311', split: { mode: 'even' } },
    { title: '공항 → 시내 택시', amount: 45000, currency: 'base', payerId: B.id, date: '2026-12-19', split: { mode: 'headcount' } },
    { title: '프라도 미술관 입장권', amount: 32, currency: 'local', payerId: A.id, date: '2026-12-20', memo: '아이 2명 무료', split: { mode: 'even' } },
    { title: '저녁 타파스', amount: 96, currency: 'local', payerId: B.id, date: '2026-12-20', split: { mode: 'headcount' } },
    { title: '마트 장보기 (간식·물)', amount: 38000, currency: 'base', payerId: A.id, date: '2026-12-21', split: { mode: 'even' } },
  ];
  for (const e of expenses) await call(`/api/trips/${trip.id}/expenses`, { method: 'POST', body: e });

  for (const it of trip.itinerary) await call(`/api/trips/${trip.id}/itinerary/${it.id}`, { method: 'DELETE' });
  const plans = [
    { day: 1, time: '14:00', place: '마드리드 바라하스 공항', region: '마드리드', memo: '입국 후 렌터카 픽업 · 숙소 체크인 15:00' },
    { day: 2, time: '10:00', place: '프라도 미술관', region: '마드리드', memo: '예약 10:00 · 아이 2명 무료, 오디오가이드 대여' },
    { day: 2, time: '19:30', place: '산 미겔 시장', region: '마드리드', memo: '저녁 간단히 · 아이들 핫초코' },
    { day: 3, time: '09:30', place: '사그라다 파밀리아', region: '바르셀로나', memo: '예약번호 SAGR-4451 · 10:00 입장, 신분증 지참' },
  ];
  for (const it of plans) await call(`/api/trips/${trip.id}/itinerary`, { method: 'POST', body: it });
  trip = await call(`/api/trips/${trip.id}`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const shots = async (name) => {
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, name) });
    if (ALIAS[name]) await page.screenshot({ path: path.join(DOCS, ALIAS[name]) });
    console.log(`📸 ${name}`);
  };

  await page.goto(`${base}/t/${trip.code}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('.hero');
  await sleep(800);
  await shots('01-정산.png');

  await page.evaluate(() => window.scrollTo({ top: 620 }));
  await shots('02-정산-지출내역.png');
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  await page.click('#tabbar .tab[data-tab="plan"]');
  await sleep(600);
  await shots('03-일정.png');
  await page.evaluate(() => window.scrollTo({ top: 420 }));
  await shots('04-일정-카드.png');
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  // 환율 계산기 (네이버 환율 불러오기 전/후)
  await page.click('#tabbar .tab[data-tab="rate"]');
  await page.waitForSelector('#cvLocal');
  await sleep(400);
  await shots('03b-환율-계산기.png');
  await page.fill('#cvLocal', '50');
  await page.click('#btnRateFetch');
  await page.waitForSelector('#rateNaver');
  await sleep(500);
  await shots('03c-환율-네이버.png');
  await sleep(2700); // 토스트가 사라진 뒤 다음 화면 촬영

  await page.click('#tabbar .tab[data-tab="settings"]');
  await page.waitForSelector('#stName');
  await sleep(400);
  await shots('05-설정.png');

  // 일정 한 번에 붙여넣기 — 실제 스페인 일정 원문 형식으로 미리보기까지
  const PASTE_SAMPLE = [
    'ㅁ 12/21(일) 마드리드 : 톨레도 근교여행',
    '  09:15 -> 09:49 마드리드 -> 톨레도',
    '  10:00~12:00 구시가지 관광',
    '    - 소코도베르 광장으로 이동',
    '    - 꼬마기차 한바퀴 (약 50분, 전망대 10분)',
    '  12:00~13:00 점심식사',
    '  19:00 저녁식사 @Restaurante Sol (salon자리, 예약함)',
  ].join('\n');
  await page.evaluate(() => window.scrollTo({ top: 430 }));
  await page.fill('#bulkText', PASTE_SAMPLE);
  await page.click('[data-act="bulk-preview"]');
  await page.waitForSelector('#bulkPreview .bulk-item');
  await page.evaluate(() => { const el = document.querySelector('.bulk-list'); if (el) el.scrollTop = 0; });
  await page.evaluate(() => { const el = document.querySelector('#bulkText'); if (el) el.scrollTop = 0; });
  await shots('05b-설정-일정-붙여넣기.png');
  // 붙여넣기 초안을 비우고 아래 설정 카드들을 원래 높이로 촬영하기 위해 다시 연다
  await page.goto(`${base}/t/${trip.code}`, { waitUntil: 'networkidle' });
  await page.click('#tabbar .tab[data-tab="settings"]');
  await page.waitForSelector('#stName');
  await sleep(300);
  await page.evaluate(() => window.scrollTo({ top: 560 }));
  await shots('06-설정-참여자.png');
  await page.evaluate(() => window.scrollTo({ top: 980 }));
  await shots('07-설정-링크-동기화.png');
  await page.evaluate(() => window.scrollTo({ top: 560 }));
  await page.click('#view [data-act="edit-participant"] >> nth=0');
  await page.waitForSelector('#ptName');
  await shots('08-참여자-수정.png');
  await page.click('.sheet-close');
  await sleep(400);

  await page.click('#tabbar .tab[data-tab="settle"]');
  await sleep(400);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.click('#btnAdd');
  await page.waitForSelector('#exTitle');
  await page.fill('#exTitle', '바르셀로나 택시');
  await page.fill('#exAmount', '24');
  await page.click('#exPayers .chip >> nth=1');
  await page.click('.radio[data-mode="select"]');
  await page.waitForTimeout(300);
  await shots('09-지출-추가.png');
  await page.evaluate(() => { document.querySelector('#sheetBody').scrollTop = 420; });
  await shots('10-분담-방식.png');
  await page.click('.sheet-close');
  await sleep(400);

  // ── 친구 5명 여행 ──────────────────────────────
  const friends = await call('/api/trips', {
    method: 'POST',
    body: {
      name: '🇯🇵 오사카 친구 여행', subtitle: '친구 5명 우정 여행',
      startDate: '2027-01-10', endDate: '2027-01-13', localCurrency: 'JPY', exchangeRate: 9.2,
      template: 'friends', friendCount: 5,
    },
  });
  const f = friends.participants;
  await call(`/api/trips/${friends.id}/expenses`, { method: 'POST', body: { title: '료칸 2박', amount: 300000, currency: 'base', payerId: f[0].id, date: '2027-01-10', split: { mode: 'even' } } });
  await call(`/api/trips/${friends.id}/expenses`, { method: 'POST', body: { title: '공항 택시 (3명)', amount: 90000, currency: 'base', payerId: f[1].id, date: '2027-01-10', memo: '짐 많은 3명만', split: { mode: 'select', participantIds: [f[0].id, f[1].id, f[2].id] } } });
  await call(`/api/trips/${friends.id}/expenses`, { method: 'POST', body: { title: '이자카야 1차', amount: 42000, currency: 'base', payerId: f[3].id, date: '2027-01-11', split: { mode: 'even' } } });
  await call(`/api/trips/${friends.id}/itinerary`, { method: 'POST', body: { day: 1, time: '18:00', place: '도톤보리', region: '오사카', memo: '저녁 먹고 산책' } });

  await page.goto(`${base}/t/${friends.code}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('.hero');
  await sleep(700);
  await shots('11-친구5명-정산.png');

  await page.click('#btnTripSwitch');
  await page.waitForSelector('[data-act="new-trip"]');
  await shots('12-여행-전환.png');
  await page.click('[data-act="new-trip"]');
  await page.waitForSelector('#ntName');
  await page.click('#ntTemplate button[data-tpl="friends"]');
  await sleep(300);
  await shots('13-새-여행.png');

  // ── 여행 중: 오늘 일정 맨 위 · 지난 일정 접기 ──────
  const kst = (offset) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000));
  const live = await call('/api/trips', {
    method: 'POST',
    body: {
      name: '🇪🇸 바르셀로나 여행 중', subtitle: '여행 2일차 · 오늘부터 보기',
      startDate: kst(-1), endDate: kst(3), localCurrency: 'EUR', exchangeRate: 1500, template: 'twoFamilies',
    },
  });
  const livePlans = [
    { day: 1, time: '09:00', place: '마드리드 왕궁', region: '마드리드', memo: '사전 예약 09:30 · 신분증 지참' },
    { day: 2, time: '09:00', place: '구엘 공원', region: '바르셀로나', memo: '예약 09:30 · 입구에서 QR 확인' },
    { day: 2, time: '13:00', place: '보케리아 시장', region: '바르셀로나', memo: '점심 · 아이들 과일 컵 챙기기' },
    { day: 3, time: '11:00', place: '카사 바트요', region: '바르셀로나', memo: '예약 11:15 · 오디오가이드 포함' },
  ];
  for (const it of livePlans) await call(`/api/trips/${live.id}/itinerary`, { method: 'POST', body: it });

  await page.goto(`${base}/t/${live.code}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.click('#tabbar .tab[data-tab="plan"]');
  await sleep(700);
  await shots('14-여행중-오늘일정.png');
  await page.click('#view .past-toggle');
  await sleep(500);
  await shots('15-여행중-지난일정-펼침.png');

  console.log(`\n✅ 스크린샷 저장: ${OUT}`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
  fxServer.close();
}
