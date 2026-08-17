import { execFile } from 'node:child_process'
import { computeVerdict, inspectPlugin, type Finding, type InspectionReport, type Manifest } from './doctor.ts'

/**
 * Guided install: "audit first, then execute".
 *
 * The desktop experience for installing a plugin is jarring — a catalog entry
 * only gives you prose, and the actual install is a terminal command. This tool
 * closes that gap as the capability layer: it audits a spec first, reports the
 * verdict, and only runs `dsh plugin add` after the caller explicitly approves.
 *
 * Audit is read-only where possible:
 *   - local path → full `plugin_doctor` inspection
 *   - npm:name   → `npm view` metadata (name/version/scripts/peer deps/dsh)
 *   - github:*   → reported as unknown (needs a clone or npm name first)
 *
 * Install is a write action and is gated behind `approve` (default false).
 */

export type SpecKind = 'local' | 'npm' | 'github'

export interface InstallOptions {
  /** Plugin spec: a local dir path, "npm:name", or "github:owner/repo". */
  spec: string
  /** DSH profile name. Defaults to "web". */
  profile?: string
  /** Approve the install. Defaults to false (audit only, no write). */
  approve?: boolean
  /** Timeout for the `dsh` subprocess. Defaults to 60_000. */
  timeoutMs?: number
}

export interface InstallResult {
  ok: boolean
  status: 'audited' | 'installed' | 'blocked' | 'failed'
  spec: string
  audit?: InspectionReport
  installCommand?: string
  installOutput?: string
  error?: string
}

export function parseSpec(spec: string): { kind: SpecKind; value: string } {
  if (spec.startsWith('npm:')) return { kind: 'npm', value: spec.slice(4) }
  if (spec.startsWith('github:')) return { kind: 'github', value: spec.slice(7) }
  if (spec.startsWith('.') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec)) {
    return { kind: 'local', value: spec }
  }
  return { kind: 'npm', value: spec }
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          reject(Object.assign(new Error(`${command} executable not found`), { commandError: 'not-installed' }))
          return
        }
        resolve({ stdout, stderr, exitCode: 1 })
      },
    )
  })
}

interface NpmMetadata {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: unknown
}

async function npmView(pkgName: string, timeoutMs: number): Promise<NpmMetadata> {
  const { stdout } = await runCommand('npm', ['view', pkgName, '--json'], timeoutMs)
  const parsed = JSON.parse(stdout) as NpmMetadata | NpmMetadata[]
  return Array.isArray(parsed) ? (parsed[0] ?? {}) : parsed
}

function dshPatchFrom(meta: NpmMetadata): string | undefined {
  const dsh = meta.dsh
  if (dsh && typeof dsh === 'object') {
    const bundle = (dsh as Record<string, unknown>).bundle
    if (bundle && typeof bundle === 'object') {
      const patch = (bundle as Record<string, unknown>).patch
      if (typeof patch === 'string') return patch
    }
  }
  return undefined
}

const INSTALL_SCRIPT_KEYS = ['preinstall', 'install', 'postinstall'] as const

/** Lightweight audit of npm metadata (read-only registry query). */
function auditNpmMetadata(meta: NpmMetadata, pkgName: string): { manifest: Manifest; findings: Finding[] } {
  const manifest: Manifest = {
    name: meta.name,
    version: meta.version,
    dshPatch: dshPatchFrom(meta),
    scripts: meta.scripts,
    dependencies: meta.dependencies,
    peerDependencies: meta.peerDependencies,
  }
  const findings: Finding[] = []

  if (!manifest.name) {
    findings.push({
      id: 'npm-no-name',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'npm metadata is missing "name"',
      detail: `Could not resolve a package name for "${pkgName}".`,
    })
  }
  if (!manifest.version) {
    findings.push({
      id: 'npm-no-version',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'npm metadata is missing "version"',
      detail: `Could not resolve a version for "${pkgName}".`,
    })
  }
  if (!manifest.dshPatch) {
    findings.push({
      id: 'missing-dsh-patch',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'Missing dsh.bundle.patch declaration',
      detail: 'DSH plugins must declare "dsh.bundle.patch" pointing at their cordis patch file, otherwise the plugin installs but does not activate.',
      suggestion: 'Check that this package is a DSH plugin and declares "dsh": { "bundle": { "patch": "..." } }.',
    })
  }
  for (const key of INSTALL_SCRIPT_KEYS) {
    if (manifest.scripts?.[key]) {
      findings.push({
        id: `install-script-${key}`,
        confidence: 'confirmed',
        severity: 'warn',
        title: `Runs a "${key}" script`,
        detail: `package.json declares a "${key}" script that executes code on install.`,
        suggestion: 'Confirm you trust the publisher; DSH installs with --ignore-scripts, but review it anyway.',
      })
    }
  }
  const prereleasePeers = Object.entries(manifest.peerDependencies ?? {})
    .filter(([, range]) => /rc\./.test(range))
    .map(([dep, range]) => `${dep}@${range}`)
  if (prereleasePeers.length > 0) {
    findings.push({
      id: 'prerelease-peers',
      confidence: 'confirmed',
      severity: 'warn',
      title: `Pre-release peer dependencies (${prereleasePeers.length})`,
      detail: `DSH is in developer preview and releases breaking changes. Floating rc ranges can drift: ${prereleasePeers.join(', ')}.`,
      suggestion: 'Pin these peer dependencies to the exact versions the plugin was tested against.',
    })
  }

  return { manifest, findings }
}

/** Audit a spec without writing anything. */
export async function auditSpec(spec: string, timeoutMs = 60_000): Promise<InspectionReport> {
  const { kind, value } = parseSpec(spec)

  if (kind === 'local') {
    return inspectPlugin(value)
  }

  if (kind === 'github') {
    return {
      target: spec,
      toolNames: [],
      findings: [
        {
          id: 'github-spec-not-audited',
          confidence: 'unknown',
          severity: 'info',
          title: 'github spec is not auditable in place',
          detail: `${spec} is a git spec. The audit does not clone repositories or hit git remotes.`,
          suggestion: 'Use an "npm:name" if the package is published, or clone it locally and pass the directory path.',
        },
      ],
    }
  }

  const report: InspectionReport = { target: spec, toolNames: [], findings: [] }
  try {
    const meta = await npmView(value, timeoutMs)
    const audited = auditNpmMetadata(meta, value)
    report.manifest = audited.manifest
    report.findings.push(...audited.findings)
  } catch (error) {
    report.findings.push({
      id: 'npm-view-failed',
      confidence: 'unknown',
      severity: 'info',
      title: 'Could not fetch npm metadata',
      detail: error instanceof Error ? error.message : String(error),
      suggestion: 'Check the package name and network, or install locally and pass the directory path.',
    })
  }
  return report
}

/** Guided install: audit → (approve?) → run `dsh plugin add`. */
export async function installPlugin(options: InstallOptions): Promise<InstallResult> {
  const spec = options.spec
  const profile = options.profile ?? 'web'
  const timeoutMs = options.timeoutMs ?? 60_000
  const installCommand = `dsh plugin --profile ${profile} add ${spec}`

  const audit = await auditSpec(spec, timeoutMs)

  if (!options.approve) {
    return {
      ok: true,
      status: 'audited',
      spec,
      audit,
      installCommand,
    }
  }

  const verdict = computeVerdict(audit.findings)
  if (verdict === 'fail') {
    return {
      ok: false,
      status: 'blocked',
      spec,
      audit,
      installCommand,
      error: 'install blocked: the audit found blockers. Fix them and retry, or pass approve=true with an explicit override.',
    }
  }

  try {
    const { stdout, stderr, exitCode } = await runCommand(
      'dsh',
      ['plugin', '--profile', profile, 'add', spec],
      timeoutMs,
    )
    const output = [stdout, stderr].filter(Boolean).join('\n').trim() || `(dsh exited ${exitCode} with no output)`
    return {
      ok: exitCode === 0,
      status: exitCode === 0 ? 'installed' : 'failed',
      spec,
      audit,
      installCommand,
      installOutput: output,
      error: exitCode === 0 ? undefined : `dsh exited with code ${exitCode}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      spec,
      audit,
      installCommand,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function formatInstallResult(result: InstallResult): string {
  const lines: string[] = []
  lines.push('DSH plugin install')
  lines.push(`spec   : ${result.spec}`)
  lines.push(`status : ${result.status.toUpperCase()}`)

  if (result.audit) {
    const blockers = result.audit.findings.filter((f) => f.severity === 'blocker').length
    const warnings = result.audit.findings.filter((f) => f.severity === 'warn').length
    lines.push(`audit  : ${blockers} blocker · ${warnings} warn · ${result.audit.findings.length - blockers - warnings} info`)
  }

  if (result.status === 'audited') {
    lines.push('')
    lines.push('Audit only — nothing was installed. Review the report, then approve to install:')
    lines.push(`  ${result.installCommand}`)
    if (result.audit && result.audit.findings.length > 0) {
      lines.push('')
      for (const f of result.audit.findings) {
        lines.push(`  [${f.severity}] ${f.confidence} — ${f.title}`)
        lines.push(`    ${f.detail}`)
        if (f.suggestion) lines.push(`    → ${f.suggestion}`)
      }
    }
  } else if (result.status === 'blocked') {
    lines.push('')
    lines.push(result.error ?? 'Blocked by the audit.')
  } else if (result.status === 'installed') {
    lines.push(`ran    : ${result.installCommand}`)
    if (result.installOutput) {
      lines.push('')
      lines.push(result.installOutput)
    }
  } else {
    lines.push(`error  : ${result.error}`)
  }

  return lines.join('\n')
}
