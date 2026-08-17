# dsh-plugin-guardian

Plugin lifecycle guardian for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

Two read-only diagnostics plus one safe promote step, covering the plugin lifecycle — **trust before you install**, **detect conflicts across what's installed**, and **turn an ephemeral plugin into a durable asset**:

- **`plugin_doctor`** — health check for a single plugin directory. Inspects the manifest, the cordis patch file, entry point, install scripts, dependency version ranges, and does a bounded static scan for subprocess / network / file-mutation patterns. Every finding carries a three-tier confidence: `confirmed` / `inferred` / `unknown`.
- **`plugin_profile_scan`** — scans the installed plugin set of a profile and surfaces cross-plugin conflicts, especially duplicate tool-name registrations that can crash the harness at startup (the Pi Issue #7696 class of failure).
- **`plugin_promote`** — "转正": runs the doctor as a gate, then stages a source plugin into a durable, validated, versioned location with a provenance marker (sha256 / promotedAt / source) and returns the exact `dsh plugin add` command. Safe by default — it never touches the live profile unless `register=true` is passed.

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
plugin_promote source="/path/to/my-plugin"
plugin_promote source="/path/to/my-plugin" register=true
```

`plugin_profile_scan` defaults to `$DSH_HOME/profiles/web`. `plugin_promote` stages into
`$DSH_HOME/.guardian-plugins` and only registers into the live profile when `register=true`.

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
