import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { formatReport, formatReportJson, inspectPlugin } from './doctor.ts'
import { formatProfileReport, scanProfile } from './profile.ts'

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
      'especially duplicate tool-name registrations that can crash the harness at startup. Also flags',
      'duplicate plugin entries and dependency version skew. Read-only: only reads package.json and source.',
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
}
