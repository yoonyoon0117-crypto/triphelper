'use strict';
/**
 * 일정 텍스트 파서 테스트 — 실제 스페인 일정 원문 + 간단한 Day/1일차/날짜 형식.
 *   node --test test/itinerary-parser.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseItinerary } = require('../lib/itinerary-parser');

const SPAIN = fs.readFileSync(path.join(__dirname, 'fixtures', 'spain-itinerary.txt'), 'utf8');
const SPAIN_TRIP = { startDate: '2026-12-26', endDate: '2027-01-02' };

const find = (items, time, placePart) => items.find((it) => it.time === time && it.place.includes(placePart));

test('자유 형식 일정 원문 — 일차·시간·장소·메모로 나뉜다 (스페인 일정 형식)', () => {
  const { items, stats } = parseItinerary(SPAIN, SPAIN_TRIP);

  assert.ok(items.length >= 40, `일정이 충분히 나뉜다: ${items.length}개`);
  assert.equal(stats.count, items.length);
  assert.deepEqual(stats.days, [1, 2, 3, 4, 5, 6, 7, 8], `여행 8일에 모두 걸친다: ${stats.days.join(',')}`);

  // 1일차 — 날짜 표기 없이 시작해도 첫날로 잡히고, 시간은 줄 앞의 07:25
  const flight = items.find((it) => it.time === '07:25');
  assert.ok(flight, '07:25 항공편 줄');
  assert.equal(flight.day, 1);
  assert.match(flight.place, /마드리드/, `항공편 장소: ${flight.place}`);
  assert.match(flight.memo, /일행 14:45 도착/, '괄호 안 도착 시각은 메모로');
  assert.match(flight.memo, /Apartments Madrid/, '바로 아래 들여쓴 줄은 메모로');

  // `ㅁ 12/27(일)` → 여행 시작일(12/26) 기준 2일차
  const train = find(items, '09:15', '톨레도');
  assert.ok(train, '09:15 톨레도행 기차');
  assert.equal(train.day, 2, '12/27 은 2일차');
  assert.equal(train.place, '마드리드 → 톨레도', `이동 표기: ${train.place}`);

  // `10:00~12:00 구시가지 관광` → 시작 시간 + 장소, 하위 불릿은 메모
  const oldTown = find(items, '10:00', '구시가지');
  assert.ok(oldTown);
  assert.equal(oldTown.day, 2);
  assert.equal(oldTown.place, '구시가지 관광');
  assert.match(oldTown.memo, /소코도베르 광장/);
  assert.match(oldTown.memo, /전망대 → 다리 → 광장/, '화살표는 → 로 정리');

  // `ㅇ 저녁식사 19:00~ @Restaurante Sol` → @ 뒤 이름이 장소, 앞 문구는 메모
  const dinner = find(items, '19:00', 'Restaurante Sol');
  assert.ok(dinner, '19:00 Restaurante Sol');
  assert.equal(dinner.memo.split('\n')[0], '저녁식사');
  assert.match(dinner.memo, /프라도/);
  const dinner2 = find(items, '19:15', 'Restaurante Luna');
  assert.ok(dinner2, '19:15 Restaurante Luna');

  // `12/28` 3일차 — 이동 + 바르셀로나 항목은 지역 태그가 바르셀로나
  const move = items.find((it) => it.day === 3 && it.place.includes('마드리드 → 바르셀로나'));
  assert.ok(move, '12/28 마드리드 → 바르셀로나');
  const palau = find(items, '10:00', '왕궁 투어');
  assert.equal(palau.day, 3, '10:00~12:30 다음 줄 `- 왕궁 투어` 가 그 시간을 이어받는다');
  assert.equal(palau.region, '', '12/28 은 마드리드·바르셀로나 두 도시라 지역 태그를 붙이지 않는다');

  // `1/1` · `1/2` — 해가 바뀌어도 일차가 이어진다
  const chocolate = items.find((it) => it.place.includes('초콜릿 박물관'));
  assert.equal(chocolate.day, 7, '1/1 은 7일차');
  assert.equal(chocolate.region, '바르셀로나');
  const backHome = find(items, '15:30', '두바이');
  assert.equal(backHome.day, 8, '1/2 은 8일차');
  assert.equal(backHome.place, '바르셀로나 → 두바이');
  assert.match(backHome.memo, /6시간 30분/);

  // `-----바르셀로나 주요 컨텐츠-----` 참고 메모 구역은 일정으로 넣지 않는다
  assert.ok(!items.some((it) => it.place.startsWith('몬주익 언덕')), '참고 메모 구역은 건너뛴다');
  assert.ok(stats.noteLines >= 4, `참고 메모 줄 수: ${stats.noteLines}`);
});

test('간단한 `Day 1 10:00 …` 형식', () => {
  const { items } = parseItinerary(
    ['Day 1 10:00 프라도 미술관', '  - 예약 10:00, 아이들은 무료', 'Day 2 09:30 구엘 공원', '  사전 예약 필요', '13:00 점심 @La Boqueria'].join('\n'),
    SPAIN_TRIP
  );
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => [i.day, i.time, i.place]), [
    [1, '10:00', '프라도 미술관'],
    [2, '09:30', '구엘 공원'],
    [2, '13:00', 'La Boqueria'],
  ]);
  assert.match(items[0].memo, /예약 10:00/, '일차 줄에 붙은 일정의 하위 불릿은 그 일정 메모로');
  assert.equal(items[1].memo, '사전 예약 필요');
  assert.equal(items[2].memo, '점심');
});

test('`1일차` 형식과 날짜 없는 메모', () => {
  const { items } = parseItinerary(
    ['1일차', '  09:00 호텔 조식', '  - 근처 산책', '  14:00 시내 투어', '2일차', '  10:00 박물관'].join('\n'),
    SPAIN_TRIP
  );
  assert.deepEqual(items.map((i) => [i.day, i.time, i.place]), [
    [1, '09:00', '호텔 조식'],
    [1, '', '근처 산책'],
    [1, '14:00', '시내 투어'],
    [2, '10:00', '박물관'],
  ]);
  assert.equal(items[0].memo, '');
});

test('`12월 27일` · `2026-12-27` 날짜 표기도 일차로 계산', () => {
  const month = parseItinerary('12월 27일\n10:00~12:00 구시가지 관광\n12월 28일\n09:15 마드리드 -> 톨레도', SPAIN_TRIP);
  assert.deepEqual(month.items.map((i) => i.day), [2, 3]);

  const iso = parseItinerary('2026-12-27 09:00 기차', SPAIN_TRIP);
  assert.equal(iso.items[0].day, 2);
  assert.equal(iso.items[0].time, '09:00');
  assert.equal(iso.items[0].place, '기차');
});

test('여행 기간을 벗어난 날짜는 1~총일수로 보정', () => {
  const before = parseItinerary('12/20 10:00 출발', SPAIN_TRIP);
  assert.equal(before.items[0].day, 1, '시작 전 날짜는 1일차로');

  const after = parseItinerary('3/15 10:00 너무 먼 날', SPAIN_TRIP);
  assert.equal(after.items[0].day, 8, '끝난 뒤 날짜는 마지막 날로');

  const day99 = parseItinerary('Day 99 10:00 엉뚱한 날', SPAIN_TRIP);
  assert.equal(day99.items[0].day, 8);
});

test('시작일이 없으면 첫 날짜를 1일차로 세고, 없으면 모두 1일차', () => {
  const dated = parseItinerary('12/27 10:00 구시가지\n12/28 09:00 기차', {});
  assert.deepEqual(dated.items.map((i) => i.day), [1, 2]);

  const plain = parseItinerary('그냥 메모\n아무 일정', {});
  assert.deepEqual(plain.items.map((i) => i.day), [1, 1]);
});

test('지역 태그 — 장소·메모의 도시 이름, 없으면 빈 문자열', () => {
  const out = parseItinerary('Day 1 10:00 도쿄 타워\nDay 2 11:00 점심 @이치란 라멘\nDay 3 12:00 산책', { startDate: '2027-04-01', endDate: '2027-04-04' });
  assert.equal(out.items[0].region, '도쿄');
  assert.equal(out.items[1].region, '');
  assert.equal(out.items[2].region, '');
});

test('빈 입력·이상한 입력에도 던지지 않는다', () => {
  for (const text of ['', '   ', '\n\n\n', null, undefined]) {
    const out = parseItinerary(text, SPAIN_TRIP);
    assert.equal(out.items.length, 0, `${JSON.stringify(text)} → 0개`);
  }
  const long = parseItinerary('Day 1 10:00 장소\n'.repeat(4000), SPAIN_TRIP);
  assert.ok(long.items.length > 0 && long.items.length <= 300, `상한 300개: ${long.items.length}`);
});

test('장소·메모는 저장 스키마 길이 안으로 다듬어진다', () => {
  const { items } = parseItinerary(`Day 1 10:00 ${'아주긴장소이름'.repeat(20)}\n  - ${'메모'.repeat(400)}`, SPAIN_TRIP);
  assert.ok(items[0].place.length <= 80, `장소 ${items[0].place.length}자`);
  assert.ok(items[0].memo.length <= 500, `메모 ${items[0].memo.length}자`);
});
