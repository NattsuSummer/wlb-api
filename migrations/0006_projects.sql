-- Projects: agile tracking for the group's side projects (daily check-ins, weekly sprints,
-- versions every N weeks, monthly retros, planned dates). Visible to project members (and admins).
CREATE TABLE projects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  repo_url      TEXT    NOT NULL DEFAULT '',
  refs_json     TEXT    NOT NULL DEFAULT '[]',   -- [{title,url}] reference links (design docs, boards, art refs)
  sprint_anchor TEXT    NOT NULL,                -- YYYY-MM-DD: first day of sprint 1 (sprints are 7 days)
  version_weeks INTEGER NOT NULL DEFAULT 2,
  review_hour   INTEGER NOT NULL DEFAULT 9,      -- default time of the weekly review + planning (on sprint start day)
  retro_hour    INTEGER NOT NULL DEFAULT 10,     -- default monthly retro time (first sprint start day of the month)
  archived      INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  days_json  TEXT    NOT NULL DEFAULT '{"weekly":[],"alternate":null}', -- project work days; alternate = [a, b] swaps each sprint
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user ON project_members(user_id);

CREATE TABLE project_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  goal         TEXT    NOT NULL DEFAULT '',
  checklist_json TEXT  NOT NULL DEFAULT '[]',   -- [{text, done}] "playable" criteria
  cut_date     TEXT,
  release_date TEXT,
  build_url    TEXT    NOT NULL DEFAULT '',
  playable     INTEGER,                         -- null = not judged yet
  notes        TEXT    NOT NULL DEFAULT '',
  closed       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  size        TEXT CHECK (size IN ('S', 'M', 'L')),
  status      TEXT    NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  sprint_no   INTEGER,                          -- null = backlog
  version_id  INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  sort        REAL    NOT NULL DEFAULT 0,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  done_at     TEXT
);
CREATE INDEX project_tasks_project ON project_tasks(project_id, sprint_no);

CREATE TABLE project_dailies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  prev_text  TEXT    NOT NULL DEFAULT '',
  prev_done  INTEGER,                           -- did last round's plan get done? null = not said
  next_text  TEXT    NOT NULL,
  blocker    TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (project_id, user_id, date)
);

CREATE TABLE project_daily_replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_id   INTEGER NOT NULL REFERENCES project_dailies(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE project_sprint_reviews (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprint_no  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  load       TEXT    NOT NULL CHECK (load IN ('over', 'ok', 'under')),
  note       TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, sprint_no, user_id)
);

CREATE TABLE project_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL CHECK (kind IN ('review', 'retro', 'cut', 'release', 'meeting', 'other')),
  title      TEXT    NOT NULL DEFAULT '',
  date       TEXT    NOT NULL,
  hour       INTEGER,
  note       TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX project_events_date ON project_events(project_id, date);

CREATE TABLE project_retros (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  phase      TEXT    NOT NULL DEFAULT 'write' CHECK (phase IN ('write', 'reveal', 'closed')),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE project_retro_cards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  retro_id       INTEGER NOT NULL REFERENCES project_retros(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  col            TEXT    NOT NULL CHECK (col IN ('good', 'bad', 'vent')),
  text           TEXT    NOT NULL,
  anonymous      INTEGER NOT NULL DEFAULT 0,
  action_task_id INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE project_retro_votes (
  card_id INTEGER NOT NULL REFERENCES project_retro_cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, user_id)
);
