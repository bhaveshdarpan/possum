# documentation_repository

Source of truth for product documentation (PRDs, implementation plans). Markdown files in this repo are the canonical version; a sync engine pushes them to Google Drive as Google Docs, so non-engineers can read and comment without round-tripping through GitHub.

**Phase 1 (current):** Drive + Markdown, push-only, manual run. Handles new files (`Add`) and edits (`Modify`). Rename, delete, GitHub Action automation, additional providers, and additional file types are deferred.

## Workflow

1. Branch from `main`.
2. Create or edit a file under `docs/` (e.g. `docs/prd/product-a/feature-x.md`).
3. Open a PR. Review on the Markdown diff.
4. Merge.
5. Run `npm run push` locally.
6. Commit and push the updated `_index.json`.

## Authoring conventions

Each Markdown file should start with YAML frontmatter:

```yaml
---
title: Feature X PRD
owner: jane@example.com
status: draft   # draft | review | approved | archived
---
```

The Doc name in Drive is taken from `title` if present, otherwise from the filename.

Folder hierarchy under `docs/` is mirrored under the Drive root folder. Files outside `docs/` are ignored.

## Why this exists

- **Edit the Markdown, not the Doc.** The Doc is a read-only published view (org gets commenter access on creation). Direct edits will be overwritten on the next sync.
- **Document URLs are stable.** Edits update the existing Doc in place, so external links keep working.

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
3. **Grant access to project**: leave both *Select a role* and *Principals with access* blank — Drive access is controlled by folder sharing, not GCP IAM. Click **Continue**, then **Done**.
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

Edit `.env`:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/service-account.json
DRIVE_ROOT_FOLDER_ID=<folder ID from step 3>
ORG_DOMAIN=example.com
```

`ORG_DOMAIN` is the Workspace domain that gets commenter access on every new Doc. If you're testing with a personal `@gmail.com` account, `type: domain` permission grants won't work — see *Personal account testing* at the bottom.

### 5. Verify the setup

```bash
npm run typecheck

mkdir -p docs/prd
cat > docs/prd/sync-smoke-test.md <<'EOF'
---
title: Sync smoke test
status: draft
---
# Hello from docs-sync
This file should appear as a Google Doc under the configured root folder.
EOF

npm run push
```

You should see a `create` line printed with a URL, the Doc should appear in Drive under your root folder, and `_index.json` should gain an entry. Running `npm run push` again should print `skip` for the unchanged file.

### Personal account testing

`type: domain` permission grants require a Workspace domain. If you're using a personal Google account just to try this out, replace the `grantDomainCommenter` call in [src/orchestrator/run.ts](src/orchestrator/run.ts) with a `type: user` grant to your own email — or comment it out entirely. The Doc will then only be visible to whoever has access to the root folder (you and the SA), which is fine for solo testing.

## Running

```bash
npm run push       # sync docs/** to Drive
npm run typecheck  # tsc --noEmit
npm test           # vitest (no tests yet in Phase 1)
```

`npm run push` scans `docs/**/*.md`, compares each file's hash against `_index.json`, and creates/updates the matching Google Doc. Unchanged files are skipped. After a successful run, commit `_index.json`.

## Layout

```text
docs/                          # source of truth (Markdown)
src/
  config.ts                    # env validation
  main.ts                      # entrypoint
  orchestrator/
    plan.ts                    # walk docs/, hash, diff against index
    run.ts                     # execute create/update actions
  converters/
    markdown-to-docx.ts        # @mohtasham/md-to-docx (pure JS)
  providers/google-drive/
    auth.ts                    # service account → Drive client + run context
    folders.ts                 # ensure-folder-path with per-run cache
    files.ts                   # create / update Google Doc from .docx upload
    permissions.ts             # grant domain commenter
  index/
    schema.ts                  # zod schema for _index.json
    io.ts                      # read / write _index.json
scripts/
  push.ts                      # thin wrapper around src/main.ts
_index.json                    # path → provider → { fileId, url, hash }
```
