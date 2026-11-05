// Build seed SQL from a seed JSON file. Passwords come from the SEED_PASSWORD env var (never from the repo).
//
//   SEED_PASSWORD='...' npx tsx scripts/build-seed-sql.ts seed/seed.json > seed/seed.sql
//   npx wrangler d1 execute DB --remote --file seed/seed.sql
import { readFileSync } from 'node:fs';
import { buildSeedSql } from './seed-lib';

const file = process.argv[2];
const password = process.env.SEED_PASSWORD;
if (!file || !password) {
  console.error('usage: SEED_PASSWORD=... build-seed-sql.ts <seed.json>');
  process.exit(1);
}
buildSeedSql(JSON.parse(readFileSync(file, 'utf8')), password).then((sql) => process.stdout.write(sql));
