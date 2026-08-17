import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { extractToolNames, listSourceFiles, type Finding } from './doctor.ts'
import { isOfficialPackage, normalizeToolName, OFFICIAL_TOOL_NAMES } from './baseline.ts'

/**
 * Scan a DeepSeek Harness profile's installed plugin set and surface
 * cross-plugin conflicts — the classic "two plugins register the same tool
 * name and the harness crashes on startup" failure (see Pi Issue #7696).
 *
 * Read-only: only reads package.json files and source text under the profile.
 */

export interface ProfilePlugin {
  name: string
  spec: string
  dir?: string
  version?: string
  toolNames: string[]
}

export interface ProfileReport {
  profileDir: string
  plugins: ProfilePlugin[]
  findings: Finding[]
}

interface ProfilePackageJson {
  dependencies?: Record<string, string>
}

const MAX_PLUGINS = 200

async function readPluginInfo(profileDir: string, name: string, spec: string): Promise<ProfilePlugin> {
  const plugin: ProfilePlugin = { name, spec, toolNames: [] }
  const dir = path.join(profileDir, 'node_modules', ...name.split('/'))

  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    plugin.version = typeof parsed.version === 'string' ? parsed.version : undefined
    plugin.dir = dir
  } catch {
    // Installed but its package.json is unreadable; keep name/spec only.
  }

  if (plugin.dir) {
    try {
      const files = await listSourceFiles(plugin.dir)
      const texts: string[] = []
      for (const file of files.slice(0, 500)) {
        try {
          texts.push(await readFile(file, 'utf8'))
        } catch {
          // skip unreadable
        }
      }
      plugin.toolNames = extractToolNames(texts)
    } catch {
      // ignore scan errors; the report stays read-only
    }
  }

  return plugin
}

export async function scanProfile(profileDir: string): Promise<ProfileReport> {
  const report: ProfileReport = { profileDir, plugins: [], findings: [] }

  let pkg: ProfilePackageJson
  try {
    const raw = await readFile(path.join(profileDir, 'package.json'), 'utf8')
    pkg = JSON.parse(raw) as ProfilePackageJson
  } catch {
    report.findings.push({
      id: 'no-profile-package',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'No readable profile package.json',
      detail: `Could not read ${path.join(profileDir, 'package.json')}. Is this a DSH profile directory?`,
      suggestion: 'Pass the profile directory (usually $DSH_HOME/profiles/web).',
    })
    return report
  }

  const deps = Object.entries(pkg.dependencies ?? {})
  if (deps.length === 0) {
    report.findings.push({
      id: 'empty-profile',
      confidence: 'confirmed',
      severity: 'info',
      title: 'Profile has no dependencies',
      detail: 'No plugins are declared in this profile.',
    })
    return report
  }

  const names = deps.slice(0, MAX_PLUGINS).map(([name]) => name)
  const plugins = await Promise.all(
    names.map((name) => readPluginInfo(profileDir, name, deps.find(([n]) => n === name)?.[1] ?? '')),
  )
  report.plugins = plugins

  report.findings.push(...detectToolCollisions(plugins))
  report.findings.push(...detectOfficialToolOverrides(plugins))
  report.findings.push(...detectDuplicatePlugins(plugins))
  report.findings.push(...detectVersionSkew(plugins))

  return report
}

export function detectToolCollisions(plugins: ProfilePlugin[]): Finding[] {
  const findings: Finding[] = []
  const owner = new Map<string, string>()

  for (const plugin of plugins) {
    for (const tool of plugin.toolNames) {
      const prev = owner.get(tool)
      if (prev !== undefined && prev !== plugin.name) {
        findings.push({
          id: `tool-collision-${tool}`,
          confidence: 'inferred',
          severity: 'blocker',
          title: `Possible tool name collision: "${tool}"`,
          detail: `Both "${prev}" and "${plugin.name}" appear to register a tool named "${tool}". Duplicate tool names can crash the harness at startup.`,
          suggestion: 'Rename one tool, or uninstall one of the two plugins.',
        })
      } else {
        owner.set(tool, plugin.name)
      }
    }
  }

  return findings
}

export function detectOfficialToolOverrides(plugins: ProfilePlugin[]): Finding[] {
  const findings: Finding[] = []
  for (const plugin of plugins) {
    if (isOfficialPackage(plugin.name)) continue
    for (const tool of plugin.toolNames) {
      if (OFFICIAL_TOOL_NAMES.has(normalizeToolName(tool))) {
        findings.push({
          id: `official-tool-override-${tool}`,
          confidence: 'inferred',
          severity: 'blocker',
          title: `Community plugin overrides an official tool: "${tool}"`,
          detail: `"${plugin.name}" appears to register a tool named "${tool}", which collides with a tool shipped by the official DSH core. Overriding core tools can break the harness or silently replace official behavior.`,
          suggestion: 'Rename the tool in the community plugin, or confirm you intend to override the official tool.',
        })
      }
    }
  }
  return findings
}

export function detectDuplicatePlugins(plugins: ProfilePlugin[]): Finding[] {
  const findings: Finding[] = []
  const seen = new Set<string>()
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      findings.push({
        id: `duplicate-plugin-${plugin.name}`,
        confidence: 'confirmed',
        severity: 'warn',
        title: `Duplicate plugin entry: "${plugin.name}"`,
        detail: 'The same plugin is declared more than once in the profile dependencies.',
      })
    }
    seen.add(plugin.name)
  }
  return findings
}

export function detectVersionSkew(plugins: ProfilePlugin[]): Finding[] {
  const findings: Finding[] = []
  const versions = new Map<string, Set<string>>()
  for (const plugin of plugins) {
    if (!plugin.version) continue
    const set = versions.get(plugin.version) ?? new Set<string>()
    set.add(plugin.name)
    versions.set(plugin.version, set)
  }
  if (versions.size > 1) {
    const summary = [...versions.entries()]
      .map(([v, names]) => `${v}: ${[...names].join(', ')}`)
      .join(' | ')
    findings.push({
      id: 'version-skew',
      confidence: 'confirmed',
      severity: 'info',
      title: 'Plugins span multiple dsh-tools versions',
      detail: `Installed plugins report different dependency versions: ${summary}.`,
      suggestion: 'Consider aligning versions to reduce incompatibility risk.',
    })
  }
  return findings
}

export function formatProfileReport(report: ProfileReport): string {
  const blockers = report.findings.filter((f) => f.severity === 'blocker').length
  const warnings = report.findings.filter((f) => f.severity === 'warn').length

  const lines: string[] = []
  lines.push('DSH profile scan')
  lines.push(`profile: ${report.profileDir}`)
  lines.push(`plugins: ${report.plugins.length}`)
  lines.push(`result : ${blockers > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'OK'}  (${blockers} blocker · ${warnings} warn)`)

  for (const plugin of report.plugins) {
    const tools = plugin.toolNames.length > 0 ? ` — tools: ${plugin.toolNames.join(', ')}` : ''
    lines.push(`  - ${plugin.name}${plugin.version ? `@${plugin.version}` : ''}${tools}`)
  }

  if (report.findings.length > 0) {
    lines.push('')
    for (const f of report.findings) {
      lines.push(`[${f.severity}] ${f.confidence} — ${f.title}`)
      lines.push(`  ${f.detail}`)
      if (f.suggestion) lines.push(`  → ${f.suggestion}`)
    }
  }

  return lines.join('\n')
}
