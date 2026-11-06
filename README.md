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

## API (เฟส 1)

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
