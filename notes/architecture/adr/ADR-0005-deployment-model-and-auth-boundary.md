# ADR-0005: Enterprise deployment model & auth boundary

**Status:** Proposed — directional; governs the multi‑org / enterprise phase. V1 (single internal org) may retain its service account until the auth items below land.
**Date:** 2026-07-01
**Deciders:** Product, Engineering, Security

## Context

If the engine becomes a product **any org can adopt**, the decision that dominates
pricing, sales cycle, and — above all — the security review that gates enterprise
deals is **where customer documents and credentials live**. The more we touch them,
the heavier the compliance burden (SOC 2, DPAs, data residency) and the slower the
deal. The current PoC authenticates with a **static Google service‑account JSON key**:
fine for one internal org, unworkable across many, since no org will mint and hand over
a long‑lived credential to a third party.

## Decision

Two coupled decisions.

### (a) Deployment — keep the data plane customer‑side; phase toward SaaS, don't jump

- Ship the engine as an **open‑core, self‑hosted** artifact: a GitHub Marketplace
  **Action** + a **CLI**. It runs entirely in the customer's CI; their docs and
  credentials **never transit our systems**.
- Anything we host is a **thin control plane** (marketplace/install, licensing &
  billing, engine releases, usage metadata) that **never holds customer documents**.
- **Defer full SaaS**; add it only on demand, and always keep the self‑hosted runner as
  an option for regulated orgs.

### (b) Auth boundary — per‑org, least‑privilege, no shared secrets

- **Google OAuth:** each org's admin consents to least‑privilege Drive scopes for their
  own Workspace.
- **GitHub App:** per‑installation, short‑lived tokens (not PATs, not a shared key).
- **Retire static service‑account keys** for any external‑facing (multi‑org) use.

## Options considered

### (a) Deployment model

| Option                                                  | We run at runtime  | Docs/creds touch us                      | Best for                                               | Cost                       |
| ------------------------------------------------------- | ------------------ | ---------------------------------------- | ------------------------------------------------------ | -------------------------- |
| **Self‑hosted Action + CLI (open‑core) — chosen first** | nothing            | **no**                                   | fast enterprise adoption; near‑trivial security review | harder direct monetization |
| GitHub App / Marketplace orchestration                  | orchestration only | no, if the customer runner does the work | distribution + built‑in billing                        | moderate                   |
| Full SaaS                                               | everything         | **yes** (tenant state)                   | best UX; non‑technical buyers                          | SOC 2, DPAs, residency     |

### (b) Auth

| Option                                   | Pros                                                                    | Cons                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Static service‑account key (current)     | simplest for one org                                                    | no org will hand over a long‑lived credential; not per‑tenant; unsafe at scale |
| **OAuth (Google) + GitHub App — chosen** | per‑org consent, least privilege, short‑lived tokens, no shared secrets | more upfront auth plumbing                                                     |

## Trade-off analysis

Self‑hosted‑first trades the richest managed UX for the **smallest compliance surface
and the shortest sales cycle** — "we never see your documents" is the fastest path
past enterprise security review, and it is the bottom‑up motion most dev tools use to
enter the enterprise. The control‑plane boundary preserves a monetization / telemetry /
dashboard story without dragging content onto our servers. On auth, static keys are a
non‑starter across orgs; the OAuth + GitHub App plumbing is upfront cost that is far
cheaper now than retrofitting after everything is built on service accounts.

## Consequences

- **Easier:** enterprise security review; per‑tenant isolation is inherent (each org's
  runtime, credentials, and ledger stay theirs); new surfaces stay additive as
  providers ([ADR-0002](ADR-0002-ports-and-adapters.md)).
- **Harder:** OAuth consent + GitHub App infrastructure; publishing and maintaining a
  Marketplace Action and CLI; the manifest, CLI, and provider API become **public,
  versioned contracts** (semver + deprecation policy) where a breaking change is
  catastrophic at scale.
- **Deferred:** full SaaS, if ever, pulls in the full compliance program (SOC 2 Type II
  / ISO 27001, DPAs, encryption at rest, residency) — explicitly out of scope here.

## Action items

1. [ ] Replace static SA keys with **Google OAuth** (per‑org admin consent, least‑
       privilege scopes) for external use.
2. [ ] Add a **GitHub App** (per‑installation tokens) for repo/CI access.
3. [ ] Package the engine as a **Marketplace Action + CLI**; define the open‑core split
       (free core vs paid SSO/audit/premium providers/support).
4. [ ] Define control‑plane scope (install, licensing, usage) with a hard **"no customer
       documents"** rule.
5. [ ] Version the manifest, CLI, and provider API (semver + deprecation policy); relates
       to [ADR-0003](ADR-0003-config-manifest-multi-repo.md).
6. [ ] Keep V1 on its service account until (1)–(2) land; do not expose it externally.
