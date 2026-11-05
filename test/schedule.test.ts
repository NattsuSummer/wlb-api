import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockAt, emptyWeek, normalizeSlot, nowInfo, planRange, summarize, targetsProblem } from '../src/lib/schedule';
import { bangkokNow, slotIndex } from '../src/lib/time';

const REST = 1, WORK = 2, SIDE = 3;
const rest = normalizeSlot([REST], 'นอน');
const work = normalizeSlot([WORK], 'งาน');
const steam = normalizeSlot([SIDE, REST], 'สตีมเกม');

test('multi-category slots split the hour equally', () => {
  const w = emptyWeek();
  w[slotIndex(0, 20)] = steam;
  w[slotIndex(0, 21)] = steam;
  w[slotIndex(0, 0)] = rest;
  const s = summarize(w, [REST, WORK, SIDE], { [REST]: 50, [SIDE]: 50 });
  const by = Object.fromEntries(s.categories.map((c) => [c.categoryId, c]));
  assert.equal(by[REST]!.hours, 2);  // 1 + 0.5 + 0.5
  assert.equal(by[SIDE]!.hours, 1);  // 0.5 + 0.5
  assert.equal(by[WORK]!.hours, 0);
  assert.equal(s.plannedHours, 3);
  assert.equal(s.unplannedHours, 165);
  assert.equal(by[REST]!.pct, 1.19);
  assert.equal(by[REST]!.diff, -48.81);
  assert.equal(s.targetsSet, true);
});

test('targets: all zero is allowed, otherwise must add up to 100', () => {
  assert.equal(targetsProblem({ 1: 0, 2: 0 }), null);
  assert.equal(targetsProblem({ 1: 60, 2: 40 }), null);
  assert.match(targetsProblem({ 1: 60, 2: 30 })!, /add up to 100/);
  assert.match(targetsProblem({ 1: 120 })!, /0–100/);
  assert.equal(summarize(emptyWeek(), [1], {}).targetsSet, false);
});

test('planRange reports overwrites grouped into runs, fills and unchanged cells', () => {
  const w = emptyWeek();
  for (let h = 8; h < 10; h++) w[slotIndex(2, h)] = normalizeSlot([4], 'ดนตรี');
  for (let h = 10; h < 18; h++) w[slotIndex(2, h)] = work;
  // write 07–11 on Wednesday: 07 empty (fill), 08–09 music (overwrite), 10 work (overwrite)
  const p = planRange(w, { days: [2], from: 7, to: 11 }, normalizeSlot([4], 'ภาษา'));
  assert.equal(p.fillCount, 1);
  assert.equal(p.overwriteCount, 3);
  assert.deepEqual(p.overwrites.map((o) => [o.weekday, o.from, o.to, o.before.description]), [
    [2, 8, 10, 'ดนตรี'],
    [2, 10, 11, 'งาน'],
  ]);
  assert.equal(p.after[slotIndex(2, 10)]!.description, 'ภาษา');
  assert.equal(p.after[slotIndex(2, 11)]!.description, 'งาน'); // outside the range stays
  // writing the same value again changes nothing
  const again = planRange(p.after, { days: [2], from: 7, to: 11 }, normalizeSlot([4], 'ภาษา'));
  assert.equal(again.unchangedCount, 4);
  assert.equal(again.overwriteCount + again.fillCount, 0);
});

test('category order does not matter when comparing slots', () => {
  const w = emptyWeek();
  w[0] = normalizeSlot([3, 1], 'x');
  assert.equal(planRange(w, { days: [0], from: 0, to: 1 }, normalizeSlot([1, 3], 'x')).unchangedCount, 1);
});

test('blockAt finds the whole block of identical cells', () => {
  const w = emptyWeek();
  for (let h = 20; h < 24; h++) w[slotIndex(1, h)] = steam;
  assert.deepEqual(blockAt(w, 1, 22), { from: 20, to: 24, slot: steam });
  assert.equal(blockAt(w, 1, 5), null);
});

test('nowInfo: current block, minutes left and next activity (wraps to next day)', () => {
  const w = emptyWeek();
  for (let h = 20; h < 24; h++) w[slotIndex(1, h)] = steam; // Tue 20–24
  for (let h = 0; h < 7; h++) w[slotIndex(2, h)] = rest;    // Wed 00–07
  const n = nowInfo(w, { weekday: 1, hour: 20, minute: 15 });
  assert.equal(n.current!.from, 20);
  assert.equal(n.current!.to, 24);
  assert.equal(n.current!.minutesLeft, 225);
  assert.deepEqual(n.next, { weekday: 2, hour: 0, slot: rest });
  const empty = nowInfo(w, { weekday: 1, hour: 5, minute: 0 });
  assert.equal(empty.current, null);
  assert.deepEqual(empty.next, { weekday: 1, hour: 20, slot: steam });
});

test('bangkokNow uses UTC+7 and Monday = 0', () => {
  // 2026-11-03T13:15Z = Tuesday 20:15 in Bangkok
  assert.deepEqual(bangkokNow(new Date('2026-11-03T13:15:00Z')), { weekday: 1, hour: 20, minute: 15 });
  // 2026-11-08T17:30Z = Monday 00:30 in Bangkok
  assert.deepEqual(bangkokNow(new Date('2026-11-08T17:30:00Z')), { weekday: 0, hour: 0, minute: 30 });
});
