# ADR-0001: Markdown in Git as the canonical store

**Status:** Accepted
**Date:** 2026-07-01
**Deciders:** Docs platform owner, Engineering, Product

## Context

Product/technical docs must be authored by PMs, engineers, and designers, reviewed,
version-controlled, consumed company-wide, and — increasingly — ingested by AI agents.
Today content is spread across Google Docs, wikis, and repos with no authoritative
source, causing drift and duplicated maintenance. We need one canonical store.

## Decision

Store all canonical docs as **Markdown files in Git repositories**. Every other
surface (Google Docs now; site, PDF, AI later) is a generated, one-way **Mirror**. The
only thing that flows back into Git is review feedback, as pull requests.

## Options considered

### Option A: Markdown in Git (chosen)

| Dimension               | Assessment                                             |
| ----------------------- | ------------------------------------------------------ |
| Complexity              | Low — Git is already in use                            |
| Cost                    | Low                                                    |
| Review/versioning       | Native (PRs, history, blame, ownership via CODEOWNERS) |
| AI-readiness            | Native — plain text, zero conversion                   |
| Non-technical authoring | Poor — mitigated by Google Docs comment mirror         |

**Pros:** single source of truth; docs live next to code/decisions; free history and
review; machine-readable for future AI index.
**Cons:** authoring floor is higher for non-technical writers.

### Option B: Wiki (Notion/Confluence) as canonical

**Pros:** friendly editing, comments, search.
**Cons:** proprietary store → only partially AI-ready; weak/opaque versioning; drift
risk; harder to keep "one source" across many teams' repos.

### Option C: Google Docs as canonical

**Pros:** best non-technical authoring and review.
**Cons:** least AI-ready (needs export); no real diff/PR review; bidirectional editing
breaks single-source guarantees.

## Trade-off analysis

The decisive factors are **AI-readiness** and **review/versioning**, where Git+Markdown
dominates, and **non-technical authoring**, where it is weakest. We accept the authoring
weakness because it is addressable at the _consumption_ layer (a comment/review mirror
in Google Docs) without compromising the source of truth — whereas the store's
weaknesses in B and C are structural and cannot be mitigated without giving up the
single source.

## Consequences

- **Easier:** trustworthy history, PR review, CODEOWNERS-based ownership, and a future
  AI index that reads the source directly.
- **Harder:** non-technical contributors cannot author directly; they comment on the
  mirror and an owner folds feedback into PRs.
- **Revisit:** if non-technical _authoring_ (not just commenting) becomes a hard
  requirement, add a Git-backed visual CMS layer — without changing the store.

## Action items

1. [ ] Adopt `docs/` as the canonical docs directory convention across repos.
2. [ ] Establish CODEOWNERS-based doc ownership.
3. [ ] Document the "comments → PRs" review loop in the contributing guide.
