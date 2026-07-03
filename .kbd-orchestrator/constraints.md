# KBD Constraints — open-design

Project-specific blocking (🛑) and warning (⚠️) rules derived from the root
`AGENTS.md`. The root `AGENTS.md` is the source of truth; when it disagrees with
this file, follow `AGENTS.md` and update this file.

## 🛑 Blocking (never do)

- **No root aggregate build/test aliases.** Do not add root `pnpm build` or
  `pnpm test`. Build/test commands must stay package-scoped
  (`pnpm --filter <package> ...`) or tool-scoped (`pnpm tools-pack ...`).
- **No root lifecycle aliases.** Do not add or restore `pnpm dev`, `pnpm dev:all`,
  `pnpm daemon`, `pnpm preview`, or `pnpm start`. `pnpm tools-dev` is the only
  local development lifecycle entry point.
- **Do not restore removed dirs.** `apps/nextjs` and `packages/shared` are gone;
  do not recreate or reference them. The web runtime is `apps/web`.
- **Daemon data paths derive from `RUNTIME_DATA_DIR`.** Do not introduce concrete
  filesystem examples for the daemon data directory, or infer packaged data paths
  from app names, Electron `userData`, ports, channel names, or namespace names.
  Follow the "Daemon data directory contract" in `AGENTS.md`.
- **`packages/contracts` stays pure TypeScript.** No Next.js, Express, Node
  fs/process APIs, browser APIs, SQLite, daemon internals, or sidecar
  control-plane deps.
- **No cross-app private imports.** `apps/web/**` must not import
  `apps/daemon/src/**`; integrate via HTTP APIs + `packages/contracts`.
- **`src/` is source-only.** No new `*.test.ts`/`*.test.tsx` under `src/`; tests
  live in a sibling `tests/` dir. Playwright UI automation belongs in `e2e/ui/`.
- **No new `.js`/`.mjs`/`.cjs`** without an explicit generated/vendor/compat
  reason that passes `pnpm guard`.
- **Git commits must not include `Co-authored-by` trailers** or any co-author
  metadata.
- **Channel-distinct packaged app identity.** stable = `Open Design`,
  beta = `Open Design Beta`, prerelease = `Open Design Prerelease`,
  preview = `Open Design Preview`. Never ship non-stable mac DMGs whose bundle is
  `Open Design.app`.
- **Do not use Node 22.** `engines.node` is `~24`.

## ⚠️ Warning (verify before proceeding)

- Run `pnpm install` after changing package manifests, workspace layout, or
  command entrypoints.
- Every user-facing capability must be reachable through BOTH the web UI and the
  `od` CLI (`apps/daemon/src/cli.ts`). Land the HTTP endpoint + contract type, the
  UI surface, and the `od <capability>` subcommand in the same PR.
- Keep shared API DTOs / SSE event unions / error shapes in `packages/contracts`;
  update contracts before wiring divergent web/daemon shapes.
- Treat every `pnpm-lock.yaml` change as requiring a Nix pnpm deps hash refresh
  check.
- New i18n keys must be added to `types.ts` first and defined in all 18 locale
  files under `apps/web/src/i18n/locales/*.ts`.
- New `apps/web` UI should reuse `@open-design/components` primitives; new
  component styles default to CSS Modules, not global stylesheets.
- Desktop is **Electron** (`apps/desktop` + `apps/packaged`), not Tauri.

## Validation gates

- Repo-level, before marking work ready: `pnpm guard` and `pnpm typecheck`, plus
  the package-scoped tests/builds matching the files changed.
- Fork/upstream: `origin` = `GQAdonis/open-design`, `upstream` =
  `nexu-io/open-design`.
