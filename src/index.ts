import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatReport, formatReportJson, inspectPlugin } from './doctor.ts'
import { formatProfileReport, scanProfile } from './profile.ts'
import { formatPromoteResult, promotePlugin } from './promote.ts'
import { formatInstallResult, installPlugin } from './install.ts'

export const name = 'plugin-guardian'
export const inject = ['tools']

export interface GuardianConfig {
  /**
   * Default DSH profile directory for `plugin_profile_scan`.
   * Defaults to `${DSH_HOME}/profiles/web` when DSH_HOME is set.
   */
  profileDir?: string
}

export function apply(ctx: Context, config: GuardianConfig = {}): void {
  ctx.tools.register(defineTool({
    name: 'plugin_doctor',
    description: [
      'Read-only health check for a DeepSeek Harness plugin directory. Inspects package.json manifest,',
      'the cordis patch file, declared entry point, install scripts, dependency version ranges, and does a',
      'bounded static scan of source for subprocess/network/file-mutation patterns. Every finding is tagged',
      'with a confidence tier: confirmed (provable), inferred (static pattern), or unknown (blocked by a boundary).',
      'Never installs packages, executes source, spawns subprocesses, or writes files.',
      'Pass a local directory path (e.g. "/path/to/my-plugin") or "npm:name" / "github:owner/repo".',
      'Set format=json for deterministic machine-readable output.',
    ].join(' '),
    parameters: {
      target: {
        type: 'string',
        required: true,
        description: 'Plugin directory path, or a remote spec like "npm:foo" / "github:owner/repo".',
      },
      format: {
        type: 'string',
        description: 'Output format: "text" (default) or "json".',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(params: { target: string; format?: string }) {
      const report = await inspectPlugin(params.target)
      return params.format === 'json' ? formatReportJson(report) : formatReport(report)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_profile_scan',
    description: [
      'Scan the installed plugin set of a DeepSeek Harness profile and surface cross-plugin conflicts,',
      'especially duplicate tool-name registrations that can crash the harness at startup. Also detects',
      'community plugins that override official DSH core tools, duplicate plugin entries, and dependency',
      'version skew. Read-only: only reads package.json and source.',
      'By default scans $DSH_HOME/profiles/web; override with the "profileDir" argument or plugin config.',
    ].join(' '),
    parameters: {
      profileDir: {
        type: 'string',
        description: 'Profile directory to scan. Defaults to $DSH_HOME/profiles/web.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(params: { profileDir?: string }) {
      const dir = params.profileDir
        ?? config.profileDir
        ?? (process.env.DSH_HOME ? `${process.env.DSH_HOME}/profiles/web` : undefined)
      if (!dir) {
        return 'No profile directory found. Pass "profileDir", set plugin config, or set DSH_HOME.'
      }
      const report = await scanProfile(dir)
      return formatProfileReport(report)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_promote',
    description: [
      'Promote (转正) a plugin from a source directory into a durable, validated, versioned location.',
      'Runs the doctor as a gate first: if blockers are found, the promotion is blocked and the blockers are',
      'reported. On success it copies the source into a managed staging directory, writes a provenance marker',
      '(owner/schema/sha256/promotedAt/source), and returns the exact `dsh plugin add` command to register it.',
      'Safe by default: it never modifies the live profile unless register=true is passed.',
      'Pass a local directory path as "source". Use "register=true" to also run `dsh plugin add` automatically.',
    ].join(' '),
    parameters: {
      source: {
        type: 'string',
        required: true,
        description: 'Local plugin directory to promote.',
      },
      register: {
        type: 'boolean',
        description: 'Also run `dsh plugin add` to register the staged plugin. Defaults to false.',
      },
      profile: {
        type: 'string',
        description: 'DSH profile name. Defaults to "web".',
      },
      outputDir: {
        type: 'string',
        description: 'Root dir for promoted plugins. Defaults to $DSH_HOME/.guardian-plugins.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(params: { source: string; register?: boolean; profile?: string; outputDir?: string }) {
      const result = await promotePlugin({
        source: params.source,
        register: params.register,
        profile: params.profile,
        outputDir: params.outputDir,
      })
      return formatPromoteResult(result)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'plugin_install',
    description: [
      'Guided install: audit first, then execute. Takes a plugin spec (a local directory path, "npm:name",',
      'or "github:owner/repo"), audits it (local path runs the full doctor; npm specs query registry metadata',
      'read-only), and reports the verdict. It only runs `dsh plugin add` when approve=true is passed.',
      'Default (approve=false) is audit-only and writes nothing — return the report and the exact install',
      'command so the user can confirm before installing. If the audit finds blockers, approve=true is refused.',
      'Use this as the "one-click guided install" capability behind a catalog entry.',
    ].join(' '),
    parameters: {
      spec: {
        type: 'string',
        required: true,
        description: 'Plugin spec: a local directory path, "npm:name", or "github:owner/repo".',
      },
      approve: {
        type: 'boolean',
        description: 'Approve the install and run `dsh plugin add`. Defaults to false (audit only).',
      },
      profile: {
        type: 'string',
        description: 'DSH profile name. Defaults to "web".',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(params: { spec: string; approve?: boolean; profile?: string }) {
      const result = await installPlugin({
        spec: params.spec,
        approve: params.approve,
        profile: params.profile,
      })
      return formatInstallResult(result)
    },
  }))
}
