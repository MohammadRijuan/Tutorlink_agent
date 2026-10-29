/**
 * Database safety tools (no Prisma engine needed; they talk to Postgres directly).
 *   npm run db:preflight   Reads the target database and says whether `prisma migrate deploy` is safe, or exactly what to do first.
 *   npm run db:verify      After migrating, proves the live schema matches prisma/schema.prisma (tables, columns, types, enums, indexes).
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = [resolve(here, "../.."), resolve(here, "../../..")].find(dir => existsSync(join(dir, "prisma/schema.prisma"))) ?? process.cwd();
const schemaText = readFileSync(join(apiRoot, "prisma/schema.prisma"), "utf8");
const localMigrations = readdirSync(join(apiRoot, "prisma/migrations"), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

function connectionString() {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) { console.error("Set DIRECT_URL (preferred) or DATABASE_URL first."); process.exit(1); }
  const url = new URL(raw);
  for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) url.searchParams.delete(key);
  return url.toString();
}

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

// ---- minimal schema.prisma reader (models, fields, enums, @@index) ----
type Field = { name: string; type: string; optional: boolean; list: boolean; relation: boolean };
type Model = { name: string; table: string; fields: Field[]; indexes: string[][] };
function parseSchema() {
  const enums = new Map<string, string[]>();
  const models: Model[] = [];
  const enumNames = new Set([...schemaText.matchAll(/^enum\s+(\w+)\s*\{/gm)].map(m => m[1]!));
  const modelNames = new Set([...schemaText.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m => m[1]!));
  for (const match of schemaText.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    enums.set(match[1]!, match[2]!.split("\n").map(line => line.trim()).filter(line => /^\w+$/.test(line)));
  }
  for (const match of schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields: Field[] = []; const indexes: string[][] = [];
    for (const raw of match[2]!.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//")) continue;
      const index = /^@@index\(\[([^\]]+)\]/.exec(line);
      if (index) { indexes.push(index[1]!.split(",").map(part => part.trim().replace(/\(.*\)/, ""))); continue; }
      if (line.startsWith("@@")) continue;
      const field = /^(\w+)\s+(\w+)(\[\])?(\?)?/.exec(line);
      if (!field) continue;
      fields.push({ name: field[1]!, type: field[2]!, list: Boolean(field[3]), optional: Boolean(field[4]), relation: modelNames.has(field[2]!) });
    }
    models.push({ name: match[1]!, table: match[1]!, fields, indexes });
  }
  return { models, enums, enumNames };
}

const PRISMA_TO_PG: Record<string, string[]> = {
  String: ["text"], Int: ["integer"], BigInt: ["bigint"], Float: ["double precision"], Boolean: ["boolean"],
  DateTime: ["timestamp without time zone"], Json: ["jsonb"], Decimal: ["numeric"], Bytes: ["bytea"],
};

const MIGRATION_MARKERS: Array<{ name: string; test: (db: DbShape) => boolean; note: string }> = [
  { name: "20261020000000_init", note: "base tables", test: db => db.tables.has("Lead") && db.tables.has("ContentItem") && db.tables.has("JobRun") && db.enums.has("LeadStatus") },
  { name: "20261020160000_durable_retry_jobs", note: "JobRun.payload", test: db => db.columns.has("JobRun.payload") && db.columns.has("JobRun.leaseExpiresAt") },
  { name: "20261021100000_content_creative_variants", note: "ContentItem.creativeAngle", test: db => db.columns.has("ContentItem.creativeAngle") && db.columns.has("ContentItem.visualStyle") },
  { name: "20261021113000_automated_publishing", note: "ContentStatus PUBLISHING", test: db => (db.enums.get("ContentStatus") ?? []).includes("PUBLISHING") },
  { name: "20261021120000_meta_inbound_events", note: "MetaWebhookEvent table", test: db => db.tables.has("MetaWebhookEvent") },
  { name: "20261021130000_unique_media_views", note: "ContentMetric.uniqueMediaViews", test: db => db.columns.has("ContentMetric.uniqueMediaViews") },
  { name: "20261022090000_reel_scenes", note: "ContentItem.reelScenes", test: db => db.columns.has("ContentItem.reelScenes") },
  { name: "20261025090000_design_subtitle_link_card", note: "ContentItem.linkAssetUrl", test: db => db.columns.has("ContentItem.linkAssetUrl") && db.columns.has("ContentItem.designPalette") },
];

type DbShape = { tables: Set<string>; columns: Map<string, { type: string; nullable: boolean; udt: string }>; enums: Map<string, string[]>; indexes: Map<string, string[][]> };

async function readDb(client: pg.Client): Promise<DbShape> {
  const tables = new Set((await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)).rows.map(row => row.table_name as string));
  const columns = new Map<string, { type: string; nullable: boolean; udt: string }>();
  for (const row of (await client.query(`SELECT table_name, column_name, data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_schema = current_schema()`)).rows) columns.set(`${row.table_name}.${row.column_name}`, { type: row.data_type, nullable: row.is_nullable === "YES", udt: row.udt_name });
  const enums = new Map<string, string[]>();
  for (const row of (await client.query(`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = current_schema() ORDER BY e.enumsortorder`)).rows) enums.set(row.typname, [...(enums.get(row.typname) ?? []), row.enumlabel]);
  const indexes = new Map<string, string[][]>();
  for (const row of (await client.query(`SELECT t.relname AS tbl, array_agg(a.attname::text ORDER BY k.ord) AS cols FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum WHERE n.nspname = current_schema() AND NOT i.indisprimary AND NOT i.indisunique GROUP BY t.relname, i.indexrelid`)).rows) indexes.set(row.tbl, [...(indexes.get(row.tbl) ?? []), row.cols as string[]]);
  return { tables, columns, enums, indexes };
}

async function preflight() {
  const { models } = parseSchema();
  const appTables = new Set(models.map(model => model.table));
  const result = await withClient(async client => {
    const db = await readDb(client);
    const hasHistory = db.tables.has("_prisma_migrations");
    const applied = hasHistory ? (await client.query(`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`)).rows as Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }> : [];
    return { db, hasHistory, applied };
  });
  const { db, hasHistory, applied } = result;
  const foreign = [...db.tables].filter(table => table !== "_prisma_migrations" && !appTables.has(table));
  const presentApp = [...appTables].filter(table => db.tables.has(table));
  const appliedNames = new Set(applied.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
  const failed = applied.filter(row => !row.finished_at && !row.rolled_back_at);
  const unknownApplied = [...appliedNames].filter(name => !localMigrations.includes(name));
  const pending = localMigrations.filter(name => !appliedNames.has(name));
  const lines: string[] = [];
  let exit = 0;
  const say = (text = "") => lines.push(text);

  say("TutorLink database preflight"); say("=".repeat(34));
  say(`Tables found: ${db.tables.size}  (TutorLink tables present: ${presentApp.length}/${appTables.size})`);
  say(`Migrations in this project: ${localMigrations.length}; recorded as applied in the database: ${appliedNames.size}`);

  if (foreign.length) { exit = 2; say(); say(`WARNING: this database also contains tables that do not belong to TutorLink: ${foreign.slice(0, 12).join(", ")}${foreign.length > 12 ? ", ..." : ""}`); say("  It is shared with another app. Create a NEW empty Neon database/branch for this project (free), and point DATABASE_URL/DIRECT_URL at it."); }
  if (failed.length) { exit = 2; say(); say(`BLOCKED: failed migration(s) are recorded: ${failed.map(row => row.migration_name).join(", ")}`); say("  Do not reset the database. Inspect the error, fix the cause, then run: npx prisma migrate resolve --rolled-back <name>  and retry."); }
  if (unknownApplied.length) { say(); say(`NOTE: the database has migration(s) that are not in this project: ${unknownApplied.join(", ")}`); say("  `prisma migrate deploy` ignores these; they are harmless history from an earlier setup. Run db:verify after deploying to prove the schema is correct."); }

  const noneRecorded = appliedNames.size === 0 || !localMigrations.some(name => appliedNames.has(name));
  if (db.tables.size === 0 || (db.tables.size === 1 && hasHistory && applied.length === 0)) {
    say(); say("RESULT: empty database. Safe. Run:  npm run db:deploy");
  } else if (presentApp.length > 0 && noneRecorded) {
    exit = 2;
    say(); say("CONFLICT: TutorLink tables already exist but this project's migrations are not recorded (typical after an earlier `prisma migrate dev`/`db push`).");
    say("  Running `migrate deploy` would try to CREATE tables that exist and fail. Choose ONE:");
    say("  A) (recommended) Create a new empty Neon database and use it. Nothing to reconcile.");
    say("  B) Keep this database. First back it up, then record the migrations whose effects are verifiably already present:");
    let sawMissingBeforePresent = false; let missingSeen = false;
    const commands: string[] = [];
    for (const marker of MIGRATION_MARKERS) {
      const present = marker.test(db);
      if (!present) missingSeen = true; else if (missingSeen) sawMissingBeforePresent = true;
      say(`     [${present ? "present" : "missing"}] ${marker.name}  (${marker.note})`);
      if (present && !missingSeen) commands.push(`npx prisma migrate resolve --applied ${marker.name}`);
    }
    if (sawMissingBeforePresent) say("     The existing schema is inconsistent (a later change exists without an earlier one). Use option A.");
    else { for (const command of commands) say(`     ${command}`); say("     then:  npm run db:deploy   (applies only what is missing)  and  npm run db:verify"); }
  } else if (pending.length === 0) {
    say(); say("RESULT: all migrations are recorded as applied. Run  npm run db:verify  to confirm the schema.");
  } else {
    say(); say(`RESULT: ${pending.length} migration(s) pending: ${pending.join(", ")}. Safe to run:  npm run db:deploy`);
  }
  console.log(lines.join("\n"));
  process.exit(exit);
}

async function verify() {
  const { models, enums } = parseSchema();
  const db = await withClient(readDb);
  const problems: string[] = [];
  for (const model of models) {
    if (!db.tables.has(model.table)) { problems.push(`Missing table "${model.table}"`); continue; }
    for (const field of model.fields) {
      if (field.relation || field.list && !PRISMA_TO_PG[field.type]) continue;
      const column = db.columns.get(`${model.table}.${field.name}`);
      if (!column) { problems.push(`Missing column ${model.table}.${field.name}`); continue; }
      if (column.nullable !== field.optional) problems.push(`${model.table}.${field.name} nullability differs (database ${column.nullable ? "NULL" : "NOT NULL"}, schema ${field.optional ? "optional" : "required"})`);
      const expected = PRISMA_TO_PG[field.type];
      if (expected && !expected.includes(column.type)) problems.push(`${model.table}.${field.name} type differs (database ${column.type}, schema ${field.type})`);
      if (!expected && enums.has(field.type) && column.udt !== field.type) problems.push(`${model.table}.${field.name} should use enum "${field.type}" (database ${column.udt})`);
    }
    for (const index of model.indexes) {
      const found = (db.indexes.get(model.table) ?? []).some(columns => columns.length === index.length && columns.every((name, i) => name === index[i]));
      if (!found) problems.push(`Missing index on ${model.table}(${index.join(", ")})`);
    }
  }
  for (const [name, values] of enums) {
    const actual = db.enums.get(name);
    if (!actual) { problems.push(`Missing enum type "${name}"`); continue; }
    for (const value of values) if (!actual.includes(value)) problems.push(`Enum ${name} lacks value ${value}`);
  }
  if (problems.length) { console.error(`Schema verification FAILED (${problems.length}):\n - ${problems.join("\n - ")}`); process.exit(1); }
  console.log(`Schema verification passed: ${models.length} tables, ${enums.size} enums, columns, nullability and indexes all match prisma/schema.prisma.`);
}

const command = process.argv[2];
(command === "preflight" ? preflight() : command === "verify" ? verify() : Promise.reject(new Error("Usage: db-tools.ts preflight|verify")))
  .catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
