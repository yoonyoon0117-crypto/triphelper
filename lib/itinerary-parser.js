'use strict';
/**
 * 일정 텍스트 파서 — 메모장·카톡에 자유롭게 적어 둔 여행 일정을
 * 일차 · 시간 · 장소 · 메모로 나눈다. (브라우저 `window.ItineraryParser` / 서버 `require` 공용)
 *
 *   const { parseItinerary } = require('./lib/itinerary-parser');
 *   parseItinerary(text, { startDate: '2026-12-26', endDate: '2027-01-02' })
 *     → { items: [{ day, time, place, region, memo, title }], stats: { count, days, skipped } }
 *
 * 알아보는 표기
 *   · 일차: `Day 1`, `1일차`, `12/27`, `12월 27일`, `2026-12-27` (여행 시작일 기준으로 일차 계산, 범위 밖은 보정)
 *   · 시간: `09:15`, `10:00~12:00`, `19:00~`, `# 09:15 -> 09:49`, `오후 7시`, `10시 30분`
 *   · 장소: 줄의 본문, `@장소`, `마드리드 -> 톨레도` 같은 이동 표기
 *   · 메모: 더 들여쓴 줄 · 하위 불릿(`-`, `*`, `·`) · `: 부연` · 괄호 설명
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ItineraryParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_TEXT = 20000; // 붙여넣기 본문 상한(서버 body 200kb 안)
  const MAX_ITEMS = 300;
  const MAX_PLACE = 80; // 일정 스키마의 장소 길이 제한
  const SOFT_PLACE = 40; // 카드에서 읽기 좋은 길이 — 넘치면 메모로
  const MAX_MEMO = 500;

  // 지역 태그로 쓸 도시 이름 (긴 이름을 먼저 검사해 부분 일치를 피한다)
  const CITIES = [
    // 스페인 · 포르투갈
    '마드리드', '바르셀로나', '톨레도', '세고비아', '아빌라', '사라고사', '지로나', '피게레스', '몬세라트',
    '시체스', '타라고나', '발렌시아', '세비야', '그라나다', '코르도바', '말라가', '론다', '빌바오',
    '산세바스티안', '산티아고데콤포스텔라', '산티아고', '팔마', '이비자', '테네리페', '란사로테',
    '리스본', '포르투', '신트라', '카스카이스', '파루',
    // 일본
    '도쿄', '오사카', '교토', '고베', '오카야마', '히로시마', '후쿠오카', '구마모토', '가고시마',
    '나가사키', '삿포로', '오타루', '하코다테', '아사히카와', '오키나와', '나하', '이시가키', '미야코',
    '나고야', '가나자와', '다카야마', '시라카와고', '마쓰모토', '니가타', '요코하마', '가마쿠라',
    '하코네', '닛코', '센다이', '아오모리', '벳푸', '유후인', '구로카와',
    // 중국 · 대만 · 홍콩
    '베이징', '상하이', '항저우', '쑤저우', '시안', '청두', '충칭', '광저우', '선전',
    '홍콩', '마카오', '타이베이', '타이중', '가오슝', '화롄', '지우펀', '예류',
    // 동남아 · 남아시아
    '방콕', '치앙마이', '치앙라이', '푸켓', '끄라비', '파타야', '코사무이', '아유타야',
    '하노이', '호이안', '다낭', '호치민', '하롱', '사파', '나트랑', '달랏', '푸꾸옥',
    '씨엠립', '프놈펜', '비엔티안', '루앙프라방', '양곤', '바간',
    '싱가포르', '쿠알라룸푸르', '페낭', '코타키나발루', '발리', '자카르타', '욕야카르타',
    '세부', '보라카이', '마닐라', '팔라완', '엘니도', '코론',
    // 유럽
    '파리', '니스', '마르세유', '리옹', '보르도', '스트라스부르', '몽생미셸', '아비뇽',
    '런던', '에든버러', '맨체스터', '옥스퍼드', '케임브리지', '더블린',
    '로마', '밀라노', '베네치아', '피렌체', '나폴리', '폼페이', '소렌토', '카프리',
    '시에나', '피사', '베로나', '토리노', '볼로냐', '팔레르모',
    '암스테르담', '로테르담', '헤이그', '브뤼셀', '브뤼헤', '룩셈부르크',
    '베를린', '뮌헨', '함부르크', '쾰른', '프랑크푸르트', '하이델베르크', '로텐부르크',
    '잘츠부르크', '비엔나', '할슈타트', '인스브루크',
    '취리히', '루체른', '인터라켄', '그린델발트', '베른', '제네바', '체르마트',
    '프라하', '체스키크롬로프', '부다페스트', '크라쿠프', '바르샤바', '브라티슬라바',
    '류블랴나', '자그레브', '두브로브니크', '스플리트', '아테네', '산토리니', '미코노스',
    '이스탄불', '카파도키아',
    '코펜하겐', '스톡홀름', '오슬로', '헬싱키', '레이캬비크', '베르겐', '트롬쇠', '로바니에미',
    // 아메리카 · 오세아니아 · 중동 · 아프리카
    '뉴욕', '보스턴', '워싱턴', '필라델피아', '시카고', '마이애미', '올랜도', '뉴올리언스',
    '라스베이거스', '로스앤젤레스', '샌프란시스코', '샌디에이고', '시애틀', '포틀랜드', '덴버',
    '하와이', '호놀룰루', '마우이', '밴쿠버', '토론토', '몬트리올', '캘거리',
    '멕시코시티', '칸쿤', '하바나', '리마', '쿠스코', '부에노스아이레스', '리우데자네이루', '상파울루',
    '시드니', '멜버른', '브리즈번', '골드코스트', '케언즈', '오클랜드', '퀸스타운',
    '두바이', '아부다비', '도하', '리야드', '텔아비브', '예루살렘',
    '카이로', '룩소르', '마라케시', '카사블랑카', '케이프타운', '요하네스버그', '나이로비', '잔지바르',
    '몰디브', '말레',
  ].sort((a, b) => b.length - a.length);

  const pad2 = (n) => String(n).padStart(2, '0');

  // ── 문자열 정리 ──────────────────────────────────────────
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u00a0\u200b\u200c\ufeff]/g, ' ')
      .replace(/[：]/g, ':')
      .replace(/[～〜]/g, '~')
      .replace(/[－–—]/g, '-')
      .replace(/[➡⇒]/g, '→')
      .replace(/＞/g, '>')
      .replace(/＜/g, '<');
  }

  // 괄호 안은 공백으로 가려 둔다 — `(일행 14:45 도착)` 같은 시간을 일정 시간으로 쓰지 않게.
  function maskParens(line) {
    let out = '';
    let depth = 0;
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') { depth += 1; out += ' '; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); out += ' '; continue; }
      out += depth > 0 ? ' ' : ch;
    }
    return out;
  }

  const BULLET = /^(?:[-*+•·▪◦▶▷◆◇>]|ㅇ|ㅁ|□|■|#+|\d{1,2}[.)])\s*/;

  function stripLead(s) {
    let out = String(s == null ? '' : s).trim();
    for (let i = 0; i < 3; i += 1) {
      const next = out.replace(BULLET, '');
      if (next === out) break;
      out = next;
    }
    return out.trim();
  }

  const isDivider = (s) => /^[-=_~]{3,}/.test(s) || /[-=_~]{3,}\s*$/.test(s) && /^[-=_~]/.test(s);
  const isTitleLine = (s) => /^<[^>]*>$/.test(s);
  const isSectionLabel = (s) => /^\[[^\]]*\]$/.test(s);
  const isParenOnly = (s) => /^\([^()]*\)[,.]?$/.test(s);

  // ── 시간 ─────────────────────────────────────────────────
  function findTimes(line, mask) {
    const out = [];
    const colon = /(\d{1,2})\s*:\s*(\d{2})/g;
    let m = colon.exec(mask);
    while (m) {
      const h = Number(m[1]);
      const mi = Number(m[2]);
      if (h < 24 && mi < 60) out.push({ start: m.index, end: m.index + m[0].length, time: `${pad2(h)}:${pad2(mi)}` });
      m = colon.exec(mask);
    }
    if (out.length) return out;

    // `10시 30분`, `오후 7시` — 콜론 표기가 하나도 없을 때만 (숫자를 잘못 시간으로 읽지 않게)
    const korean = /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/g;
    m = korean.exec(mask);
    while (m) {
      let h = Number(m[1]);
      const mi = m[2] ? Number(m[2]) : 0;
      if (h < 24 && mi < 60) {
        const before = mask.slice(Math.max(0, m.index - 4), m.index);
        if (/오후|저녁|밤/.test(before) && h < 12) h += 12;
        out.push({ start: m.index, end: m.index + m[0].length, time: `${pad2(h)}:${pad2(mi)}` });
      }
      m = korean.exec(mask);
    }
    return out;
  }

  function removeTimes(line, times) {
    let out = line;
    for (let i = times.length - 1; i >= 0; i -= 1) {
      out = `${out.slice(0, times[i].start)} ${out.slice(times[i].end)}`;
    }
    // `09:15 -> 09:49` 처럼 시간 사이를 잇던 표시는 남기지 않는다.
    return out.replace(/\s*[~∼]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ── 날짜 · 일차 ──────────────────────────────────────────
  const DAY_HEAD = /^(?:day\s*(\d{1,2})(?:\s*일차)?|(\d{1,2})\s*일차)(?![가-힣\d])/i;
  const DATE_HEADS = [
    /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})(?:\s*\(([일월화수목금토])\))?/,
    /^(\d{1,2})\s*[/.]\s*(\d{1,2})(?:\s*\(([일월화수목금토])\))?(?!\d)/,
    /^(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*\(([일월화수목금토])\))?/,
  ];

  function dayDiff(y1, m1, d1, y2, m2, d2) {
    return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000) + 1;
  }

  function isoParts(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function makeContext(options) {
    const start = isoParts(options.startDate);
    const end = isoParts(options.endDate);
    let totalDays = 60;
    if (start && end) {
      totalDays = Math.min(60, Math.max(1, dayDiff(end.y, end.m, end.d, start.y, start.m, start.d)));
    }
    return {
      startY: start ? start.y : null,
      startM: start ? start.m : 0,
      startD: start ? start.d : 0,
      totalDays,
      base: null,
    };
  }

  function clampDay(day, totalDays) {
    const n = Math.round(Number(day) || 1);
    return Math.min(Math.max(1, n), Math.max(1, totalDays || 60));
  }

  function computeDay(month, date, ctx) {
    if (ctx.startY) {
      // 연말·연초 여행은 다음 해(`1/1`)도 함께 본다. 범위 안에 드는 해를 먼저 고른다.
      let best = null;
      for (const y of [ctx.startY, ctx.startY + 1, ctx.startY - 1]) {
        const diff = dayDiff(y, month, date, ctx.startY, ctx.startM, ctx.startD);
        if (diff >= 1 && diff <= ctx.totalDays) return diff;
        const distance = diff < 1 ? 1 - diff : diff - ctx.totalDays;
        if (best == null || distance < best.distance) best = { diff, distance };
      }
      return clampDay(best ? best.diff : 1, ctx.totalDays);
    }
    if (!ctx.base) {
      ctx.base = { m: month, d: date };
      return 1;
    }
    return clampDay(dayDiff(2024, month, date, 2024, ctx.base.m, ctx.base.d), ctx.totalDays);
  }

  function matchDayHeader(line) {
    const s = stripLead(line);
    const m = DAY_HEAD.exec(s);
    if (m) {
      return { day: Number(m[1] || m[2]), rest: s.slice(m[0].length).replace(/^[\s:·.\-]+/, '').trim() };
    }
    for (const re of DATE_HEADS) {
      const d = re.exec(s);
      if (!d) continue;
      const isFullYear = d[1] && d[1].length === 4;
      const month = Number(isFullYear ? d[2] : d[1]);
      const date = Number(isFullYear ? d[3] : d[2]);
      if (!(month >= 1 && month <= 12) || !(date >= 1 && date <= 31)) continue;
      return { month, date, rest: s.slice(d[0].length).replace(/^[\s:·.\-]+/, '').trim() };
    }
    return null;
  }

  // ── 도시(지역 태그) ──────────────────────────────────────
  function findCities(...texts) {
    const hay = texts.filter(Boolean).join(' ');
    const found = [];
    for (const city of CITIES) {
      if (hay.includes(city) && !found.some((f) => f.includes(city))) found.push(city);
    }
    return found;
  }

  // ── 본문 정리 ────────────────────────────────────────────
  const LEAD_FILLER = /^(?:부터|까지|이후에는|이후에|이후|이전에는|이전에|이전|에는|에(?=\s)|쯤|경|약|[-~,·→])\s*/;

  // 시간(HH:MM)도 괄호 안도 아닌 진짜 구분용 콜론 위치만 찾는다.
  function separatorColon(body) {
    const mask = maskParens(body);
    for (let i = 1; i < mask.length; i += 1) {
      if (mask[i] !== ':') continue;
      if (/\d/.test(mask[i - 1]) && /\d/.test(mask[i + 1] || '')) continue; // 09:15
      if (!/[가-힣A-Za-z0-9]/.test(body.slice(0, i))) continue; // `-> :` 같은 꼬리
      if (!body.slice(i + 1).trim()) continue;
      return i;
    }
    return -1;
  }

  function cleanBody(line, times) {
    let body = times.length ? removeTimes(line, times) : line;
    body = body.replace(/->|=>/g, '→').replace(/\s+/g, ' ').trim();
    body = stripLead(body);
    for (let i = 0; i < 3; i += 1) {
      const next = body.replace(LEAD_FILLER, '');
      if (next === body) break;
      body = next;
    }
    return body.replace(/\s+/g, ' ').trim();
  }

  // 끝(또는 앞)에 붙은 괄호 설명은 메모로 옮긴다. `(두바이)` 처럼 장소가 괄호뿐이면 남긴다.
  function pullParens(text) {
    const memo = [];
    let place = text.trim();
    for (let i = 0; i < 4; i += 1) {
      const tail = /^(.*?)\s*(\([^()]*\))[,.]?\s*$/.exec(place);
      if (!tail || tail[1].trim().length < 4) break;
      memo.unshift(tail[2].trim());
      place = tail[1].trim();
    }
    for (let i = 0; i < 2; i += 1) {
      const head = /^(\([^()]*\))\s*(.+)$/.exec(place);
      if (!head || head[2].trim().length < 4) break;
      memo.unshift(head[1].trim());
      place = head[2].trim();
    }
    return { place, memo };
  }

  function splitAtTag(body) {
    const at = body.indexOf('@');
    if (at < 0) return null;
    const before = body.slice(0, at).trim().replace(/[-–—:·,]\s*$/, '').trim();
    const after = body.slice(at + 1).trim();
    const token = /[^\s@,;()\[\]{}<>]+/g;
    const words = [];
    let end = 0;
    let m = token.exec(after);
    while (m && words.length < 4) {
      if (m.index > end && after.slice(end, m.index).trim() !== '') break;
      // `@산미구앨 시장에서 먹고…` → 이름은 `산미구앨 시장` 에서 멈춘다 (붙은 조사 떼기)
      const particle = /^(.*?)(에서부터|에서|으로|에는|부터|까지|에|로)$/.exec(m[0]);
      if (particle && particle[1].length >= (words.length ? 1 : 2)) {
        words.push(particle[1]);
        end = m.index + m[0].length;
        break;
      }
      words.push(m[0]);
      end = m.index + m[0].length;
      m = token.exec(after);
    }
    const name = words.join(' ').trim();
    if (!name) return { name: '', rest: after, before };
    return { name, rest: after.slice(end).trim(), before };
  }

  function shortenPlace(place, memo) {
    let out = place.trim();
    if (out.length <= SOFT_PLACE) return out;
    // 괄호 안에서는 끊지 않는다 (`(두바이) → (마드리드) 도착` 같은 이동 표기 보존)
    const depthAt = [];
    let depth = 0;
    for (const ch of out) {
      if (ch === '(' || ch === '[') depth += 1;
      depthAt.push(depth);
      if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    }
    const safe = (i) => out[i] === ' ' && depthAt[i] === 0;
    // 40자 근처에서 `+`·`/`·`-` 같은 구분자 뒤로 끊으면 읽기 좋다
    let idx = -1;
    for (const sep of [' + ', ' / ', ' - ', ' · ', ', ']) {
      const at = out.lastIndexOf(sep, SOFT_PLACE + 2);
      if (at > 10 && at + sep.length <= SOFT_PLACE + 3 && safe(at)) idx = Math.max(idx, at);
    }
    if (idx < 0) {
      idx = -1;
      for (let i = Math.min(SOFT_PLACE, out.length - 1); i > 10; i -= 1) {
        if (safe(i)) { idx = i; break; }
      }
      if (idx < 0) idx = SOFT_PLACE;
    }
    const tail = out.slice(idx).trim().replace(/^[-–—:·,]+\s*/, '');
    if (tail) memo.unshift(tail);
    out = out.slice(0, idx).trim().replace(/[-–—:·,]+$/, '').trim();
    return out;
  }

  function buildItem(line, times, { title, dayCity }) {
    let body = cleanBody(line, times);
    if (!body) return null;

    if (title) {
      body = body.replace(/\(\s*\d+\s*일차\s*\)/g, ' ').replace(/\d+\s*일차/g, ' ').replace(/\s+/g, ' ').trim();
    }

    const memoParts = [];
    let place = '';

    const tagged = splitAtTag(body);
    if (tagged) {
      const name = tagged.name.trim();
      if (name) {
        place = name;
        if (tagged.before) memoParts.push(tagged.before);
        if (tagged.rest) memoParts.push(tagged.rest.replace(/^[-–—:·,]+\s*/, ''));
      } else {
        place = tagged.before;
        if (tagged.rest) memoParts.push(tagged.rest);
      }
    } else {
      const at = separatorColon(body);
      if (at > 0) {
        place = body.slice(0, at).trim();
        memoParts.push(body.slice(at + 1).trim());
      } else {
        place = body;
      }
    }

    const pulled = /^\s*\(/.test(place) && /→/.test(place)
      ? { place, memo: [] } // `(두바이) → (마드리드) 도착` 같은 이동 표기는 그대로 둔다
      : pullParens(place);
    place = pulled.place;
    memoParts.unshift(...pulled.memo);

    place = place.replace(/→\s*→/g, '→').replace(/^[→\s]+/, '').replace(/\s+/g, ' ').trim();
    place = place.replace(/^[-–—:·,]+/, '').replace(/[-–—:·,]+$/, '').trim();
    if (!place && memoParts.length) place = memoParts.shift().trim();
    if (!place) return null;

    const placeMemo = [];
    place = shortenPlace(place, placeMemo);
    memoParts.unshift(...placeMemo);
    if (place.length > MAX_PLACE) place = place.slice(0, MAX_PLACE).trim();

    const memo = memoParts.map((m) => String(m).trim()).filter(Boolean).join('\n').slice(0, MAX_MEMO);
    const region = findCities(place)[0] || findCities(memo)[0] || dayCity || '';

    return {
      time: times.length ? times[0].time : '',
      place,
      region: region.slice(0, 30),
      memo,
    };
  }

  // ── 메인 ────────────────────────────────────────────────
  function parseItinerary(text, options) {
    const opts = options || {};
    const ctx = makeContext(opts);
    const src = normalize(text).slice(0, MAX_TEXT);
    const items = [];
    const stats = { count: 0, skipped: 0, noteLines: 0, days: [] };
    let currentDay = 1;
    let dayCity = '';
    let current = null;
    let itemIndent = 0;
    let inNotes = false;
    let pendingTime = '';

    const pushMemo = (text) => {
      if (!current || !text) return;
      const line = String(text).replace(/->|=>/g, '→').trim();
      if (!line) return;
      const next = current.memo ? `${current.memo}\n${line}` : line;
      current.memo = next.slice(0, MAX_MEMO);
    };

    const pushItem = (built, indent) => {
      if (!built) { stats.skipped += 1; return; }
      const item = {
        day: clampDay(currentDay, ctx.totalDays),
        time: built.time || pendingTime || '',
        place: built.place,
        region: built.region,
        memo: built.memo,
      };
      pendingTime = '';
      if (!item.place) { stats.skipped += 1; return; }
      items.push(item);
      current = item;
      itemIndent = indent;
    };

    for (const rawLine of src.split('\n')) {
      if (items.length >= MAX_ITEMS) break;
      const line = rawLine.replace(/\s+$/, '');
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      const indent = line.length - line.replace(/^\s+/, '').length;

      if (isTitleLine(trimmed) || isSectionLabel(trimmed)) { continue; }
      if (isDivider(trimmed)) {
        // `-----바르셀로나 주요 컨텐츠-----` 같은 참고 메모 구역: 다음 일차부터 다시 읽는다
        inNotes = true;
        current = null;
        stats.noteLines += 1;
        continue;
      }

      const head = matchDayHeader(trimmed);
      if (head) {
        inNotes = false;
        currentDay = head.day != null ? head.day : computeDay(head.month, head.date, ctx);
        const cities = head.rest ? findCities(head.rest) : [];
        dayCity = cities.length === 1 ? cities[0] : '';
        current = null;
        pendingTime = '';
        itemIndent = indent;
        if (head.rest) {
          const restTimes = findTimes(head.rest, maskParens(head.rest));
          pushItem(buildItem(head.rest, restTimes, { title: true, dayCity }), indent);
          // `Day 1 10:00 …` 처럼 일차 줄에 일정이 함께 있으면 그 일정이 메모 기준이 된다.
          // 순수한 일차 제목만 카드 하나로 두고, 뒤따르는 줄의 메모 기준이 되지 않게 한다.
          if (!restTimes.length) { current = null; pendingTime = ''; }
        }
        continue;
      }

      if (inNotes) { stats.noteLines += 1; continue; }

      const times = findTimes(line, maskParens(line));
      const hasTime = times.length > 0;
      const bullet = BULLET.test(trimmed);
      const deeper = Boolean(current) && indent > itemIndent;

      if (isParenOnly(trimmed)) {
        if (current) pushMemo(trimmed);
        else stats.skipped += 1;
        continue;
      }
      if (/^[:]/.test(trimmed)) {
        if (current) pushMemo(trimmed.replace(/^[:]\s*/, ''));
        else stats.skipped += 1;
        continue;
      }
      if (!hasTime && deeper && !bullet) { pushMemo(trimmed); continue; }
      // 하위 불릿은 itemIndent 보다 2칸 이상 깊을 때만 메모 (자유 형식의 들여쓰기 흔들림 대비)
      if (bullet && current && indent >= itemIndent + 2) { pushMemo(trimmed.replace(/^[-*+•·▪◦]\s*/, '· ')); continue; }

      const built = buildItem(line, times, { title: false, dayCity });
      if (!built) {
        if (hasTime) pendingTime = times[0].time;
        stats.skipped += 1;
        continue;
      }
      pushItem(built, indent);
    }

    stats.count = items.length;
    stats.days = [...new Set(items.map((i) => i.day))].sort((a, b) => a - b);
    return { items, stats };
  }

  return { parseItinerary, CITIES };
});
