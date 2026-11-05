import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildSeedSql } from '../scripts/seed-lib';
import { summarize } from '../src/lib/schedule';
import { listTimeCategories, loadTargets, loadWeek } from '../src/store';
import { createTestDb } from './helpers/d1';

/** Build seed SQL from a seed file and load it into a fresh test DB. */
export async function seededDb(file: string, password = 'Seed-pass-1') {
  const sql = await buildSeedSql(JSON.parse(readFileSync(file, 'utf8')), password);
  const db = createTestDb();
  for (const line of sql.split('\n').filter((l) => l.startsWith('INSERT'))) await db.prepare(line).run();
  return { db, sql };
}

test('seed builder creates users that must change password, with slots and targets', async () => {
  const { db, sql } = await seededDb(join(import.meta.dirname, '../seed/seed.example.json'));
  assert.ok(!sql.includes('Seed-pass-1'), 'plain password must not appear in the SQL');
  const u = await db.prepare('SELECT id, role, must_change_password FROM users WHERE username = ?').bind('demo').first<{ id: number; role: string; must_change_password: number }>();
  assert.equal(u!.role, 'admin');
  assert.equal(u!.must_change_password, 1);
  const week = await loadWeek(db, u!.id);
  assert.equal(week.filter(Boolean).length, 3);
  assert.equal(week[20]!.categoryIds.length, 2);
  const cats = await listTimeCategories(db);
  const targets = await loadTargets(db, u!.id);
  assert.equal(Object.values(targets).reduce((a, b) => a + b, 0), 100);
  assert.equal(summarize(week, cats.map((c) => c.id), targets).plannedHours, 3);
});
