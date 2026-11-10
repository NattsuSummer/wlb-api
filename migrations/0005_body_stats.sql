-- Body stats: one entry per user per day (weight required, the rest optional) and a personal goal.
-- Private: only the owner can read or write them.
CREATE TABLE body_entries (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,              -- YYYY-MM-DD (Bangkok)
  weight_kg  REAL    NOT NULL,
  height_cm  REAL,
  waist_cm   REAL,
  body_fat   REAL,                          -- percent
  note       TEXT    NOT NULL DEFAULT '',
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, date)
);

CREATE TABLE body_goals (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  target_weight_kg REAL,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
