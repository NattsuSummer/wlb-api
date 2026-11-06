// Builds what one member may see of another — shared by the members page, "now" and schedule views.
import { courseState, inCatalog, percent } from '../domain/course';
import { maskSlot, maskWeek, visibility } from '../domain/privacy';
import { nowInfo, summarize } from '../domain/schedule';
import { bangkokNow } from '../domain/time';
import { publicUser, type User } from '../domain/user';
import type { CourseRepository, PrivacyRepository, ProgressRepository, ScheduleRepository, TimeCategoryRepository } from '../repositories/interfaces';

export class MemberViewService {
  constructor(
    private schedules: ScheduleRepository,
    private privacy: PrivacyRepository,
    private categories: TimeCategoryRepository,
    private courses: CourseRepository,
    private progress: ProgressRepository,
  ) {}

  /** Courses `userId` is in the middle of, limited to ones the viewer could open too. */
  async coursesInProgress(userId: number, viewerId: number) {
    const [all, byCourse] = await Promise.all([this.courses.listSummaries(), this.progress.byCourse(userId)]);
    return all
      .filter((c) => byCourse.has(c.id) && inCatalog(c, { id: viewerId, role: 'member' }))
      .map((c) => {
        const p = byCourse.get(c.id)!;
        const done = Math.min(p.done, c.lessonCount);
        return { id: c.id, title: c.title, categoryId: c.categoryId, done, total: c.lessonCount, percent: percent(done, c.lessonCount), state: courseState(done, c.lessonCount), lastAt: p.lastAt };
      })
      .filter((c) => c.state === 'in_progress')
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  }

  async categoryIds() {
    return (await this.categories.list()).map((c) => c.id);
  }

  /** Member card: current activity and weekly summary, filtered by the owner's privacy. */
  async card(u: User, viewerId: number, at: Date, categoryIds?: number[]) {
    const isOwner = u.id === viewerId;
    const p = await this.privacy.load(u.id);
    const nowLevel = visibility(p, 'nowStatus', isOwner);
    const schedLevel = visibility(p, 'schedule', isOwner);
    const sumLevel = visibility(p, 'summary', isOwner);
    const week = nowLevel !== 'hide' || sumLevel !== 'hide' || schedLevel !== 'hide' ? await this.schedules.loadWeek(u.id) : null;

    let now = null;
    if (week && nowLevel !== 'hide') {
      const info = nowInfo(week, bangkokNow(at));
      now = {
        ...info,
        current: info.current ? { ...info.current, slot: maskSlot(info.current.slot, nowLevel) } : null,
        next: info.next ? { ...info.next, slot: maskSlot(info.next.slot, nowLevel) } : null,
      };
    }
    const cats = categoryIds ?? (await this.categoryIds());
    const summary = week && sumLevel !== 'hide' ? summarize(week, cats, await this.schedules.loadTargets(u.id)) : null;
    const coursesLevel = visibility(p, 'courses', isOwner);
    return {
      user: publicUser(u),
      isMe: isOwner,
      privateMode: !isOwner && p.privateMode,
      visible: { schedule: schedLevel, now: nowLevel, summary: sumLevel, courses: coursesLevel },
      now,
      summary,
      courses: coursesLevel === 'hide' ? null : await this.coursesInProgress(u.id, viewerId),
    };
  }

  /** Full schedule view (week + summary + targets), filtered by the owner's privacy. */
  async schedule(ownerId: number, viewerId: number) {
    const isOwner = ownerId === viewerId;
    const p = await this.privacy.load(ownerId);
    const schedLevel = visibility(p, 'schedule', isOwner);
    const sumLevel = visibility(p, 'summary', isOwner);
    const week = await this.schedules.loadWeek(ownerId);
    const targets = await this.schedules.loadTargets(ownerId);
    return {
      visible: { schedule: schedLevel, summary: sumLevel },
      week: schedLevel === 'hide' ? null : maskWeek(week, schedLevel),
      targets: sumLevel === 'hide' ? null : targets,
      summary: sumLevel === 'hide' ? null : summarize(week, await this.categoryIds(), targets),
    };
  }
}
