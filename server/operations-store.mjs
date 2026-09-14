import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { dataRoot } from "./store.mjs";
export function openOperations(dir = dataRoot) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "operations.db");
  const db = new DatabaseSync(file);
  fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    INSERT OR IGNORE INTO metadata VALUES ('schema','1');
    CREATE TABLE IF NOT EXISTS snapshots(system TEXT,at INTEGER,score INTEGER,coverage INTEGER,status TEXT,PRIMARY KEY(system,at));
    CREATE TABLE IF NOT EXISTS samples(system TEXT,signal TEXT,at INTEGER,value REAL,status TEXT,PRIMARY KEY(system,signal,at));
    CREATE TABLE IF NOT EXISTS daily(system TEXT,day TEXT,score REAL,coverage REAL,PRIMARY KEY(system,day));
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,system TEXT,at INTEGER,kind TEXT,payload TEXT);
    CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE IF NOT EXISTS transitions(id INTEGER PRIMARY KEY,incident TEXT,at INTEGER,payload TEXT);
    CREATE TABLE IF NOT EXISTS preferences(owner TEXT PRIMARY KEY,payload TEXT);
    CREATE INDEX IF NOT EXISTS samples_window ON samples(system,signal,at);
    CREATE INDEX IF NOT EXISTS events_window ON events(at);
  `);
  return {
    db,
    get(key, fallback = null) {
      const r = db.prepare("SELECT value FROM metadata WHERE key=?").get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    put(key, value) {
      db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(
        key,
        JSON.stringify(value),
      );
    },
    record(system, at) {
      db.prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?)").run(
        system.id,
        at,
        system.score,
        system.coverage,
        system.status,
      );
    },
    sample(system, signal, at, value, status) {
      db.prepare("INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?)").run(
        system,
        signal,
        at,
        Number.isFinite(value) ? value : null,
        status,
      );
    },
    samples(system, signal, from = Date.now() - 30 * 86400000) {
      return db
        .prepare(
          "SELECT at,value,status FROM samples WHERE system=? AND signal=? AND at>=? ORDER BY at LIMIT 50000",
        )
        .all(system, signal, from);
    },
    history(system, from, to) {
      return db
        .prepare(
          "SELECT (at/3600000)*3600000 AS at,round(avg(score),1) AS score,round(avg(coverage),1) AS coverage FROM snapshots WHERE system=? AND at>=? AND at<=? GROUP BY at/3600000 ORDER BY at LIMIT 2161",
        )
        .all(system, from, to);
    },
    event(event) {
      db.prepare("INSERT OR REPLACE INTO events VALUES (?,?,?,?,?)").run(
        event.id,
        event.system,
        event.at,
        event.kind,
        JSON.stringify(event),
      );
    },
    events(from = Date.now() - 30 * 86400000, to = Date.now(), system = null) {
      return db
        .prepare(
          "SELECT payload FROM events WHERE at>=? AND at<=? AND (? IS NULL OR system=?) ORDER BY at DESC LIMIT 500",
        )
        .all(from, to, system, system)
        .map((r) => JSON.parse(r.payload));
    },
    incidents() {
      return db
        .prepare("SELECT payload FROM incidents ORDER BY id")
        .all()
        .map((r) => JSON.parse(r.payload));
    },
    incident(value) {
      db.prepare("INSERT OR REPLACE INTO incidents VALUES (?,?)").run(
        value.id,
        JSON.stringify(value),
      );
    },
    transition(id, at, value) {
      db.prepare(
        "INSERT INTO transitions(incident,at,payload) VALUES (?,?,?)",
      ).run(id, at, JSON.stringify(value));
    },
    transitions(id) {
      return db
        .prepare(
          "SELECT at,payload FROM transitions WHERE incident=? ORDER BY at DESC LIMIT 1000",
        )
        .all(id)
        .map((r) => ({ at: r.at, ...JSON.parse(r.payload) }));
    },
    preferences(owner) {
      const row = db
        .prepare("SELECT payload FROM preferences WHERE owner=?")
        .get(owner);
      return row ? JSON.parse(row.payload) : { favorites: [] };
    },
    savePreferences(owner, value) {
      db.prepare("INSERT OR REPLACE INTO preferences VALUES (?,?)").run(
        owner,
        JSON.stringify(value),
      );
    },
    prune(now = Date.now()) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "INSERT OR REPLACE INTO daily SELECT system,date(at/1000,'unixepoch'),avg(score),avg(coverage) FROM snapshots GROUP BY system,date(at/1000,'unixepoch')",
        ).run();
        for (const table of ["snapshots", "samples", "events"])
          db.prepare(`DELETE FROM ${table} WHERE at<?`).run(
            now - 90 * 86400000,
          );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    close() {
      db.close();
    },
  };
}
