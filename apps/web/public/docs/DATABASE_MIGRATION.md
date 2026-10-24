# Database and migrations (read this before `migrate deploy`)

## Recommended: a new, empty database
Neon's free plan allows several projects. Create a **new** Neon project/database just for this app, then:
```bash
npm run db:preflight   # reads the database and says what is safe
npm run db:deploy      # prisma migrate deploy (applies the 7 migrations in order)
npm run db:verify      # proves the live schema matches prisma/schema.prisma
# or all three:  npm run db:setup
```
Use the Neon **direct** connection string (no `-pooler`) as `DIRECT_URL` for these commands; the running API uses the **pooled** string as `DATABASE_URL`.

## If you reuse a database that already has TutorLink tables / a different migration history
This is the situation behind the earlier "migration history drift" warning: the database recorded a migration
(`20261019151101_database_setup`) that does not exist in this project. That alone is harmless: `prisma migrate deploy`
ignores applied migrations it does not know. The real danger is a database that already contains this project's tables
but has not recorded this project's migrations: `migrate deploy` would then try to create tables that exist and fail.

`npm run db:preflight` detects this and prints exactly what to do. Typical output and meaning:

* `RESULT: empty database. Safe.` run `npm run db:deploy`.
* `NOTE: the database has migration(s) that are not in this project` harmless, continue.
* `CONFLICT: TutorLink tables already exist...` it lists each migration as `present`/`missing` by inspecting the real schema and prints the exact `prisma migrate resolve --applied <name>` commands for the ones whose effect is verifiably already there. Back the database up first (Neon: create a branch). Run those commands, then `npm run db:deploy`, then `npm run db:verify`.
* `WARNING: ... tables that do not belong to TutorLink` the database is shared with another app (for example the TutorLink AI Sales Agent). Do **not** reuse it; create a new Neon database.
* `BLOCKED: failed migration(s)` never reset blindly; follow the printed instruction.

Never run `prisma migrate reset` or `db push --force-reset` against a database that holds data you care about.

## What was tested
Against a real PostgreSQL 16: all 7 migrations apply in order on an empty database; `db:verify` then reports all 13 tables, 3 enums, every column's type and nullability, and every declared index matching `schema.prisma` (it also correctly fails when a column or index is removed). The drifted-database scenario above was reproduced and the printed recovery plan was executed to a verified-correct schema.
