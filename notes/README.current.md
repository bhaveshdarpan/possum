# possum

Canonical home for product/technical docs, plus the pluggable pipeline that publishes them.

Docs are written once as Markdown in Git (single source of truth) and **published** one‑way to consumption surfaces. Only review feedback flows back, as pull requests.

> **Status:** V1 in design; specs in [`notes/`](notes/). A working PoC exists locally and is being reconciled with these specs.

## Flow (V1)

```mermaid
flowchart LR
  A["Git repos<br/>Markdown + front-matter"] -->|merge triggers CI| B["possum<br/>pipeline"]
  B --> C["Google Docs<br/>comment / review mirror"]
  C -. comments to PRs .-> A
  B -. deferred .-> D[Docusaurus]
  B -. deferred .-> E[PDF]
  B -. deferred .-> F["AI index"]
```

## V1 scope

- **Store:** Markdown in Git, one or many repos.
- **Pipeline:** config‑driven engine `possum`; a repo adopts it with a manifest + shared CI workflow — no repo‑specific code.
- **One publisher:** Google Docs (one‑way mirror).

**Deferred** (designed for, not built): Docusaurus, PDF, AI index, versioning, per‑doc access control.

## Why this exists

- **Edit the Markdown, not the Doc.** The Doc is a read-only published mirror (org gets commenter access on creation). Direct edits will be overwritten on the next sync.
- **Document URLs are stable.** Edits update the existing Doc in place, so external links keep working.

## Adopt in your repo

No engine code to install — the shared CI workflow builds and runs it for you. Three steps:

**1. Add `possum.yaml`** at your repo root:

```yaml
# possum.yaml
version: 1
source: { type: git, docsDir: docs }
targets:
  - {
      name: google-docs,
      type: google-docs,
      driveFolderId: "<id>",
      mode: mirror,
    }
defaults: { onUnchanged: skip, publish: [google-docs] }
ledger: ledger.json # optional; where the sync ledger lives (default shown)
```

**2. Add the caller workflow** — copy [`examples/possum-adopter.yml`](examples/possum-adopter.yml) to `.github/workflows/docs.yml`. It calls the shared reusable workflow (~15 lines, no engine code):

```yaml
jobs:
  possum:
    permissions: { contents: write, pull-requests: write }
    uses: bhaveshdarpan/possum/.github/workflows/publish.yml@main
    with:
      command: ${{ github.event_name == 'pull_request' && 'plan' || 'push' }}
    secrets:
      google-credentials-json: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
```

**3. Add the secret** — `GOOGLE_SERVICE_ACCOUNT_JSON` (the key file's full contents) under Settings → Secrets and variables → Actions. See [Setup](#setup) for creating the service account and sharing the Drive folder.

Then add `publish:` front‑matter to the docs you want mirrored (below). On a PR you get a read‑only plan comment; on merge to `main` it publishes and commits the ledger back.

> **Prefer more control?** Skip the reusable workflow and use the composite action directly (`uses: bhaveshdarpan/possum@main` with `command` / `manifest` / `google-credentials-json` inputs), writing your own commit/comment steps. The engine currently lives in this repo; pin `@main` now and switch to a release tag once one is cut.

**`possum.yaml` is yours to edit; `ledger.json` is the machine's.** The ledger is the pipeline's memory of what's already published — like `package-lock.json` to `package.json`. CI commits it back after each run; you commit it, but never hand-edit it. It defaults to `ledger.json` beside the manifest; point `ledger:` elsewhere (e.g. `state/ledger.json`) if you prefer — nested paths are created for you.

```yaml
# per-document front-matter
---
title: Payments overview
owner: payments-team
publish: [google-docs]
gdoc: "<filled-in-on-first-publish>"
---
```

The Doc name in Drive is taken from `title` if present, otherwise from the filename. Folder hierarchy under `docs/` is mirrored under the Drive root folder. Files outside `docs/` are ignored.

## Workflow

1. Branch from `main`.
2. Create or edit a file under `docs/` (e.g. `docs/payments/overview.md`).
3. Open a PR. Review on the Markdown diff.
4. Merge.
5. Publish — either automatically on merge (CI) or manually with `possum push`.

## Run modes

- **Dry‑run (PR check):** `possum plan` — print the create/update/rename/delete/skip plan without writing anything. Needs **no** service‑account key (planning is read‑only). `.github/workflows/dry-run.yml` runs it on every PR touching `docs/**`, posts the plan as a job summary + sticky PR comment, and fails on an invalid manifest.
- **Manual:** `possum push` — sync `docs/**` to Drive on demand. After a successful run, commit the updated `ledger.json` ledger.
- **On merge:** `.github/workflows/sync.yml` runs on push to `main` under `docs/**`, then commits the updated `ledger.json` ledger back with `[skip ci]`.

Config lives in the committed manifest; the **service‑account key stays a secret** (env / CI secret), never in the manifest.

## Setup

### Prerequisites

- Node.js 22+
- A Google account that can create Cloud projects and share Drive folders in your org

### 1. Create a Google Cloud project and enable the Drive API

1. Open the [Google Cloud Console](https://console.cloud.google.com) and create a new project (or reuse one).
2. Go to **APIs & Services → Library**, search for **Google Drive API**, and click **Enable**.

The Docs API is **not** required for v1 — we upload `.docx` and let Drive auto-convert it to a Google Doc. Enable it later only if you start using `docs.documents.batchUpdate`.

### 2. Create a service account and download its key

1. **APIs & Services → Credentials → Create credentials → Service account.**
2. Give it a name (e.g. `docs-sync`) and click **Create and continue**.
3. **Grant access to project**: leave both _Select a role_ and _Principals with access_ blank — Drive access is controlled by folder sharing, not GCP IAM. Click **Continue**, then **Done**.
4. Open the new service account, go to the **Keys** tab, **Add key → Create new key → JSON**. A `.json` file downloads.
5. Move the key file somewhere stable and outside the repo, e.g. `~/.config/docs-sync/service-account.json`. **Never commit it.** (The repo's `.gitignore` already blocks `service-account*.json` and `*-credentials.json`, but keeping the key out of the working tree entirely is safer.)
6. Note the service account email — it looks like `docs-sync@<project-id>.iam.gserviceaccount.com`. You'll paste it into Drive in the next step.

You do **not** need:

- Domain-wide delegation (only for impersonating end users).
- Project IAM roles like Owner / Editor (those are for GCP resources, not Drive).

### 3. Set up the Drive root folder

1. In Google Drive, create the folder that will hold all synced Docs (e.g. `Product Docs`).
2. Open it and copy the **folder ID** from the URL — the segment after `/folders/`:
   `https://drive.google.com/drive/folders/`**`1AbCdEf...XyZ`** → ID is `1AbCdEf...XyZ`.
3. Share the folder with the service account email:
   - **My Drive folder:** click **Share**, paste the SA email, set role to **Editor**, uncheck **Notify people**, click **Share**.
   - **Shared Drive:** sharing the folder alone is not enough. Open the Shared Drive → **Manage members** → add the SA email as **Content Manager**.

If Drive says "We couldn't find this user," your Workspace has external-visitor sharing restricted. Either use a Shared Drive (works around it) or have an admin relax the OU's sharing setting.

### 4. Local config

```bash
npm install
cp .env.example .env
```

The service-account key is the only **secret** — it lives in `.env`:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
```

Everything else is **structural config** and lives in the committed `possum.yaml` (ADR-0003). Set the Drive folder ID from step 3 and your Workspace domain on the `google-docs` target:

```yaml
targets:
  - name: google-docs
    type: google-docs
    driveFolderId: "<folder ID from step 3>"
    orgDomain: example.com
    mode: mirror
```

`orgDomain` is the Workspace domain that gets commenter access on every new Doc. If you're testing with a personal `@gmail.com` account, `type: domain` permission grants won't work — see _Personal account testing_ at the bottom.

### 5. Verify the setup

```bash
npm run build

mkdir -p docs/prd
cat > docs/prd/sync-smoke-test.md <<'EOF'
---
title: Sync smoke test
status: draft
---
# Hello from docs-sync
This file should appear as a Google Doc under the configured root folder.
EOF

node dist/cli/cli.js push
```

You should see a `created` line with the Doc URL, the Doc should appear in Drive under your root folder, and `ledger.json` should gain an entry. Running `push` again should report the file as unchanged (skipped).

### Personal account testing

`type: domain` permission grants require a Workspace domain. If you're using a personal Google account just to try this out, replace the `grantDomainCommenter` call in [src/orchestrator/run.ts](src/orchestrator/run.ts) with a `type: user` grant to your own email — or comment it out entirely. The Doc will then only be visible to whoever has access to the root folder (you and the SA), which is fine for solo testing.

## Running

The engine ships a `possum` CLI. Build once, then run the bin:

```bash
npm run build                # emit dist/ and the `possum` bin
node dist/cli/cli.js plan    # dry-run — read-only, no credentials
node dist/cli/cli.js push    # publish — needs GOOGLE_APPLICATION_CREDENTIALS
node dist/cli/cli.js push --manifest path/to/possum.yaml
node dist/cli/cli.js --help | --version
```

Installed as a package the bin is on `PATH`, so the same commands are `possum plan`, `possum push`, etc. Development checks:

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

`push` scans `docs/**/*.md`, compares each file's hash against `ledger.json`, and creates/updates the matching Google Doc. Unchanged files are skipped. After a successful run, commit `ledger.json`.

## Layout

Hexagonal layout (ADR-0006): the core (`domain`, `ports`, `app`) depends on nothing outside itself; adapters point inward; `cli` is the only composition root.

```text
docs/                          # source of truth (Markdown)
src/
  domain/                      # Document, Ledger, Target, PublishPlan — types + pure rules
  ports/                       # Publisher, LedgerStore — interfaces adapters implement
  app/
    plan.ts                    # walk docs/, hash, route, reconcile (create/update/rename/delete/skip)
    run.ts                     # execute a PublishPlan; per-action ledger bookkeeping
    pipeline.ts                # orchestrate targets → RunReport (pure; ports only)
  publishers/google-drive/     # GoogleDrivePublisher: docx render, folders, files, permissions
  adapters/
    git.ts                     # HEAD + rename detection
    file-ledger-store.ts       # read / write ledger.json (implements LedgerStore)
    ledger-schema.ts           # zod schema for the ledger
  config.ts                    # env secrets (service-account key)
  config/manifest.ts           # possum.yaml schema + fail-fast loader
  cli/
    main.ts                    # composition root — wires publishers to the core
    cli.ts                     # `possum` bin — arg parsing, report rendering, exit codes
  index.ts                     # public API barrel (programmatic use)
possum.yaml                   # committed manifest (source, targets, defaults)
ledger.json                    # ledger: path → provider → { fileId, url, hash }; + lastSyncedSha
dist/                          # build output (the published package; gitignored)
```

## Docs

[PRD](notes/product/prd.md) · [Domain model](notes/architecture/domain-model.md) · [System design](notes/architecture/system-design.md) · [ADRs](notes/architecture/adr/) · [Testing strategy](notes/testing/testing-strategy.md)
