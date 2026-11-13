import type { Daily, DailyReply, EventWrite, Load, Project, ProjectEvent, ProjectMember, ProjectWrite, Retro, RetroCard, RetroCol, RetroPhase, SprintReview, Task, TaskWrite, Version, VersionWrite } from '../../domain/project';
import type { ProjectRepository } from '../interfaces';
import type { D1Database } from './db';

type Row = Record<string, unknown>;
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const b = (v: unknown) => (v === null || v === undefined ? null : Number(v) === 1);
const json = <T>(v: unknown, d: T): T => { try { return v ? (JSON.parse(String(v)) as T) : d; } catch { return d; } };

const toProject = (r: Row): Project => ({
  id: Number(r.id), name: String(r.name), description: String(r.description), repoUrl: String(r.repo_url), refs: json(r.refs_json, []),
  sprintAnchor: String(r.sprint_anchor), versionWeeks: Number(r.version_weeks), reviewHour: Number(r.review_hour), retroHour: Number(r.retro_hour),
  archived: Number(r.archived) === 1, createdBy: n(r.created_by), createdAt: String(r.created_at),
});
const toMember = (r: Row): ProjectMember & { projectId: number } => ({
  projectId: Number(r.project_id), userId: Number(r.user_id), role: r.role as ProjectMember['role'], days: json(r.days_json, { weekly: [], alternate: null }),
  displayName: r.display_name as string | undefined, avatarColor: (r.avatar_color as string | null) ?? null,
});
const toTask = (r: Row): Task => ({
  id: Number(r.id), projectId: Number(r.project_id), title: String(r.title), description: String(r.description), assigneeId: n(r.assignee_id),
  size: (r.size as Task['size']) ?? null, status: r.status as Task['status'], sprintNo: n(r.sprint_no), versionId: n(r.version_id), sort: Number(r.sort),
  createdBy: n(r.created_by), createdAt: String(r.created_at), doneAt: (r.done_at as string | null) ?? null,
});
const toVersion = (r: Row): Version => ({
  id: Number(r.id), projectId: Number(r.project_id), name: String(r.name), goal: String(r.goal), checklist: json(r.checklist_json, []),
  cutDate: (r.cut_date as string | null) ?? null, releaseDate: (r.release_date as string | null) ?? null, buildUrl: String(r.build_url),
  playable: b(r.playable), notes: String(r.notes), closed: Number(r.closed) === 1,
});
const toDaily = (r: Row): Daily => ({
  id: Number(r.id), projectId: Number(r.project_id), userId: Number(r.user_id), date: String(r.date), prevText: String(r.prev_text),
  prevDone: b(r.prev_done), nextText: String(r.next_text), blocker: String(r.blocker), createdAt: String(r.created_at),
});
const toEvent = (r: Row): ProjectEvent => ({
  id: Number(r.id), projectId: Number(r.project_id), kind: r.kind as ProjectEvent['kind'], title: String(r.title), date: String(r.date), hour: n(r.hour), note: String(r.note),
});
const toRetro = (r: Row): Retro => ({ id: Number(r.id), projectId: Number(r.project_id), title: String(r.title), date: String(r.date), phase: r.phase as RetroPhase, createdAt: String(r.created_at) });

export class D1ProjectRepository implements ProjectRepository {
  constructor(private db: D1Database) {}
  private q(sql: string, ...v: unknown[]) { return this.db.prepare(sql).bind(...v); }

  async list(userId: number | null) {
    const r = userId === null
      ? await this.q('SELECT * FROM projects ORDER BY archived, name').all<Row>()
      : await this.q('SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ? ORDER BY p.archived, p.name', userId).all<Row>();
    return r.results.map(toProject);
  }
  async find(id: number) { const r = await this.q('SELECT * FROM projects WHERE id = ?', id).first<Row>(); return r ? toProject(r) : null; }
  async create(w: ProjectWrite, createdBy: number) {
    const r = await this.q('INSERT INTO projects (name, description, repo_url, refs_json, sprint_anchor, version_weeks, review_hour, retro_hour, archived, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      w.name, w.description, w.repoUrl, JSON.stringify(w.refs), w.sprintAnchor, w.versionWeeks, w.reviewHour, w.retroHour, w.archived ? 1 : 0, createdBy).run();
    return Number(r.meta.last_row_id);
  }
  async update(id: number, w: ProjectWrite) {
    await this.q(`UPDATE projects SET name = ?, description = ?, repo_url = ?, refs_json = ?, sprint_anchor = ?, version_weeks = ?, review_hour = ?, retro_hour = ?, archived = ?, updated_at = ${NOW} WHERE id = ?`,
      w.name, w.description, w.repoUrl, JSON.stringify(w.refs), w.sprintAnchor, w.versionWeeks, w.reviewHour, w.retroHour, w.archived ? 1 : 0, id).run();
  }
  async remove(id: number) { await this.q('DELETE FROM projects WHERE id = ?', id).run(); }

  async members(projectId: number) { return this.membersOfMany([projectId]); }
  async membersOfMany(ids: number[]) {
    if (!ids.length) return [];
    const r = await this.q(`SELECT m.*, u.display_name, u.avatar_color FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.role DESC, u.display_name`, ...ids).all<Row>();
    return r.results.map(toMember);
  }
  async setMembers(projectId: number, members: ProjectMember[]) {
    await this.db.batch([
      this.q('DELETE FROM project_members WHERE project_id = ?', projectId),
      ...members.map((m) => this.q('INSERT INTO project_members (project_id, user_id, role, days_json) VALUES (?, ?, ?, ?)', projectId, m.userId, m.role, JSON.stringify(m.days))),
    ]);
  }
  async setMemberDays(projectId: number, userId: number, days: ProjectMember['days']) {
    await this.q('UPDATE project_members SET days_json = ? WHERE project_id = ? AND user_id = ?', JSON.stringify(days), projectId, userId).run();
  }

  async tasks(projectId: number) { return (await this.q('SELECT * FROM project_tasks WHERE project_id = ? ORDER BY sort, id', projectId).all<Row>()).results.map(toTask); }
  async findTask(id: number) { const r = await this.q('SELECT * FROM project_tasks WHERE id = ?', id).first<Row>(); return r ? toTask(r) : null; }
  async createTask(projectId: number, w: TaskWrite, createdBy: number) {
    const r = await this.q(`INSERT INTO project_tasks (project_id, title, description, assignee_id, size, status, sprint_no, version_id, sort, created_by, done_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${w.status === 'done' ? NOW : 'NULL'})`,
      projectId, w.title, w.description, w.assigneeId, w.size, w.status, w.sprintNo, w.versionId, w.sort, createdBy).run();
    return Number(r.meta.last_row_id);
  }
  async updateTask(id: number, w: TaskWrite, doneAt: string | null) {
    await this.q('UPDATE project_tasks SET title = ?, description = ?, assignee_id = ?, size = ?, status = ?, sprint_no = ?, version_id = ?, sort = ?, done_at = ? WHERE id = ?',
      w.title, w.description, w.assigneeId, w.size, w.status, w.sprintNo, w.versionId, w.sort, doneAt, id).run();
  }
  async deleteTask(id: number) { await this.q('DELETE FROM project_tasks WHERE id = ?', id).run(); }

  async versions(projectId: number) {
    return (await this.q('SELECT * FROM project_versions WHERE project_id = ? ORDER BY COALESCE(cut_date, release_date, \'9999\'), id', projectId).all<Row>()).results.map(toVersion);
  }
  async findVersion(id: number) { const r = await this.q('SELECT * FROM project_versions WHERE id = ?', id).first<Row>(); return r ? toVersion(r) : null; }
  async createVersion(projectId: number, w: VersionWrite) {
    const r = await this.q('INSERT INTO project_versions (project_id, name, goal, checklist_json, cut_date, release_date, build_url, playable, notes, closed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      projectId, w.name, w.goal, JSON.stringify(w.checklist), w.cutDate, w.releaseDate, w.buildUrl, w.playable === null ? null : w.playable ? 1 : 0, w.notes, w.closed ? 1 : 0).run();
    return Number(r.meta.last_row_id);
  }
  async updateVersion(id: number, w: VersionWrite) {
    await this.q('UPDATE project_versions SET name = ?, goal = ?, checklist_json = ?, cut_date = ?, release_date = ?, build_url = ?, playable = ?, notes = ?, closed = ? WHERE id = ?',
      w.name, w.goal, JSON.stringify(w.checklist), w.cutDate, w.releaseDate, w.buildUrl, w.playable === null ? null : w.playable ? 1 : 0, w.notes, w.closed ? 1 : 0, id).run();
  }
  async deleteVersion(id: number) { await this.q('DELETE FROM project_versions WHERE id = ?', id).run(); }

  async dailies(projectId: number, from: string, to: string) {
    return (await this.q('SELECT * FROM project_dailies WHERE project_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC, created_at', projectId, from, to).all<Row>()).results.map(toDaily);
  }
  async lastDaily(projectId: number, userId: number, before: string) {
    const r = await this.q('SELECT * FROM project_dailies WHERE project_id = ? AND user_id = ? AND date < ? ORDER BY date DESC LIMIT 1', projectId, userId, before).first<Row>();
    return r ? toDaily(r) : null;
  }
  async findDaily(id: number) { const r = await this.q('SELECT * FROM project_dailies WHERE id = ?', id).first<Row>(); return r ? toDaily(r) : null; }
  async upsertDaily(d: Omit<Daily, 'id' | 'createdAt'>) {
    await this.q(`INSERT INTO project_dailies (project_id, user_id, date, prev_text, prev_done, next_text, blocker) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (project_id, user_id, date) DO UPDATE SET prev_text = excluded.prev_text, prev_done = excluded.prev_done, next_text = excluded.next_text, blocker = excluded.blocker`,
      d.projectId, d.userId, d.date, d.prevText, d.prevDone === null ? null : d.prevDone ? 1 : 0, d.nextText, d.blocker).run();
  }
  async deleteDaily(projectId: number, userId: number, date: string) {
    const r = await this.q('DELETE FROM project_dailies WHERE project_id = ? AND user_id = ? AND date = ?', projectId, userId, date).run();
    return (r.meta.changes ?? 0) > 0;
  }
  async replies(ids: number[]) {
    if (!ids.length) return [];
    const r = await this.q(`SELECT * FROM project_daily_replies WHERE daily_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`, ...ids).all<Row>();
    return r.results.map((x): DailyReply => ({ id: Number(x.id), dailyId: Number(x.daily_id), userId: Number(x.user_id), text: String(x.text), createdAt: String(x.created_at) }));
  }
  async addReply(dailyId: number, userId: number, text: string) { await this.q('INSERT INTO project_daily_replies (daily_id, user_id, text) VALUES (?, ?, ?)', dailyId, userId, text).run(); }
  async todaysDailies(userId: number, date: string) {
    return (await this.q('SELECT project_id FROM project_dailies WHERE user_id = ? AND date = ?', userId, date).all<Row>()).results.map((r) => Number(r.project_id));
  }

  async reviews(projectId: number, sprintNo: number) {
    const r = await this.q('SELECT * FROM project_sprint_reviews WHERE project_id = ? AND sprint_no = ?', projectId, sprintNo).all<Row>();
    return r.results.map((x): SprintReview => ({ sprintNo: Number(x.sprint_no), userId: Number(x.user_id), load: x.load as Load, note: String(x.note) }));
  }
  async setReview(projectId: number, sprintNo: number, userId: number, load: Load, note: string) {
    await this.q(`INSERT INTO project_sprint_reviews (project_id, sprint_no, user_id, load, note) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (project_id, sprint_no, user_id) DO UPDATE SET load = excluded.load, note = excluded.note`, projectId, sprintNo, userId, load, note).run();
  }

  async events(projectId: number) { return (await this.q('SELECT * FROM project_events WHERE project_id = ? ORDER BY date, hour', projectId).all<Row>()).results.map(toEvent); }
  async findEvent(id: number) { const r = await this.q('SELECT * FROM project_events WHERE id = ?', id).first<Row>(); return r ? toEvent(r) : null; }
  async createEvent(projectId: number, w: EventWrite) {
    const r = await this.q('INSERT INTO project_events (project_id, kind, title, date, hour, note) VALUES (?, ?, ?, ?, ?, ?)', projectId, w.kind, w.title, w.date, w.hour, w.note).run();
    return Number(r.meta.last_row_id);
  }
  async updateEvent(id: number, w: EventWrite) { await this.q('UPDATE project_events SET kind = ?, title = ?, date = ?, hour = ?, note = ? WHERE id = ?', w.kind, w.title, w.date, w.hour, w.note, id).run(); }
  async deleteEvent(id: number) { await this.q('DELETE FROM project_events WHERE id = ?', id).run(); }

  async retros(projectId: number) { return (await this.q('SELECT * FROM project_retros WHERE project_id = ? ORDER BY date DESC, id DESC', projectId).all<Row>()).results.map(toRetro); }
  async findRetro(id: number) { const r = await this.q('SELECT * FROM project_retros WHERE id = ?', id).first<Row>(); return r ? toRetro(r) : null; }
  async createRetro(projectId: number, title: string, date: string) {
    return Number((await this.q('INSERT INTO project_retros (project_id, title, date) VALUES (?, ?, ?)', projectId, title, date).run()).meta.last_row_id);
  }
  async setRetroPhase(id: number, phase: RetroPhase) { await this.q('UPDATE project_retros SET phase = ? WHERE id = ?', phase, id).run(); }
  async deleteRetro(id: number) { await this.q('DELETE FROM project_retros WHERE id = ?', id).run(); }
  async cards(retroId: number) {
    const [c, v] = await Promise.all([
      this.q('SELECT * FROM project_retro_cards WHERE retro_id = ? ORDER BY created_at, id', retroId).all<Row>(),
      this.q('SELECT v.card_id, v.user_id FROM project_retro_votes v JOIN project_retro_cards c ON c.id = v.card_id WHERE c.retro_id = ?', retroId).all<Row>(),
    ]);
    return c.results.map((r): RetroCard => ({
      id: Number(r.id), retroId: Number(r.retro_id), userId: Number(r.user_id), col: r.col as RetroCol, text: String(r.text), anonymous: Number(r.anonymous) === 1,
      actionTaskId: n(r.action_task_id), createdAt: String(r.created_at), votes: v.results.filter((x) => Number(x.card_id) === Number(r.id)).map((x) => Number(x.user_id)),
    }));
  }
  async findCard(id: number) {
    const r = await this.q('SELECT retro_id FROM project_retro_cards WHERE id = ?', id).first<Row>();
    return r ? (await this.cards(Number(r.retro_id))).find((c) => c.id === id) ?? null : null;
  }
  async addCard(retroId: number, userId: number, col: RetroCol, text: string, anonymous: boolean) {
    return Number((await this.q('INSERT INTO project_retro_cards (retro_id, user_id, col, text, anonymous) VALUES (?, ?, ?, ?, ?)', retroId, userId, col, text, anonymous ? 1 : 0).run()).meta.last_row_id);
  }
  async deleteCard(id: number) { await this.q('DELETE FROM project_retro_cards WHERE id = ?', id).run(); }
  async toggleVote(cardId: number, userId: number) {
    const r = await this.q('DELETE FROM project_retro_votes WHERE card_id = ? AND user_id = ?', cardId, userId).run();
    if (!(r.meta.changes ?? 0)) await this.q('INSERT INTO project_retro_votes (card_id, user_id) VALUES (?, ?)', cardId, userId).run();
  }
  async setCardAction(cardId: number, taskId: number) { await this.q('UPDATE project_retro_cards SET action_task_id = ? WHERE id = ?', taskId, cardId).run(); }
}
