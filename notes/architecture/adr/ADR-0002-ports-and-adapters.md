# ADR-0002: Ports & adapters for a pluggable publisher architecture

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Engineering, Docs platform owner

## Context

V1 publishes to Google Docs, but the roadmap adds a Docusaurus site, PDF export, and an
AI index. We do not want each new surface to require rewriting the pipeline, and we want
"adopt this in any repo" to be configuration, not code. The differentiating value is the
_publishing seam_ (see [domain model](../domain-model.md), Publishing context).

## Decision

Build the engine as a **hexagonal (ports-and-adapters)** application. The domain core
(Orchestration, Configuration, Transformation, Publishing rules) is pure and depends
only on **ports**: `SourcePort`, `TransformPort`, `PublisherPort`, `LedgerPort`. All I/O
lives in **adapters**. New surfaces are new `PublisherPort` adapters and require **no**
change to the core or to existing adapters.

## Options considered

### Option A: Ports & adapters with a `PublisherPort` seam (chosen)

| Dimension     | Assessment                                 |
| ------------- | ------------------------------------------ |
| Complexity    | Medium — one interface + a registry        |
| Extensibility | High — new surface = new adapter           |
| Testability   | High — core tested with in-memory adapters |
| Coupling      | Low — core knows nothing target-specific   |

**Pros:** additive Publishers; idempotency enforced once in the core for all Publishers;
core is unit-testable without Git or Google.
**Cons:** slightly more upfront structure than a script.

### Option B: A script per surface (Markdown→Google Docs script, later a separate site script)

**Pros:** fastest for exactly one surface.
**Cons:** duplicated discovery/loading/idempotency logic per surface; every new surface
is new bespoke code; no shared reporting; hard to test.

### Option C: Off-the-shelf static-site generator as the pipeline

**Pros:** zero build for a website.
**Cons:** solves only the site surface; not a publishing engine for Google Docs / PDF /
AI; not multi-target.

## Trade-off analysis

Option B is cheaper _today_ and more expensive on every subsequent surface — and the
roadmap has three. The `PublisherPort` seam pays for its small upfront cost the first
time we add a second surface, and it lets us enforce cross-cutting rules (idempotency,
per-document routing, reporting) exactly once. Option C is not a pipeline at all.

## Consequences

- **Easier:** adding Docusaurus/PDF/AI later; testing the core with fakes; onboarding a
  repo (config only).
- **Harder:** contributors must respect the boundary — no target-specific logic leaks
  into Transformation or Orchestration.
- **Revisit:** if the port set proves too narrow (e.g., a Publisher needs capabilities
  the port can't express), version the port rather than special-casing the core.

## Consequences for the existing Google Docs pipeline

The team's current Markdown→Google Docs pipeline is **refactored to sit behind
`PublisherPort`**, not rewritten. Its logic becomes the `GoogleDocsPublisher` adapter.

## Action items

1. [ ] Define `SourcePort`, `TransformPort`, `PublisherPort`, `LedgerPort`.
2. [ ] Implement `GitSource`, `GoogleDocsPublisher`, `FileLedger`.
3. [ ] Add a Publisher registry keyed by `target.type`.
4. [ ] Provide in-memory `FakeSource` / `FakePublisher` / `InMemoryLedger` for tests.
