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

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

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
  app.get(['/', '/t/:code'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(
    express.static(PUBLIC_DIR, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  app.use('/api', (req, res) => res.status(404).json({ error: '없는 API 입니다.' }));

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, ...(err.details || {}) });
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
  const app = createApp(store);
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
