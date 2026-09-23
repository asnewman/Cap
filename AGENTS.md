# ⚠️ FORK NOTICE — read this first

This is **`asnewman/Cap`**, a customized fork of [CapSoftware/cap](https://github.com/CapSoftware/cap) that is **self-hosted in production on Railway**. It is not upstream. `main` is the **live deployment branch**: pushing to `main` auto-builds and deploys the real instance. Treat changes with production care, and preserve the fork's customizations (below) when merging upstream or refactoring.

## Deployment
- **Host:** Railway, project `cap-selfhost`. The `cap-web` service builds from **this repo's `main`** using `apps/web/Dockerfile` (selected via the service's `RAILWAY_DOCKERFILE_PATH` env var). **Push to `main` → automatic build + deploy.** There is no separate release step.
- **Services:** `cap-web` (this fork) · `media-server` (`ghcr.io/capsoftware/cap-media-server`, official image) · `MySQL` (Railway managed) · `minio` (S3-compatible storage, **path-style**, `S3_PATH_STYLE=true`).
- **Config & secrets live in Railway env vars, never in the repo.** Do not hardcode keys or infra values. Transcription uses **AssemblyAI** (`ASSEMBLY_API_KEY`).
- **Watch a deploy:** `railway logs --build --service cap-web` (build) or `railway logs --service cap-web` (runtime). The app auto-runs DB migrations on boot via `apps/web/instrumentation.node.ts`.

## Fork customizations — do NOT drop these
- **Email + password login** (upstream has none). A `CredentialsProvider` in `packages/database/auth/auth-options.ts` hashes passwords with Node's built-in `crypto.scrypt` (helpers in `packages/database/auth/password.ts`; salted, stored as `salt:hash` in the `users.password` column; migration `0049_add_user_password`). It verifies existing accounts and sets the password on first password login for accounts originally created via email-code/OAuth. The `/login` form has a password field, and **Settings → Account** has a "Change password" card (`changePassword` server action; new password only, no current-password check). Upstream's magic-code (OTP) and OAuth/Apple providers still work.
- **Railway-compatible Dockerfile** (`apps/web/Dockerfile`): upstream's `# syntax=` BuildKit frontend directive and `--mount=type=cache` bun cache mount were removed (Railway's Metal builder rejects them), and install uses a plain `bun install`. **Do not reintroduce BuildKit-only Dockerfile features** or the Railway build breaks.

## Migration gotcha (when merging upstream)
Drizzle applies only journal migrations whose `when` is **greater than the max `created_at` already recorded** in the live DB's `__drizzle_migrations` (the "watermark"). A past password migration was once recorded with a future `when`, which pushed the watermark ahead of wall-clock time — so during upstream merges, several historical upstream migrations (authored *before* that timestamp) fell below the watermark and had to be applied to the live DB **by hand** (run their SQL, then `INSERT` a `__drizzle_migrations` row whose `hash` = `sha256(raw .sql file)` and `created_at` = the journal `when`). As of 2026-09-23 the watermark is `1790073970527` and wall-clock `Date.now()` has surpassed it, so **new migrations you generate via `bun run db:generate` (whose `when` = `Date.now()`) apply normally on boot — no special action needed.** The only time to worry: (a) you hand-set an older `when`, or (b) you merge upstream migrations timestamped below the current watermark — then apply those manually as described. Check the watermark with `SELECT MAX(created_at) FROM __drizzle_migrations`.

---

# Repository Guidelines

## Pre-Generation Invariants (read BEFORE writing any code)

These rules are enforced by CI (`cargo clippy -D warnings`, Biome). Fixing them afterwards is wasted effort — emit code in the correct shape the FIRST time. Every CI failure caused by one of these rules means the agent didn't read this section.

### Zero-tolerance rules
- **Default to no code comments. Add a comment only after solving a bug or working through a complex issue, and only when it captures non-obvious context that a future investigator or reviewer genuinely needs** — e.g. why the fix looks the way it does, the upstream/platform bug being worked around, a non-obvious invariant or trade-off chosen after investigation, or a link to the PR/issue that explains the decision. Bad cases that remain banned: narrating what the code does, restating types, JSDoc that paraphrases parameter names, "TODO: refactor" or "this should be cleaner" notes, and any comment that just describes the change you are currently making. When in doubt, prefer better naming/types over a comment. Applies to every language: Rust, TS, JS, Python, shell, SQL, TOML, etc.
- **Never hand-edit generated files**: `**/tauri.ts`, `apps/desktop/src-tauri/gen/**`, `packages/ui-solid/src/auto-imports.d.ts`, Drizzle migration SQL under `packages/database/migrations/`. These are regenerated (e.g. `tauri.ts` only on debug desktop runs) but stay committed because CI typecheck and fresh clones depend on them; commit binding changes alongside the Rust change that produced them. For database schema changes, run `bun run db:generate` and commit the generated SQL, snapshot, and journal changes alongside the schema change. Generating and committing these artifacts is required; modifying generated output by hand is prohibited. Note: `apps/desktop/src/utils/queries.ts` is hand-written, not generated — edit it normally.
- **Never start additional dev servers** (`bun run dev`, `bun run dev:web`, `bun run dev:desktop`, Docker services). Assume they are already running.

### Post-edit checks (run before you say "done")
- Prefer scoped, fast checks over full workspace gates. Do not run long full-repo checks by default.
- Touched any Rust file → `cargo fmt --all` and `cargo check -p <crate>`. Add `--all-targets`, `--workspace`, or clippy only when explicitly requested, when preparing CI/PR final validation, or when the change needs broader coverage.
- Touched any TS / JS / JSON / CSS / MD file → run the narrowest applicable formatter/linter on touched files first, such as `bun run biome check --write <files>`. Use full `bun run format`, `bun run lint`, and `bun run typecheck` only when explicitly requested or when the change spans shared types/packages.
- Touched DB schema → `bun run db:generate` before relying on it.

### Rust — write the clippy-clean form the FIRST time
All patterns below are `deny` in the workspace `[workspace.lints]` in `Cargo.toml`. Do not emit the left column; always emit the right column.

| ❌ Don't write | ✅ Write instead | Lint |
|---|---|---|
| `dbg!(x)` | `tracing::debug!(?x)` (or delete it) | `dbg_macro` |
| `let _ = async_fn();` | `async_fn().await;` or `tokio::spawn(async_fn());` | `let_underscore_future` |
| `a - b` for `Duration`/`Instant` | `a.saturating_sub(b)` | `unchecked_time_subtraction` |
| `if a { if b { … } }` | `if a && b { … }` | `collapsible_if` |
| `x.clone()` when `x: Copy` | `x` | `clone_on_copy` |
| `iter.map(\|x\| foo(x))` | `iter.map(foo)` | `redundant_closure` |
| `fn f(v: &Vec<T>)` / `fn f(s: &String)` | `fn f(v: &[T])` / `fn f(s: &str)` | `ptr_arg` |
| `v.len() == 0` / `v.len() > 0` | `v.is_empty()` / `!v.is_empty()` | `len_zero` |
| `let _ = unit_returning();` | `unit_returning();` | `let_unit_value` |
| `opt.unwrap_or_else(\|\| 42)` (cheap default) | `opt.unwrap_or(42)` | `unnecessary_lazy_evaluations` |
| `for i in 0..v.len() { v[i] … }` | `for item in &v { … }` or `.iter().enumerate()` | `needless_range_loop` |
| `value.min(max).max(min)` | `value.clamp(min, max)` | `manual_clamp` |

Additionally, `unused_must_use = "deny"` applies to all Rust code: every `Result`, `Option`, and `#[must_use]` value must be explicitly handled (`?`, `.unwrap()`, `.ok()`, `let _ = …;` **is not allowed** for unit-returning calls — see `let_unit_value`; it is the correct escape hatch for `Result`-returning calls you consciously discard, e.g. `let _ = tx.send(msg);`).

### TypeScript / JavaScript — write the Biome-clean form the FIRST time
`biome.json` at repo root enforces (do not override locally):
- **Indent: tab.** Not two spaces, not four spaces. New files and edits must use tabs.
- **Quotes: double.** `"foo"`, never `'foo'`, for JS/TS string literals.
- **`organizeImports: on`** — imports are sorted/grouped automatically; don't leave unused imports or hand-sort against the grain.
- **Recommended lint ruleset is on**, with `suspicious.noShadowRestrictedNames` disabled. Everything else (unused vars, `noExplicitAny`, dead code, etc.) applies.
- Desktop code under `apps/desktop/**` has a11y rules disabled; they are enforced everywhere else (`apps/web`, `packages/ui`, etc.).
- CSS overrides: `noUnknownAtRules`, `noUnknownTypeSelector`, `noDescendingSpecificity` are off for `**/*.css`.

### TypeScript — strictness
- Avoid `any`. Use `unknown` + narrowing, or existing shared types from `@cap/utils`, `@cap/web-domain`, generated bindings, etc.
- Do not introduce `@ts-expect-error` / `@ts-ignore` without a concrete reason. Prefer fixing the type.

## Project Structure & Modules
- Turborepo monorepo:
  - `apps/desktop` (Tauri v2 + SolidStart), `apps/web` (Next.js), `apps/cli` (Rust CLI).
  - `packages/*` shared libs (e.g., `database`, `ui`, `ui-solid`, `utils`, `web-*`).
  - `crates/*` Rust media/recording/rendering/camera crates.
  - `scripts/*`, `infra/`, and `packages/local-docker/` for tooling and local services.

## Build, Test, Develop
- Install: `bun install`; setup: `bun run env-setup` then `bun run cap-setup`.
- Dev: `bun run dev` (web+desktop). Desktop only: `bun run dev:desktop`. Web only: `bun run dev:web` or `cd apps/web && bun run dev`.
- Build: `bun run build` (Turbo). Desktop release: `bun run tauri:build`.
- DB: `bun run db:generate` → `bun run db:push` → `bun run db:studio`.
- Docker: `bun run docker:up | docker:stop | docker:clean`.
- Quality: `bun run lint`, `bun run format`, `bun run typecheck`. Rust: `cargo build -p <crate>`, `cargo test -p <crate>`.

## Coding Style & Naming
- TypeScript / JS / JSON / CSS: **tab indent** and **double-quoted** strings, enforced by Biome (see `biome.json`). Do not configure per-file overrides.
- Rust: `rustfmt` default style + the denied clippy lints in the Pre-Generation Invariants above.
- Naming: files kebab‑case (`user-menu.tsx`); React/Solid components PascalCase; hooks `useX`; Rust modules snake_case; crates kebab‑case.
- Runtime: Node 20, Bun 1.4.0, Rust 1.88+, Docker for MySQL/MinIO.

(See **Pre-Generation Invariants** at the top of this file for the comments policy and the denied clippy/Biome patterns. Those are the source of truth — do not duplicate or weaken them here.)

## Testing
- TS/JS: Vitest where present (e.g., desktop). Name tests `*.test.ts(x)` near sources.
- Rust: `cargo test` per crate; tests in `src` or `tests`.
- Prefer unit tests for logic and light smoke tests for flows; no strict coverage yet.

## Commits & PRs
- Conventional style: `feat:`, `fix:`, `chore:`, `improve:`, `refactor:`, `docs:` (e.g., `fix: hide watermark for pro users`).
- Never add `Co-authored-by` or other attribution trailers (Cursor, Cursor Agent, or anyone else). Commit as the user only.
- PRs: clear description, linked issues, screenshots/GIFs for UI, env/migration notes. Keep scope tight and update docs when behavior changes.

## Agent‑Specific Practices
- Do not start extra servers; use `bun run dev:web` or `bun run dev:desktop` as needed.
- Prefer existing scripts and Turbo filters over ad‑hoc commands; clear `.turbo` only when necessary.
- Database flow: always `db:generate` → `db:push` before relying on new schema.
- Keep secrets out of VCS; configure via `.env` from `bun run env-setup`.
- macOS note: desktop permissions (screen/mic) apply to the terminal running `bun run dev:desktop`.
- All other agent-facing rules (comments policy, no editing generated files, clippy/Biome shape, post-edit gates) live in **Pre-Generation Invariants** at the top of this file.

## Deep Investigation Default
When asked to inspect, review, optimize, secure, or fix something, do not stop at the obvious local change. First trace the full path and run a second-pass blast-radius review:

- identify the real root cause, not only the symptom
- trace callers, side effects, async/runtime behavior, generated artifacts, caches, exports, old data, and platform-specific paths
- compare old vs new behavior when reviewing a diff
- call out what is verified vs merely plausible
- consider likely follow-up reviewer or user reports before calling it done
- verify the actual user-visible outcome where practical, not only compile/lint success

Prefer the smallest correct fix, but only after checking whether the narrow fix misses related consequences.

## Effect Usage
- Next.js API routes in `apps/web/app/api/*` are built with `@effect/platform`'s `HttpApi` builder; copy the existing class/group/endpoint pattern instead of ad-hoc handlers.
- Acquire backend services (e.g., `Videos`, `S3Buckets`) inside `Effect.gen` blocks and wire them through `Layer.provide`/`HttpApiBuilder.group`, translating domain errors to `HttpApiError` variants.
- Convert the effectful API to a Next.js handler with `apiToHandler(ApiLive)` from `@/lib/server` and export the returned `handler`—avoid calling `runPromise` inside route files.
- On the server, run effects through `EffectRuntime.runPromise` from `@/lib/server`, typically after `provideOptionalAuth`, so cookies and per-request context are attached automatically.
- On the client, use `useEffectQuery`/`useEffectMutation` from `@/lib/EffectRuntime`; they already bind the managed runtime and tracing so you shouldn't call `EffectRuntime.run*` directly in components.

## Code Formatting & Lint Checks
Before declaring any task complete, the agent should run the fastest useful check for every file type it touched and report anything skipped.

- **Rust**: `cargo fmt --all` and `cargo check -p <crate>` for the touched crate. Add `--all-targets`, `--workspace`, or `cargo clippy -p <crate> --all-targets -- -D warnings` only for explicit requests, CI/PR final validation, or changes that need broader coverage.
- **TS / JS / JSON / CSS / MD**: prefer scoped checks such as `bun run biome check --write <files>`. Use full `bun run format`, `bun run lint`, and `bun run typecheck` only when explicitly requested or when the change is broad enough to justify it.
- If a scoped check fails, fix the violation in the source (do NOT suppress with `#[allow(...)]`, `// biome-ignore`, or `any` unless explicitly approved). The Pre-Generation Invariants show the correct form for every denied lint.
