# dsh-plugin-guardian

Plugin lifecycle guardian for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

Two read-only diagnostics that cover the two ends of the plugin lifecycle — **trust before you install** and **detect conflicts across what's installed**:

- **`plugin_doctor`** — health check for a single plugin directory. Inspects the manifest, the cordis patch file, entry point, install scripts, dependency version ranges, and does a bounded static scan for subprocess / network / file-mutation patterns. Every finding carries a three-tier confidence: `confirmed` / `inferred` / `unknown`.
- **`plugin_profile_scan`** — scans the installed plugin set of a profile and surfaces cross-plugin conflicts, especially duplicate tool-name registrations that can crash the harness at startup (the Pi Issue #7696 class of failure).

## Install

```bash
dsh plugin --profile web add github:Nico0713520/dsh-plugin-guardian
```

## Usage

In a DSH session:

```text
plugin_doctor target="/path/to/my-plugin"
plugin_doctor target="npm:some-plugin" format="json"
plugin_profile_scan
plugin_profile_scan profileDir="/home/me/.dsh/profiles/web"
```

`plugin_profile_scan` defaults to `$DSH_HOME/profiles/web`.

## Safety boundary

Both tools are read-only. They never install packages, execute inspected source,
spawn subprocesses, hit the network, or write any file. Static findings are honest
about their limits: `inferred` means "a pattern was seen, not proof of runtime
behavior", and `unknown` means a boundary (e.g. a remote spec) blocked a conclusion.

## Development

```bash
npm install --legacy-peer-deps
npm run typecheck
npm run test
npm run build
```

Node 20+ required. `@deepseek-ai/dsh-tools` declares a large peer tree that only
exists at runtime inside a real DSH host; tests isolate it behind a stub
(`src/__stubs__/dsh-tools.ts`), while the real package is still used for types and
the production build.

## License

MIT
