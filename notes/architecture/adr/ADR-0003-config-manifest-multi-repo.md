# ADR-0003: Declarative manifest, multi-repo adoption, and ledger persistence

**Status:** Accepted (with one open sub-decision)
**Date:** 2026-07-01
**Deciders:** Engineering, Docs platform owner

## Context

A core requirement is that **any repository can adopt the pipeline** with minimal effort
and no bespoke code, and that publishing is **idempotent** across runs. Two coupled
decisions follow: (a) how a repo declares its configuration and how the engine is
distributed, and (b) where the Sync Ledger lives.

## Decision

### (a) Configuration & distribution

- Each repo declares a **`docpipe.yaml` manifest** (source, targets, defaults). See the
  [domain model](../domain-model.md), Configuration context.
- The engine is distributed as a **versioned package**, invoked by a **shared reusable
  CI workflow**. A repo adopts the pipeline by adding `docpipe.yaml` and calling the
  shared workflow — **configuration, not code**.
- Per-document distribution is controlled by front-matter `publish:`; a manifest
  `defaults.publish` applies when omitted.

#### Manifest vs. `.env` (config vs. secrets)

The PoC keeps all config in `.env` (`DRIVE_ROOT_FOLDER_ID`, `ORG_DOMAIN`,
`GOOGLE_APPLICATION_CREDENTIALS`). We split these by kind:

- **Committed manifest** (`docpipe.yaml`) holds non‑secret, structural config —
  `driveFolderId`, `orgDomain`, targets, defaults. Being in Git, it is reviewed per PR,
  carries history/ownership, is self‑documenting for the next adopting repo, and can
  express structure a flat `.env` cannot (multiple targets, per‑doc `publish:`).
- **Env / CI secrets** hold only the **service‑account key**
  (`GOOGLE_APPLICATION_CREDENTIALS`) — per‑machine, uncommitted, injected from CI.

Rationale: `.env`‑only config is invisible to reviewers, drifts per machine, and can't
scale to per‑repo declarative config across many repos. Migrate `DRIVE_ROOT_FOLDER_ID`
and `ORG_DOMAIN` into the manifest; keep the credential in env. **Not either/or —
manifest for config, env for secrets.**

### (b) Multi-repo model — V1: self-publish

- V1 uses **self-publishing**: every repo runs the shared workflow with its own manifest
  and its own Ledger. No central service is required for V1.
- **Central aggregation is deferred** (P1/P2). `SourcePort` already models multiple
  Sources, so aggregation becomes an additional adapter + a shared Ledger later.

### (c) Ledger persistence — V1: commit-back (open sub-decision)

- V1 stores the Sync Ledger at **`ledger.json` (repo root, committed back by the CI
  bot)** after each successful run. The path is a manifest field (`ledger:`), so
  adopters can relocate it; it defaults to `ledger.json` next to `docpipe.yaml` —
  a lockfile-style pairing (edit the manifest, never the ledger).
- **Open:** move to an external store (object storage / KV) if concurrency or repo count
  makes commit-back painful. Tracked as PRD Open Question #2.

## Options considered

### Configuration

| Option                                        | Pros                                                                     | Cons                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **`docpipe.yaml` + shared workflow (chosen)** | Adopt with config only; engine versioned centrally; consistent behaviour | Requires publishing/maintaining the engine package + workflow |
| Copy a script into each repo                  | No shared infra                                                          | Drift across repos; every fix is N PRs                        |
| Central-only service                          | One place to run                                                         | Repos lose local self-service; heavier to stand up in V1      |

### Ledger persistence

| Option                                       | Pros                                                             | Cons                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Commit `state.json` back (chosen for V1)** | Zero extra infra; auditable in Git history; co-located with docs | Write-back commits; needs CI concurrency control; awkward at high concurrency |
| External object store / KV                   | No commits; scales to many concurrent runs                       | New infra + credentials to manage                                             |
| Recompute from targets (no ledger)           | Nothing to store                                                 | Fragile mapping; can't cheaply detect "unchanged"; risks duplicate mirrors    |

## Trade-off analysis

For V1's scale (a few repos, serialized per-repo runs), commit-back is the lowest-infra
way to get durable, auditable idempotency, and its main weakness (concurrency) is
neutralized by running publishing only on the default branch inside a CI concurrency
group. The external store is strictly better at scale and is the designated upgrade
path — deferring it avoids standing up infra before we need it. Recomputing without a
ledger was rejected because idempotency and stable mirrors are domain invariants that a
ledger makes explicit.

## Consequences

- **Easier:** onboarding a new repo; reasoning about idempotency (ledger is inspectable
  in Git); no new infra for V1.
- **Harder:** the CI bot needs write access to commit the ledger; runs must be
  serialized per repo to avoid ledger conflicts.
- **Revisit:** switch the `LedgerPort` adapter from `FileLedger` to an external store
  when concurrency/repo count warrants — a swap behind the port, no core change.

## Action items

1. [ ] Publish the shared reusable CI workflow and pin engine versions.
2. [ ] Define and validate the `docpipe.yaml` schema; fail fast on invalid manifests.
3. [ ] Implement `FileLedger` with `ledger.json` (manifest-configurable path) and
       CI concurrency-group serialization.
4. [ ] Resolve PRD Open Question #2 (commit-back vs external store) before >~3 repos.
