'use strict';
/**
 * 4자리 입장 비밀번호(PIN) — 설정·검증·세션 토큰.
 *
 *  · APP_PIN 환경변수가 있으면 그것을 우선 사용합니다(코드에는 아무 비밀번호도 두지 않음).
 *  · 없으면 DATA_DIR/pin.json 에 { salt, hash } 만 저장합니다(scrypt, 평문 저장 없음).
 *  · 둘 다 없으면 잠금이 꺼진 상태(locked=false)로 기존처럼 바로 열립니다.
 *  · 토큰은 PIN 해시에서 파생한 비밀키로 서명하므로, PIN 을 바꾸면 기존 토큰이 모두 무효가 됩니다.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PIN_RE = /^\d{4}$/;
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180일 — 한 번 입력하면 계속 열려 있게
const SCRYPT_KEYLEN = 32;

class PinError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'PinError';
    this.status = status;
    this.code = code;
  }
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), String(salt), SCRYPT_KEYLEN).toString('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (str) => Buffer.from(String(str), 'base64url');

class PinGate {
  constructor({ dataDir, envPin = process.env.APP_PIN, tokenTtlMs = TOKEN_TTL_MS } = {}) {
    this.dir = path.resolve(dataDir || path.join(process.cwd(), 'data'));
    this.file = path.join(this.dir, 'pin.json');
    this.tokenTtlMs = tokenTtlMs;

    const env = String(envPin == null ? '' : envPin).trim();
    if (env && !PIN_RE.test(env)) {
      // 형식이 잘못된 환경변수는 잠금을 반쯤 거는 대신 무시하고 알린다(앱이 잠기지 않음).
      console.warn('[pin] APP_PIN 은 4자리 숫자여야 합니다. 환경변수를 무시합니다.');
      this.envPin = null;
    } else {
      this.envPin = env || null;
    }
    this.record = this._read();
    this.failures = new Map(); // ip → [실패 시각]
  }

  _read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed.salt === 'string' && typeof parsed.hash === 'string' && parsed.salt && parsed.hash) {
        return { salt: parsed.salt, hash: parsed.hash, updatedAt: parsed.updatedAt || null };
      }
    } catch { /* 파일 없음/깨짐 → 미설정 */ }
    return null;
  }

  get locked() {
    return Boolean(this.envPin || this.record);
  }

  hasPin() {
    return this.locked;
  }

  verify(pin) {
    const value = String(pin == null ? '' : pin);
    if (this.envPin) return PIN_RE.test(value) && safeEqual(value, this.envPin);
    if (!this.record) return false;
    if (!PIN_RE.test(value)) return false;
    return safeEqual(hashPin(value, this.record.salt), this.record.hash);
  }

  /** 첫 설정 — 이미 설정돼 있으면 409 (외부인이 덮어쓰지 못하게) */
  async setup(pin) {
    const value = String(pin == null ? '' : pin);
    if (this.locked) throw new PinError(409, '이미 비밀번호가 설정되어 있어요.', 'PIN_ALREADY_SET');
    if (!PIN_RE.test(value)) throw new PinError(400, '비밀번호는 4자리 숫자로 정해 주세요.', 'PIN_FORMAT');
    await this._save(value);
    return true;
  }

  /** 변경 — 현재 PIN 확인 후 교체. 해시가 바뀌므로 기존 토큰은 자동으로 무효. */
  async change(currentPin, newPin) {
    if (!this.locked) throw new PinError(400, '아직 비밀번호가 없어요. 먼저 설정해 주세요.', 'PIN_NOT_SET');
    if (this.envPin) throw new PinError(409, '환경변수(APP_PIN)로 정한 비밀번호는 앱에서 바꿀 수 없어요.', 'PIN_ENV_LOCKED');
    if (!this.verify(currentPin)) throw new PinError(401, '비밀번호가 맞지 않아요.', 'PIN_WRONG');
    const value = String(newPin == null ? '' : newPin);
    if (!PIN_RE.test(value)) throw new PinError(400, '새 비밀번호는 4자리 숫자로 정해 주세요.', 'PIN_FORMAT');
    await this._save(value);
    return true;
  }

  async _save(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const record = { version: 1, salt, hash: hashPin(pin, salt), updatedAt: new Date().toISOString() };
    await fsp.mkdir(this.dir, { recursive: true });
    const tmp = path.join(this.dir, `.pin-${process.pid}-${Date.now()}.tmp`);
    const fh = await fsp.open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(JSON.stringify(record, null, 2), 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, this.file);
    this.record = record;
  }

  // ── 세션 토큰 ────────────────────────────────────────────
  _secret() {
    const material = this.envPin ? `env:${this.envPin}` : `file:${this.record ? `${this.record.salt}:${this.record.hash}` : 'none'}`;
    return crypto.createHash('sha256').update(`trip-helper-pin-v1|${material}`).digest();
  }

  issueToken() {
    if (!this.locked) return null;
    const now = Date.now();
    const payload = b64u(JSON.stringify({ v: 1, iat: now, exp: now + this.tokenTtlMs }));
    const sig = b64u(crypto.createHmac('sha256', this._secret()).update(payload).digest());
    return `p1.${payload}.${sig}`;
  }

  checkToken(token) {
    if (!this.locked) return true;
    if (!token) return false;
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts[0] !== 'p1') return false;
    const [, payload, sig] = parts;
    const expected = b64u(crypto.createHmac('sha256', this._secret()).update(payload).digest());
    if (!safeEqual(sig, expected)) return false;
    try {
      const data = JSON.parse(unb64u(payload).toString('utf8'));
      if (!data || data.v !== 1 || !Number.isFinite(data.exp)) return false;
      return data.exp > Date.now();
    } catch {
      return false;
    }
  }

  tokenFrom(req) {
    const header = req.get ? req.get('x-trip-pin-token') : (req.headers && req.headers['x-trip-pin-token']);
    if (header) return String(header);
    const raw = String((req.headers && req.headers.cookie) || '');
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === 'trip_pin') {
        try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
      }
    }
    return '';
  }

  isAuthed(req) {
    if (!this.locked) return true;
    return this.checkToken(this.tokenFrom(req));
  }

  status(req) {
    const locked = this.locked;
    return { locked, unlocked: !locked || this.isAuthed(req) };
  }

  // ── 무차별 대입 완화 (IP 당 1분에 10회 실패하면 잠시 막음) ──
  _recent(key) {
    const now = Date.now();
    const list = (this.failures.get(key) || []).filter((t) => now - t < 60 * 1000);
    this.failures.set(key, list);
    return list;
  }

  allowAttempt(key) {
    return this._recent(key).length < 10;
  }

  noteFailure(key) {
    const list = this._recent(key);
    list.push(Date.now());
    this.failures.set(key, list);
  }

  noteSuccess(key) {
    this.failures.delete(key);
  }
}

module.exports = { PinGate, PinError, PIN_RE, TOKEN_TTL_MS };
