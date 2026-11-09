-- Routines: a library of exercises and meals, plans built from them, and optional links to the weekly schedule.
-- Plans are a guide only (nothing is logged as "done"), like the schedule itself.

CREATE TABLE routine_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('exercise', 'meal')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  body_md     TEXT NOT NULL DEFAULT '',        -- exercise: how to do it · meal: how to cook it
  data_json   TEXT NOT NULL DEFAULT '{}',      -- exercise: muscles, equipment, sets, reps, seconds · meal: mealTypes, ingredients, kcal, P/C/F
  images_json TEXT NOT NULL DEFAULT '[]',
  links_json  TEXT NOT NULL DEFAULT '[]',
  visibility  TEXT NOT NULL DEFAULT 'group' CHECK (visibility IN ('group', 'private')),
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX routine_items_kind ON routine_items(kind);

CREATE TABLE routine_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL CHECK (kind IN ('workout', 'meal')),
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility  TEXT NOT NULL DEFAULT 'group' CHECK (visibility IN ('group', 'private')),
  status      TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE routine_plan_entries (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id   INTEGER NOT NULL REFERENCES routine_plans(id) ON DELETE CASCADE,
  sort      INTEGER NOT NULL,
  section   TEXT NOT NULL,                       -- workout: warmup/main/cooldown · meal: breakfast/lunch/dinner/snack
  item_id   INTEGER NOT NULL REFERENCES routine_items(id),
  sets      INTEGER,
  reps      TEXT,
  seconds   INTEGER,
  rest_seconds INTEGER,
  servings  REAL,
  note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX routine_plan_entries_plan ON routine_plan_entries(plan_id);
CREATE INDEX routine_plan_entries_item ON routine_plan_entries(item_id);

-- A user links a plan to days of their week, optionally to one hour slot (hour NULL = the whole day).
CREATE TABLE routine_assignments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id  INTEGER NOT NULL REFERENCES routine_plans(id) ON DELETE CASCADE,
  weekday  INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  hour     INTEGER CHECK (hour BETWEEN 0 AND 23)
);
CREATE UNIQUE INDEX routine_assignments_unique ON routine_assignments(user_id, plan_id, weekday, IFNULL(hour, -1));
CREATE INDEX routine_assignments_user ON routine_assignments(user_id);
