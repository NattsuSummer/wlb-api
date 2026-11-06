// A D1-compatible wrapper around node:sqlite so the Worker code can run in plain Node tests.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/repositories/d1/db';

const fix = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

class Stmt implements D1PreparedStatement {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...values: unknown[]) {
    return new Stmt(this.db, this.sql, values.map(fix));
  }
  async first<T>() {
    return ((this.db.prepare(this.sql).get(...(this.params as never[])) as T) ?? null);
  }
  async all<T>(): Promise<D1Result<T>> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[], success: true, meta: {} };
  }
  async run(): Promise<D1Result> {
    return this.runSync();
  }
  runSync(): D1Result {
    const r = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = join(import.meta.dirname, '../../migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    // D1 runs a batch as one transaction.
    async batch(stmts: D1PreparedStatement[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => (s as Stmt).runSync());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
