---
theme: default
title: Docs-Sync
info: |
  Markdown in GitHub. Google Docs for the rest of the org.
class: text-center
transition: slide-left
mdc: true
---

# Docs-Sync

Markdown in GitHub. Google Docs for the rest of the org.

---
layout: center
---

## What it does

- Markdown under `docs/` &nbsp;→&nbsp; Google Docs in Drive
- One-way sync, automatic on merge to `main`
- Folder hierarchy mirrored
- Read-only Docs &middot; org gets comment access

---
layout: default
---

## How it does

**Adding a new doc**

```mermaid {scale: 0.45}
flowchart LR
  A[Edit docs/*.md] --> B[Merge PR to main]
  B --> C[GitHub Action]
  C --> D{In _index.json?}
  D -->|No| E[Convert MD → DOCX]
  E --> F[Create Doc in Drive]
  F --> G[Grant org comment access]
  G --> H[Record fileId + hash]
```

**Updating an existing doc**

```mermaid {scale: 0.45}
flowchart LR
  A[Edit docs/*.md] --> B[Merge PR to main]
  B --> C[GitHub Action]
  C --> D{Content hash changed?}
  D -->|Yes| E[Convert MD → DOCX]
  E --> F[Update same Doc · URL stays]
  F --> G[Refresh hash in index]
  D -->|No| H[Skip]
```

---
layout: two-cols
---

## Benefits

**Engineering**

- Write in your editor
- Review in PRs
- Versioned in Git

::right::

<br/><br/>

**Product &amp; stakeholders**

- Read & comment in Drive
- Stable Doc URLs
- No GitHub account needed

---
layout: two-cols
---

## Architectural benefits

**Future extensibility**

- Provider-keyed index
- Drive today &middot; Notion / Confluence tomorrow
- New provider &rArr; no migration

::right::

<br/><br/>

**Maintainability**

- Pure converters &middot; no hidden state
- Three layers: orchestrator &middot; converters &middot; providers

---
layout: end
class: text-center
---

# Thank you

Questions?
