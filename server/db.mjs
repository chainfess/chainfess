import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS jobs(
      id TEXT PRIMARY KEY, burn_tx TEXT NOT NULL, status TEXT NOT NULL,
      request TEXT, statement TEXT, signature TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS burns(
      tx_hash TEXT PRIMARY KEY, used_at TEXT NOT NULL, job_id TEXT NOT NULL);
  `);
  const q = {
    insBurn: db.prepare('INSERT INTO burns(tx_hash, used_at, job_id) VALUES(?,?,?)'),
    getBurn: db.prepare('SELECT * FROM burns WHERE tx_hash = ?'),
    delBurn: db.prepare('DELETE FROM burns WHERE tx_hash = ?'),
    insJob: db.prepare('INSERT INTO jobs(id, burn_tx, status, request, created_at, updated_at) VALUES(?,?,?,?,?,?)'),
    getJob: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    jobByBurn: db.prepare('SELECT * FROM jobs WHERE burn_tx = ?'),
    setStatus: db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?'),
    setDone: db.prepare("UPDATE jobs SET status='done', statement=?, signature=?, request=NULL, error=NULL, updated_at=? WHERE id=?"),
    setFailed: db.prepare("UPDATE jobs SET status='failed', error=?, updated_at=? WHERE id=?"),
    requeue: db.prepare("UPDATE jobs SET status='queued', error=NULL, request=?, updated_at=? WHERE id=?"),
    open: db.prepare("SELECT id FROM jobs WHERE status IN ('queued','scanning') ORDER BY created_at"),
  };
  const now = () => new Date().toISOString();
  return {
    raw: db,
    now,
    /** atomically claim a burn; returns {ok:true} or {ok:false, jobId} */
    claimBurn(txHash, jobId) {
      try { q.insBurn.run(txHash, now(), jobId); return { ok: true }; }
      catch (e) {
        if (/UNIQUE|constraint/i.test(String(e.message))) return { ok: false, jobId: q.getBurn.get(txHash).job_id };
        throw e;
      }
    },
    addJob(id, burnTx, request) { q.insJob.run(id, burnTx, 'queued', JSON.stringify(request), now(), now()); },
    getJob: (id) => q.getJob.get(id),
    jobByBurn: (h) => q.jobByBurn.get(h),
    setStatus: (id, s) => q.setStatus.run(s, now(), id),
    setDone: (id, statement, signature) => q.setDone.run(JSON.stringify(statement), signature, now(), id),
    setFailed: (id, err) => q.setFailed.run(String(err).slice(0, 300), now(), id),
    requeue: (id, request) => q.requeue.run(JSON.stringify(request), now(), id),
    openJobs: () => q.open.all().map((r) => r.id),
    close: () => db.close(),
  };
}
