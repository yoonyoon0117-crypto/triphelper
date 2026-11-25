'use strict';
/**
 * 일정 텍스트 파서 테스트 — 가상 샘플 일정 원문 + 간단한 Day/1일차/날짜 형식.
 *   node --test test/itinerary-parser.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseItinerary } = require('../lib/itinerary-parser');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-itinerary.txt'), 'utf8');
const SAMPLE_TRIP = { startDate: '2027-05-01', endDate: '2027-05-08' };

const find = (items, time, placePart) => items.find((it) => it.time === time && it.place.includes(placePart));

test('자유 형식 일정 원문 — 일차·시간·장소·메모로 나뉜다 (가상 샘플 일정 형식)', () => {
  const { items, stats } = parseItinerary(SAMPLE, SAMPLE_TRIP);

  assert.ok(items.length >= 40, `일정이 충분히 나뉜다: ${items.length}개`);
  assert.equal(stats.count, items.length);
  assert.deepEqual(stats.days, [1, 2, 3, 4, 5, 6, 7, 8], `여행 8일에 모두 걸친다: ${stats.days.join(',')}`);

  // 1일차 — 날짜 표기 없이 시작해도 첫날로 잡히고, 시간은 줄 앞의 10:20
  const flight = items.find((it) => it.time === '10:20');
  assert.ok(flight, '10:20 항공편 줄');
  assert.equal(flight.day, 1);
  assert.match(flight.place, /도쿄/, `항공편 장소: ${flight.place}`);
  assert.match(flight.memo, /일행 13:40 도착/, '괄호 안 도착 시각은 메모로');
  assert.match(flight.memo, /Aoi Stay 아사쿠사/, '바로 아래 들여쓴 줄은 메모로');

  // `ㅁ 5/2(일)` → 여행 시작일(5/1) 기준 2일차
  const train = find(items, '09:15', '하코네');
  assert.ok(train, '09:15 하코네행 기차');
  assert.equal(train.day, 2, '5/2 는 2일차');
  assert.equal(train.place, '도쿄 → 하코네', `이동 표기: ${train.place}`);

  // `10:30~12:00 호수 주변 산책` → 시작 시간 + 장소, 하위 불릿은 메모
  const walk = find(items, '10:30', '호수 주변 산책');
  assert.ok(walk);
  assert.equal(walk.day, 2);
  assert.equal(walk.place, '호수 주변 산책');
  assert.match(walk.memo, /전망 광장/);
  assert.match(walk.memo, /정자 → 다리 → 광장/, '화살표는 → 로 정리');

  // `ㅇ 저녁식사 19:00~ @Kaze Shokudo` → @ 뒤 이름이 장소, 앞 문구는 메모
  const dinner = find(items, '19:00', 'Kaze Shokudo');
  assert.ok(dinner, '19:00 Kaze Shokudo');
  assert.equal(dinner.memo.split('\n')[0], '저녁식사');
  assert.match(dinner.memo, /미술관/);
  const dinner2 = find(items, '19:15', 'Midori Cafe');
  assert.ok(dinner2, '19:15 Midori Cafe');

  // `5/3` 3일차 — 이동 + 두 도시가 걸친 날은 지역 태그를 붙이지 않는다
  const move = items.find((it) => it.day === 3 && it.place.includes('도쿄 → 교토 이동'));
  assert.ok(move, '5/3 도쿄 → 교토 이동');
  const palace = find(items, '10:00', '옛 궁전 정원 투어');
  assert.equal(palace.day, 3, '10:00~12:30 다음 줄 `- 옛 궁전 정원 투어` 가 그 시간을 이어받는다');
  assert.equal(palace.region, '', '5/3 은 도쿄·교토 두 도시라 지역 태그를 붙이지 않는다');

  // 5/7 · 5/8 — 마지막 이틀도 일차가 이어진다
  const sweets = items.find((it) => it.place.includes('과자 박물관'));
  assert.equal(sweets.day, 7, '5/7 은 7일차');
  assert.equal(sweets.region, '교토');
  const backHome = find(items, '15:30', '도쿄');
  assert.equal(backHome.day, 8, '5/8 은 8일차');
  assert.equal(backHome.place, '교토 → 도쿄');
  assert.match(backHome.memo, /5시간 20분/);

  // `-----교토 주요 컨텐츠-----` 참고 메모 구역은 일정으로 넣지 않는다
  assert.ok(!items.some((it) => `${it.place} ${it.memo}`.includes('조명 쇼')), '참고 메모 구역은 건너뛴다');
  assert.ok(!items.some((it) => it.place.startsWith('아이들용')), '참고 메모 구역은 건너뛴다');
  assert.ok(stats.noteLines >= 4, `참고 메모 줄 수: ${stats.noteLines}`);
});

test('연말·연초 날짜도 일차가 이어진다', () => {
  const { items } = parseItinerary(
    ['12/31 10:00 출발 준비', '1/1 09:00 새해 첫 일정', '1/2 18:00 집으로'].join('\n'),
    { startDate: '2026-12-31', endDate: '2027-01-02' }
  );
  assert.deepEqual(items.map((i) => i.day), [1, 2, 3]);
  assert.deepEqual(items.map((i) => i.time), ['10:00', '09:00', '18:00']);
});

test('간단한 `Day 1 10:00 …` 형식', () => {
  const { items } = parseItinerary(
    ['Day 1 10:00 동네 미술관', '  - 예약 10:00, 아이들은 무료', 'Day 2 09:30 호수 공원', '  사전 예약 필요', '13:00 점심 @마루 상점가'].join('\n'),
    SAMPLE_TRIP
  );
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => [i.day, i.time, i.place]), [
    [1, '10:00', '동네 미술관'],
    [2, '09:30', '호수 공원'],
    [2, '13:00', '마루 상점가'],
  ]);
  assert.match(items[0].memo, /예약 10:00/, '일차 줄에 붙은 일정의 하위 불릿은 그 일정 메모로');
  assert.equal(items[1].memo, '사전 예약 필요');
  assert.equal(items[2].memo, '점심');
});

test('`1일차` 형식과 날짜 없는 메모', () => {
  const { items } = parseItinerary(
    ['1일차', '  09:00 호텔 조식', '  - 근처 산책', '  14:00 시내 투어', '2일차', '  10:00 박물관'].join('\n'),
    SAMPLE_TRIP
  );
  assert.deepEqual(items.map((i) => [i.day, i.time, i.place]), [
    [1, '09:00', '호텔 조식'],
    [1, '', '근처 산책'],
    [1, '14:00', '시내 투어'],
    [2, '10:00', '박물관'],
  ]);
  assert.equal(items[0].memo, '');
});

test('`5월 2일` · `2027-05-02` 날짜 표기도 일차로 계산', () => {
  const month = parseItinerary('5월 2일\n10:30~12:00 호수 주변 산책\n5월 3일\n09:15 도쿄 -> 하코네', SAMPLE_TRIP);
  assert.deepEqual(month.items.map((i) => i.day), [2, 3]);

  const iso = parseItinerary('2027-05-02 09:00 기차', SAMPLE_TRIP);
  assert.equal(iso.items[0].day, 2);
  assert.equal(iso.items[0].time, '09:00');
  assert.equal(iso.items[0].place, '기차');
});

test('여행 기간을 벗어난 날짜는 1~총일수로 보정', () => {
  const before = parseItinerary('4/20 10:00 출발', SAMPLE_TRIP);
  assert.equal(before.items[0].day, 1, '시작 전 날짜는 1일차로');

  const after = parseItinerary('9/15 10:00 너무 먼 날', SAMPLE_TRIP);
  assert.equal(after.items[0].day, 8, '끝난 뒤 날짜는 마지막 날로');

  const day99 = parseItinerary('Day 99 10:00 엉뚱한 날', SAMPLE_TRIP);
  assert.equal(day99.items[0].day, 8);
});

test('시작일이 없으면 첫 날짜를 1일차로 세고, 없으면 모두 1일차', () => {
  const dated = parseItinerary('5/2 10:00 시장 골목\n5/3 09:00 기차', {});
  assert.deepEqual(dated.items.map((i) => i.day), [1, 2]);

  const plain = parseItinerary('그냥 메모\n아무 일정', {});
  assert.deepEqual(plain.items.map((i) => i.day), [1, 1]);
});

test('지역 태그 — 장소·메모의 도시 이름, 없으면 빈 문자열', () => {
  const out = parseItinerary('Day 1 10:00 도쿄 시내 산책\nDay 2 11:00 점심 @마루 상점가\nDay 3 12:00 산책', { startDate: '2027-04-01', endDate: '2027-04-04' });
  assert.equal(out.items[0].region, '도쿄');
  assert.equal(out.items[1].region, '');
  assert.equal(out.items[2].region, '');
});

test('빈 입력·이상한 입력에도 던지지 않는다', () => {
  for (const text of ['', '   ', '\n\n\n', null, undefined]) {
    const out = parseItinerary(text, SAMPLE_TRIP);
    assert.equal(out.items.length, 0, `${JSON.stringify(text)} → 0개`);
  }
  const long = parseItinerary('Day 1 10:00 장소\n'.repeat(4000), SAMPLE_TRIP);
  assert.ok(long.items.length > 0 && long.items.length <= 300, `상한 300개: ${long.items.length}`);
});

test('장소·메모는 저장 스키마 길이 안으로 다듬어진다', () => {
  const { items } = parseItinerary(`Day 1 10:00 ${'아주긴장소이름'.repeat(20)}\n  - ${'메모'.repeat(400)}`, SAMPLE_TRIP);
  assert.ok(items[0].place.length <= 80, `장소 ${items[0].place.length}자`);
  assert.ok(items[0].memo.length <= 500, `메모 ${items[0].memo.length}자`);
});
