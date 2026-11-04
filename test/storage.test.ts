import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { FileStore, HostStore, MAX_STATE_BYTES } from "../src/storage.ts";
import type { HostDatabase, TrustedSqlContract } from "../src/storage.ts";

const COMPANY = "fixture-company-one";
const OTHER = "fixture-company-two";
const NAMESPACE = "plugin_growth_publisher_c7caceeea3";
const proof: TrustedSqlContract = {
  namespace: NAMESPACE, atomicCompareAndSwap: true, affectedRowCount: true,
  evidence: "Test-only composition: SQLite SQL exercise, not a verified PostgreSQL host contract",
};

async function fixture(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "growth-storage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, "state.sqlite");
}

function hostHarness(t: TestContext) {
  // Executes the exact generated statements on real SQLite, not a hand-coded CAS mock.
  // This proves SQL predicates and row counts locally, not host PostgreSQL semantics.
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`ATTACH DATABASE ':memory:' AS "${NAMESPACE}";
    CREATE TABLE "${NAMESPACE}".publisher_state (company_id TEXT PRIMARY KEY, version INTEGER NOT NULL, state_json TEXT NOT NULL)`);
  t.after(() => sqlite.close());
  const calls: { kind: string; sql: string; params: unknown[] }[] = [];
  const statement = (sql: string, params: unknown[]) => {
    const ordered: (string | number | null)[] = [];
    const translated = sql.replace(/\$(\d+)/g, (_, index) => {
      ordered.push(params[Number(index) - 1] as string | number | null);
      return "?";
    });
    return { prepared: sqlite.prepare(translated), ordered };
  };
  const db: HostDatabase = {
    namespace: NAMESPACE,
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      calls.push({ kind: "query", sql, params });
      const { prepared, ordered } = statement(sql, params);
      return prepared.all(...ordered) as T[];
    },
    async execute(sql, params = []) {
      calls.push({ kind: "execute", sql, params });
      const { prepared, ordered } = statement(sql, params);
      return { rowCount: Number(prepared.run(...ordered).changes) };
    },
  };
  return { db, calls, store: new HostStore<{ nested: { count: number } }>({ db }, proof) };
}

test("file store survives restart, isolates companies, and never shares state references", async (t) => {
  const filename = await fixture(t);
  let store = new FileStore<{ nested: { count: number } }>(filename);
  t.after(() => store.close());
  assert.equal(await store.load(COMPANY), null);
  const state = { nested: { count: 1 } };
  assert.equal(await store.compareAndSwap(COMPANY, null, state), true);
  state.nested.count = 999;
  assert.equal(await store.compareAndSwap(OTHER, null, { nested: { count: 2 } }), true);
  store.close();
  store.close();
  store = new FileStore(filename);
  const loaded = (await store.load(COMPANY))!;
  assert.deepEqual(loaded, { version: 1, state: { nested: { count: 1 } } });
  loaded.state.nested.count = 100;
  assert.equal((await store.load(COMPANY))!.state.nested.count, 1);
  assert.equal((await store.load(OTHER))!.state.nested.count, 2);
  const inspect = new DatabaseSync(filename);
  try { assert.equal(inspect.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal"); }
  finally { inspect.close(); }
});

test("file insert uniqueness and stale-version CAS do not overwrite state", async (t) => {
  const store = new FileStore<number>(await fixture(t));
  t.after(() => store.close());
  assert.equal(await store.compareAndSwap(COMPANY, 1, 9), false);
  assert.equal(await store.compareAndSwap(COMPANY, null, 1), true);
  assert.equal(await store.compareAndSwap(COMPANY, null, 9), false);
  assert.equal(await store.compareAndSwap(COMPANY, 1, 2), true);
  assert.equal(await store.compareAndSwap(COMPANY, 1, 9), false);
  assert.deepEqual(await store.load(COMPANY), { version: 2, state: 2 });
  assert.equal(await store.load(OTHER), null);
});

for (const expected of [null, 1]) {
  test(`independent SQLite processes race a ${expected === null ? "unique insert" : "versioned UPDATE"}`, { timeout: 15_000 }, async (t) => {
    const filename = await fixture(t);
    const initial = new FileStore<{ contender: string }>(filename);
    if (expected === 1) await initial.compareAndSwap(COMPANY, null, { contender: "initial" });
    initial.close();
    const workers = ["a", "b"].map((contender) => {
      const child = fork(new URL("./contention-worker.ts", import.meta.url), [filename, COMPANY, String(expected), contender], {
        execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      t.after(() => { if (child.exitCode === null) child.kill(); });
      let stderr = "";
      child.stderr!.on("data", (chunk) => { stderr += chunk; });
      let signalReady!: () => void;
      let failReady!: (error: Error) => void;
      let won: boolean | undefined;
      const ready = new Promise<void>((resolve, reject) => { signalReady = resolve; failReady = reject; });
      child.on("message", (message) => {
        if (message && typeof message === "object" && "ready" in message) signalReady();
        if (message && typeof message === "object" && "won" in message) won = message.won as boolean;
      });
      const result = new Promise<boolean>((resolve, reject) => {
        child.on("error", (error) => { failReady(error); reject(error); });
        child.on("exit", (code) => {
          if (code !== 0 || typeof won !== "boolean") {
            const error = new Error(`Race worker failed (${code}): ${stderr}`);
            failReady(error); reject(error);
          } else resolve(won);
        });
      });
      return { child, ready, result };
    });
    const resultsPromise = Promise.all(workers.map((worker) => worker.result));
    await Promise.all(workers.map((worker) => worker.ready));
    for (const worker of workers) worker.child.send("go");
    const results = await resultsPromise;
    assert.equal(results.filter(Boolean).length, 1, "at most one winner, with one successful uncontested write");
    const reopened = new FileStore<{ contender: string }>(filename);
    try {
      const loaded = (await reopened.load(COMPANY))!;
      assert.equal(loaded.version, expected === null ? 1 : 2);
      assert.equal(loaded.state.contender, results[0] ? "a" : "b");
    } finally { reopened.close(); }
  });
}

test("file store rejects non-fixture IDs, bad versions, bad JSON, and over-limit UTF-8 bytes", async (t) => {
  const store = new FileStore<unknown>(await fixture(t));
  t.after(() => store.close());
  for (const id of ["company-real", "fixture-company-", `fixture-company-${"a".repeat(41)}`, "fixture-company-A", "fixture-company-one' OR 1=1", "fixture-company-one\n"]) {
    await assert.rejects(store.load(id), /fixture-company/);
    await assert.rejects(store.compareAndSwap(id, null, {}), /fixture-company/);
  }
  for (const version of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(store.compareAndSwap(COMPANY, version, {}), /version/);
  }
  assert.throws(() => new FileStore(":memory:"), /file-backed/);
  await assert.rejects(store.compareAndSwap(COMPANY, null, undefined), /JSON/);
  await assert.rejects(store.compareAndSwap(COMPANY, null, 1n), /BigInt/);
  const circular: { self?: unknown } = {}; circular.self = circular;
  await assert.rejects(store.compareAndSwap(COMPANY, null, circular), /circular/i);
  // String quotes occupy two bytes: the exact cap succeeds, one more byte fails.
  assert.equal(await store.compareAndSwap(COMPANY, null, "a".repeat(MAX_STATE_BYTES - 2)), true);
  await assert.rejects(store.compareAndSwap(COMPANY, 1, "a".repeat(MAX_STATE_BYTES - 1)), /2 MiB/);
  await assert.rejects(store.compareAndSwap(COMPANY, 1, "é".repeat(MAX_STATE_BYTES / 2)), /2 MiB/);
  store.close();
  await assert.rejects(store.load(COMPANY), /closed/);
  await assert.rejects(store.compareAndSwap(COMPANY, 1, {}), /closed/);
});

test("file store reports corrupt persisted JSON, oversized rows and disk/schema errors", async (t) => {
  const filename = await fixture(t);
  const store = new FileStore<unknown>(filename);
  t.after(() => store.close());
  await store.compareAndSwap(COMPANY, null, {});
  const sqlite = new DatabaseSync(filename);
  try {
    sqlite.prepare("UPDATE publisher_state SET state_json = ? WHERE company_id = ?").run("invalid-json", COMPANY);
    await assert.rejects(store.load(COMPANY), SyntaxError);
    sqlite.prepare("UPDATE publisher_state SET state_json = ? WHERE company_id = ?").run("x".repeat(MAX_STATE_BYTES + 1), COMPANY);
    await assert.rejects(store.load(COMPANY), /2 MiB/);
    sqlite.exec("DROP TABLE publisher_state");
    await assert.rejects(store.load(COMPANY), /no such table/);
    await assert.rejects(store.compareAndSwap(COMPANY, 1, {}), /no such table/);
  } finally { sqlite.close(); }
  assert.throws(() => new FileStore(join(filename, "nonexistent", "state.sqlite")), /unable to open database/);
});

test("host store uses scoped SELECT, conflict insert and single-statement versioned UPDATE", async (t) => {
  const { db, calls, store } = hostHarness(t);
  assert.equal(await store.load(COMPANY), null);
  const state = { nested: { count: 1 } };
  assert.equal(await store.compareAndSwap(COMPANY, null, state), true);
  state.nested.count = 99;
  assert.equal(await store.compareAndSwap(COMPANY, null, state), false);
  assert.equal(await store.compareAndSwap(OTHER, null, { nested: { count: 20 } }), true);
  assert.equal(await store.compareAndSwap(COMPANY, 1, { nested: { count: 2 } }), true);
  assert.equal(await store.compareAndSwap(COMPANY, 1, state), false);
  assert.equal(await store.compareAndSwap("missing", 1, state), false);
  const loaded = (await store.load(COMPANY))!;
  loaded.state.nested.count = 77;
  assert.deepEqual(await store.load(COMPANY), { version: 2, state: { nested: { count: 2 } } });
  assert.deepEqual(await store.load(OTHER), { version: 1, state: { nested: { count: 20 } } });
  for (const call of calls) {
    assert.ok(call.sql.includes(`"${NAMESPACE}"."publisher_state"`));
    assert.doesNotMatch(call.sql, /\b(RETURNING|BEGIN|COMMIT|TRIGGER|public)\b/i);
    if (call.kind === "query") {
      assert.match(call.sql, /WHERE company_id = \$1$/);
      assert.equal(call.params.length, 1);
    } else if (call.sql.startsWith("INSERT")) {
      assert.match(call.sql, /ON CONFLICT \(company_id\) DO NOTHING$/);
      assert.equal(call.params.length, 2);
    } else {
      assert.match(call.sql, /version = version \+ 1 WHERE company_id = \$2 AND version = \$3$/);
      assert.equal(call.params.length, 3);
    }
  }
  db.namespace = "plugin_other_0123456789";
  await assert.rejects(store.load(COMPANY), /namespace changed/);
});

test("host store requires trusted composition and rejects SQL namespace injection", async (t) => {
  const { db } = hostHarness(t);
  assert.throws(() => new HostStore({ db }), /trusted SQL contract/);
  for (const bad of [undefined, {}, { ...proof, evidence: " " }, { ...proof, atomicCompareAndSwap: false }, { ...proof, affectedRowCount: false }, { ...proof, namespace: "other" }]) {
    assert.throws(() => new HostStore({ db }, bad as TrustedSqlContract), /trusted SQL contract/);
  }
  for (const namespace of ["public", "", "plugin_foo", "test_plugin", "plugin_x_0123456789;DROP TABLE x", "plugin_x_0123456789\"", "plugin_x_0123456789\n", `plugin_${"a".repeat(37)}_0123456789`]) {
    assert.throws(() => new HostStore({ db: { ...db, namespace } }, { ...proof, namespace }), /namespace/);
  }
});

test("host store rejects malformed rowCount and query results, and propagates database failures", async (t) => {
  const { db } = hostHarness(t);
  for (const rowCount of [undefined, null, "1", true, -1, 2, NaN, Infinity]) {
    const invalid = { ...db, execute: async () => ({ rowCount }) } as HostDatabase;
    await assert.rejects(new HostStore({ db: invalid }, proof).compareAndSwap(COMPANY, null, {}), /affected-row count/);
  }
  for (const result of [null, undefined, [], 1]) {
    const invalid = { ...db, execute: async () => result } as unknown as HostDatabase;
    await assert.rejects(new HostStore({ db: invalid }, proof).compareAndSwap(COMPANY, 1, {}), /affected-row count/);
  }
  const validRow = { company_id: COMPANY, version: 1, state_json: "{}" };
  for (const rows of [undefined, null, {}, { rows: [] }, [validRow, validRow], [null], [{ ...validRow, company_id: OTHER }], [{ ...validRow, version: "01" }], [{ ...validRow, version: 0 }], [{ ...validRow, version: Number.MAX_SAFE_INTEGER + 1 }], [{ ...validRow, state_json: {} }], [{ ...validRow, state_json: "broken" }], [{ ...validRow, state_json: "x".repeat(MAX_STATE_BYTES + 1) }]]) {
    const invalid = { ...db, query: async () => rows } as HostDatabase;
    await assert.rejects(new HostStore({ db: invalid }, proof).load(COMPANY));
  }
  const bigintResult = { ...db, query: async () => [{ ...validRow, version: "2" }] } as HostDatabase;
  assert.deepEqual(await new HostStore({ db: bigintResult }, proof).load(COMPANY), { version: 2, state: {} });
  const failure = new Error("database unavailable");
  const broken: HostDatabase = { ...db, query: async () => { throw failure; }, execute: async () => { throw failure; } };
  const store = new HostStore({ db: broken }, proof);
  await assert.rejects(store.load(COMPANY), (error) => error === failure);
  await assert.rejects(store.compareAndSwap(COMPANY, 1, {}), (error) => error === failure);
});

test("host rejects oversized/invalid state and versions before any SQL call", async (t) => {
  const { db, calls } = hostHarness(t);
  const store = new HostStore<unknown>({ db }, proof);
  await assert.rejects(store.compareAndSwap(COMPANY, null, "é".repeat(MAX_STATE_BYTES / 2)), /2 MiB/);
  await assert.rejects(store.compareAndSwap(COMPANY, null, undefined), /JSON/);
  await assert.rejects(store.compareAndSwap(COMPANY, 0, {}), /version/);
  await assert.rejects(store.compareAndSwap("", null, {}), /Company/);
  assert.equal(calls.length, 0);
});

test("migration uses the exact derived namespace and defines only publisher state", async () => {
  const migration = await readFile(new URL("../migrations/001-publisher-state.sql", import.meta.url), "utf8");
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS "${NAMESPACE}"\\."publisher_state"`));
  assert.match(migration, /company_id TEXT PRIMARY KEY NOT NULL/);
  assert.match(migration, /octet_length\(state_json\) <= 2097152/);
  assert.doesNotMatch(migration, /\b(RETURNING|TRIGGER|BEGIN|COMMIT|public)\b|\{\{/i);
});
