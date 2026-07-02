import type { Document } from "../domain/document.js";
import type { OnDelete } from "../domain/publish-plan.js";

export type DestinationRef = { id: string; url: string };

// The document fields a publisher needs to create or update a mirror.
export type PublishTargetDoc = Pick<Document, "name" | "body" | "segments">;

// A destination type (Google Docs today; Notion / PDF later). One implementation
// per Target type. The app depends only on this interface — never on a concrete
// publisher — so adding a surface is additive (ADR-0002 / ADR-0006).
export interface Publisher {
  readonly type: string; // manifest target type, e.g. "google-docs"
  readonly providerId: string; // stable ledger key, e.g. "google-drive"
  readonly capabilities: { folders: boolean; comments: boolean };

  create(doc: PublishTargetDoc): Promise<DestinationRef>;
  update(ref: DestinationRef, doc: PublishTargetDoc): Promise<void>;
  move(ref: DestinationRef, segments: string[]): Promise<void>;
  delete(ref: DestinationRef, mode: OnDelete): Promise<void>;

  // Post-record side effects (e.g. grant commenter access). Invoked AFTER the
  // ledger is persisted, so a failure here can never orphan a recorded mirror —
  // this is what preserves the P0-6 "record before grant" ordering once the
  // grant moves inside the publisher.
  afterRecord?(ref: DestinationRef): Promise<void>;
}
