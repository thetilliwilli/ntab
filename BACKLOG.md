# Backlog

Plans and ideas that are not decided rules yet (those live in CLAUDE.md). Remove an item once it is done or dropped.

## Next

- **Sync server (implemented; the user's steps 3–10 remain)**: one Node server (`server/`, never in the extension or the PWA) that every client
  (extension, PWA, web page) syncs all data with, in real time; offline first: a client works without it (or before
  one is set) and sends everything when it connects. Decided:
  - data model 2 (new database `ntab2`, the 2.2 `ntab` is left as it is): every record of every store has a uuid `id`
    and `updatedAt`; `meta` is gone: synced `settings` (one record per setting) and local `device` (session, backup,
    sync); fractional `rank` (a move changes one record); default actions have fixed ids (`updatedAt: 0` until changed:
    they give way to the actions of a server or a backup); backups only in format 2.
  - sync: local writes go to an `outbox` (deletes too); the server gives each accepted record a `rev`; pull "since rev",
    push the outbox, a `/events` stream (fetch, SSE format) says when to pull; the newer `updatedAt` always wins (notes
    too); one page per browser syncs (Web Locks); the first connect to a server that has data asks Merge / Replace this
    device; Disconnect pauses (the outbox keeps collecting); "Delete all data" doesn't touch the server.
  - server: `node:sqlite`, flags `--token` (basic auth, user or password), `--listen ip:port`, `--origin` (CORS list or
    `*`), `--cert`/`--key` (a self-signed certificate the user makes once with openssl and trusts on each device), `--data`.
  - migration of the user's 2.2 data: `scripts/migrate-backup.mjs` turns format 1 backups (several devices) into one
    format 2 file to import.
  - steps: (1) user exports backups ✓ (2) implementation ✓ (3) user: certificate, server (4) user: trust the certificate on
    the laptop (5) user: migrate-backup (6) user: unpacked extension, import, connect (7) push (8) phone: certificate,
    connect, Replace this device (9) checks (10) store release later.

- **Mobile (web version on Android)**: decided to try the desktop layout as it is first and fix only what gets in
  the way. Seen at 400px (the tracker log is fixed, two-line rows under 600px): the actions
  editor table scrolls sideways, the board scrolls sideways; on touch the sidebar flyout doesn't show and double-tap
  (new note, rename) may be unreliable.
