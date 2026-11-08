#!/usr/bin/env node
/*
 * the NTab sync server: one person's data, shared by all their clients (the extension, the PWA, the web page).
 * no dependencies: Node 22.13+ (node:sqlite). not part of the extension or the web version.
 *
 *   node server/ntab-server.mjs --token <secret> --cert cert.pem --key key.pem [--listen 127.0.0.1:8443]
 *                               [--origin '*' | --origin https://a.example,chrome-extension://<id>] [--data ./ntab-data]
 *
 * security: HTTPS only (--cert/--key); every request but a CORS preflight must carry the token in HTTP basic auth,
 * as the user name or the password (a client takes it from https://TOKEN@host or https://user:TOKEN@host);
 * --origin limits which web pages may call the server (browsers only; the token is what keeps others out).
 *
 * the data: records { store, id, rev, updatedAt, deleted, data }. the server doesn't know what a record means: a
 * store is any name, data is the client's JSON. each accepted change gets the next `rev` (one counter for all); a
 * deleted record stays as a tombstone (deleted: 1, no data) so that every client hears about it.
 *
 * the API (JSON):
 *   GET  /                       "NTab sync server" (to check the address, the certificate and the token in a browser)
 *   GET  /pull?since=<rev>       { serverId, head, empty, records: [{ store, id, rev, updatedAt, deleted, data }], more }
 *                                records changed after `since`, oldest first; more: call again with since = last rev
 *   POST /push { changes: [{ store, id, updatedAt, deleted, data }] }
 *                                -> { serverId, head, results: [{ store, id, ok: true, rev } | { store, id, ok: false, current }] }
 *                                the newer updatedAt wins: a change older than the server's record is refused and
 *                                the server's record comes back (current); an equal one is accepted
 *   GET  /events                 a text/event-stream: `data: { serverId, head }` on connect and after every change
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";

const HELP = `usage: node server/ntab-server.mjs --token <secret> --cert <cert.pem> --key <key.pem> [options]

  --token <secret>     required, 16+ characters; clients send it as the user or the password of the server URL
  --cert <file>        required, the TLS certificate (PEM)
  --key <file>         required, its private key (PEM)
  --listen <ip:port>   where to listen (default 127.0.0.1:8443; 0.0.0.0:8443 = every network, [::]:8443 = IPv6)
  --origin <list>      the web pages allowed to call the server, comma separated, or * (default *), e.g.
                       chrome-extension://<extension id>,https://thetilliwilli.github.io
  --data <dir>         where the database lives (default ./ntab-data)
  --help`;

const MAX_BODY = 64 * 1024 * 1024;
const PAGE_RECORDS = 1000;
const PAGE_BYTES = 8 * 1024 * 1024;
const PING = 25_000;

/* ---------- options ---------- */

let opts;
try {
  opts = parseArgs({
    options: {
      token: { type: "string" },
      cert: { type: "string" },
      key: { type: "string" },
      listen: { type: "string", default: "127.0.0.1:8443" },
      origin: { type: "string", default: "*" },
      data: { type: "string", default: "./ntab-data" },
      help: { type: "boolean" },
    },
  }).values;
} catch (e) {
  fail(e.message);
}
if (opts.help) {
  console.log(HELP);
  process.exit(0);
}
if (!opts.token) fail("--token is required");
if (opts.token.length < 16) fail("--token must have at least 16 characters (e.g. openssl rand -hex 24)");
if (!opts.cert || !opts.key) fail("--cert and --key are required (see README: Sync server)");

const listen = /^\[?([^\]]*?)\]?:(\d+)$/.exec(opts.listen);
if (!listen) fail(`--listen must be ip:port, got "${opts.listen}"`);
const [, host, port] = listen;

const anyOrigin = opts.origin.trim() === "*";
const origins = new Set(opts.origin.split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean));

function fail(msg) {
  console.error(`ntab-server: ${msg}\n\n${HELP}`);
  process.exit(2);
}

/* ---------- the database ---------- */

fs.mkdirSync(opts.data, { recursive: true });
const db = new DatabaseSync(path.join(opts.data, "ntab.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS records (
    store TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
    deleted INTEGER NOT NULL, data TEXT, PRIMARY KEY (store, id));
  CREATE INDEX IF NOT EXISTS records_rev ON records (rev);
  CREATE TABLE IF NOT EXISTS info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// a new database is a new server for the clients: they send everything again
db.prepare("INSERT OR IGNORE INTO info (key, value) VALUES ('serverId', ?)").run(crypto.randomUUID());
const serverId = db.prepare("SELECT value FROM info WHERE key = 'serverId'").get().value;
let head = db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM records").get().rev;

const q = {
  get: db.prepare("SELECT * FROM records WHERE store = ? AND id = ?"),
  put: db.prepare(`INSERT INTO records (store, id, rev, updatedAt, deleted, data) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT (store, id) DO UPDATE SET rev = excluded.rev, updatedAt = excluded.updatedAt,
                   deleted = excluded.deleted, data = excluded.data`),
  since: db.prepare("SELECT * FROM records WHERE rev > ? ORDER BY rev LIMIT ?"),
  live: db.prepare("SELECT EXISTS (SELECT 1 FROM records WHERE deleted = 0) AS live"),
};

const out = (r) => ({ store: r.store, id: r.id, rev: r.rev, updatedAt: r.updatedAt, deleted: !!r.deleted, data: r.data == null ? null : JSON.parse(r.data) });

function pull(since) {
  const rows = q.since.all(since, PAGE_RECORDS + 1);
  const records = [];
  let bytes = 0;
  for (const r of rows.slice(0, PAGE_RECORDS)) {
    if (records.length && bytes + (r.data?.length ?? 0) > PAGE_BYTES) break;
    bytes += r.data?.length ?? 0;
    records.push(out(r));
  }
  return { serverId, head, empty: !q.live.get().live, records, more: records.length < rows.length };
}

const STORE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function check(c, i) {
  const bad = (what) => {
    throw Object.assign(new Error(`changes[${i}]: ${what}`), { status: 400 });
  };
  if (typeof c !== "object" || !c) bad("not an object");
  if (typeof c.store !== "string" || !STORE.test(c.store)) bad("bad store");
  if (typeof c.id !== "string" || !c.id || c.id.length > 200) bad("bad id");
  if (!Number.isFinite(c.updatedAt)) bad("updatedAt must be a number");
  if (!c.deleted && (typeof c.data !== "object" || !c.data || c.data.id !== c.id)) bad("data must be the record (with this id)");
}

function push(changes) {
  if (!Array.isArray(changes)) throw Object.assign(new Error("changes must be an array"), { status: 400 });
  changes.forEach(check);
  const results = [];
  const before = head;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const c of changes) {
      const row = q.get.get(c.store, c.id);
      const deleted = c.deleted ? 1 : 0;
      const data = deleted ? null : JSON.stringify(c.data);
      if (row && row.updatedAt > c.updatedAt) {
        results.push({ store: c.store, id: c.id, ok: false, current: out(row) });
      } else if (row && row.updatedAt === c.updatedAt && row.deleted === deleted && row.data === data) {
        results.push({ store: c.store, id: c.id, ok: true, rev: row.rev }); // the same again: nothing changes
      } else {
        q.put.run(c.store, c.id, ++head, c.updatedAt, deleted, data);
        results.push({ store: c.store, id: c.id, ok: true, rev: head });
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    head = before;
    throw e;
  }
  if (head !== before) announce();
  return { serverId, head, results };
}

/* ---------- /events ---------- */

const streams = new Set();
const event = () => `data: ${JSON.stringify({ serverId, head })}\n\n`;
const announce = () => streams.forEach((res) => res.write(event()));
setInterval(() => streams.forEach((res) => res.write(": ping\n\n")), PING).unref();

/* ---------- HTTP ---------- */

const hash = (s) => crypto.createHash("sha256").update(s).digest();
const tokenHash = hash(opts.token);

/* the token as the user or the password of basic auth (both are always compared: the time says nothing) */
function authorized(req) {
  const m = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const pair = Buffer.from(m[1], "base64").toString("utf8");
  const i = pair.indexOf(":");
  const [user, pass] = i < 0 ? [pair, ""] : [pair.slice(0, i), pair.slice(i + 1)];
  const a = crypto.timingSafeEqual(hash(user), tokenHash);
  const b = crypto.timingSafeEqual(hash(pass), tokenHash);
  return a || b;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!anyOrigin && !origins.has(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", anyOrigin ? "*" : origin);
  res.setHeader("Vary", "Origin");
  return true;
}

function send(res, status, body, type = "application/json") {
  const text = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("the request is too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("the body is not JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "https://x");
  if (!cors(req, res)) return send(res, 403, { error: "this origin is not allowed (--origin)" });

  if (req.method === "OPTIONS") {
    // a preflight carries no credentials (browsers never send them there); it learns nothing but the CORS rules
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.writeHead(204);
    return res.end();
  }

  if (!authorized(req)) {
    console.warn(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${url.pathname}: wrong or no token`);
    // the login prompt only for a browser opening the address (a client that sent a token just hears "no")
    if (!req.headers.authorization) res.setHeader("WWW-Authenticate", 'Basic realm="NTab sync", charset="UTF-8"');
    return send(res, 401, { error: "wrong token" });
  }

  const route = `${req.method} ${url.pathname}`;
  if (route === "GET /") return send(res, 200, `NTab sync server: OK (${head} changes so far)\n`, "text/plain");
  if (route === "GET /pull") {
    const since = Number(url.searchParams.get("since") ?? 0);
    if (!Number.isInteger(since) || since < 0) return send(res, 400, { error: "since must be a rev" });
    return send(res, 200, pull(since));
  }
  if (route === "POST /push") return send(res, 200, push((await readBody(req)).changes));
  if (route === "GET /events") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
    res.write(event());
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  send(res, 404, { error: "not found" });
}

const server = https.createServer({ cert: fs.readFileSync(opts.cert), key: fs.readFileSync(opts.key), minVersion: "TLSv1.2" }, (req, res) =>
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.message });
    else res.end();
  }),
);
server.on("tlsClientError", () => {}); // a browser that doesn't trust the certificate yet hangs up: not our error

server.listen(Number(port), host, () => {
  const cert = new crypto.X509Certificate(fs.readFileSync(opts.cert));
  console.log(`NTab sync server on https://${host.includes(":") ? `[${host}]` : host}:${port}
  data:        ${path.resolve(opts.data)} (server ${serverId}, ${head} changes)
  origins:     ${anyOrigin ? "any" : [...origins].join(", ")}
  certificate: ${cert.subjectAltName ?? cert.subject}, valid till ${cert.validTo}
  SHA-256:     ${cert.fingerprint256}`);
});

const stop = () => {
  streams.forEach((res) => res.end());
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
