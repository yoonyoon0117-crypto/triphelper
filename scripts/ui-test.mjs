#!/usr/bin/env node
/**
 * Trip helper✈️ UI E2E 테스트 (Playwright, 아이폰 390×844)
 *
 *   1) 정산 탭 · 지출 추가 → 정산 금액 확인
 *   2) 인원 변경 시 재계산
 *   3) 가족 호칭 변경이 정산·지출·지출 모달에 즉시 반영
 *   4) 일정 추가 · 구글지도 링크 · 일정에서 지출 기록
 *   5) 친구 5명 새 여행 만들기 · 전환 · 5명/3명 정산(최소 송금)
 *   6) 두 기기 동시 사용(폴링 동기화)
 *   7) 콘솔 오류 0건
 *
 *   npm run test:ui
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKSPACE = path.resolve(ROOT, '..');
const SHOT_DIR = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.join(WORKSPACE, 'downloads', 'family-trip-screens', 'steps');

const BROWSERS = path.join(WORKSPACE, '.tools', 'pw-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(BROWSERS)) process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS;
const LIBS = path.join(WORKSPACE, '.tools', 'libs');
if (fs.existsSync(LIBS)) process.env.LD_LIBRARY_PATH = [LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
const { chromium } = require('playwright');

fs.mkdirSync(SHOT_DIR, { recursive: true });

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-ui-'));
const DATA_DIR = path.join(tmpRoot, 'data');
let server;
let fxServer;
let browser;
let base;

const errors = [];
const steps = [];
function step(name) {
  steps.push(name);
  console.log(`\n▶ ${name}`);
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) return;
    } catch { /* 대기 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('서버가 뜨지 않았습니다.');
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, name);
  await page.screenshot({ path: file });
  console.log(`   📸 ${name}`);
  return file;
}

const api = async (p, opts) => {
  const r = await fetch(base + p, opts);
  return { status: r.status, data: await r.json().catch(() => null) };
};

async function run() {
  // ── 네이버 환율 fixture (외부 네트워크 없이 동작) ─────────
  const FX_FIXTURE = { EUR: '1,471.88', USD: '1,343.20', JPY: '843.35' };
  fxServer = http.createServer((req, res) => {
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

  // ── 서버 ──────────────────────────────────────
  const port = 3200 + Math.floor(Math.random() * 400);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR, NODE_ENV: 'test', NAVER_EXCHANGE_API_BASE: FX_BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer(base);

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
  page.setDefaultTimeout(15000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // ── 1. 첫 화면 · 정산 ─────────────────────────
  step('1. 첫 화면: 첫 번째 탭 일정 · 정산 요약');
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#view .section-title');
  await page.waitForTimeout(400);

  assert.equal(await page.title(), 'Trip helper✈️');
  assert.equal(await page.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content'), 'Trip helper✈️');
  const brand = await page.textContent('.brand');
  assert.match(brand, /Trip helper/);

  // Cart helper 스타일 골격: 글로시 상단 바 + 하단 고정 탭 3개 + 새로고침
  const tabs = await page.$$eval('#tabbar .tab', (els) => els.map((e) => e.dataset.tab));
  assert.deepEqual(tabs, ['plan', 'settle', 'rate', 'settings'], '하단 탭 순서: 일정·정산·환율·설정');
  const tabLabels = await page.$$eval('#tabbar .tab-label', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(tabLabels, ['일정', '정산', '환율', '설정']);
  // Cart helper 처럼 이모지 아이콘 — 비활성은 흑백/흐리게, 활성은 컬러
  const tabIcons = await page.$$eval('#tabbar .tab-ico', (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(tabIcons, ['🗓️', '🧾', '💱', '⚙️'], `이모지 탭 아이콘: ${tabIcons.join(' ')}`);
  const tabLook = await page.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map((t) => {
    const ico = getComputedStyle(t.querySelector('.tab-ico'));
    return { on: t.classList.contains('is-active'), filter: ico.filter, opacity: ico.opacity };
  }));
  assert.match(tabLook[0].filter, /none/, '활성 탭 아이콘은 컬러');
  assert.ok(tabLook.slice(1).every((t) => /grayscale/.test(t.filter) && Number(t.opacity) < 1), '비활성 탭 아이콘은 흑백·흐리게');
  assert.ok(await page.$('#btnRefresh'), '상단 새로고침 버튼');
  const barBg = await page.$eval('.appbar', (el) => getComputedStyle(el).backgroundImage);
  assert.match(barBg, /linear-gradient/, '상단 바 글로시 그라데이션');
  const fontFamily = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  assert.match(fontFamily, /NanumSquareRound/, `본문 폰트: ${fontFamily}`);
  assert.match(fontFamily, /-apple-system|Apple SD Gothic Neo/, `폰트 폴백: ${fontFamily}`);
  // 로컬 woff2 실로딩 확인 (regular·bold 둘 다)
  const fontsReady = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      regular: document.fonts.check('400 15px NanumSquareRound'),
      medium: document.fonts.check('500 15px NanumSquareRound'),
      bold: document.fonts.check('600 15px NanumSquareRound'),
      faces: [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === 'NanumSquareRound')
        .map((f) => `${f.weight}:${f.status}`),
    };
  });
  assert.equal(fontsReady.regular, true, `Regular 로드: ${fontsReady.faces.join(',')}`);
  assert.equal(fontsReady.medium, true, `Medium 로드: ${fontsReady.faces.join(',')}`);
  assert.equal(fontsReady.bold, true, `Bold 로드: ${fontsReady.faces.join(',')}`);
  assert.match(fontsReady.faces.join(','), /400[^,]*:loaded/, `Regular 실제 로드됨: ${fontsReady.faces.join(',')}`);
  assert.match(fontsReady.faces.join(','), /600[^,]*:loaded/, `Bold 실제 로드됨: ${fontsReady.faces.join(',')}`);
  const fontReq = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('/fonts/')).map((e) => `${e.name.split('/').pop()}:${Math.round(e.transferSize / 1024)}KB`));
  console.log(`   폰트: ${fontsReady.faces.join(', ')} / ${fontReq.join(', ')}`);
  const tabbarPos = await page.$eval('#tabbar', (el) => getComputedStyle(el).position);
  assert.equal(tabbarPos, 'fixed', '하단 탭 바 고정');

  await page.waitForFunction(() => document.querySelector('#tripName').textContent.includes('스페인'));
  // 앱을 열면 맨 왼쪽 탭(일정)이 기본으로 열린다
  assert.match(await page.getAttribute('#tabbar .tab[data-tab="plan"]', 'class'), /is-active/, '첫 화면은 일정 탭');
  assert.match(await page.textContent('#btnAdd'), /일정 추가하기/);
  assert.match(await page.textContent('#view'), /Day 1/);

  // 정산 탭으로 이동해 정산 요약 확인
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(250);
  const heroText = await page.textContent('.hero');
  assert.match(heroText, /정산 상태/, '지출이 없으면 정산 상태로 보인다');
  assert.match(heroText, /딱 맞아요😆/);
  assert.match(heroText, /첫 지출을 기록해 보세요/);
  assert.match(heroText, /총 지출/);
  assert.match(heroText, /0건/, '기본 시드 지출은 0건');
  const emptyView = await page.textContent('#view');
  assert.match(emptyView, /지출 내역/);
  assert.match(emptyView, /아직 지출이 없어요/);

  // 정산 탭 카드 순서: 정산할 금액 → ＋ 지출 추가하기 → 지출 내역 → 참여자별 정산(맨 아래)
  const cardOrder = await page.evaluate(() => {
    const nodes = [...document.querySelector('#view').children];
    const find = (fn) => nodes.findIndex(fn);
    return {
      hero: find((n) => n.classList.contains('hero')),
      add: find((n) => n.id === 'btnAdd'),
      expenses: find((n) => n.classList.contains('section-title') && n.textContent.includes('지출 내역')),
      people: find((n) => n.classList.contains('card') && n.textContent.includes('참여자별 정산')),
    };
  });
  assert.ok(cardOrder.hero >= 0, '정산할 금액 카드');
  assert.ok(cardOrder.add > cardOrder.hero, '지출 추가하기 버튼은 정산할 금액 아래');
  assert.ok(cardOrder.expenses > cardOrder.add, '지출 내역은 지출 추가하기 아래');
  assert.ok(cardOrder.people > cardOrder.expenses, '참여자별 정산은 지출 내역 아래(맨 끝)');
  const summaryText = await page.textContent('.trip-summary');
  assert.match(summaryText, /12\.19 – 12\.26/, '여행 요약 바 날짜');
  assert.match(summaryText, /1 EUR = 1,500원/, '여행 요약 바 환율');
  const rateBadge = await page.$('.trip-summary .summary-link');
  assert.ok(rateBadge, '요약 바 환율 배지는 누를 수 있는 버튼');

  const chips = await page.$$('#peopleStrip .person-chip:not(.is-add)');
  assert.equal(chips.length, 2, '두 가족 칩');

  // 아바타: 파스텔 틴트 사각(스퀘어클) + 은은한 테두리
  const av = await page.$eval('#peopleStrip .avatar', (el) => {
    const c = getComputedStyle(el);
    return { radius: c.borderRadius, bg: c.backgroundColor, border: c.borderColor, color: c.color };
  });
  assert.equal(av.bg, 'rgb(231, 243, 253)', `스카이 틴트 배경: ${av.bg}`);
  assert.equal(av.color, 'rgb(20, 103, 163)', `포인트 글자: ${av.color}`);
  assert.notEqual(av.radius, '50%', '동그라미가 아닌 사각 아바타');
  assert.match(av.radius, /^\d+px$/);
  assert.match(av.border, /rgb\(201, 228, 248\)/, '은은한 테두리');

  // 주요 CTA는 글로시 하늘색
  const ctaBg = await page.$eval('#btnAdd', (el) => getComputedStyle(el).backgroundImage);
  assert.match(ctaBg, /linear-gradient/);
  assert.match(await page.textContent('#btnAdd'), /지출 추가하기/);
  await shot(page, '01-settle.png');

  const tripBefore = (await api('/api/trips')).data.trips.find((t) => t.name.includes('스페인'));

  // ── 2. 지출 추가 ──────────────────────────────
  step('2. 지출 추가 → 정산 금액 반영');
  await page.click('#btnAdd');
  await page.waitForSelector('#exTitle');
  await page.fill('#exTitle', '저녁 식사');
  await page.fill('#exAmount', '120');
  await page.fill('#exDate', '2026-12-20');
  await page.click('#exPayers .chip >> nth=0'); // A가족 결제
  await page.click('.radio[data-mode="headcount"]'); // 인원 비례 — 인원 변경 재계산 확인용
  await page.waitForTimeout(200);
  await shot(page, '02-expense-form.png');
  await page.click('[data-act="save-expense"]');
  await page.waitForSelector('#sheetLayer:not(.is-open)');
  await page.waitForTimeout(500);

  const afterExpense = (await api(`/api/trips/${tripBefore.id}`)).data;
  const expectedTotal = 120 * 1500;
  assert.equal(afterExpense.settlement.totalKrw, expectedTotal, '지출 1건 = 180,000원');
  const viewText = await page.textContent('#view');
  assert.match(viewText, /저녁 식사/);
  assert.match(viewText, /180,000/, '원화 환산이 목록에 보인다');
  await shot(page, '03-settle-after-expense.png');

  // ── 3. 인원 변경 재계산 ───────────────────────
  step('3. 인원 변경 → 인원 비례 부담 재계산');
  const beforeA = afterExpense.settlement.participants[0].burden;
  await page.click('#tabbar .tab[data-tab="settings"]');
  await page.waitForSelector('#stName');
  await page.waitForTimeout(400);
  await shot(page, '04-settings.png');

  // 설정 탭 하나에 여행 정보·참여자·공유 링크·자동 동기화·여행 관리가 모두 모여 있다
  const settingsText = await page.textContent('#view');
  assert.match(settingsText, /여행 정보/);
  assert.match(settingsText, /함께 쓰는 링크/);
  assert.match(settingsText, /자동 동기화/);
  assert.match(settingsText, /새 여행 만들기/);
  assert.match(settingsText, /여행 삭제/);
  assert.ok(await page.$('#syncBadge'), '동기화 상태 표시');
  const shareUrl = await page.textContent('#view .share-box .url');
  assert.match(shareUrl, /\/t\/[A-Z0-9]{6}$/, `공유 링크 /t/CODE: ${shareUrl}`);

  // 설정 여행 정보 카드에서도 네이버 환율을 채울 수 있다 (저장은 '여행 정보 저장'으로 확정)
  await page.click('#view [data-act="st-rate-fetch"]');
  await page.waitForTimeout(700);
  assert.equal(await page.inputValue('#stRate'), '1,471.88', '네이버 환율이 입력 칸에 채워짐');
  assert.match(await page.textContent('#toast'), /저장을 누르면 반영돼요/);
  await page.fill('#stRate', '1500'); // 이후 단계는 1,500원 기준으로 계속

  // 설정 탭에서 여행 정보 저장 → 서버에 남고 상단 pill에도 반영
  await page.fill('#stSub', '두 가족 첫 유럽 여행 · 겨울');
  await page.click('#view [data-act="save-settings"]');
  await page.waitForTimeout(800);
  const savedTrip = (await api(`/api/trips/${tripBefore.id}`)).data;
  assert.equal(savedTrip.subtitle, '두 가족 첫 유럽 여행 · 겨울', '설정 탭 저장이 서버에 반영');

  // 상단 새로고침 버튼으로 최신 상태 다시 불러오기
  await page.click('#btnRefresh');
  await page.waitForTimeout(900);
  assert.match(await page.textContent('#toast'), /불러왔어요/);

  // A가족 이름 칩 → 참여자 시트에서 아이 수 2 → 0
  await page.click('#view [data-act="edit-participant"] >> nth=0');
  await page.waitForSelector('#ptAdults');
  await page.click('[data-act="pt-k-minus"]');
  await page.click('[data-act="pt-k-minus"]');
  await page.waitForTimeout(200);
  await shot(page, '05-participant.png');
  await page.click('[data-act="save-participant"]');
  await page.waitForSelector('#sheetLayer:not(.is-open)');
  await page.waitForTimeout(700);

  const afterCount = (await api(`/api/trips/${tripBefore.id}`)).data;
  const aAfter = afterCount.settlement.participants.find((p) => p.id === afterExpense.settlement.participants[0].id);
  assert.equal(afterCount.participants[0].kids, 0);
  assert.notEqual(aAfter.burden, beforeA, '인원 변경 후 부담액이 달라진다');
  assert.equal(afterCount.settlement.participants.reduce((s, p) => s + p.burden, 0), expectedTotal);
  assert.match(await page.textContent('#view'), /참여자/);

  // 정산 탭으로 돌아가 재계산 확인
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForTimeout(400);
  const burdenText = await page.textContent('#view');
  assert.match(burdenText, /어른2·아이0/);

  // ── 4. 호칭 변경 반영 ────────────────────────
  step('4. 가족 호칭 변경 → 정산·지출·모달에 즉시 반영');
  await page.click('#peopleStrip .person-chip >> nth=0');
  await page.waitForSelector('#ptName');
  await page.fill('#ptName', '김家');
  await page.click('[data-act="save-participant"]');
  await page.waitForTimeout(700);

  assert.match(await page.textContent('#peopleStrip'), /김家/);
  const settleText = await page.textContent('#view');
  assert.match(settleText, /김家/, '정산 히어로/목록에 새 호칭');
  assert.match(settleText, /김家 결제/, '지출 목록 결제자 이름');
  await shot(page, '06-renamed.png');

  await page.click('#btnAdd');
  await page.waitForSelector('#exPayers');
  const payerChips = await page.$$eval('#exPayers .chip', (els) => els.map((e) => e.textContent.trim()));
  assert.ok(payerChips.some((c) => c.includes('김家')), `지출 모달 결제자 칩에 새 호칭: ${payerChips.join(',')}`);
  assert.ok(payerChips.some((c) => c.includes('B가족')), '다른 가족 이름도 유지');
  await shot(page, '07-expense-modal-honorific.png');
  await page.click('.sheet-close');
  await page.waitForTimeout(300);

  // ── 5. 일정 ──────────────────────────────────
  step('5. 일정 추가 · 구글지도 링크 · 일정에서 지출 기록');
  await page.click('#tabbar .tab[data-tab="plan"]');
  await page.waitForTimeout(400);
  assert.match(await page.textContent('#btnAdd'), /일정 추가하기/);
  await page.click('#btnAdd');
  await page.waitForSelector('#itPlace');
  await page.selectOption('#itDay', '2');
  await page.fill('#itTime', '10:00');
  await page.fill('#itPlace', '사그라다 파밀리아');
  await page.fill('#itRegion', '바르셀로나');
  await page.fill('#itMemo', '예약 10:00 · 아이들은 무료');
  await page.waitForTimeout(200);
  await shot(page, '08-itinerary-form.png');
  await page.click('[data-act="save-itinerary"]');
  await page.waitForTimeout(700);

  const planText = await page.textContent('#view');
  assert.match(planText, /사그라다 파밀리아/);
  assert.match(planText, /Day 2/);
  const mapLinks = await page.$$eval('.itn a.mini-btn', (els) => els.map((e) => ({ href: e.getAttribute('href'), target: e.getAttribute('target'), text: e.textContent })));
  const mapHref = mapLinks[mapLinks.length - 1].href;
  assert.ok(mapHref.startsWith('https://www.google.com/maps/search/?api=1&query='), `지도 링크: ${mapHref}`);
  assert.ok(decodeURIComponent(mapHref).includes('사그라다 파밀리아'), `지도 링크에 장소명: ${decodeURIComponent(mapHref)}`);

  // 지도 링크가 새 창으로
  assert.equal(mapLinks[mapLinks.length - 1].target, '_blank');

  // 일정 → 지출 기록 (항목명·날짜 자동 채움)
  const cards = await page.$$('.itn');
  await (await cards[cards.length - 1].$('[data-act="itn-to-expense"]')).click();
  await page.waitForSelector('#exTitle');
  assert.equal(await page.inputValue('#exTitle'), '사그라다 파밀리아');
  assert.equal(await page.inputValue('#exDate'), '2026-12-20');
  await page.fill('#exAmount', '38');
  await page.click('[data-act="save-expense"]');
  await page.waitForTimeout(700);
  await shot(page, '09-plan.png');
  const withItnExpense = (await api(`/api/trips/${tripBefore.id}`)).data;
  assert.ok(withItnExpense.expenses.some((e) => e.title === '사그라다 파밀리아' && e.date === '2026-12-20'));

  // ── 5-1. 환율 탭 ─────────────────────────────
  step('5-1. 환율 탭 — 네이버 환율 · 현지↔원화 양방향 계산');
  await page.click('#tabbar .tab[data-tab="rate"]');
  await page.waitForSelector('#cvLocal');
  await page.waitForTimeout(400);
  const rateView = await page.textContent('#view');
  assert.match(rateView, /환율 계산기/);
  assert.match(rateView, /1 EUR = 1,500원/, '여행에 저장된 환율이 적용 중');
  assert.match(rateView, /네이버 환율 불러오기/);
  assert.match(rateView, /€5.*€10.*€20.*€50.*€100/s, '빠른 금액 칩');
  await shot(page, '09b-rate-calculator.png');

  // 현지 통화 → 원화
  await page.fill('#cvLocal', '25');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#cvKrw'), '37,500', '25 EUR → 37,500원');

  // 원화 → 현지 통화 (반대 방향도 즉시 계산)
  await page.fill('#cvKrw', '90000');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#cvLocal'), '60', '90,000원 → 60 EUR');

  // 빠른 금액 칩 €50
  await page.click('#cvChips [data-act="rate-chip"] >> nth=3');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#cvLocal'), '50');
  assert.equal(await page.inputValue('#cvKrw'), '75,000', '€50 칩 → 75,000원');

  // 초기화
  await page.click('#view [data-act="rate-clear"]');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#cvLocal'), '');
  assert.equal(await page.inputValue('#cvKrw'), '');

  // 네이버 환율 불러오기 (fixture) → 계산기에 바로 적용
  await page.click('#btnRateFetch');
  await page.waitForSelector('#rateNaver');
  await page.waitForTimeout(400);
  assert.match(await page.textContent('#rateNaver'), /1 EUR = 1,471\.88원/);
  assert.match(await page.textContent('#toast'), /네이버 환율 1,471\.88원/);
  assert.match(await page.textContent('#cvNote'), /1,471\.88원 기준/, '계산기가 네이버 환율을 쓴다');
  assert.match(await page.textContent('#fxRateValue'), /1,500원/, '저장된 환율은 아직 1,500원');
  await page.fill('#cvLocal', '10');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#cvKrw'), '14,719', '네이버 환율로 계산 (10 EUR → 14,719원)');
  await shot(page, '09c-rate-naver.png');

  // 이 환율 저장 → 여행 환율로 반영
  await page.click('#view [data-act="rate-save"]');
  await page.waitForTimeout(900);
  const savedFx = (await api(`/api/trips/${tripBefore.id}`)).data;
  assert.equal(savedFx.exchangeRate, 1471.88, '여행 환율이 네이버 환율로 저장됨');
  assert.match(await page.textContent('#fxRateValue'), /1,471\.88원/);
  assert.ok(!(await page.$('#rateNaver')), '저장 뒤에는 네이버 안내 상자가 사라진다');

  // 정산 요약 배지에서도 바뀐 환율 + 배지를 누르면 환율 탭으로
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForTimeout(300);
  assert.match(await page.textContent('.summary-link'), /1 EUR = 1,471\.88원/);
  await page.click('.summary-link');
  await page.waitForSelector('#cvLocal');
  await page.waitForTimeout(250);
  assert.match(await page.getAttribute('#tabbar .tab[data-tab="rate"]', 'class'), /is-active/, '배지를 누르면 환율 탭');

  // ── 5-2. 여행 중 — 지난 일정 접기 · 오늘 일정 맨 위 ────────
  step('5-2. 여행 중 — 지난 Day 1 숨김 · 오늘 Day 2 맨 위 · 토글로 다시 보기');
  // 기기(브라우저 컨텍스트) 시간대는 Asia/Seoul — 오늘이 여행 2일차인 여행을 만든다
  const kstDate = (offset) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000));
  const liveTrip = await fetch(`${base}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '🇪🇸 여행 중 테스트', startDate: kstDate(-1), endDate: kstDate(2),
      localCurrency: 'EUR', exchangeRate: 1500, template: 'twoFamilies',
    }),
  }).then((r) => r.json());
  assert.ok(liveTrip.id, '여행 중 테스트 여행 생성');
  for (const [day, place] of [[1, '어제 다녀온 곳'], [2, '오늘 갈 곳'], [3, '내일 갈 곳']]) {
    const r = await fetch(`${base}/api/trips/${liveTrip.id}/itinerary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, time: '10:00', place }),
    });
    assert.equal(r.status, 201, `Day ${day} 일정 생성`);
  }

  await page.goto(`${base}/t/${liveTrip.code}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#tripName').textContent.includes('여행 중 테스트'));
  await page.waitForSelector('#view .day-block');
  await page.waitForTimeout(400);

  // 지난 Day 1 은 기본으로 숨고, 오늘(Day 2)이 ＋ 일정 추가하기 바로 아래 맨 위
  const visibleDays = await page.$$eval('#view .day-banner', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(visibleDays.length, 2, `보이는 날짜 블록: ${visibleDays.join(' / ')}`);
  assert.match(visibleDays[0], /^Day 2/, `오늘(Day 2)이 맨 위: ${visibleDays[0]}`);
  assert.match(visibleDays[0], /오늘/, '오늘 배지');
  assert.match(visibleDays[1], /^Day 3/, `다음 날: ${visibleDays[1]}`);
  assert.doesNotMatch(visibleDays[1], /오늘/);
  const viewNow = await page.textContent('#view');
  assert.doesNotMatch(viewNow, /어제 다녀온 곳/, '지난 일정은 기본으로 숨김');
  assert.match(viewNow, /오늘 갈 곳/);
  assert.match(viewNow, /내일 갈 곳/);
  const todayBadges = await page.$$eval('#view .day-today', (els) => els.length);
  assert.equal(todayBadges, 1, '오늘 배지는 하나');

  // ＋ 일정 추가하기 → 오늘 일정 → 내일 일정 → 맨 아래 1줄 토글 순서
  const planOrder = await page.evaluate(() => {
    const nodes = [...document.querySelector('#view').children];
    return {
      add: nodes.findIndex((n) => n.id === 'btnAdd'),
      firstDay: nodes.findIndex((n) => n.classList.contains('day-block')),
      toggle: nodes.findIndex((n) => n.classList.contains('past-toggle')),
      lastDay: nodes.map((n) => n.classList.contains('day-block')).lastIndexOf(true),
    };
  });
  assert.equal(planOrder.firstDay, planOrder.add + 1, '오늘 일정이 추가 버튼 바로 아래');
  assert.equal(planOrder.toggle, planOrder.lastDay + 1, '토글은 일정 블록 맨 아래');
  const toggle = page.locator('#view .past-toggle');
  assert.match(await toggle.textContent(), /지난 일정 1일 \(1개\)/, '지난 일정 줄 수·개수');
  assert.match(await toggle.textContent(), /보기 ▾/);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await shot(page, '09d-plan-today.png');

  // 토글 → 지난 Day 1 이 날짜 순서대로 나타난다
  await toggle.click();
  await page.waitForTimeout(350);
  const openedDays = await page.$$eval('#view .day-banner', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  assert.equal(openedDays.length, 3, `펼친 뒤 3일: ${openedDays.join(' / ')}`);
  assert.match(openedDays[0], /^Day 1/, '펼치면 Day 1 부터 날짜 순서');
  assert.match(openedDays[1], /^Day 2/);
  assert.match(await page.textContent('#view'), /어제 다녀온 곳/, '지난 일정이 다시 보인다');
  const toggleOpen = page.locator('#view .past-toggle');
  assert.match(await toggleOpen.textContent(), /접기 ▴/);
  assert.equal(await toggleOpen.getAttribute('aria-expanded'), 'true');
  await shot(page, '09e-plan-past-open.png');

  // 다시 접으면 오늘 일정만
  await toggleOpen.click();
  await page.waitForTimeout(350);
  assert.equal(await page.$$eval('#view .day-block', (els) => els.length), 2, '다시 접힘');
  assert.doesNotMatch(await page.textContent('#view'), /어제 다녀온 곳/);

  // 테스트 여행은 지워서 이후 단계(여행 개수·전환)에 영향이 없게 한다
  assert.equal((await fetch(`${base}/api/trips/${liveTrip.id}`, { method: 'DELETE' })).status, 200, '테스트 여행 삭제');

  // 여행 시작 전(스페인: 12.19~)은 기존과 동일하게 Day 1 부터 전부 보인다
  await page.goto(`${base}/t/${tripBefore.code}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#tripName').textContent.includes('스페인'));
  await page.waitForSelector('#view .day-block');
  await page.waitForTimeout(400);
  assert.match((await page.$$eval('#view .day-banner', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())))[0], /^Day 1/, '여행 전에는 Day 1 부터');
  assert.equal(await page.$$eval('#view .past-toggle', (els) => els.length), 0, '여행 전에는 지난 일정 토글 없음');
  assert.equal(await page.$$eval('#view .day-today', (els) => els.length), 0, '여행 전에는 오늘 배지 없음');
  assert.match(await page.textContent('#view'), /마드리드 바라하스 공항/, '지난 일정도 그대로 표시(시작 전)');

  // ── 6. 친구 5명 여행 ─────────────────────────
  step('6. 친구 5명 새 여행 → 5명 균등 + 3명 부분 분담 정산');
  await page.click('#btnTripSwitch');
  await page.waitForSelector('[data-act="new-trip"]');
  await shot(page, '10-trip-switch.png');
  await page.click('[data-act="new-trip"]');
  await page.waitForSelector('#ntName');
  await page.fill('#ntName', '🇯🇵 오사카 친구 여행');
  await page.fill('#ntSub', '친구 5명 우정 여행');
  await page.fill('#ntStart', '2027-01-10');
  await page.fill('#ntEnd', '2027-01-13');
  await page.selectOption('#ntCur', 'JPY');
  await page.fill('#ntRate', '9.2');
  await page.click('#ntTemplate button[data-tpl="friends"]');
  await page.waitForTimeout(200);
  await shot(page, '11-new-trip-friends.png');
  await page.click('[data-act="create-trip"]');
  await page.waitForFunction(() => document.querySelector('#tripName').textContent.includes('오사카'), null, { timeout: 15000 });
  await page.waitForTimeout(600);

  // 새 여행은 첫 탭(일정)으로 열린다 → 정산 탭에서 참여자 확인
  assert.match(await page.getAttribute('#tabbar .tab[data-tab="plan"]', 'class'), /is-active/);
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('#peopleStrip');
  await page.waitForTimeout(250);
  const friendChips = await page.$$('#peopleStrip .person-chip:not(.is-add)');
  assert.equal(friendChips.length, 5, '친구 5명 칩');
  const newTrip = (await api('/api/trips')).data.trips.find((t) => t.name.includes('오사카'));
  assert.equal(newTrip.participantCount, 5);

  // 5명 균등: 300,000원
  await page.click('#btnAdd');
  await page.waitForSelector('#exTitle');
  await page.fill('#exTitle', '료칸 2박');
  await page.fill('#exAmount', '300000');
  await page.click('#exCur button[data-val="base"]');
  await page.click('[data-act="save-expense"]');
  await page.waitForTimeout(700);

  // 3명만 부담: 택시 90,000원 (친구1,2,3)
  await page.click('#btnAdd');
  await page.fill('#exTitle', '택시');
  await page.fill('#exAmount', '90000');
  await page.click('#exCur button[data-val="base"]');
  await page.click('#exPayers .chip >> nth=1');
  await page.click('.radio[data-mode="select"]');
  await page.waitForTimeout(250);
  const selRows = await page.$$('#exExtra [data-sel]');
  assert.equal(selRows.length, 5);
  await (await selRows[3]).click();
  await (await selRows[4]).click();
  await page.waitForTimeout(250);
  await shot(page, '12-split-select.png');
  await page.click('[data-act="save-expense"]');
  await page.waitForTimeout(800);

  const friendsTrip = (await api(`/api/trips/${newTrip.id}`)).data;
  assert.equal(friendsTrip.settlement.totalKrw, 390000);
  const fNet = Object.fromEntries(friendsTrip.settlement.participants.map((p) => [p.name, p.net]));
  assert.equal(fNet['친구 1'], 210000);
  assert.equal(fNet['친구 2'], 0);
  assert.equal(fNet['친구 3'], -90000);
  assert.equal(fNet['친구 4'], -60000);
  assert.equal(fNet['친구 5'], -60000);
  assert.equal(friendsTrip.settlement.transfers.length, 3);

  const friendView = await page.textContent('#view');
  assert.match(friendView, /210,000/, '정산할 금액 210,000원');
  const transferRows = await page.$$('.transfer');
  assert.equal(transferRows.length, 3, '송금 3건');
  await shot(page, '13-friends-settle.png');

  // ── 7. 두 기기 동기화 ────────────────────────
  step('7. 두 기기 동시 사용 — 5초 안에 자동 반영');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errors.push(`page2 pageerror: ${e.message}`));
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(`page2 console: ${m.text()}`); });
  await page2.goto(`${base}/t/${friendsTrip.code}`, { waitUntil: 'networkidle' });
  await page2.waitForSelector('#tabbar');
  await page2.waitForTimeout(500);
  assert.match(await page2.textContent('#tripName'), /오사카/);
  await page2.click('#tabbar .tab[data-tab="settle"]');
  await page2.waitForSelector('.hero');
  await page2.waitForTimeout(250);
  assert.match(await page2.textContent('#view'), /390,000/);

  // 기기 2 에서 지출 추가 → 기기 1 이 폴링으로 받는다
  await page2.click('#btnAdd');
  await page2.waitForSelector('#exTitle');
  await page2.fill('#exTitle', '편의점');
  await page2.fill('#exAmount', '5000');
  await page2.click('#exCur button[data-val="base"]');
  await page2.click('[data-act="save-expense"]');
  await page2.waitForTimeout(600);

  await page.waitForFunction(() => document.querySelector('#view').textContent.includes('편의점'), null, { timeout: 12000 });
  assert.match(await page.textContent('#view'), /395,000/);
  await shot(page, '14-sync.png');
  await ctx2.close(); // 이후 PIN 잠금 단계에서 예전 기기가 401 을 받지 않도록 정리

  // ── 8. 여행 전환 복귀 ────────────────────────
  step('8. 여행 전환으로 스페인 여행 복귀');
  await page.click('#btnTripSwitch');
  await page.waitForSelector('[data-act="switch-trip"]');
  const rows = await page.$$('[data-act="switch-trip"]');
  await (await rows[rows.length - 1]).click();
  await page.waitForTimeout(800);
  assert.match(await page.textContent('#tripName'), /스페인/);
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(250);
  assert.match(await page.textContent('#view'), /김家/);

  // ── 8-1. ?trip=코드 로 바로 열기 ─────────────
  step('8-1. ?trip=코드 링크로 바로 열기');
  await page.goto(`${base}/?trip=${friendsTrip.code}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.waitForFunction(() => document.querySelector('#tripName').textContent.includes('오사카'));
  await page.click('#tabbar .tab[data-tab="settle"]');
  await page.waitForSelector('.hero');
  await page.waitForTimeout(250);
  assert.match(await page.textContent('#view'), /395,000/, '링크로 연 여행의 총 지출');

  // ── 9. PWA ───────────────────────────────────
  step('9. PWA · 홈 화면 추가 준비 상태');
  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  assert.equal(manifestHref, '/manifest.webmanifest');
  const iconHref = await page.getAttribute('link[rel="apple-touch-icon"]', 'href');
  assert.equal(iconHref, '/icons/apple-touch-icon.png');
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      return reg ? 'registered' : 'none';
    } catch (e) { return 'error: ' + e.message; }
  });
  assert.equal(swReady, 'registered');
  // 오프라인용 프리캐시에 나눔스퀘어라운드 폰트가 실제로 들어갔는지
  const precachedFonts = await page.evaluate(async () => {
    for (let i = 0; i < 30; i++) {
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        const paths = (await cache.keys()).map((r) => new URL(r.url).pathname);
        if (paths.includes('/fonts/NanumSquareRoundR.woff2') && paths.includes('/fonts/NanumSquareRoundB.woff2')) {
          return { cache: key, paths: paths.filter((p) => p.startsWith('/fonts/')) };
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  });
  assert.ok(precachedFonts, '폰트 프리캐시 없음 (오프라인 로드 불가)');
  assert.equal(precachedFonts.cache, 'trip-helper-v12', `캐시 버전: ${precachedFonts.cache}`);
  console.log(`   프리캐시: ${precachedFonts.cache} → ${precachedFonts.paths.join(', ')}`);
  const viewport = await page.getAttribute('meta[name="viewport"]', 'content');
  assert.match(viewport, /viewport-fit=cover/);
  assert.match(viewport, /maximum-scale=1/);

  // ── 9-1. 마지막 여행 삭제 → 새 여행 안내 ─────
  step('9-1. 여행을 모두 지우면 새 여행 안내');
  for (let i = 0; i < 2; i++) {
    await page.click('#tabbar .tab[data-tab="settings"]');
    await page.waitForSelector('[data-act="delete-trip"]');
    await page.click('[data-act="delete-trip"]');
    await page.waitForSelector('[data-act="confirm-yes"]');
    await page.click('[data-act="confirm-yes"]');
    await page.waitForTimeout(900);
  }
  const left = (await api('/api/trips')).data.trips.length;
  assert.equal(left, 0, '모든 여행이 삭제됨');
  await page.waitForSelector('#ntName', { timeout: 8000 });
  assert.match(await page.textContent('#sheetTitle'), /새 여행/);

  // ── 10. 4자리 입장 비밀번호 잠금 ─────────────
  // (테스트 서버에만 설정 — 실제 서비스 비밀번호와 무관한 임의 숫자)
  step('10. 4자리 PIN 잠금 화면 · 한 번 입력하면 기억');
  const TEST_PIN = '5729';
  const TEST_PIN_NEW = '8314';
  assert.equal(await page.evaluate(() => localStorage.getItem('trip-helper:pin-token')), null);

  const setupRes = await fetch(`${base}/api/pin/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: TEST_PIN }),
  });
  assert.equal(setupRes.status, 200, 'PIN 설정');
  const setupBody = await setupRes.json();
  assert.equal(setupBody.locked, true);

  // 설정 전에 열어 둔 기기도, 새로 열면 잠금 화면이 뜼다
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#lockScreen.is-open');
  assert.match(await page.textContent('#lockScreen'), /비밀번호 4자리/);
  assert.equal(await page.$$eval('#lockScreen .lock-dot', (els) => els.length), 4, '4자리 도트');
  assert.equal(await page.$$eval('#lockScreen .lock-key[data-key]', (els) => els.length), 11, '0~9 + 지우기 키');
  await shot(page, '15-lock.png');

  // 인증 없이 API 는 401
  const anon = await fetch(`${base}/api/trips`);
  assert.equal(anon.status, 401);

  // 틀린 비밀번호 → 안내 + 입력 초기화
  for (const d of '0000') await page.click(`#lockPad [data-key="${d}"]`);
  await page.waitForSelector('#lockMsg.is-err');
  assert.match(await page.textContent('#lockMsg'), /비밀번호가 맞지 않아요/);
  await page.waitForTimeout(200);
  assert.equal(await page.$$eval('#lockDots .lock-dot.is-on', (els) => els.length), 0, '틀리면 다시 비움');
  assert.match(await page.getAttribute('#lockScreen', 'class'), /is-open/);
  await shot(page, '16-lock-wrong.png');

  // 지우기 키도 동작
  for (const d of '12') await page.click(`#lockPad [data-key="${d}"]`);
  assert.equal(await page.$$eval('#lockDots .lock-dot.is-on', (els) => els.length), 2);
  await page.click('#lockPad [data-key="del"]');
  assert.equal(await page.$$eval('#lockDots .lock-dot.is-on', (els) => els.length), 1);
  await page.click('#lockPad [data-key="del"]');

  // 맞는 비밀번호 → 바로 열리고 토큰을 저장한다
  for (const d of TEST_PIN) await page.click(`#lockPad [data-key="${d}"]`);
  await page.waitForFunction(() => !document.querySelector('#lockScreen').classList.contains('is-open'), null, { timeout: 10000 });
  const storedToken = await page.evaluate(() => localStorage.getItem('trip-helper:pin-token'));
  assert.ok(storedToken && storedToken.startsWith('p1.'), 'localStorage 에 토큰 저장');
  const authed = await fetch(`${base}/api/trips`, { headers: { 'X-Trip-Pin-Token': storedToken } });
  assert.equal(authed.status, 200, '토큰으로 API 통과');

  // 다음에 다시 열어도 묻지 않는다 (localStorage 토큰)
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.waitForTimeout(700);
  assert.ok(!(await page.getAttribute('#lockScreen', 'class')).includes('is-open'), '재접속 시 잠금 화면 없음');

  // ── 11. 설정 탭에서 입장 비밀번호 변경 ────────
  step('11. 설정 탭 — 입장 비밀번호 변경 (기존 기기 토큰 무효)');
  const seeded = await fetch(`${base}/api/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Trip-Pin-Token': storedToken },
    body: JSON.stringify({ name: '잠금 테스트 여행', startDate: '2027-03-01', endDate: '2027-03-03', localCurrency: 'EUR', exchangeRate: 1500, template: 'twoFamilies' }),
  }).then((r) => r.json());
  assert.ok(seeded.id);
  await page.goto(`${base}/t/${seeded.code}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tabbar');
  await page.click('#tabbar .tab[data-tab="settings"]');
  await page.waitForSelector('#stPinCur');
  assert.match(await page.textContent('#view'), /입장 비밀번호/);
  await page.locator('#stPinCur').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shot(page, '17-settings-pin.png');

  await page.fill('#stPinCur', TEST_PIN);
  await page.fill('#stPinNew', TEST_PIN_NEW);
  await page.click('#view [data-act="change-pin"]');
  await page.waitForTimeout(900);
  assert.match(await page.textContent('#toast'), /입장 비밀번호를 바꿨어요/);
  const tokenAfterChange = await page.evaluate(() => localStorage.getItem('trip-helper:pin-token'));
  assert.ok(tokenAfterChange && tokenAfterChange !== storedToken, '새 토큰으로 교체');

  // 예전 토큰은 즉시 무효 → 다른 기기는 다시 잠금다
  assert.equal((await fetch(`${base}/api/trips`, { headers: { 'X-Trip-Pin-Token': storedToken } })).status, 401);
  const otherCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const otherPage = await otherCtx.newPage();
  await otherPage.goto(`${base}/t/${seeded.code}`, { waitUntil: 'networkidle' });
  await otherPage.waitForSelector('#lockScreen.is-open');
  for (const d of TEST_PIN) await otherPage.click(`#lockPad [data-key="${d}"]`);
  await otherPage.waitForSelector('#lockMsg.is-err');
  assert.match(await otherPage.textContent('#lockMsg'), /비밀번호가 맞지 않아요/, '바꾼 뒤에는 예전 비밀번호 불가');
  for (const d of TEST_PIN_NEW) await otherPage.click(`#lockPad [data-key="${d}"]`);
  await otherPage.waitForFunction(() => document.querySelector('#tripName').textContent.includes('잠금 테스트'), null, { timeout: 10000 });
  assert.ok(!(await otherPage.getAttribute('#lockScreen', 'class')).includes('is-open'), '새 비밀번호로 열림');
  await otherPage.screenshot({ path: path.join(SHOT_DIR, '18-lock-new-pin.png') });
  await otherCtx.close();

  // ── 12. 콘솔 오류 ────────────────────────────
  step('12. 콘솔 오류 확인');
  // 잠금 테스트에서 일부러 틀린 비밀번호를 넣어 생기는 401 네트워크 로그는 앱 오류가 아니므로 제외
  const realErrors = errors.filter((e) => !/favicon\.ico|Failed to load resource: the server responded with a status of (404|401)/i.test(e));
  assert.deepEqual(realErrors, [], `콘솔 오류: ${realErrors.join(' | ')}`);

  await browser.close();
  console.log(`\n✅ 모든 UI 테스트 통과 (${steps.length}단계)`);
  console.log(`스크린샷: ${SHOT_DIR}`);
}

run()
  .catch(async (err) => {
    console.error('\n❌ UI 테스트 실패:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { if (browser) await browser.close(); } catch { /* 이미 닫힘 */ }
    if (server) server.kill();
    if (fxServer) fxServer.close();
  });
