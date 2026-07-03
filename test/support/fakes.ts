import type {
  Publisher,
  DestinationRef,
  PublishTargetDoc,
  RenderedDoc,
} from "../../src/ports/publisher.js";
import type { OnDelete } from "../../src/domain/publish-plan.js";
import type { LedgerStore } from "../../src/ports/ledger-store.js";
import type { Ledger } from "../../src/domain/ledger.js";

// In-memory LedgerStore (testing-strategy "InMemoryLedger"): records every save
// (deep-cloned) so a scenario can assert on persistence without touching disk.
export class InMemoryLedgerStore implements LedgerStore {
  readonly saves: Ledger[] = [];
  private current: Ledger;

  constructor(initial: Ledger) {
    this.current = structuredClone(initial);
  }

  async load(): Promise<Ledger> {
    return structuredClone(this.current);
  }

  async save(ledger: Ledger): Promise<void> {
    this.current = structuredClone(ledger);
    this.saves.push(structuredClone(ledger));
  }

  get latest(): Ledger {
    return this.current;
  }
}

// Recorded publisher operation, for assertions.
export type Call =
  | { op: "create"; doc: PublishTargetDoc }
  | { op: "update"; ref: DestinationRef; doc: RenderedDoc }
  | { op: "move"; ref: DestinationRef; segments: string[] }
  | { op: "delete"; ref: DestinationRef; mode: OnDelete }
  | { op: "afterRecord"; ref: DestinationRef };

// In-memory Publisher (testing-strategy "FakePublisher"): records every call and
// mints deterministic refs. `failOn` lets a scenario make a specific operation
// throw, to exercise partial-failure isolation.
export class FakePublisher implements Publisher {
  readonly type = "google-docs";
  readonly providerId = "google-drive";
  readonly capabilities = { folders: true, comments: true };

  readonly calls: Call[] = [];
  createdCount = 0;

  private readonly failOn: (call: Call) => boolean;

  constructor(opts: { failOn?: (call: Call) => boolean } = {}) {
    this.failOn = opts.failOn ?? (() => false);
  }

  private record(call: Call): void {
    this.calls.push(call);
    if (this.failOn(call)) throw new Error(`fake failure: ${call.op}`);
  }

  ops(kind: Call["op"]): Call[] {
    return this.calls.filter((c) => c.op === kind);
  }

  async create(doc: PublishTargetDoc): Promise<DestinationRef> {
    this.record({ op: "create", doc });
    this.createdCount++;
    const id = `id-${doc.name}`;
    return { id, url: `https://docs.google.com/document/d/${id}/edit` };
  }

  async update(ref: DestinationRef, doc: RenderedDoc): Promise<void> {
    this.record({ op: "update", ref, doc });
  }

  async move(ref: DestinationRef, segments: string[]): Promise<void> {
    this.record({ op: "move", ref, segments });
  }

  async delete(ref: DestinationRef, mode: OnDelete): Promise<void> {
    this.record({ op: "delete", ref, mode });
  }

  async afterRecord(ref: DestinationRef): Promise<void> {
    this.record({ op: "afterRecord", ref });
  }
}
