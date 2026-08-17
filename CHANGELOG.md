# Changelog

All notable changes to this project are documented in this file, following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), with versions following [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `plugin_install` tool: guided install — audit a spec first (local path runs the full doctor, `npm:` specs query registry metadata read-only), report the verdict, and only run `dsh plugin add` when `approve=true` (default false). Blocks on audit blockers. Fills the "one-click guided install behind a catalog entry" capability.
- Official baseline detection in `plugin_profile_scan`: flags community plugins that register tool names colliding with official DSH core tools (e.g. `bash`, `read`, `web_search`), pinned to DSH `0.1.0-rc.6` (`src/baseline.ts`).
- `examples/` sample outputs for `plugin_doctor` and `plugin_profile_scan`.

## [0.1.0] - 2026-08-18

### Added

- `plugin_doctor` tool: read-only single-plugin health check (manifest, cordis patch, entry point, install scripts, dependency version ranges, static source scan) with three-tier confidence — `confirmed` / `inferred` / `unknown`
- `plugin_profile_scan` tool: installed-set scan for cross-plugin tool-name collisions, duplicate entries, and dependency version skew
- `plugin_promote` tool: doctor-gated promotion of a source plugin into a durable, versioned location with a provenance marker (sha256 / promotedAt / source), atomic via `mkdtemp` + `rename`, never overwrites, and never touches the live profile unless `register=true`
- `dsh.bundle.patch` declaration (`cordis.patch.yml`) for correct DSH activation
- GitHub Actions CI: Node 20/22/24 matrix (typecheck + test + build)
- Bilingual README (English + 中文)

### Security

- `plugin_doctor` and `plugin_profile_scan` are strictly read-only: no install, no source execution, no subprocess, no network, no file writes
- `plugin_promote` defaults to `register=false` and writes only to a managed staging directory

[0.1.0]: https://github.com/Nico0713520/dsh-plugin-guardian/releases/tag/v0.1.0
