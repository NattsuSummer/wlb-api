import type { Repositories } from '../interfaces';
import { D1CourseCategoryRepository, D1TimeCategoryRepository } from './category-repository';
import { D1CourseRepository, D1PackRepository, D1ProgressRepository } from './course-repository';
import type { D1Database } from './db';
import { D1PrivacyRepository } from './privacy-repository';
import { D1ScheduleRepository } from './schedule-repository';
import { D1TokenRepository } from './token-repository';
import { D1UserRepository } from './user-repository';

export function d1Repositories(db: D1Database): Repositories {
  return {
    users: new D1UserRepository(db),
    tokens: new D1TokenRepository(db),
    timeCategories: new D1TimeCategoryRepository(db),
    courseCategories: new D1CourseCategoryRepository(db),
    packs: new D1PackRepository(db),
    courses: new D1CourseRepository(db),
    progress: new D1ProgressRepository(db),
    schedules: new D1ScheduleRepository(db),
    privacy: new D1PrivacyRepository(db),
  };
}
