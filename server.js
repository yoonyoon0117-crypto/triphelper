'use strict';
/**
 * 두 가족(그리고 친구들) 여행 정산·일정 PWA 서버.
 *   DATA_DIR 환경변수로 저장 위치를 바꿀 수 있습니다(기본 ./data, Railway 볼륨 /data).
 */
const path = require('node:path');
const express = require('express');
const { JsonStore } = require('./lib/store');
const {
  HttpError,
  CURRENCIES,
  MODE_LABELS,
  MAX_PARTICIPANTS,
  newId,
  createTrip,
  tripPatch,
  expenseInput,
  itineraryInput,
  participantInput,
  defaultParticipants,
  toClient,
  summary,
  seedTrip,
  stamp,
} = require('./lib/trips');
const { createNaverRateClient, RateLookupError } = require('./lib/rates');
const { PinGate, PinError } = require('./lib/pin');
const { parseItinerary } = require('./lib/itinerary-parser');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

function createApp(store, options = {}) {
  const app = express();
  // 환율 조회 — 테스트에서는 options.rateLookup 으로 네이버 요청을 대체합니다.
  const rateLookup = options.rateLookup || createNaverRateClient();
  // 4자리 입장 비밀번호 — options.pin 으로 테스트용 게이트를 넣을 수 있습니다.
  const pin = options.pin || new PinGate({
    dataDir: options.dataDir || DATA_DIR,
    envPin: options.envPin !== undefined ? options.envPin : process.env.APP_PIN,
  });
  app.disable('x-powered-by');
  // Railway 같은 프록시 뒤에서도 https(보안 쿠키)·실제 접속 IP 를 알 수 있게
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '200kb' }));

  const pinCookie = (token, req) => {
    const parts = [`trip_pin=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(pin.tokenTtlMs / 1000)}`];
    if (req && req.secure) parts.push('Secure'); // https(Railway)에서만 Secure — 로컬 http 테스트에서도 저장되게
    return parts.join('; ');
  };
  const clientKey = (req) => {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.ip || 'unknown';
  };

  // ── API 잠금: PIN 이 설정돼 있으면 여행 데이터·환율은 인증 필수 ──
  //    (health·pin API·정적 파일은 잠금 화면이 뜰 수 있도록 열어 둔다)
  app.use('/api', (req, res, next) => {
    if (!pin.locked) return next();
    const p = req.path;
    const isPinApi = p === '/pin' || p.startsWith('/pin/');
    const isHealth = p === '/health';
    const guarded = p === '/trips' || p.startsWith('/trips/') || p === '/exchange-rate' || p.startsWith('/exchange-rate/');
    if (isPinApi || isHealth || !guarded) return next();
    if (pin.isAuthed(req)) return next();
    return res.status(401).json({ error: '입장 비밀번호가 필요해요.', code: 'PIN_REQUIRED' });
  });

  // ── 입장 비밀번호 API ─────────────────────────────────────
  app.get('/api/pin/status', (req, res) => ok(res, pin.status(req)));

  app.post('/api/pin/verify', (req, res) => {
    if (!pin.locked) return ok(res, { ok: true, locked: false, unlocked: true, token: null });
    const key = clientKey(req);
    if (!pin.allowAttempt(key)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ error: '시도가 너무 많아요. 1분 뒤에 다시 해 주세요.', code: 'PIN_TOO_MANY' });
    }
    if (!pin.verify(req.body && req.body.pin)) {
      pin.noteFailure(key);
      return res.status(401).json({ error: '비밀번호가 맞지 않아요.', code: 'PIN_WRONG' });
    }
    pin.noteSuccess(key);
    const token = pin.issueToken();
    res.set('Set-Cookie', pinCookie(token, req));
    return ok(res, { ok: true, locked: true, unlocked: true, token, expiresInDays: Math.round(pin.tokenTtlMs / 86400000) });
  });

  app.post('/api/pin/setup', async (req, res, next) => {
    try {
      await pin.setup(req.body && req.body.pin);
      const token = pin.issueToken();
      res.set('Set-Cookie', pinCookie(token, req));
      return ok(res, { ok: true, locked: true, unlocked: true, token });
    } catch (err) {
      return next(err);
    }
  });

  app.post('/api/pin/change', async (req, res, next) => {
    try {
      const body = req.body || {};
      await pin.change(body.currentPin, body.pin);
      const token = pin.issueToken();
      res.set('Set-Cookie', pinCookie(token, req));
      return ok(res, { ok: true, locked: true, unlocked: true, token });
    } catch (err) {
      return next(err);
    }
  });

  const findTrip = (idOrCode) => {
    const s = store.snapshot();
    return s.trips.find((t) => t.id === idOrCode) || s.trips.find((t) => t.code === String(idOrCode).toUpperCase());
  };

  const requireTrip = (req, res) => {
    const trip = findTrip(req.params.id);
    if (!trip) throw new HttpError(404, '여행을 찾을 수 없습니다.');
    return trip;
  };

  const ok = (res, body, status = 200) => res.status(status).json(body);

  // ── 기본 정보 ─────────────────────────────────────────────
  app.get('/api/health', (req, res) => ok(res, { ok: true, trips: store.snapshot().trips.length }));

  app.get('/api/meta', (req, res) =>
    ok(res, {
      currencies: CURRENCIES,
      splitModes: Object.entries(MODE_LABELS).map(([id, label]) => ({ id, label })),
      maxParticipants: MAX_PARTICIPANTS,
    })
  );

  // ── 네이버 환율 ───────────────────────────────────────────
  app.get('/api/exchange-rate', async (req, res, next) => {
    const currency = String(req.query.currency || '').trim().toUpperCase();
    try {
      if (!CURRENCIES.includes(currency)) {
        throw new HttpError(400, `지원하지 않는 통화예요. (${CURRENCIES.join(', ')})`);
      }
      const found = await rateLookup(currency);
      res.set('Cache-Control', 'no-store');
      ok(res, {
        ok: true,
        currency,
        rate: found.rate, // 1단위 = ?원 (앱에 적용하는 값)
        unitRate: found.quotedRate, // 네이버 고시 그대로 (100 JPY = 843.08원 등)
        baseUnit: found.baseUnit,
        source: 'naver',
        fetchedAt: new Date().toISOString(),
        quotedAt: found.quotedAt || null,
      });
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      if (err instanceof RateLookupError) {
        return res.status(502).json({
          ok: false,
          error: '네이버에서 환율을 불러오지 못했어요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.',
        });
      }
      return next(err);
    }
  });

  // ── 여행 목록/생성 ────────────────────────────────────────
  app.get('/api/trips', (req, res) => {
    const trips = store.snapshot().trips.map(summary).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    ok(res, { trips });
  });

  app.post('/api/trips', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = createTrip(req.body, state.trips);
        state.trips.push(t);
        return t;
      });
      ok(res, toClient(trip), 201);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/trips/:id', (req, res, next) => {
    try {
      const trip = requireTrip(req, res);
      const since = Number(req.query.version);
      if (Number.isFinite(since) && since === trip.version) {
        return ok(res, { unchanged: true, version: trip.version, updatedAt: trip.updatedAt });
      }
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/trips/:id/poll', (req, res, next) => {
    try {
      const trip = requireTrip(req, res);
      const since = Number(req.query.version);
      if (Number.isFinite(since) && since === trip.version) {
        return ok(res, { unchanged: true, version: trip.version, updatedAt: trip.updatedAt });
      }
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/trips/:id', async (req, res, next) => {
    try {
      const result = await store.write((state) => {
        const trip = state.trips.find((t) => t.id === req.params.id) || state.trips.find((t) => t.code === String(req.params.id).toUpperCase());
        if (!trip) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const patch = tripPatch(trip, req.body);
        Object.assign(trip, patch);
        stamp(trip);
        return trip;
      });
      ok(res, toClient(result));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/trips/:id', async (req, res, next) => {
    try {
      await store.write((state) => {
        const idx = state.trips.findIndex((t) => t.id === req.params.id);
        if (idx < 0) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        state.trips.splice(idx, 1);
      });
      ok(res, { ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ── 참여자 ───────────────────────────────────────────────
  app.get('/api/trips/:id/participants', (req, res, next) => {
    try {
      const trip = requireTrip(req, res);
      ok(res, { participants: trip.participants });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/trips/:id/participants', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        if (t.participants.length >= MAX_PARTICIPANTS) throw new HttpError(400, `참여자는 ${MAX_PARTICIPANTS}명까지 추가할 수 있어요.`);
        const p = participantInput(req.body, { id: newId('ptc'), type: (req.body && req.body.type) || 'person', name: '', adults: 1, kids: 0 });
        t.participants.push(p);
        stamp(t);
        return t;
      });
      ok(res, toClient(trip), 201);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/trips/:id/participants/:pid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const idx = t.participants.findIndex((p) => p.id === req.params.pid);
        if (idx < 0) throw new HttpError(404, '참여자를 찾을 수 없습니다.');
        const nextP = participantInput(req.body, t.participants[idx]);
        t.participants[idx] = nextP;
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/trips/:id/participants/:pid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const idx = t.participants.findIndex((p) => p.id === req.params.pid);
        if (idx < 0) throw new HttpError(404, '참여자를 찾을 수 없습니다.');
        if (t.participants.length <= 2) throw new HttpError(400, '참여자는 최소 2명이 남아야 해요.');

        const pid = req.params.pid;
        const payerCount = t.expenses.filter((e) => e.payerId === pid).length;
        const splitCount = t.expenses.filter(
          (e) => (e.split.mode === 'select' && (e.split.participantIds || []).includes(pid)) || (e.split.mode === 'custom' && e.split.amounts && e.split.amounts[pid])
        ).length;
        const reassignTo = String(req.query.reassignTo || '');
        if ((payerCount || splitCount) && !reassignTo) {
          throw new HttpError(409, '이 참여자가 들어간 지출이 있어요. 지출을 넘길 참여자를 골라 주세요.', {
            code: 'PARTICIPANT_IN_USE',
            usage: { payerCount, splitCount },
            participant: t.participants[idx],
          });
        }
        if (reassignTo && !t.participants.some((p) => p.id === reassignTo && p.id !== pid)) {
          throw new HttpError(400, '지출을 넘길 참여자를 찾을 수 없습니다.');
        }
        if (reassignTo) {
          for (const e of t.expenses) {
            if (e.payerId === pid) e.payerId = reassignTo;
            if (e.split.mode === 'select' && (e.split.participantIds || []).includes(pid)) {
              const list = new Set(e.split.participantIds.filter((x) => x !== pid));
              list.add(reassignTo);
              e.split.participantIds = [...list];
            }
            if (e.split.mode === 'custom' && e.split.amounts && e.split.amounts[pid]) {
              e.split.amounts[reassignTo] = (e.split.amounts[reassignTo] || 0) + e.split.amounts[pid];
              delete e.split.amounts[pid];
            }
          }
        }
        t.participants.splice(idx, 1);
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  // ── 지출 ─────────────────────────────────────────────────
  app.post('/api/trips/:id/expenses', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const data = expenseInput(req.body, null, t.participants);
        const ts = new Date().toISOString();
        t.expenses.push({ id: newId('exp'), ...data, createdAt: ts, updatedAt: ts });
        stamp(t);
        return t;
      });
      ok(res, toClient(trip), 201);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/trips/:id/expenses/:eid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const e = t.expenses.find((x) => x.id === req.params.eid);
        if (!e) throw new HttpError(404, '지출을 찾을 수 없습니다.');
        Object.assign(e, expenseInput(req.body, e, t.participants), { updatedAt: new Date().toISOString() });
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/trips/:id/expenses/:eid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const idx = t.expenses.findIndex((x) => x.id === req.params.eid);
        if (idx < 0) throw new HttpError(404, '지출을 찾을 수 없습니다.');
        t.expenses.splice(idx, 1);
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  // ── 일정 ─────────────────────────────────────────────────
  // 일정 텍스트 붙여넣기 — 미리보기(파싱만)와 한 번에 등록(bulk).
  // 파서는 브라우저와 같은 파일(lib/itinerary-parser.js)을 써서 결과가 같습니다.
  app.post('/api/trips/:id/itinerary/parse', (req, res, next) => {
    try {
      const trip = requireTrip(req, res);
      const text = String((req.body && req.body.text) || '').trim();
      if (!text) throw new HttpError(400, '붙여넣은 일정이 비어 있어요.');
      if (text.length > 20000) throw new HttpError(400, '일정은 한 번에 20,000자까지 붙여넣을 수 있어요.');
      const parsed = parseItinerary(text, { startDate: trip.startDate, endDate: trip.endDate });
      ok(res, { ok: true, items: parsed.items, stats: parsed.stats });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/trips/:id/itinerary/bulk', async (req, res, next) => {
    try {
      const body = req.body || {};
      const raw = Array.isArray(body.items) ? body.items : null;
      if (!raw) throw new HttpError(400, '등록할 일정 목록이 필요해요.');
      if (!raw.length) throw new HttpError(400, '등록할 일정이 없어요. 미리보기에서 반영할 일정을 골라 주세요.');
      if (raw.length > 300) throw new HttpError(400, '일정은 한 번에 300개까지 등록할 수 있어요.');
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const ts = new Date().toISOString();
        const items = raw.map((item, i) => {
          try {
            return { id: newId('itn'), ...itineraryInput(item, null), createdAt: ts, updatedAt: ts };
          } catch (err) {
            if (err instanceof HttpError) throw new HttpError(400, `${i + 1}번째 일정: ${err.message}`);
            throw err;
          }
        });
        t.itinerary = body.replaceExisting === true ? items : [...(t.itinerary || []), ...items];
        stamp(t);
        return t;
      });
      ok(res, { ...toClient(trip), added: raw.length, replaced: body.replaceExisting === true }, 201);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/trips/:id/itinerary', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const data = itineraryInput(req.body, null);
        const ts = new Date().toISOString();
        t.itinerary.push({ id: newId('itn'), ...data, createdAt: ts, updatedAt: ts });
        stamp(t);
        return t;
      });
      ok(res, toClient(trip), 201);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/trips/:id/itinerary/:iid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const item = t.itinerary.find((x) => x.id === req.params.iid);
        if (!item) throw new HttpError(404, '일정을 찾을 수 없습니다.');
        Object.assign(item, itineraryInput(req.body, item), { updatedAt: new Date().toISOString() });
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/trips/:id/itinerary/:iid', async (req, res, next) => {
    try {
      const trip = await store.write((state) => {
        const t = state.trips.find((x) => x.id === req.params.id) || state.trips.find((x) => x.code === String(req.params.id).toUpperCase());
        if (!t) throw new HttpError(404, '여행을 찾을 수 없습니다.');
        const idx = t.itinerary.findIndex((x) => x.id === req.params.iid);
        if (idx < 0) throw new HttpError(404, '일정을 찾을 수 없습니다.');
        t.itinerary.splice(idx, 1);
        stamp(t);
        return t;
      });
      ok(res, toClient(trip));
    } catch (err) {
      next(err);
    }
  });

  // ── 정적 파일 / 페이지 라우팅 ─────────────────────────────
  // 일정 텍스트 파서 — 브라우저(오프라인 미리보기 포함)와 서버가 같은 파일을 쓴다.
  app.get('/itinerary-parser.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/javascript; charset=utf-8');
    res.sendFile(path.join(__dirname, 'lib', 'itinerary-parser.js'));
  });

  app.get(['/', '/t/:code'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        // 폰트는 내용이 바뀌지 않으므로 길게 캐시(파일명이 곧 버전)
        else if (filePath.includes(`${path.sep}fonts${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    })
  );

  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API 입니다.' }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details || {}) });
    }
    if (err instanceof PinError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '요청 형식이 올바르지 않습니다.' });
    }
    console.error('[error]', err);
    return res.status(500).json({ error: '서버에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.' });
  });

  return app;
}

async function start() {
  const store = new JsonStore(DATA_DIR);
  await store.load();
  if (!store.snapshot().trips.length) {
    await store.write((state) => {
      state.trips.push(seedTrip());
    });
  }
  const pin = new PinGate({ dataDir: DATA_DIR, envPin: process.env.APP_PIN });
  if (pin.locked) console.log(`[family-trip] 잠금 켜짐 (${pin.envPin ? 'APP_PIN 환경변수' : path.join(DATA_DIR, 'pin.json')})`);
  const app = createApp(store, { pin });
  const server = app.listen(PORT, () => {
    console.log(`[family-trip] http://localhost:${PORT}  (data: ${DATA_DIR})`);
  });
  return { app, server, store };
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
