# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`possum` — a config-driven pipeline that publishes Markdown docs from Git one-way to Google Docs (a review/comment mirror). A repo adopts it with a `possum.yaml` manifest + shared CI — **no repo-specific code**. Markdown in Git is canonical; the Google Doc is a non-authoritative mirror that gets overwritten on the next sync.

The engine is packaged as `@bhaveshdarpan/possum` with a `possum` CLI (`bin` → `dist/cli/cli.js`).

## Commands

```bash
npm run build         # tsc → dist/ (+ chmod the bin); the published artifact
node dist/cli/cli.js plan   # possum plan — read-only, no writes, no credentials
node dist/cli/cli.js push   # possum push — publish (needs GOOGLE_APPLICATION_CREDENTIALS)
npm run typecheck     # tsc --noEmit (source uses NodeNext + strict + exactOptionalPropertyTypes)
npm run lint:boundaries  # enforces the hexagonal import rule (see below) — runs in CI
npm test              # vitest run (48 tests)
npm run coverage      # vitest + v8 coverage gate (core ≥90% stmts/lines/funcs, ≥80% branch)
npm run format        # prettier over docs/**/*.md + README.md
```

Run the engine via the built bin (`node dist/cli/cli.js …`, or `possum …` once installed); it loads a local `.env` if present. There is no `tsx` run script — CI builds and runs `dist/`. Run a single test file or case:

```bash
npx vitest run test/unit/manifest.test.ts
npx vitest run -t "skips an unchanged document"
npx vitest              # watch mode
```

## Architecture — hexagonal (ports & adapters)

The system is a pure core surrounded by adapters. Dependencies point **inward**. This is the load-bearing design decision (ADR-0002, ADR-0006); respect it.

```
src/
  domain/       Document, Ledger/Publication, Target, PublishPlan/PublishAction — types + pure rules
  ports/        Publisher, LedgerStore — interfaces the core depends on
  app/          plan.ts (decide) + run.ts (execute one plan) + pipeline.ts (orchestrate targets → RunReport); imports only domain + ports
  publishers/   google-drive/ — GoogleDrivePublisher implements Publisher (owns docx render, folders, files, permissions)
  adapters/     git.ts (rename detection), file-ledger-store.ts + ledger-io/-schema (LedgerStore over ledger.json)
  config/       manifest.ts — possum.yaml zod schema + fail-fast loader
  config.ts     env secrets only (GOOGLE_APPLICATION_CREDENTIALS)
  cli/          main.ts (composition root — wires publishers to the core) + cli.ts (the bin)
  index.ts      public API barrel
```

**The one rule (enforced by `npm run lint:boundaries`):** nothing in `domain/`, `ports/`, or `app/` may import from `publishers/` or `adapters/`. `cli/main.ts` is the **only** composition root — it's the sole place that knows which concrete publisher/store exist and wires them together. Adding a new surface (Notion, PDF) = a new folder under `publishers/` implementing `Publisher`, wired in `cli/main.ts` — no core change.

### The pipeline (one run)

`cli/main.ts` is pure composition: it builds the concrete `FileLedgerStore` + Google publisher and the Git-derived inputs, then calls `app/pipeline.ts`'s `runPipeline(deps)`, which orchestrates and returns a structured `RunReport`. `cli/cli.ts` renders that report to stdout and maps `report.failed` to the exit code. Keep this split: **orchestration is in `app/`, wiring in `cli/main.ts`, presentation in `cli/cli.ts`.**

- **`app/pipeline.ts`** — the orchestrator: for each target, `planSync()` → (unless dry-run) `runActions()`, persist the ledger, advance the rename baseline on a clean run. Depends only on domain + ports, so it's unit-testable with `FakePublisher` + `InMemoryLedgerStore`.
- **`app/plan.ts`** decides `create | update | rename | delete | skip` per doc. Pure (fs/git are inputs). Routing (P0-5) filters by `publish` front-matter ∪ `defaults.publish`. Reconcile (P0-8): ledger entries whose path vanished are deletes, unless re-linked to a rename target via Git (`adapters/git.ts`) or a content-hash fallback.
- **`app/run.ts`** executes one `PublishPlan` via the `Publisher` port and owns ledger bookkeeping + reliability. It writes nothing to stdout — it returns `ActionResult[]` (per-doc ok/url/error) for the CLI to render.

### Non-obvious invariants (do not break)

- **Ledger key stability.** Publications are keyed by `providerId` (`"google-drive"`, from `GOOGLE_DRIVE_PROVIDER_ID`). The manifest target _name_ (`google-docs`) is for routing only. Re-keying the ledger orphans every existing mirror. The on-disk shape is wire-compatible with the old PoC `_index.json`.
- **Partial-failure isolation (P0-6).** `run.ts` wraps each action in its own try/catch, persists the ledger immediately after each success, and on create persists **before** `afterRecord` (the commenter grant) — so a grant failure can never leave a created-but-unrecorded Doc that a re-run would duplicate. One failure never blocks the rest; the run exits non-zero if any failed.
- **Stable destination URLs.** Update/rename reuse the existing `fileId` (never re-create), so Doc URLs survive edits and moves.
- **Config vs secret split (ADR-0003).** Structural config (`driveFolderId`, `orgDomain`, targets, `ledger` path) lives in the committed `possum.yaml`; only the service-account key is a secret (`.env` / CI secret). Never put the key in the manifest.
- **`ledger.json`** is machine-managed (like a lockfile): committed, never hand-edited. Its path is the manifest `ledger:` field (default repo root).

### Run modes

- **plan / dry-run** — read-only (files + ledger + Git), needs no credentials. Used as the PR check (`.github/workflows/dry-run.yml`).
- **push** — writes to Drive, commits the updated ledger back. On merge via `.github/workflows/sync.yml` (`fetch-depth: 0` is required so Git rename detection can diff `lastSyncedSha..HEAD`).

### Reuse in other repos (CI)

`action.yml` is a composite GitHub Action that builds the engine from its own checkout and runs the CLI against the caller's workspace (needs no published package). `.github/workflows/publish.yml` (`workflow_call`) wraps it with checkout + ledger commit-back + PR comment, so an adopter's caller is ~15 lines (see `examples/possum-adopter.yml`). This repo's own `sync.yml`/`dry-run.yml` dogfood the action via `uses: ./`. When changing the run/commit/comment flow, keep the action (run) and the workflow (lifecycle) concerns separate. The action ref in `publish.yml` is pinned to `@main` — bump it when a release tag is cut.

## Conventions

- **NodeNext ESM.** Source imports use explicit `.js` specifiers that resolve to `.ts` files. Vitest maps these via a `resolve.alias` in `vitest.config.ts`; keep it when adding tests.
- **Tests** live in `test/` by pyramid tier: `unit/` (pure logic), `acceptance/` (whole-run via `FakePublisher`), `contract/` (real adapter + fake client), `support/` (doubles + helpers, not run as tests). Prefer hand-written in-memory doubles (`support/fakes.ts`) over mocking libraries.
- **Specs live in `notes/`, not `docs/`.** `notes/` holds the PRD, domain model, system design, ADRs, testing strategy, and the phased implementation plan. `docs/` is _sample content being synced_ — do not treat it as project documentation. Read `notes/architecture/*` and the ADRs before changing architecture.
- Ubiquitous language: say **publish** (not "sync"/"export"), **Document** (not "page"), **Publisher/Publication/Target/Ledger**. Match these names in code and tests.

## Status

V1 P0s are complete (manifest, routing, idempotency, partial-failure isolation, delete/rename reconcile, two run modes) with tests + CI gates. See `notes/IMPLEMENTATION_PLAN.md` for what's done and deferred (second publisher, reusable CI workflow + adopter guide, access/sharing model, OAuth/GitHub-App).
