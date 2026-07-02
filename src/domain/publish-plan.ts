// How a deleted source's mirror is handled.
export type OnDelete = "trash" | "archive" | "ignore";

// One decided operation for a Document on a Target. The core produces a
// PublishPlan (a list of these); adapters execute them. Ubiquitous-language
// name for what the PoC calls `DocAction` (ADR-0006).
export type PublishAction =
  | {
      kind: "create";
      sourcePath: string;
      segments: string[];
      name: string;
      body: string;
      hash: string;
    }
  | {
      kind: "update";
      sourcePath: string;
      fileId: string;
      name: string;
      body: string;
      hash: string;
    }
  | {
      kind: "rename";
      fromPath: string;
      sourcePath: string;
      fileId: string;
      segments: string[];
      name: string;
      body: string;
      hash: string;
    }
  | { kind: "delete"; sourcePath: string; fileId: string; onDelete: OnDelete }
  | { kind: "skip"; sourcePath: string; reason: string };

export type PublishPlan = PublishAction[];
