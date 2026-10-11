# Contributing to Saarthi

How code moves from your machine to production. Everyone follows these rules, the lead
included. GitHub enforces most of them and rejects anything that breaks them.

## The short version

1. Branch from `develop` using the [naming rules](#branch-naming).
2. Write [Conventional Commit](#commit-messages) messages.
3. Run the [local checks](#local-checks) before pushing.
4. Open a pull request into `develop`. Its **title** must be a Conventional Commit.
5. @Muba9161 reviews it. Address every comment.
6. It is **squash-merged** and the branch is deleted automatically.

Never push directly to `main` or `develop`; GitHub rejects it.

---

## Branches

| Branch       | Purpose                                                          | Branches from |
| ------------ | ---------------------------------------------------------------- | ------------- |
| `main`       | Production. `deploy/deploy.sh --pull` deploys whatever is here. | none          |
| `develop`    | Integration: the next release, tested together                  | `main`        |
| `feature/*`  | New features                                                     | `develop`     |
| `fix/*`      | Bug fixes                                                        | `develop`     |
| `refactor/*` | Code restructuring with no behaviour change                      | `develop`     |
| `chore/*`    | Maintenance: dependencies, tooling, config                       | `develop`     |
| `docs/*`     | Documentation only                                               | `develop`     |
| `hotfix/*`   | Urgent production fixes (lead only)                              | `main`        |

Work branches are short-lived: one task, merged within a few days, deleted after merge.

### Branch naming

`<type>/<issue-number>-<short-description>`: lowercase, words joined by hyphens. Include the
issue number when there is one.

```
feature/123-add-login
feature/124-user-dashboard
fix/125-redirect-issue
refactor/126-auth-module
chore/127-update-dependencies
docs/128-api-documentation
hotfix/129-critical-payment-bug
```

Not accepted: `test`, `new`, `changes`, `final`, `abc`, your own name, or anything without a type
prefix.

---

## Commit messages

Saarthi uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<optional body: what changed and why, not how>

<optional footer: Closes #123, BREAKING CHANGE: ...>
```

| Type       | Purpose                                         |
| ---------- | ----------------------------------------------- |
| `feat`     | New feature                                     |
| `fix`      | Bug fix                                         |
| `refactor` | Code restructuring with no behaviour change     |
| `perf`     | Performance improvement                         |
| `docs`     | Documentation                                   |
| `test`     | Adding or fixing tests                          |
| `chore`    | Maintenance: dependencies, tooling, config      |
| `style`    | Formatting only: whitespace, semicolons, quotes |

**Scope** is optional and names the part of the repo you touched: `api`, `web`, `shared`,
`device` (device-android), `terminal` (terminal-android), `db` (Prisma schema and migrations),
`deploy`, `deps`, `ci` (GitHub workflows) or `release`. No other scope is accepted.

**Subject** rules:

- Imperative mood: "add", not "added" or "adds".
- Lowercase first letter, no full stop at the end, 72 characters at most.
- Says what changed. `fix(api): reject expired OTP codes`, not `Fixed bug.`

One logical change per commit. Messages such as `Changes made`, `update`, `wip` or `final` are not
accepted.

```
feat(web): add email verification flow
fix(api): resolve login redirect after token refresh
refactor(shared): simplify entitlement checks
perf(api): index trips by vehicle and start time
docs: document the device pairing flow
test(api): cover backhaul commission rounding
chore(deps): update vitest
```

### Breaking changes

A change that breaks an existing client is a breaking change. That includes the web app, the
Android apps and any API consumer. Mark it with `!` and explain it in the footer:

```
feat(api)!: require vehicle id on trip creation

BREAKING CHANGE: POST /api/v1/trips now rejects requests without vehicleId.
Saarthi Terminal 1.2 and earlier must be updated first.
```

### Pull request titles

Pull requests are squash-merged, so the **PR title becomes the one commit** that lands on
`develop`. It must follow the same format, for example `feat(web): add email verification flow`.
Commits inside your branch should still be meaningful, because reviewers read them.

---

## Daily workflow

```bash
# 1. Start from the latest develop
git checkout develop
git pull origin develop

# 2. Create your branch
git checkout -b feature/123-add-login

# 3. Make your changes, then run the local checks (below)

# 4. Commit
git add <files>
git commit -m "feat(web): add login form validation"

# 5. Push and open a pull request into develop
git push -u origin feature/123-add-login
```

In VS Code the same steps are the branch picker (bottom-left), the Source Control panel for
commits, and the **GitHub Pull Requests** extension for opening the PR.

If `develop` moves on while you work, bring your branch up to date with `git pull origin develop`
or the **Update branch** button on the PR. Never force-push a branch someone else is using.

### Local checks

```bash
npm run lint
npm run typecheck
npm test
```

API tests run against a real PostgreSQL database; see [`LOCAL_SETUP.md`](LOCAL_SETUP.md).

Format every file you change with Prettier. The easiest way is the **Prettier** extension in
VS Code with **Format on Save** turned on; otherwise run `npx prettier --write <file>`. Much of the
existing code predates the Prettier config, so `npm run format:check` across the whole repo still
fails. Only the files you touch are checked.

### Automatic checks

Every pull request runs these on GitHub, and it cannot be merged until all of them pass:

| Check                   | What it verifies                                                       |
| ----------------------- | ---------------------------------------------------------------------- |
| Branch & title rules    | Branch name, target branch and PR title follow this guide              |
| Lint, typecheck & build | ESLint, Prettier on the changed files, TypeScript, and a full build    |
| Tests                   | Every test, with the API suite against a fresh PostgreSQL 17 database  |

A red check links to its log. Fix the problem and push again, and the checks re-run by themselves.
A rejected title only needs editing; no new commit is required.

---

## Pull requests

- **Target** `develop`. Only hotfixes target `main`.
- **Title:** a Conventional Commit (see above).
- **Description:** fill in the template and link the issue with `Closes #123`.
- **Size:** one feature or one fix. Large mixed PRs are sent back to be split.
- **Review:** @Muba9161 is requested automatically. One approval is required, and every
  conversation must be resolved. Pushing new commits after approval dismisses it, so request
  review again.
- **Merge:** squash and merge, done by the lead. The branch is deleted automatically.

---

## Versioning

Versions follow [Semantic Versioning](https://semver.org/), written `vMAJOR.MINOR.PATCH`:

| Part  | Bump when                                                                     | Example           |
| ----- | ----------------------------------------------------------------------------- | ----------------- |
| MAJOR | A breaking change: API contract, Android app compatibility, data migration    | `v1.4.2 → v2.0.0` |
| MINOR | A new, backward-compatible feature                                            | `v1.4.2 → v1.5.0` |
| PATCH | A backward-compatible bug fix                                                 | `v1.4.2 → v1.4.3` |

## Releases (lead)

1. On a `chore/release-vX.Y.Z` branch from `develop`, compile [`CHANGELOG.md`](CHANGELOG.md) from
   the PR titles merged since the last tag (`feat` → Added, `fix` → Fixed,
   `refactor`/`perf` → Changed). Bump `version` in the root `package.json`, then merge into
   `develop`.
2. Open a PR `develop → main` titled `chore(release): vX.Y.Z` and merge it with
   **Create a merge commit**, not squash. Squashing would give `main` a different history from
   `develop`, and every later release PR would conflict.
3. Tag the merge commit on `main` and push the tag:
   ```bash
   git checkout main && git pull origin main
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```
4. Create a GitHub Release from the tag, using the changelog section as release notes.
5. Deploy: `bash deploy.sh --pull` on the server (see [`deploy/README.md`](../deploy/README.md)).

## Hotfixes (lead)

1. Branch `hotfix/<issue>-<description>` from `main`.
2. Open a PR into `main`, squash-merge it, then tag and deploy a PATCH version.
3. Open a PR `main → develop`, titled for example `chore(release): merge v1.4.3 into develop`,
   and merge it with a merge commit, so the fix is not lost from the next release.

## Database migrations

Rolling back means redeploying an earlier tag, but `prisma migrate deploy` only moves forward.
The previous release must still run against the newer schema:

- Add columns as nullable or with a default.
- Rename or remove in two releases: stop using it first, drop it in a later release.
- Never edit or delete a migration that has been merged; add a new one.

---

## Secrets: this repository is public

Everything pushed is visible to everyone, including branches that were never merged. Deleting a
commit later does not undo the leak.

- Never commit `.env`, API keys, tokens, passwords, keystores (`*.jks`, `*.keystore`) or
  `keystore.properties`.
- New configuration goes into `.env.example` with a placeholder value, never a real one.
- If you commit a secret by accident, tell the lead **immediately**. The secret has to be
  rotated; removing the commit is not enough.

## Never

- Push directly to `main` or `develop`.
- Force-push a shared branch.
- Merge your own pull request.
- Commit `node_modules`, build output (`dist/`, `build/`, APKs), logs or uploads.
- Leave a merged branch alive.
