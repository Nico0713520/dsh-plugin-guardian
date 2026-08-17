<div align="center">

# dsh-plugin-guardian

**Your DeepSeek Harness plugin's whole life — diagnose before you install, promote after you build.**

[![CI](https://github.com/Nico0713520/dsh-plugin-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-plugin-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-purple)](https://github.com/topics/dsh-plugin)

[English](./README.md) · [中文](./README.zh.md)

</div>

> 5,905 plugins and counting. Some of them fight each other. Install a skin and another plugin silently breaks. Two plugins register the same tool name and the harness crashes at startup. Your agent writes a plugin in Creator mode and it vanishes on restart.
>
> **This plugin makes all of that visible — and fixable — before it bites you.**

## Why you need it

DeepSeek Harness is *"everything is a plugin"*, and the ecosystem exploded to thousands of plugins within a week. But nobody is keeping watch:

| Pain | What actually happens | What guardian does |
|---|---|---|
| "I installed a skin and now X is broken" | Plugins silently collide | `plugin_profile_scan` finds tool-name collisions |
| Two plugins register the same tool | Harness crashes at startup (see [Pi #7696](https://github.com/earendil-works/pi/issues/7696)) | Conflict detected before you ship |
| "Is this random npm plugin safe?" | No trust system exists | `plugin_doctor` checks it, with honest confidence tiers |
| "The plugin my agent just wrote is gone" | Creator-mode plugins live only in memory | `plugin_promote` promotes it to durable disk |

## Four tools, one lifecycle

```
陌生/临时插件  →  plugin_doctor 体检  →  通过门禁  →  plugin_promote 转正  →  可信磁盘插件
                        │
                 plugin_profile_scan 扫已装集冲突
                        │
                 plugin_install 引导安装（先审计→再执行）
```

| Tool | What it does | Analogy |
|---|---|---|
| `plugin_doctor` | Health-check a single plugin directory | 门诊 checkup |
| `plugin_profile_scan` | Scan the installed set for cross-plugin conflicts | 体检 center |
| `plugin_promote` | Turn an ephemeral plugin into a durable, versioned asset | 落户 registration |
| `plugin_install` | Guided install: audit first, then execute | 一键安装 one-click install |

## What makes it honest: three-tier confidence

Every finding is tagged with a confidence tier — borrowed from Pi's [`pi-extension-doctor`](https://www.npmjs.com/package/pi-extension-doctor):

| Tier | Meaning |
|---|---|
| `confirmed` | Provable from the files we read (e.g. a missing field) |
| `inferred` | A static pattern was seen — not proof of runtime behavior |
| `unknown` | A boundary (remote spec, unreadable file) blocked a conclusion |

No fake precision. A static scan result is labeled "inferred", never "definitely a bug".

## 30-second start

```bash
dsh plugin --profile web add github:Nico0713520/dsh-plugin-guardian
# restart dsh web, then ask in a session:
```

```text
plugin_doctor target="/path/to/my-plugin"
plugin_profile_scan
plugin_promote source="/path/to/my-plugin"
plugin_install spec="npm:some-plugin"      # audit-only by default
plugin_install spec="npm:some-plugin" approve=true
```

## Demo

`plugin_doctor` against a real DSH plugin:

```
DSH plugin doctor
target : /path/to/dsh-gh-cli
verdict: WARN  (0 blocker · 1 warn · 3 info)

[info] confirmed — cordis patch file present
[warn] confirmed — Pre-release peer dependencies (9)   → 建议锁版本
[info] inferred  — Spawns subprocesses
[info] inferred  — Detected 2 possible tool name(s): gh_cli_run, gh_auth_status
```

`plugin_promote`:

```
DSH plugin promote
status : PROMOTED
name   : dsh-gh-cli@0.1.0
sha256 : 6cf15989…
install: dsh plugin --profile web add link:…/.guardian-plugins/dsh-gh-cli-6cf15989
```

## Safety boundary

- `plugin_doctor` and `plugin_profile_scan` are **read-only**. They never install packages, execute source, spawn subprocesses, hit the network, or write a file.
- `plugin_promote` writes only to a managed staging directory (`$DSH_HOME/.guardian-plugins`) with a provenance marker (sha256 / promotedAt / source). It **never touches your live profile** unless you pass `register=true`.

## Tools

| Tool | Parameters | Notes |
|---|---|---|
| `plugin_doctor` | `target` (path or `npm:`/`github:` spec), `format` (`text`/`json`) | Three-tier confidence report |
| `plugin_profile_scan` | `profileDir` (defaults to `$DSH_HOME/profiles/web`) | Finds tool-name collisions, dupes, version skew |
| `plugin_promote` | `source`, `register` (default false), `profile`, `outputDir` | Doctor-gated, atomic, provenance-marked |
| `plugin_install` | `spec`, `approve` (default false), `profile` | Audit-first guided install; `approve=true` runs `dsh plugin add` |

## FAQ

**Is this the same as `dsh-plugin-check`?** — Overlapping but different. `plugin-check` does 33 read-only checks on a single plugin. `guardian` adds three things it doesn't: **confidence tiers**, **cross-plugin conflict scanning**, and **promote (转正)** — the last of which is entirely absent from the ecosystem.

**Will `plugin_promote` modify my profile by surprise?** — No. It defaults to `register=false`; it only stages the plugin and prints the exact `dsh plugin add` command. You opt in to registration explicitly.

**What's the Pi reference?** — Pi's `pi-extension-doctor` established the `confirmed`/`inferred`/`unknown` confidence model and a strict read-only boundary. `guardian` applies the same discipline to DSH's much larger, messier ecosystem.

## Development

```bash
git clone https://github.com/Nico0713520/dsh-plugin-guardian.git
cd dsh-plugin-guardian
npm install --legacy-peer-deps
npm run typecheck
npm run test
npm run build
```

## Requirements

- Node.js ≥ 20
- DeepSeek Harness (`@deepseek-ai/dsh`, verified on `0.1.0-rc.x`)

## Related

- [Contributing](./CONTRIBUTING.md)
- [Changelog](./CHANGELOG.md)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the official repo
- [dsh-plugin topic](https://github.com/topics/dsh-plugin) — discover more plugins
- [pi-extension-doctor](https://www.npmjs.com/package/pi-extension-doctor) — the confidence model we borrow

## License

MIT — see [LICENSE](./LICENSE).
