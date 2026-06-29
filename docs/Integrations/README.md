---
title: "Authoring Guide"
---

# Integration Docs — Authoring Guide

How the docs in this folder are organised, and the few rules that keep them consistent for everyone. (Docs sync to Google Drive: folders mirror, and each Drive Doc is named from the file's frontmatter `title`.)

## Structure

```
Integrations/
  <Connector>/          # one folder per connector (Netsuite, Quickbooks, Avalara, Anrok…)
    UseCase.md          # what syncs — coverage, object mappings, caveats
    Setup.md            # how to connect & configure
    Working/            # design & planning docs (PRDs, ADRs, plans, proposals)
  _Template/            # copy these to start a new connector
    UseCase.md
    Setup.md
```

## The two core docs

- **`UseCase.md` → "Use Cases":** what Zenskar syncs and how each object maps — the product-facing source of truth.
- **`Setup.md` → "Setup & Configuration Guide":** how to connect the system and set it up.

Both are **product-oriented and team-facing** — describe the business outcome, not the code (no file/line citations, no SDK jargon). Keep the shared shape: one-minute overview → Legend → Coverage at a glance → per-use-case (how it's handled / mapping / caveats) → Not supported.

`Working/` holds the engineering artifacts behind a connector (PRDs, ADRs, implementation plans, proposals).

## Titles (this is what names the Drive Doc)

Every file needs a frontmatter `title`. **The folder already says which connector — never repeat it in the title.**

**Format: `<Subject> — <Artifact>`**

| Case                 | Rule                     | Example                                    |
| :------------------- | :----------------------- | :----------------------------------------- |
| Self-descriptive doc | Stands alone             | `Use Cases`, `Setup & Configuration Guide` |
| Generic doc-type     | **Must** carry a subject | `Multi-Provider Tax Sync — PRD`            |
| Variant              | Append `(Concise)`       | `LLD (Concise)`                            |
| Template             | Append `(Template)`      | `Use Cases (Template)`                     |

- **Subject** = the feature / domain concept in plain language (e.g. _Avalara Tax Sync_, _Automated Sales Tax_) — not the connector name.
- **Artifact** = one of `PRD · Overview · Proposal · Design · Implementation Plan · ADR-NNNN · HLD · LLD · Use Cases · Setup & Configuration Guide`.
- A bare `PRD` isn't enough — it says the _kind_, not the _topic_.

## Add a new integration

1. Copy `_Template/UseCase.md` + `Setup.md` into a new `Integrations/<Connector>/` folder.
2. Fill them in — product voice, keep the section shape.
3. Set each file's `title` per the rule above.
4. Put any design/planning docs under `Working/`.

Keep it short, business-first, and consistently titled.
