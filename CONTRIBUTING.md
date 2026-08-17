# Contributing

Thanks for your interest in `dsh-plugin-guardian`! This is a small, focused plugin — issues, PRs, and doc improvements are all welcome.

## Before you start

- DeepSeek Harness is in **developer preview** and will have breaking changes. Note which `@deepseek-ai/dsh` version you are targeting (currently locked to `0.1.0-rc.x`).
- The core selling point is the **safety boundary**. Any change must not weaken it:
  - `plugin_doctor` / `plugin_profile_scan` stay strictly read-only.
  - `plugin_promote` never touches the live profile unless `register=true`.

## Development environment

```bash
git clone https://github.com/Nico0713520/dsh-plugin-guardian.git
cd dsh-plugin-guardian
npm install --legacy-peer-deps   # peer resolution is broken without --legacy-peer-deps
```

Common commands:

```bash
npm run typecheck    # TypeScript check
npm run test         # vitest unit tests
npm run build        # tsdown → dist/
```

## Directory structure

```
src/
├── index.ts              # plugin entry: registers plugin_doctor / plugin_profile_scan / plugin_promote
├── doctor.ts             # single-plugin inspection + report formatting (three-tier confidence)
├── profile.ts            # installed-set scan + conflict detection
├── promote.ts            # promote pipeline (doctor gate → hash → stage → marker → rename)
├── *.test.ts             # unit tests per module
└── __stubs__/dsh-tools.ts  # test stub (isolates the dsh-tools peer tree)
```

## How to add a new doctor check

1. Add the check to `src/doctor.ts` (manifest checks in `inspectManifest`, source patterns in `SOURCE_SAFETY_PATTERNS`).
2. Give every `Finding` a correct `confidence` tier: `confirmed` (provable) / `inferred` (static pattern) / `unknown` (blocked by a boundary).
3. Add a corresponding assertion in `src/doctor.test.ts`.

## Commit conventions

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:` / `fix:` / `docs:` / `chore:` / `test:`.
- One PR, one thing.

## Test requirements

- Changes should include or update tests.
- Anything touching the safety boundary (read-only guarantees, promote atomicity, conflict detection) must have targeted tests.
- Run `npm run typecheck` and `npm run test` green before submitting.

## Code of conduct

Be kind, concise, and focused. This is a community project, not an official DeepSeek product.

## License

Contributions are under the same [MIT](./LICENSE) license.
