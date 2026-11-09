# wlb-api

Backend ของ **Balance Our Day**: เว็บแอปในกลุ่มสำหรับดูตารางชีวิตประจำสัปดาห์ สัดส่วนเวลาแต่ละหมวด และเรียนคอร์สตามลำดับ

- Cloudflare Workers (ไม่มี runtime dependency) + D1 (SQLite)
- Login ด้วย username/password → ได้ bearer token (session 1 วัน หรือ 30 วันถ้าติ๊ก "จำฉัน")
- เวลาทั้งหมดเป็น Asia/Bangkok (UTC+7) · weekday 0 = จันทร์
- Frontend: [wlb-web](https://github.com/NattsuSummer/wlb-web)
- โครงสร้างแบบ clean architecture (`domain` / `repositories` / `services` / `usecases` / `http`) — ดู [ARCHITECTURE.md](ARCHITECTURE.md)

## พัฒนาในเครื่อง

```bash
npm install
npm test            # node:test + node:sqlite (ไม่ต้องใช้ Cloudflare)
npm run typecheck
npm run dev         # wrangler dev (ต้อง migrate local ก่อน: npm run db:migrate:local)
```

## API (เฟส 1–2)

ทุก endpoint (ยกเว้น login/health) ต้องส่ง `Authorization: Bearer <token>`
ผู้ใช้ที่ยังต้องเปลี่ยนรหัสผ่าน ใช้ได้แค่ `GET /api/me`, `POST /api/me/password`, `POST /api/auth/logout`

| Method | Path | ทำอะไร |
|---|---|---|
| POST | `/api/auth/login` | `{username, password, remember}` → `{token, expiresAt, user}` · ผิด 10 ครั้งล็อก 15 นาที |
| POST | `/api/auth/logout` | ยกเลิก session นี้ |
| GET / PATCH | `/api/me` | ข้อมูลตัวเอง · แก้ `displayName`, `locale`, `theme`, `avatarColor` |
| POST | `/api/me/password` | `{currentPassword, newPassword}` (≥ 8 ตัว มีตัวอักษร+ตัวเลข ห้ามซ้ำรหัสเดิม) |
| GET / PUT | `/api/me/privacy` | โหมดส่วนตัว + ระดับการแชร์แต่ละเรื่อง |
| GET / POST / DELETE | `/api/me/tokens[/:id]` | API token ส่วนตัว (แสดงตัวเต็มครั้งเดียว) |
| GET | `/api/now` | ตอนนี้เป็นเวลาอะไร ของฉันและคนอื่น (ตาม privacy) |
| GET | `/api/users` | การ์ดสมาชิก (ตาม privacy) |
| GET | `/api/schedules/:userId` | ตาราง 168 ช่อง + สรุป % + เป้า (ตาม privacy) |
| POST | `/api/schedules/:userId/preview` | ลองดูว่าจะทับอะไร `{days, from, to, categoryIds, description}` |
| PUT | `/api/schedules/:userId/range` | เขียนช่วงเวลา ถ้าทับของเดิมต้องส่ง `confirmOverwrite: true` (ไม่งั้นได้ 409) · คืน `undo` |
| POST | `/api/schedules/:userId/clear` | ล้างช่วงเวลา · คืน `undo` |
| PUT | `/api/schedules/:userId/cells` | ตั้งค่าทีละช่อง (ใช้กับปุ่มเลิกทำ) |
| PUT | `/api/schedules/:userId/targets` | เป้า % ต่อหมวด (ทั้งหมด 0 = ยังไม่ตั้ง หรือรวม = 100) |
| GET | `/api/time-categories` · `/api/course-categories` | หมวดหมู่ |
| POST / PATCH / DELETE | `/api/time-categories[/:id]` | admin · ลบหมวดที่ยังมีช่องใช้อยู่ไม่ได้ (409) |
| GET / POST / PATCH | `/api/admin/users[/:id]` | admin · สร้างผู้ใช้, เปลี่ยน role, ปิดบัญชี (ต้องเหลือ admin อย่างน้อย 1 คน) |
| POST | `/api/admin/users/:id/reset-password` | admin · ผู้ใช้ต้องเปลี่ยนรหัสอีกครั้ง |
| GET / DELETE | `/api/admin/tokens[/:id]` | admin · ดูและยกเลิก API token ทุกคน |

ช่องหนึ่งใส่ได้หลายหมวด (`categoryIds`) ตอนสรุปจะหารชั่วโมงเท่ากัน เช่น 2 หมวด = หมวดละ 0.5 ชม.

## API คอร์ส (เฟส 3)

คอร์สเขียนเป็น JSON รูปแบบเดียวกันทุกทาง (เว็บ, import, API token, AI) — ดูรายละเอียดที่ `GET /api/import/guide.md` (เปิดได้ไม่ต้อง login เอาไว้ส่งให้ AI อ่าน)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/import/guide.md` | AI Guide: รูปแบบ JSON + หมวด + ตัวอย่าง |
| POST | `/api/import/validate` | ตรวจ JSON → `{errors, warnings, draft}` (errors บล็อกการบันทึก, warnings ไม่บล็อก) |
| POST | `/api/courses` · `/api/import/course` | สร้างคอร์ส · ส่งด้วย API token จะเป็น **ร่าง** (`?status=published` เพื่อเผยแพร่ทันที) |
| GET | `/api/courses` | catalog: packs (เรียงตามลำดับ) + คอร์สเดี่ยว + กำลังเรียน พร้อม progress ของฉัน |
| GET | `/api/courses/:id` | รายละเอียด + บท + pack + `skippedCourses` (คอร์สก่อนหน้าใน pack ที่ยังไม่จบ) |
| PUT | `/api/courses/:id` | แก้ทั้งคอร์ส (JSON เดิม) · บท/แบบฝึกที่มี `id` เดิมจะเก็บ progress ไว้ |
| PATCH | `/api/courses/:id` | `visibility`, `status`, `packId`, `orderInPack` |
| DELETE | `/api/courses/:id` | ผู้สร้างหรือ admin |
| GET | `/api/courses/:id/export` | JSON สำหรับแก้/นำเข้าใหม่ |
| GET | `/api/lessons/:id` | เนื้อหาบท + แบบฝึก + `skipped` (บทก่อนหน้าที่ยังไม่จบ) + คำตอบเพื่อน (ถ้าเขาแชร์) |
| POST | `/api/lessons/:id/complete` | `{done: true\|false}` |
| POST | `/api/exercises/:id/attempt` | `{answer}` · mcq = index, checklist = [index], text = ข้อความ · เฉลย mcq เห็นหลังตอบครั้งแรก |
| GET / POST / PATCH / DELETE | `/api/packs[/:id]` | ใครก็สร้าง pack ได้ · แก้/ลบได้เฉพาะผู้สร้างหรือ admin · ลบ pack แล้วคอร์สกลายเป็นคอร์สเดี่ยว |
| GET | `/api/admin/courses` | admin · ทุกคอร์ส รวมส่วนตัวและร่าง |
| POST / PATCH / DELETE | `/api/course-categories[/:id]` | admin · ลบหมวดที่ยังมีคอร์สใช้ไม่ได้ (409) |

สิทธิ์: คอร์ส `group` + `published` ทุกคนเห็น · `private` หรือร่าง เห็นเฉพาะผู้สร้าง (และ admin ในหน้า admin)

## กิจวัตร (Routines) — ตารางออกกำลังกาย / ตารางอาหาร

- **คลัง**: ท่าออกกำลังกาย (กล้ามเนื้อ, อุปกรณ์, เซ็ต/ครั้ง/วินาที, วิธีทำ) และเมนูอาหาร (มื้อ, วัตถุดิบ, วิธีทำ, kcal + P/C/F ต่อ 1 ที่)
- **แผน**: workout = 1 ครั้งที่เล่น (warmup / main / cooldown) · meal = อาหาร 1 วัน (breakfast / lunch / dinner / snack) รวม kcal + P/C/F ให้
- **ผูกกับสัปดาห์**: แต่ละคนผูกแผนกับวัน (และชั่วโมงได้ ไม่บังคับ) ของตัวเอง · เป็นไกด์ ไม่บันทึกว่าทำแล้ว
- JSON รูปแบบเดียว `{ items: [...], plans: [...] }` · guide: `GET /api/routines/guide.md` (public)

| Method | Path | ทำอะไร |
|---|---|---|
| GET | `/api/routines` | คลัง + แผน (พร้อมยอดรวม / นาที / วันที่ฉันผูกไว้) |
| GET | `/api/routines/week` | แผนที่ฉันผูกกับแต่ละวัน/ชั่วโมง |
| POST | `/api/routines/validate` · `/api/routines/import` | ตรวจ / สร้าง (API token → ร่าง) |
| GET / PUT / PATCH / DELETE | `/api/routines/items/:id` · `/api/routines/plans/:id` | ดู / แก้ / visibility-status / ลบ (ท่าที่ยังอยู่ในแผนลบไม่ได้) |
| GET | `/api/routines/{items,plans}/:id/export` | JSON ไว้แก้/นำเข้าใหม่ |
| PUT | `/api/routines/plans/:id/days` | `{ days: [{ weekday: 0–6, hour: 0–23 \| null }] }` แทนที่ของเดิม |

MCP tools: `get_routine_guide`, `list_routines`, `get_routine_plan`, `validate_routines`, `create_routines`, `update_routine_item`, `update_routine_plan`

## MCP connector (เฟส 4) — ให้ Claude เพิ่มคอร์สให้

URL ของ connector: `https://balance-our-day-api.nattsummer-14.workers.dev/mcp`

ใน Claude: **Settings → Connectors → Add custom connector** → ใส่ URL ด้านบน → Connect → login เว็บ Balance Our Day → กดอนุญาต
ไม่ต้องคัดลอก token · Claude ของใครก็ใช้ได้ เพราะ server ส่งคำแนะนำ + คำอธิบาย tool ให้เอง

| Tool | ทำอะไร |
|---|---|
| `get_import_guide` | อ่านรูปแบบ JSON (บอกให้เรียกก่อน) |
| `list_course_categories` · `list_packs` · `list_my_courses` | ข้อมูลประกอบ |
| `get_course` | JSON ของคอร์ส (มี id บท/แบบฝึก ไว้แก้) |
| `validate_course` | ตรวจโดยไม่บันทึก |
| `create_course` | บันทึกเป็น **ร่าง** + ส่งลิงก์พรีวิวกลับ (ถ้าตอนอนุญาตติ๊ก "เผยแพร่ได้ทันที" จะเผยแพร่เลย) |
| `update_course` | แก้ได้เฉพาะคอร์สที่ตัวเองสร้าง |

OAuth 2.1: dynamic client registration (`/oauth/register`), authorization code + PKCE S256 (`/oauth/authorize` → หน้า consent บนเว็บ → `/oauth/token`), refresh token หมุนทุกครั้ง
· discovery: `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`
· access token อายุ 30 วัน เห็นในหน้า ตั้งค่า › API tokens ชื่อ "Claude (MCP)" — ลบที่นั่น = ตัดการเชื่อมต่อ

## ความเป็นส่วนตัว

แต่ละคนตั้งได้ว่าคนอื่นเห็นอะไร: `schedule` / `nowStatus` = `full | cat | hide` (cat = เห็นหมวดแต่ไม่เห็นคำอธิบาย), `summary` / `courses` / `answers` = `show | hide`, และ `privateMode` ซ่อนทุกอย่าง · admin เห็นตามกฎเดียวกับทุกคน

## Deploy

ทำผ่าน GitHub Actions (`.github/workflows/deploy.yml`) เมื่อ push เข้า `main` ต้องมี repo secrets:

| Secret | คืออะไร |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token ที่มีสิทธิ์ Workers Scripts: Edit และ D1: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | account id ของ Cloudflare |
| `D1_DATABASE_ID` | id จาก `wrangler d1 create balance-our-day` |

### Seed ข้อมูลเริ่มต้น (ครั้งเดียว)

repo เป็น public ข้อมูลตารางจริงกับรหัสเริ่มต้นจึงเก็บเป็น secret ไม่อยู่ในโค้ด:

1. `python3 scripts/excel-to-seed.py <ไฟล์.xlsx>` → `seed/seed.json` (git ignore ไว้แล้ว) · ตัวอย่างโครงสร้าง: `seed/seed.example.json`
2. ตั้ง secret `SEED_DATA_B64` = `gzip -9 -c seed/seed.json | base64 -w0` และ `SEED_PASSWORD` = รหัสเริ่มต้น
3. Actions → **Seed database (one time)** → Run workflow · รันซ้ำได้ ไม่ทับข้อมูลเดิม
