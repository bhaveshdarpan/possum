# ADR-0006: Align the engine to DDD — Publisher port + ubiquitous-language naming

**Status:** Accepted — refactor to land before the Notion provider and the multi-repo engine extraction. Makes [ADR-0002](ADR-0002-ports-and-adapters.md) real in code.
**Date:** 2026-07-01
**Deciders:** Engineering

## Context

The PoC is well‑layered — a near‑pure `planSync` (decide) separated from `runActions`
(do), and a versioned, provider‑scoped ledger. But two things keep it from being
DDD‑clean:

1. **Naming is technical, not the ubiquitous language.** The Sync Ledger is
   `IndexFile` / `_index.json` / `readIndex`; there are no `Document`, `Publication`,
   `Target`, or `Publisher` types. The code speaks `DocAction`, `IndexEntry`,
   `ProviderEntry` — folders are named by mechanism (`converters`, `index`, `providers`)
   rather than by domain concept.
2. **The dependency direction is inverted.** `run.ts` imports concrete Google Drive
   functions directly (`createDoc`, `ensureFolderPath`, `grantDomainCommenter`); there is
   no `Publisher` port, and the provider name is a constant (`PROVIDER = "google-drive"`)
   baked into the planner. [ADR-0002](ADR-0002-ports-and-adapters.md) chose
   ports‑and‑adapters, but the code doesn't realize it — the core depends on the adapter.
   Relatedly, DOCX rendering (a Drive‑specific trick) lives in a shared `converters/`
   folder rather than inside the Drive provider.

## Decision

Refactor to make ADR-0002 real and name by the domain.

- **Introduce a `Publisher` port.** Publishers declare their own `type`; `run()`
  dispatches through the port keyed by a `Target`'s `type`. The core depends on the
  port, never on a concrete provider.
- **Adopt ubiquitous‑language names.** Surface `Document`, `Publication`, `Target`,
  `Publisher` as first‑class types; rename `Index → Ledger`.
- **Move provider‑specific rendering into the provider.** Drive owns markdown→docx;
  a future Notion publisher owns markdown→blocks.
- **Restructure `src/` by domain**, with dependencies pointing **inward** — `domain/`
  and `app/` know nothing about Google Drive.

### Naming map

| Now (technical)                            | DDD / business name                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `IndexFile`, `_index.json`, `readIndex`    | `Ledger` / `PublicationLedger`, `loadLedger`                             |
| `IndexEntry.providers[x]`                  | `Publication` (per document, per target)                                 |
| `DocAction` (`create/update/skip`)         | `PublishPlan` of `PublishAction`s                                        |
| `providers/google-drive/*` called directly | a `Publisher` port + `GoogleDrivePublisher` adapter                      |
| `PROVIDER = "google-drive"` constant       | `Target { name, type }` from the manifest; publisher declares its `type` |
| `converters/markdownToDocx`                | rendering owned by the Drive publisher                                   |
| (implicit)                                 | `Document` type (path id, front‑matter, contentHash)                     |

### Target structure (arrows point inward)

```text
src/
  domain/       Document, Publication, Ledger, Target, PublishPlan  (types + pure logic)
  ports/        Publisher, LedgerStore  (interfaces)
  app/          plan(), run()  (orchestration — depends only on domain + ports)
  publishers/
    google-drive/   GoogleDrivePublisher implements Publisher (owns docx render, folders, permissions)
    notion/         (future) NotionPublisher implements Publisher
  adapters/     FileLedgerStore, GitSource
  cli/          entrypoint / composition root
```

## Options considered

| Option                                              | Pros                                                                                     | Cons                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Ports + domain naming (chosen)**               | realizes ADR-0002; adding surfaces is additive; core unit‑testable with a fake publisher | one upfront refactor                                                                                                    |
| B. Keep as‑is; add Notion by copying the Drive path | no refactor now                                                                          | duplicates the publish/ledger path per provider; re‑bakes the provider name each time; cost recurs on every new surface |
| C. Rename only, no port                             | quick readability win                                                                    | dependency stays inverted; multi‑provider still not expressible                                                         |

## Trade-off analysis

Option B pays a small cost now and a large cost on every subsequent surface — and there
are several planned (Notion, website, PDF, AI). Option C reads better but leaves the core
pointing at the adapter, so it doesn't unlock anything. Option A is a **mechanical,
low‑risk** change precisely because `plan()` is already pure, and it is the _same_
refactor that unblocks Notion and the multi‑repo engine extraction — so it pays for
itself twice.

## Consequences

- **Easier:** adding Notion / a website build / PDF as adapters; unit‑testing the core
  with a `FakePublisher`; the engine extraction (the core becomes the package, publishers
  are plugins) per [ADR-0005](ADR-0005-deployment-model-and-auth-boundary.md).
- **Harder:** one upfront refactor; contributors must respect the inward‑dependency rule
  (no provider imports in `app/` or `domain/`) — worth a lint/boundary check.
- **Migration:** the ledger stays **wire‑compatible** — this renames types, not the JSON
  shape — so `_index.json` needs no data migration.

## Action items

1. [ ] Define `Publisher` port (`type`, `render`, `create`, `update`, `delete`, opaque
       `destinationRef`) and a `LedgerStore` port.
2. [ ] Rename `Index → Ledger`; add `Document`, `Publication`, `Target` types.
3. [ ] Move markdown→docx into the Drive publisher; add capability flags
       (`supportsFolders`, `supportsComments`, delete behaviour).
4. [ ] Make `run()` dispatch by `Target.type`; drop the `PROVIDER` constant from the planner.
5. [ ] Restructure `src/` (`domain`, `ports`, `app`, `publishers`, `adapters`, `cli`);
       enforce inward dependencies with a boundary/lint check.
6. [ ] Keep `_index.json` wire‑compatible; no data migration.
