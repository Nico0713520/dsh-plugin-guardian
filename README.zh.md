<div align="center">

# dsh-plugin-guardian

**DeepSeek Harness 插件的一生：先体检，再转正。**

[![CI](https://github.com/Nico0713520/dsh-plugin-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/Nico0713520/dsh-plugin-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-purple)](https://github.com/topics/dsh-plugin)

[English](./README.md) · [中文](./README.zh.md)

</div>

> 5905 个插件还在涨。有些会互相打架——装个皮肤，另一个插件就悄悄坏了；两个插件注册同名工具，整个 Harness 启动就崩；你的 Agent 在创造模式里写了个插件，一重启就没了。
>
> **这个插件，让这些问题在你被咬之前先现形、先解决。**

## 为什么需要它

DeepSeek Harness 信奉「一切皆插件」，一周内生态就膨胀到几千个插件——但没有人看场子：

| 痛点 | 实际后果 | guardian 怎么救 |
|---|---|---|
| 「装了个皮肤，X 就坏了」 | 插件悄悄互相冲突 | `plugin_profile_scan` 扫出工具名冲突 |
| 两个插件注册同名工具 | 启动直接崩溃（见 [Pi #7696](https://github.com/earendil-works/pi/issues/7696)） | 装前就拦下冲突 |
| 「这个野 npm 插件安全吗？」 | 没有任何信任体系 | `plugin_doctor` 三档置信度体检 |
| 「Agent 刚写的插件没了」 | 创造模式插件只存内存 | `plugin_promote` 一键转正落盘 |

## 三个工具，一条生命周期

```
陌生/临时插件  →  plugin_doctor 体检  →  通过门禁  →  plugin_promote 转正  →  可信磁盘插件
                        │
                 plugin_profile_scan 扫已装集冲突
```

| 工具 | 作用 | 类比 |
|---|---|---|
| `plugin_doctor` | 单插件体检 | 门诊 |
| `plugin_profile_scan` | 已装集冲突扫描 | 体检中心 |
| `plugin_promote` | 临时插件转正 | 落户 |

## 它凭什么可信：三档置信度

每条结论都带置信度标签——借鉴 Pi 的 [`pi-extension-doctor`](https://www.npmjs.com/package/pi-extension-doctor)：

| 档位 | 含义 |
|---|---|
| `confirmed` | 从读到的文件可证实（如字段缺失） |
| `inferred` | 看到了静态模式，但不等于运行时真有 bug |
| `unknown` | 边界（远程 spec、文件读不了）挡住了结论 |

不装懂。静态扫描的结果就叫 `inferred`，绝不吹成「肯定是 bug」。

## 30 秒上手

```bash
dsh plugin --profile web add github:Nico0713520/dsh-plugin-guardian
# 重启 dsh web，然后在会话里直接问：
```

```text
plugin_doctor target="/path/to/my-plugin"
plugin_profile_scan
plugin_promote source="/path/to/my-plugin"
```

## 演示

`plugin_doctor` 体检一个真实 DSH 插件：

```
DSH plugin doctor
target : /path/to/dsh-gh-cli
verdict: WARN  (0 blocker · 1 warn · 3 info)

[info] confirmed — cordis patch file present
[warn] confirmed — Pre-release peer dependencies (9)   → 建议锁版本
[info] inferred  — Spawns subprocesses
[info] inferred  — Detected 2 possible tool name(s): gh_cli_run, gh_auth_status
```

`plugin_promote`：

```
DSH plugin promote
status : PROMOTED
name   : dsh-gh-cli@0.1.0
sha256 : 6cf15989…
install: dsh plugin --profile web add link:…/.guardian-plugins/dsh-gh-cli-6cf15989
```

## 安全边界

- `plugin_doctor`、`plugin_profile_scan` **只读**：不装包、不执行源码、不跑子进程、不联网、不写文件。
- `plugin_promote` 只写到一个受管理的 staging 目录（`$DSH_HOME/.guardian-plugins`），并写下溯源标记（sha256 / promotedAt / source）。**除非你显式传 `register=true`，否则绝不碰你的 live profile。**

## 工具

| 工具 | 参数 | 说明 |
|---|---|---|
| `plugin_doctor` | `target`（路径或 `npm:`/`github:` spec）、`format`（`text`/`json`） | 三档置信度报告 |
| `plugin_profile_scan` | `profileDir`（默认 `$DSH_HOME/profiles/web`） | 查工具名冲突、重复项、版本偏斜 |
| `plugin_promote` | `source`、`register`（默认 false）、`profile`、`outputDir` | doctor 门禁、原子落盘、溯源标记 |

## FAQ

**跟 `dsh-plugin-check` 有啥区别？** —— 有重叠但不同。`plugin-check` 对单个插件做 33 项只读检查；`guardian` 多了三样它没有的：**置信度分级**、**跨插件冲突扫描**、**转正（promote）**——最后这个在整个生态里是空白。

**`plugin_promote` 会偷偷改我的 profile 吗？** —— 不会。默认 `register=false`，只 staging 并打印出准确的 `dsh plugin add` 命令，注册要你显式开启。

**那个 Pi 引用是啥？** —— Pi 的 `pi-extension-doctor` 首创了 `confirmed`/`inferred`/`unknown` 置信度模型和严格只读边界。guardian 把同一套纪律用到了更大、更乱的 DSH 生态上。

## 开发

```bash
git clone https://github.com/Nico0713520/dsh-plugin-guardian.git
cd dsh-plugin-guardian
npm install --legacy-peer-deps
npm run typecheck
npm run test
npm run build
```

## 要求

- Node.js ≥ 20
- DeepSeek Harness（`@deepseek-ai/dsh`，已在 `0.1.0-rc.x` 验证）

## 相关链接

- [贡献指南](./CONTRIBUTING.md)
- [更新日志](./CHANGELOG.md)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — 官方仓库
- [dsh-plugin topic](https://github.com/topics/dsh-plugin) — 发现更多插件
- [pi-extension-doctor](https://www.npmjs.com/package/pi-extension-doctor) — 我们借鉴的置信度模型

## License

MIT — 见 [LICENSE](./LICENSE)。
