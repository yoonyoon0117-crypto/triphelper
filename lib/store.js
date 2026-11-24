'use strict';
/**
 * JSON 파일 저장소 — 원자적 쓰기(tmp → rename) + 쓰기 직렬화.
 * DATA_DIR 환경변수로 위치를 바꿀 수 있습니다(Railway 볼륨 /data 호환).
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

class JsonStore {
  constructor(dataDir) {
    this.dir = path.resolve(dataDir || path.join(process.cwd(), 'data'));
    this.file = path.join(this.dir, 'trips.json');
    this.state = { trips: [] };
    this.queue = Promise.resolve();
  }

  async load() {
    await fsp.mkdir(this.dir, { recursive: true });
    try {
      const raw = await fsp.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.trips)) this.state = parsed;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // 깨진 파일은 옆으로 치워 두고 새로 시작합니다.
        try {
          await fsp.rename(this.file, `${this.file}.broken-${Date.now()}`);
        } catch { /* ignore */ }
      }
      this.state = { trips: [] };
    }
    return this.state;
  }

  snapshot() {
    return this.state;
  }

  /** 쓰기 작업을 한 줄로 세워 실행 (동시 요청에도 유실 없음) */
  write(fn) {
    const run = async () => {
      const result = await fn(this.state);
      await this.flush();
      return result;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => {});
    return next;
  }

  async flush() {
    const tmp = path.join(this.dir, `.trips-${process.pid}-${Date.now()}.tmp`);
    const body = JSON.stringify(this.state, null, 2);
    const fh = await fsp.open(tmp, 'w');
    try {
      await fh.writeFile(body, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fsp.rename(tmp, this.file);
  }

  readSyncIfExists() {
    return fs.existsSync(this.file);
  }
}

module.exports = { JsonStore };
