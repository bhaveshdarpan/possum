# Migrating possum to a new repo / account

The engine is self-contained and config-driven — moving it is a repo copy plus a
find/replace over a handful of hard-coded identifiers. This doc lists exactly what
to change so future-you can do it in a few minutes.

## When is it cheapest?

| Timing                                     | GitHub move                                                        | npm package                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Before publish + before adopters** (now) | trivial                                                            | trivial — nothing published yet                                                          |
| **After publish, before adopters**         | trivial                                                            | seamless _if you keep the npm scope_; a scope change means deprecate-old + republish-new |
| **After adopters exist**                   | use **Transfer** (keeps redirects) or you break their `uses:` refs | keep the scope, or adopters' `npx @scope/possum` breaks                                  |

**Rule of thumb:** moving the GitHub repo is always easy. The npm _scope_ is the
thing worth keeping stable — it's decoupled from GitHub, so you can change GitHub
owners freely and keep publishing the same `@bhaveshdarpan/possum`.

## Two ways to move the repo

**A. GitHub Transfer** (Settings → General → Transfer ownership) — **preferred.**
Moves history, issues, PRs, releases, and sets up **redirects** from the old URL,
so existing `uses: old-owner/possum@…` references keep resolving. Requires access
to the destination account.

**B. Fresh repo + mirror push** (into a brand-new account).
Preserves all commits/branches/tags but **not** issues/PRs, and **no redirects**.

```bash
git clone --mirror https://github.com/bhaveshdarpan/possum.git
cd possum.git
git push --mirror https://github.com/NEW-OWNER/possum.git
```

**Secrets never transfer** (either method). Re-add in the new repo:
`NPM_TOKEN` and `GOOGLE_SERVICE_ACCOUNT_JSON` (Settings → Secrets and variables → Actions).

## Reference inventory — what to update

Current identifiers:

- **GitHub owner/repo:** `bhaveshdarpan/possum`
- **npm scope/name:** `@bhaveshdarpan/possum`

Change GitHub owner/repo (only if the repo moves) in:

| File                            | What                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| `.github/workflows/publish.yml` | `uses: bhaveshdarpan/possum@main` (the composite-action ref)    |
| `examples/possum-adopter.yml`   | `uses: bhaveshdarpan/possum/.github/workflows/publish.yml@main` |
| `README.md`                     | the two `uses:` paths in "Adopt in your repo"                   |
| `package.json`                  | `repository.url`, `homepage`, `bugs.url`                        |

Change npm scope/name (**only if** you switch npm accounts) in:

| File                            | What                               |
| ------------------------------- | ---------------------------------- |
| `package.json`                  | `name` (`@bhaveshdarpan/possum`)   |
| `.github/workflows/release.yml` | the header comment                 |
| `README.md`, `CLAUDE.md`        | prose mentions of the package name |

**No change needed:** `sync.yml` and `dry-run.yml` use `uses: ./` (relative to the
repo), so they follow the code wherever it lives. The CLI command (`possum`), the
manifest name (`possum.yaml`), and the ledger are all local and identity-free.

### One-liners

Move the GitHub owner (keep repo name `possum`):

```bash
git grep -l 'bhaveshdarpan/possum' | xargs sed -i '' 's#bhaveshdarpan/possum#NEW-OWNER/possum#g'
```

Change the npm scope (only if switching npm accounts):

```bash
git grep -l '@bhaveshdarpan/possum' | xargs sed -i '' 's#@bhaveshdarpan/possum#@NEW-SCOPE/possum#g'
```

Then run `npm run typecheck && npm test && npm run build` and re-parse the workflows
before pushing.

## If you change the npm scope after publishing

npm can't rename a published package. So:

1. Republish under the new scope from a fresh version (`@NEW-SCOPE/possum`).
2. Deprecate the old one so anyone who finds it is redirected:
   ```bash
   npm deprecate @bhaveshdarpan/possum "moved to @NEW-SCOPE/possum"
   ```
3. If you set up OIDC trusted publishing, re-register the new repo/package as the
   trusted publisher (the OIDC binding is per package + per repo).

## After migrating — verify

- `npm run typecheck && npm test && npm run build`
- `node dist/cli/cli.js plan` (reads `possum.yaml`) runs clean.
- All workflow YAML parses.
- New repo has `NPM_TOKEN` + `GOOGLE_SERVICE_ACCOUNT_JSON` secrets.
- A test PR triggers `dry-run.yml`; a merge triggers `sync.yml`.
- (If publishing) push a `v*` tag and confirm `release.yml` publishes to the intended scope.
