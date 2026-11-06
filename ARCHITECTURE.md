# Architecture (clean architecture)

```
request ─► http (controllers) ─► usecases ─► services ─► repositories (interfaces)
                                     │                         ▲
                                     └──────► domain ◄─────────┤
                                                               │
                                          repositories/d1 ─────┘  (implements interfaces with Cloudflare D1)
```

Dependencies point **inward only**: `domain` imports nothing; `usecases` know only interfaces, never D1 or HTTP.

| Folder | หน้าที่ | ห้าม |
|---|---|---|
| `src/domain/` | Types + pure rules: schedule math (`planRange`, `summarize`, `nowInfo`), privacy rules, password policy, Bangkok time, `AppError` | import อะไรนอก domain |
| `src/repositories/interfaces.ts` | สัญญาว่าเก็บ/อ่านข้อมูลอะไรได้บ้าง (`UserRepository`, `TokenRepository`, `ScheduleRepository`, …) | — |
| `src/repositories/d1/` | SQL จริงบน D1 · `d1Repositories(db)` รวมทุกตัว | ใส่ business rule |
| `src/services/` | งานเทคนิคที่หลาย use case ใช้ร่วม: hash password (PBKDF2), ออก/ตรวจ token, `Clock`, `MemberViewService` (กรองข้อมูลตาม privacy) | รู้จัก HTTP |
| `src/usecases/<feature>/` | 1 class = 1 action ของผู้ใช้ (`LoginUseCase`, `WriteRangeUseCase`, `AdminUpdateUserUseCase`, …) — เช็คสิทธิ์ + กฎธุรกิจ แล้วโยน `AppError` | รู้จัก Request/Response, SQL |
| `src/http/` | `router.ts`, `app.ts` (CORS, auth, gate บังคับเปลี่ยนรหัส), `http.ts` (parse input, map `AppError` → status), `controllers/*` (แปลง HTTP ↔ use case) | ใส่ business rule |
| `src/container.ts` | Composition root: ประกอบ repos + services + use cases | — |
| `src/index.ts` | Worker entry: `d1Container(env.DB)` → `handleRequest` | — |

## Error → HTTP status

`validation` 400 · `unauthorized` 401 · `forbidden` 403 · `not_found` 404 · `conflict` 409 · `locked` 429 — mapped once in `src/http/http.ts`.

## เพิ่ม feature ใหม่ (เช่น courses เฟส 3)

1. `domain/course.ts` — types + กฎ (ลำดับบทเรียน, คำเตือนข้ามคอร์ส)
2. `repositories/interfaces.ts` — เพิ่ม `CourseRepository`; เขียน `repositories/d1/course-repository.ts`
3. `usecases/courses/` — `CreateCourseUseCase`, `ImportCoursePackUseCase`, …
4. `http/controllers/courses-controller.ts` — ผูก route
5. ลงทะเบียนใน `container.ts`
6. Test: use case ด้วย `test/fakes/memory-repositories.ts` (เร็ว ไม่มี DB) + API test ใน `test/api.test.ts`

## Tests

- `test/schedule.test.ts` — domain ล้วน
- `test/usecases.test.ts` — use case + in-memory repos + `Clock` ปลอม (lockout, session หมดอายุ, overwrite confirm, last admin …)
- `test/api.test.ts` — end-to-end ผ่าน HTTP บน SQLite (`test/helpers/d1.ts`)
- `test/seed.test.ts` — seed builder
