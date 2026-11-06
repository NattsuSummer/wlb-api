// MCP server (Streamable HTTP, JSON responses). Lets an AI assistant such as Claude read the guide and
// create / update the user's courses. Courses arrive as drafts unless the user allowed direct publishing.
import { AppError } from '../../domain/errors';
import { LIMITS } from '../../domain/course';
import type { Actor } from '../../domain/user';
import { GetImportGuideUseCase, ExportCourseUseCase, ImportCourseUseCase, ListCatalogUseCase, UpdateCourseUseCase, ValidateCourseUseCase } from '../courses';
import type { Deps } from '../deps';

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
Write course content in the language the user asks for (often Thai).`;

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
}
