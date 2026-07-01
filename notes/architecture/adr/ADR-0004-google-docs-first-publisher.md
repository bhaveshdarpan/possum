# ADR-0004: Google Docs as the first publisher (V1)

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Product, Engineering, Docs platform owner

## Context

We must ship one consumption surface in V1 to prove the store + pipeline end to end.
Candidate first surfaces are Google Docs, a Docusaurus site, and PDF export. The company
already uses Google Docs heavily and already has a Markdown→Google Docs pipeline.

## Decision

Ship **Google Docs** as the only V1 Publisher, implemented as the `GoogleDocsPublisher`
adapter behind `PublisherPort` (see [ADR-0002](ADR-0002-ports-and-adapters.md)). It is a
**one-way, comment/suggest-only mirror**: the pipeline creates and updates Google Docs
from Git; it never treats Doc content as source. Docusaurus, PDF, and AI index are
deferred behind the same seam.

## Options considered

### Option A: Google Docs first (chosen)

| Dimension               | Assessment                                       |
| ----------------------- | ------------------------------------------------ |
| Time to value           | Low — existing pipeline to refactor, not build   |
| Audience fit            | High — non-technical reviewers already live here |
| Review capability       | Strong — comments + suggesting mode              |
| AI-readiness of surface | Low — but irrelevant in V1 (AI deferred)         |

**Pros:** fastest path; reuses existing work; best surface for the non-technical review
loop that Git can't provide.
**Cons:** proprietary format (not the surface we'd point AI at — but AI is deferred).

### Option B: Docusaurus site first

**Pros:** best reader experience; natively built from Markdown; AI-ready.
**Cons:** more to build/host in V1; doesn't reuse the existing Google Docs pipeline;
the non-technical _review_ loop still needs Google Docs anyway.

### Option C: PDF export first

**Pros:** simple artifact.
**Cons:** weakest as a living, reviewable surface; no comment loop.

## Trade-off analysis

Google Docs wins on **time to value** (refactor an existing pipeline rather than build a
new site) and uniquely provides the **review loop** that the Git store lacks — which is
the specific gap V1 most needs to close for company-wide, non-technical consumption. The
site's advantages (reader experience, AI-readiness) matter most for surfaces that are
themselves deferred, so they don't argue for making it _first_.

## Consequences

- **Easier:** V1 delivery (reuse), and immediate non-technical review via comments.
- **Harder:** we must enforce the one-way discipline operationally — Docs are set
  comment/suggest-only and a doc owner triages comments back into PRs. If people edit
  Docs as masters, single-source is broken (see [ADR-0001](ADR-0001-markdown-git-canonical-store.md)).
- **Revisit:** add `DocusaurusPublisher` next (best reader surface), then `PdfPublisher`
  (reuse Google Docs → PDF or Pandoc), then `AiIndexPublisher` (which must inherit the
  access boundary from PRD Open Question #1).

## Action items

1. [ ] Refactor the existing Markdown→Google Docs pipeline into `GoogleDocsPublisher`.
2. [ ] Set created Docs to comment/suggest-only; document the "comments → PRs" loop.
3. [ ] Configure the service account + target Drive folder(s) (PRD Open Question #3).
4. [ ] Add P1 comment-surfacing to the Run Report for owner triage.
