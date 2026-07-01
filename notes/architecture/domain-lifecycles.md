# Domain Lifecycles

**Related:** [domain model](domain-model.md) · [system design](system-design.md)

The [domain model](domain-model.md) lists the objects; this doc shows the three that
have a real **lifecycle** and how they interlock. Diagrams are Mermaid (render in GitHub
and Docusaurus).

## Which objects have a lifecycle

`Manifest`, `Source`, `Target`, `Publisher`, and the `Sync Ledger` are static (config or
stores). Three objects change state over time: **`Document`** (a source file),
**`Publication`** (one document on one provider), and **`Run`** (one execution).

## How the objects connect

One `Document` produces one `Publication` **per Target** — so a doc going to two
providers has two independent Publications.

```mermaid
classDiagram
  direction LR
  class Manifest {
    source
    targets
    defaults
  }
  class Document {
    path id
    contentHash
  }
  class Target {
    name
    type
  }
  class Publisher {
    type
  }
  class Publication {
    destinationRef
    publishedHash
  }
  class SyncLedger
  class Run {
    report
  }
  Manifest "1" --> "*" Target : declares
  Run --> Manifest : reads
  Run --> Document : loads
  Document "1" --> "*" Publication : one per Target
  Target "1" --> "1" Publisher : handled by
  Publisher --> Publication : create / update
  SyncLedger "1" --> "*" Publication : stores
```

## Document lifecycle

The life of a source file. `Invalid` is the side-trap for bad front-matter; `Moved` is
resolved via Git rename detection so the same mirror is reused.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> New
  New --> Synced: publish
  Synced --> Modified: source edited
  Modified --> Synced: update in place
  Synced --> Moved: renamed or moved
  Moved --> Synced: reuse id and move
  Synced --> Removed: file deleted
  Removed --> Retired: trash mirror
  New --> Invalid: bad front-matter
  Invalid --> New: fixed
  Retired --> [*]
```

## Publication lifecycle

The ledger's memory of one document on one provider — the object that enforces
idempotency. `Failed` is first-class, so retries never duplicate a mirror.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Unpublished
  Unpublished --> UpToDate: create ok
  Unpublished --> Failed: create error
  Failed --> UpToDate: retry ok
  UpToDate --> Stale: source changed
  Stale --> UpToDate: update ok
  Stale --> Failed: update error
  UpToDate --> Orphaned: source deleted
  Orphaned --> Trashed: trash and drop entry
  Trashed --> [*]
```

## Run lifecycle

The execution envelope. Per-action `try/catch` means one bad doc doesn't abort the
batch; the ledger is persisted during and after execution.

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Triggered
  Triggered --> Planning: merge or manual
  Planning --> Done: no changes
  Planning --> Executing: has actions
  Executing --> Reporting: per-action try-catch
  Reporting --> Completed: no failures
  Reporting --> CompletedWithFailures: some failed
  Done --> [*]
  Completed --> [*]
  CompletedWithFailures --> [*]
  note right of Executing
    ledger committed
    per action + at end
  end note
```

## How they interlock

The three machines nest by time-scale. A `Run` is the clock: one tick drives many
`Document` transitions, and each `Document` transition drives its `Publication`
transitions.

- A `Modified` document → its `Publication` goes `Stale → UpToDate` (update in place).
- A `Removed` document → its `Publication` goes `Orphaned → Trashed`.
- A `New` document → a `Publication` is created (`Unpublished → UpToDate`).

The `Document` machine answers "what happened to the file", the `Publication` machine
answers "what we did on each provider", and the `Run` machine batches them and sets the
exit code. The `Sync Ledger` is the persisted set of `Publication` states between runs.

Two consequences worth noting: adding a second provider (e.g. Notion) fans one
`Document` out to two independent `Publication` machines, so one provider failing leaves
the other `UpToDate`; and every failure lives in the `Publication` machine, not the
`Run`, which is what makes partial-failure isolation a property of the model rather than
a special case.
