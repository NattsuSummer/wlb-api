-- Phase 4: OAuth 2.1 for the MCP connector (dynamic client registration + PKCE).
-- Access tokens live in auth_tokens (kind 'api', with an expiry), so they show up under the user's API tokens
-- and can be revoked there. Refresh tokens and per-connection settings live in oauth_grants.

CREATE TABLE oauth_clients (
  id                  TEXT PRIMARY KEY,             -- public client id (no secret: PKCE public clients)
  name                TEXT NOT NULL,
  redirect_uris_json  TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE oauth_codes (
  code_hash       TEXT PRIMARY KEY,                 -- sha256(code)
  client_id       TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scope           TEXT NOT NULL DEFAULT '',
  auto_publish    INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL
);

CREATE TABLE oauth_grants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash     TEXT NOT NULL UNIQUE,
  access_token_id  TEXT REFERENCES auth_tokens(id) ON DELETE SET NULL,
  scope            TEXT NOT NULL DEFAULT '',
  auto_publish     INTEGER NOT NULL DEFAULT 0,      -- 0 = courses from the AI arrive as drafts (default)
  refresh_expires_at TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX oauth_grants_access ON oauth_grants(access_token_id);
