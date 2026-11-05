-- Balance Our Day — initial schema
-- weekday: 0 = Monday … 6 = Sunday · hour: 0 … 23 · all times are Asia/Bangkok
-- D1 enforces foreign keys by default.

-- ---------- users & auth ----------
CREATE TABLE users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name          TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  locale                TEXT NOT NULL DEFAULT 'th' CHECK (locale IN ('th', 'en')),
  theme                 TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
  avatar_color          TEXT,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  disabled              INTEGER NOT NULL DEFAULT 0,
  failed_logins         INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  last_login_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Login sessions and personal API tokens share one table. Only a SHA-256 hash of the token is stored.
CREATE TABLE auth_tokens (
  id            TEXT PRIMARY KEY,              -- sha256(token) hex
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('session', 'api')),
  name          TEXT,
  hint          TEXT,                          -- last 4 chars, for display
  expires_at    TEXT,                          -- NULL = no expiry (api tokens)
  last_used_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE user_privacy (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  private_mode  INTEGER NOT NULL DEFAULT 0,
  schedule      TEXT NOT NULL DEFAULT 'full' CHECK (schedule IN ('full', 'cat', 'hide')),
  now_status    TEXT NOT NULL DEFAULT 'full' CHECK (now_status IN ('full', 'cat', 'hide')),
  summary       TEXT NOT NULL DEFAULT 'show' CHECK (summary IN ('show', 'hide')),
  courses       TEXT NOT NULL DEFAULT 'show' CHECK (courses IN ('show', 'hide')),
  answers       TEXT NOT NULL DEFAULT 'hide' CHECK (answers IN ('show', 'hide'))
);

-- ---------- schedule ----------
CREATE TABLE time_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name_th     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  color       TEXT NOT NULL,                   -- #RRGGBB
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE user_category_targets (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES time_categories(id) ON DELETE CASCADE,
  pct          INTEGER NOT NULL DEFAULT 0 CHECK (pct BETWEEN 0 AND 100),
  PRIMARY KEY (user_id, category_id)
);

CREATE TABLE schedule_slots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  hour         INTEGER NOT NULL CHECK (hour BETWEEN 0 AND 23),
  description  TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, weekday, hour)
);

-- One slot can belong to several categories; each gets 1/n of the hour in the summary.
CREATE TABLE schedule_slot_categories (
  slot_id      INTEGER NOT NULL REFERENCES schedule_slots(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES time_categories(id) ON DELETE RESTRICT,
  PRIMARY KEY (slot_id, category_id)
);
CREATE INDEX slot_categories_category ON schedule_slot_categories(category_id);

-- ---------- courses (APIs arrive in phase 3; tables exist now so the schema is complete) ----------
CREATE TABLE course_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name_th     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'book',
  tint        TEXT NOT NULL DEFAULT 'r',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE packs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  category_id  INTEGER REFERENCES course_categories(id) ON DELETE SET NULL,
  cover_url    TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE courses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id        INTEGER REFERENCES packs(id) ON DELETE SET NULL,
  order_in_pack  INTEGER,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  category_id    INTEGER REFERENCES course_categories(id) ON DELETE SET NULL,
  level          TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  visibility     TEXT NOT NULL DEFAULT 'group' CHECK (visibility IN ('group', 'private')),
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  cover_url      TEXT,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE lessons (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  sort         INTEGER NOT NULL,
  title        TEXT NOT NULL,
  minutes      INTEGER,
  content_md   TEXT NOT NULL DEFAULT '',
  links_json   TEXT NOT NULL DEFAULT '[]',
  images_json  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX lessons_course ON lessons(course_id, sort);

CREATE TABLE exercises (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  sort       INTEGER NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('mcq', 'checklist', 'text')),
  prompt     TEXT NOT NULL,
  data_json  TEXT NOT NULL DEFAULT '{}'        -- mcq: {choices, answer} · checklist: {items}
);

CREATE TABLE lesson_progress (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at  TEXT,
  note          TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE exercise_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_id  INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  answer_json  TEXT NOT NULL,
  is_correct   INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
