# wlb-api

Backend ของ **Balance Our Day**: เว็บแอปในกลุ่มสำหรับดูตารางชีวิตประจำสัปดาห์ สัดส่วนเวลาแต่ละหมวด และเรียนคอร์สตามลำดับ

- Runtime: Cloudflare Workers + [Hono](https://hono.dev)
- DB: Cloudflare D1 (SQLite) + Drizzle ORM
- รูปภาพ: Cloudflare R2
- นำเข้าคอร์สด้วย JSON (`POST /api/import/course`) และ MCP server (`/mcp`) ให้ Claude เพิ่มคอร์สเองได้

Frontend อยู่ที่ [wlb-web](https://github.com/NattsuSummer/wlb-web)

> สถานะ: กำลังเริ่มสร้าง (เฟส 0–1)
