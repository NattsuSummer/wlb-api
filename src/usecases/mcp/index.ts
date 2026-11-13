// MCP server (Streamable HTTP, JSON responses). Lets an AI assistant such as Claude read the guide and
// create / update the user's courses. Courses arrive as drafts unless the user allowed direct publishing.
import { GetBodyStatsUseCase } from '../body';
import * as P from '../projects';
import { AppError, validationError } from '../../domain/errors';
import { LIMITS } from '../../domain/course';
import type { Actor } from '../../domain/user';
import { GetImportGuideUseCase, ExportCourseUseCase, ImportCourseUseCase, ListCatalogUseCase, UpdateCourseUseCase, ValidateCourseUseCase } from '../courses';
import type { Deps } from '../deps';
import { ExportRoutinePlanUseCase, GetRoutineGuideUseCase, ImportRoutinesUseCase, ListRoutinesUseCase, UpdateRoutineItemUseCase, UpdateRoutinePlanUseCase, ValidateRoutinesUseCase } from '../routines';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface JsonRpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
type Json = Record<string, unknown>;

const INSTRUCTIONS = `Balance Our Day is a small group's site for weekly life planning and learning courses.
With these tools you can write courses for the signed-in user.
1. Call get_import_guide first and follow it exactly (JSON shape, categories, limits).
2. Use list_course_categories and list_packs to pick a category and, for a series, a pack + order.
3. Call validate_course, fix every error, then create_course. Warnings are fine.
4. New courses are drafts visible only to the user unless they allowed direct publishing. Give the user the preview link from the result so they can check and publish.
5. To change a course, call get_course, edit the JSON (keep lesson/exercise ids so learners keep their progress), then update_course. You can only update the user's own courses.
Routines (exercise library, meal library, workout plans, one-day meal plans with calories and protein/carbs/fat):
call get_routine_guide first, check list_routines so you reuse existing exercises/meals by title, validate_routines, then create_routines.
Users link plans to days of their week in the site. Routines are general guidance, not medical advice.
Projects (agile tracking for the group's side projects): list_projects, get_project_board, get_sprint, get_project_dailies to read; add_project_tasks to break work into tasks or plan a sprint.
get_my_body_stats reads the user's own weekly weight/height/waist/body-fat check-ins (private, read-only) so you can size meal plans; never share them.
Write content in the language the user asks for (often Thai).`;

const ex = { type: 'object', additionalProperties: true } as const;
const COURSE_SCHEMA = {
  type: 'object',
  description: 'A course in the import format (see get_import_guide).',
  required: ['title', 'lessons'],
  properties: {
    title: { type: 'string', maxLength: LIMITS.title },
    description: { type: 'string', maxLength: LIMITS.description },
    category: { type: 'string', description: 'Category name (English or Thai) from list_course_categories' },
    level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
    visibility: { type: 'string', enum: ['group', 'private'] },
    coverUrl: { type: 'string', description: 'https image URL' },
    pack: { type: 'object', properties: { title: { type: 'string' }, order: { type: 'integer', minimum: 1 } } },
    lessons: {
      type: 'array', minItems: 1, maxItems: LIMITS.lessons,
      items: {
        type: 'object', required: ['title'],
        properties: {
          id: { type: 'integer', description: 'Keep when updating an existing lesson' },
          title: { type: 'string' },
          minutes: { type: 'integer', minimum: 1, maximum: 600 },
          content: { type: 'string', description: 'Markdown' },
          links: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['url'] } },
          images: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, alt: { type: 'string' } }, required: ['url'] } },
          exercises: {
            type: 'array', maxItems: LIMITS.exercises,
            items: {
              type: 'object', required: ['type', 'prompt'],
              properties: {
                id: { type: 'integer' },
                type: { type: 'string', enum: ['mcq', 'checklist', 'text'] },
                prompt: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' }, description: 'mcq: 2–8 choices' },
                answer: { type: 'integer', description: 'mcq: index of the correct choice (0 = first)' },
                items: { type: 'array', items: { type: 'string' }, description: 'checklist items' },
                sample: { type: 'string', description: 'text: example answer' },
              },
            },
          },
        },
      },
    },
  },
};

const ROUTINES_SCHEMA = {
  type: 'object',
  description: 'Routines in the import format: { "items": [exercise or meal], "plans": [workout or meal plan] } (see get_routine_guide).',
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: true, required: ['kind', 'title'],
      properties: { kind: { type: 'string', enum: ['exercise', 'meal'] }, title: { type: 'string' } } } },
    plans: { type: 'array', items: { type: 'object', additionalProperties: true, required: ['kind', 'title', 'entries'],
      properties: { kind: { type: 'string', enum: ['workout', 'meal'] }, title: { type: 'string' }, entries: { type: 'array', items: { type: 'object', additionalProperties: true } } } } },
  },
};

const noArgs = { type: 'object', properties: {}, additionalProperties: false };
const idArg = { course_id: { type: 'integer', description: 'Course id (from list_my_courses or create_course)' } };

export const TOOLS = [
  { name: 'get_import_guide', title: 'Read the course format guide', description: 'Read this first. The JSON format for courses, the category list, limits and an example.', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'list_course_categories', title: 'List course categories', description: 'Categories a course can use.', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'list_packs', title: 'List packs', description: 'Packs (ordered series of courses) and the courses already in each, with their order.', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'list_my_courses', title: 'List my courses', description: 'Courses the signed-in user created, with status and links.', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'get_course', title: 'Get a course as JSON', description: 'A course in the import format, with lesson and exercise ids, ready to edit and send to update_course.', inputSchema: { type: 'object', properties: idArg, required: ['course_id'] }, annotations: { readOnlyHint: true } },
  { name: 'validate_course', title: 'Check a course', description: 'Check a course without saving. Returns errors (must fix) and warnings (fine).', inputSchema: { type: 'object', properties: { course: COURSE_SCHEMA }, required: ['course'] }, annotations: { readOnlyHint: true } },
  { name: 'create_course', title: 'Create a course', description: 'Save a new course for the user. It is a draft (only the user sees it) unless they allowed direct publishing. Returns the preview link.', inputSchema: { type: 'object', properties: { course: COURSE_SCHEMA }, required: ['course'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'get_routine_guide', title: 'Read the routine format guide', description: 'Read before creating routines: JSON format for exercises, meals, workout plans and one-day meal plans, with an example.', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'list_routines', title: 'List routines', description: 'Exercises, meals and plans in the library (reuse items by title instead of duplicating them).', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'get_routine_plan', title: 'Get a plan as JSON', description: 'A plan with the items it uses, in the import format.', inputSchema: { type: 'object', properties: { plan_id: { type: 'integer' } }, required: ['plan_id'] }, annotations: { readOnlyHint: true } },
  { name: 'validate_routines', title: 'Check routines', description: 'Check routines JSON without saving. Returns errors (must fix) and warnings.', inputSchema: { type: 'object', properties: { routines: ROUTINES_SCHEMA }, required: ['routines'] }, annotations: { readOnlyHint: true } },
  { name: 'create_routines', title: 'Create routines', description: 'Save new exercises/meals and plans. Drafts unless the user allowed direct publishing. Returns links.', inputSchema: { type: 'object', properties: { routines: ROUTINES_SCHEMA }, required: ['routines'] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'update_routine_item', title: 'Update one of my exercises/meals', description: 'Replace an exercise or meal the user created.', inputSchema: { type: 'object', properties: { item_id: { type: 'integer' }, item: { type: 'object', additionalProperties: true } }, required: ['item_id', 'item'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'update_routine_plan', title: 'Update one of my plans', description: 'Replace a plan the user created (title, description, entries). Items must already exist.', inputSchema: { type: 'object', properties: { plan_id: { type: 'integer' }, plan: { type: 'object', additionalProperties: true } }, required: ['plan_id', 'plan'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'get_my_body_stats', title: 'Read my body stats', description: "The signed-in user's own weekly check-ins (weight, height, waist, body fat), goal weight and trend. Private to the user; read-only.", inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'list_projects', title: 'List my projects', description: 'Projects the user is a member of, with the current sprint, task counts and members (ids for assignees).', inputSchema: noArgs, annotations: { readOnlyHint: true } },
  { name: 'get_project_board', title: 'Read a project board', description: 'All tasks of a project (backlog = sprintNo null), its versions and the current sprint.', inputSchema: { type: 'object', properties: { project_id: { type: 'integer' } }, required: ['project_id'] }, annotations: { readOnlyHint: true } },
  { name: 'get_sprint', title: 'Read a sprint summary', description: 'Planned vs done per person, load votes (over/ok/under) and notes for a sprint, plus next sprint capacity. sprint = number or "current".', inputSchema: { type: 'object', properties: { project_id: { type: 'integer' }, sprint: { type: ['integer', 'string'] } }, required: ['project_id'] }, annotations: { readOnlyHint: true } },
  { name: 'get_project_dailies', title: 'Read daily check-ins', description: 'Daily check-ins (last round / this round / blockers) of the last 14 days.', inputSchema: { type: 'object', properties: { project_id: { type: 'integer' } }, required: ['project_id'] }, annotations: { readOnlyHint: true } },
  { name: 'add_project_tasks', title: 'Add tasks to a project', description: 'Add tasks: [{title, description?, size? S|M|L, assigneeId? (member user id), sprintNo? (null = backlog), versionId?}]. Use for breaking work down or planning a sprint.', inputSchema: { type: 'object', properties: { project_id: { type: 'integer' }, tasks: { type: 'array', items: { type: 'object', additionalProperties: true } } }, required: ['project_id', 'tasks'] }, annotations: { readOnlyHint: false } },
  { name: 'update_course', title: 'Update one of my courses', description: 'Replace a course the user created with new JSON. Keep lesson/exercise ids from get_course so learners keep their progress; lessons left out are removed.', inputSchema: { type: 'object', properties: { ...idArg, course: COURSE_SCHEMA }, required: ['course_id', 'course'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
];

const rpcError = (id: JsonRpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const text = (v: unknown) => ({ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) });

export class McpUseCase {
  constructor(private d: Deps) {}

  /** One JSON-RPC message → response, or null for notifications. */
  async execute(actor: Actor, msg: JsonRpcRequest): Promise<Json | null> {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
    const isNotification = msg.id === undefined || msg.id === null;
    if (isNotification) return null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
    switch (msg.method) {
      case 'initialize': {
        const asked = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '';
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'balance-our-day', title: 'Balance Our Day', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': {
        const name = msg.params?.name;
        const args = (msg.params?.arguments ?? {}) as Json;
        if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name)) return rpcError(msg.id, -32602, `Unknown tool: ${String(name)}`);
        try {
          return ok({ content: [text(await this.call(actor, name, args))], isError: false });
        } catch (e) {
          if (e instanceof AppError) return ok({ content: [text({ error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) })], isError: true });
          throw e;
        }
      }
      default: return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }

  private link = (id: number) => `${this.d.config.webUrl}/courses/${id}`;

  private async call(actor: Actor, name: string, a: Json): Promise<unknown> {
    const d = this.d;
    const courseId = () => {
      const v = a.course_id;
      if (!Number.isInteger(v) || (v as number) < 1) throw new AppError('validation', 'bad_request', 'course_id must be a positive integer');
      return v as number;
    };
    const course = () => {
      if (typeof a.course !== 'object' || a.course === null) throw new AppError('validation', 'bad_request', 'course must be a JSON object');
      return a.course;
    };
    if (name.includes('routine')) return this.callRoutine(actor, name, a);
    if (name === 'get_my_body_stats') return new GetBodyStatsUseCase(d).execute(actor);
    if (name === 'list_projects') return new P.ListProjectsUseCase(d).execute(actor);
    if (name === 'get_project_board') {
      const [board, proj] = await Promise.all([new P.ListTasksUseCase(d).execute(actor, a.project_id), new P.GetProjectUseCase(d).execute(actor, a.project_id)]);
      return { ...board, versions: proj.versions, members: proj.members.map((m) => ({ userId: m.userId, name: m.displayName })), url: `${d.config.webUrl}/projects/${proj.project.id}` };
    }
    if (name === 'get_sprint') return new P.GetSprintUseCase(d).execute(actor, a.project_id, a.sprint ?? 'current');
    if (name === 'get_project_dailies') return new P.ListDailiesUseCase(d).execute(actor, a.project_id, {});
    if (name === 'add_project_tasks') {
      if (!Array.isArray(a.tasks) || !a.tasks.length || a.tasks.length > 50) throw validationError('tasks must be a list of 1–50 tasks', { field: 'tasks' });
      const out = [];
      for (const t of a.tasks) out.push((await new P.CreateTaskUseCase(d).execute(actor, a.project_id, t as Record<string, unknown>)).task);
      return { created: out, url: `${d.config.webUrl}/projects/${Number(a.project_id)}?tab=board` };
    }
    switch (name) {
      case 'get_import_guide': return new GetImportGuideUseCase(d).execute();
      case 'list_course_categories':
        return (await d.repos.courseCategories.list()).map((c) => ({ id: c.id, nameEn: c.nameEn, nameTh: c.nameTh }));
      case 'list_packs': {
        const cat = await new ListCatalogUseCase(d).execute(actor);
        return cat.packs.map((p) => ({ id: p.id, title: p.title, courses: p.courses.map((c) => ({ id: c.id, title: c.title, order: c.orderInPack })) }));
      }
      case 'list_my_courses':
        return (await d.repos.courses.listSummaries()).filter((c) => c.createdBy === actor.id)
          .map((c) => ({ id: c.id, title: c.title, status: c.status, visibility: c.visibility, lessons: c.lessonCount, url: this.link(c.id) }));
      case 'get_course': return new ExportCourseUseCase(d).execute(actor, courseId());
      case 'validate_course': {
        const v = await new ValidateCourseUseCase(d).execute(actor, course());
        return { ok: v.errors.length === 0, errors: v.errors, warnings: v.warnings };
      }
      case 'create_course': {
        const grant = await d.repos.oauth.findGrantByAccessToken(actor.tokenId);
        const status = grant?.autoPublish ? 'published' : 'draft';
        const r = await new ImportCourseUseCase(d).execute(actor, course(), { status });
        return {
          id: r.id, status: r.status, url: this.link(r.id), warnings: r.warnings,
          note: r.status === 'draft' ? 'Saved as a draft. Share the url with the user; they can check it and press Publish.' : 'Published to the group.',
        };
      }
      case 'update_course': {
        const id = courseId();
        const c = await d.repos.courses.findById(id);
        if (!c || c.createdBy !== actor.id) throw new AppError('forbidden', 'forbidden', 'You can only update courses you created (see list_my_courses)');
        const r = await new UpdateCourseUseCase(d).execute(actor, id, course());
        return { id, url: this.link(id), warnings: r.warnings };
      }
    }
    throw new AppError('not_found', 'not_found', 'Unknown tool');
  }

  private async callRoutine(actor: Actor, name: string, a: Json): Promise<unknown> {
    const d = this.d;
    const id = (k: string) => {
      const v = a[k];
      if (!Number.isInteger(v) || (v as number) < 1) throw new AppError('validation', 'bad_request', `${k} must be a positive integer`);
      return v as number;
    };
    const obj = (k: string) => {
      if (typeof a[k] !== 'object' || a[k] === null) throw new AppError('validation', 'bad_request', `${k} must be a JSON object`);
      return a[k];
    };
    const link = (kind: 'items' | 'plans', i: number) => `${d.config.webUrl}/routines/${kind}/${i}`;
    switch (name) {
      case 'get_routine_guide': return new GetRoutineGuideUseCase(d).execute();
      case 'list_routines': {
        const r = await new ListRoutinesUseCase(d).execute(actor);
        return {
          items: r.items.map((i) => ({ id: i.id, kind: i.kind, title: i.title, ...(i.kind === 'exercise' ? { muscles: i.data.muscles } : { mealTypes: i.data.mealTypes, calories: i.data.calories }) })),
          plans: r.plans.map((p) => ({ id: p.id, kind: p.kind, title: p.title, mine: p.mine })),
        };
      }
      case 'get_routine_plan': return new ExportRoutinePlanUseCase(d).execute(actor, id('plan_id'));
      case 'validate_routines': {
        const v = await new ValidateRoutinesUseCase(d).execute(actor, obj('routines'));
        return { ok: v.errors.length === 0, errors: v.errors, warnings: v.warnings };
      }
      case 'create_routines': {
        const grant = await d.repos.oauth.findGrantByAccessToken(actor.tokenId);
        const r = await new ImportRoutinesUseCase(d).execute(actor, obj('routines'), { status: grant?.autoPublish ? 'published' : 'draft' });
        return {
          status: r.status, warnings: r.warnings,
          items: r.items.map((i) => ({ ...i, url: link('items', i.id) })),
          plans: r.plans.map((p) => ({ ...p, url: link('plans', p.id) })),
          note: r.status === 'draft' ? 'Saved as drafts. Share the plan urls with the user; they can check them, publish, and link plans to days of their week.' : 'Published to the group.',
        };
      }
      case 'update_routine_item': {
        const i = id('item_id');
        const it = await d.repos.routines.findItem(i);
        if (!it || it.createdBy !== actor.id) throw new AppError('forbidden', 'forbidden', 'You can only update items you created');
        return { ...(await new UpdateRoutineItemUseCase(d).execute(actor, i, obj('item'))), url: link('items', i) };
      }
      case 'update_routine_plan': {
        const i = id('plan_id');
        const p = await d.repos.routines.findPlan(i);
        if (!p || p.createdBy !== actor.id) throw new AppError('forbidden', 'forbidden', 'You can only update plans you created');
        return { ...(await new UpdateRoutinePlanUseCase(d).execute(actor, i, obj('plan'))), url: link('plans', i) };
      }
    }
    throw new AppError('not_found', 'not_found', 'Unknown tool');
  }
}
