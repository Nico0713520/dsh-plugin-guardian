import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

/**
 * Read-only, bounded static inspection for a single DeepSeek Harness plugin.
 *
 * Every finding carries a confidence tier (borrowed from Pi's
 * `pi-extension-doctor`):
 *   - `confirmed`: provable from the files we read (e.g. a missing field).
 *   - `inferred`:  a pattern found by static scan, not proof of runtime behavior.
 *   - `unknown`:   a boundary (remote spec, unreadable file) blocked a conclusion.
 *
 * The doctor never imports or executes inspected source, never spawns
 * subprocesses, never touches the network, and never writes any file.
 */

export type Confidence = 'confirmed' | 'inferred' | 'unknown'
export type Severity = 'blocker' | 'warn' | 'info'

export interface Finding {
  id: string
  confidence: Confidence
  severity: Severity
  title: string
  detail: string
  suggestion?: string
}

export interface Manifest {
  name?: string
  version?: string
  dshPatch?: string
  main?: string
  exports?: unknown
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

export interface InspectionReport {
  target: string
  resolvedPath?: string
  manifest?: Manifest
  patchFileExists?: boolean
  toolNames: string[]
  findings: Finding[]
}

export type Verdict = 'pass' | 'warn' | 'fail'

const MAX_SOURCE_FILES = 500
const MAX_FILE_BYTES = 256 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.turbo', '.workbuddy'])

function looksLikeSpec(target: string): boolean {
  return /^(npm|github|git|https?):/.test(target)
}

/** Recursively collect source files under a directory, bounded and skipping vendor dirs. */
export async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string): Promise<void> {
    if (out.length >= MAX_SOURCE_FILES) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= MAX_SOURCE_FILES) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await walk(path.join(current, entry.name))
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs|jsx)$/.test(entry.name)) {
        out.push(path.join(current, entry.name))
      }
    }
  }
  await walk(dir)
  return out
}

async function readSourceTexts(files: string[]): Promise<string[]> {
  const texts: string[] = []
  for (const file of files) {
    if (texts.length >= MAX_SOURCE_FILES) break
    try {
      const buf = await readFile(file)
      if (buf.byteLength > MAX_FILE_BYTES) continue
      texts.push(buf.toString('utf8'))
    } catch {
      // Unreadable file: skip silently; the report stays read-only.
    }
  }
  return texts
}

const NAME_LITERAL_RE = /\bname\s*:\s*['"]([A-Za-z0-9_-]+)['"]/g

/** Extract string literals bound to a `name:` key. Inferred, not proof of tool registration. */
export function extractToolNames(sourceTexts: readonly string[]): string[] {
  const names = new Set<string>()
  for (const text of sourceTexts) {
    const re = /\bname\s*:\s*['"]([A-Za-z0-9_-]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      names.add(m[1])
    }
  }
  return [...names].sort()
}

interface SafetyPattern {
  id: string
  severity: Severity
  title: string
  detail: string
  re: RegExp
}

const SOURCE_SAFETY_PATTERNS: SafetyPattern[] = [
  {
    id: 'subprocess',
    severity: 'info',
    title: 'Spawns subprocesses',
    detail: 'Source references child_process / exec / spawn. Verify it is sandboxed.',
    re: /(?:child_process|\bexecSync\b|\bexecFile\b|\bspawn\s*\(|\bfork\s*\()/,
  },
  {
    id: 'network',
    severity: 'info',
    title: 'May access the network',
    detail: 'Source references fetch / http(s).request. Verify it does not exfiltrate data.',
    re: /(?:fetch\s*\(|https?\.request\s*\(|XMLHttpRequest)/,
  },
  {
    id: 'file-mutation',
    severity: 'info',
    title: 'Mutates files',
    detail: 'Source references writeFile / rm / unlink / rename. Verify paths stay inside the workspace.',
    re: /(?:writeFile|appendFile|\brm\s*\(|\bunlink\s*\(|\brename\s*\()/,
  },
]

const INSTALL_SCRIPT_KEYS = ['preinstall', 'install', 'postinstall'] as const

export async function readManifest(dir: string): Promise<Manifest | undefined> {
  try {
    const raw = await readFile(path.join(dir, 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      version: typeof parsed.version === 'string' ? parsed.version : undefined,
      dshPatch: readDshPatch(parsed),
      main: typeof parsed.main === 'string' ? parsed.main : undefined,
      exports: parsed.exports,
      scripts: isStringMap(parsed.scripts) ? (parsed.scripts as Record<string, string>) : undefined,
      dependencies: isStringMap(parsed.dependencies) ? (parsed.dependencies as Record<string, string>) : undefined,
      peerDependencies: isStringMap(parsed.peerDependencies)
        ? (parsed.peerDependencies as Record<string, string>)
        : undefined,
    }
  } catch {
    return undefined
  }
}

function readDshPatch(parsed: Record<string, unknown>): string | undefined {
  const dsh = parsed.dsh
  if (dsh && typeof dsh === 'object') {
    const bundle = (dsh as Record<string, unknown>).bundle
    if (bundle && typeof bundle === 'object') {
      const patch = (bundle as Record<string, unknown>).patch
      if (typeof patch === 'string') return patch
    }
  }
  return undefined
}

function isStringMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inspectManifest(manifest: Manifest, patchFileExists: boolean | undefined): Finding[] {
  const findings: Finding[] = []

  if (!manifest.name) {
    findings.push({
      id: 'manifest-no-name',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'package.json is missing "name"',
      detail: 'A DSH plugin must declare a package name to be installable.',
      suggestion: 'Add a "name" field to package.json.',
    })
  }
  if (!manifest.version) {
    findings.push({
      id: 'manifest-no-version',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'package.json is missing "version"',
      detail: 'Without a version, DSH cannot pin or resolve the plugin.',
      suggestion: 'Add a "version" field to package.json.',
    })
  }

  if (!manifest.dshPatch) {
    findings.push({
      id: 'missing-dsh-patch',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'Missing dsh.bundle.patch declaration',
      detail:
        'DSH plugins must declare "dsh.bundle.patch" pointing at their cordis patch file, otherwise the plugin installs but does not activate.',
      suggestion: 'Add "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } and ship that file.',
    })
  } else if (patchFileExists === false) {
    findings.push({
      id: 'missing-patch-file',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'Declared patch file is missing',
      detail: `dsh.bundle.patch points at "${manifest.dshPatch}" but that file was not found.`,
      suggestion: 'Create the referenced cordis patch file, or fix the path.',
    })
  } else if (patchFileExists === true) {
    findings.push({
      id: 'patch-present',
      confidence: 'confirmed',
      severity: 'info',
      title: 'cordis patch file present',
      detail: `Found the declared patch file "${manifest.dshPatch}".`,
    })
  }

  if (!manifest.main && manifest.exports === undefined) {
    findings.push({
      id: 'missing-entry',
      confidence: 'confirmed',
      severity: 'warn',
      title: 'No "main" or "exports" entry point',
      detail: 'The package does not declare a module entry point.',
      suggestion: 'Add "main" or "exports" so the plugin can be imported.',
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

  const prereleasePeers: string[] = []
  for (const [dep, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (/rc\./.test(range)) prereleasePeers.push(`${dep}@${range}`)
  }
  if (prereleasePeers.length > 0) {
    findings.push({
      id: 'prerelease-peers',
      confidence: 'confirmed',
      severity: 'warn',
      title: `Pre-release peer dependencies (${prereleasePeers.length})`,
      detail: `DSH is in developer preview and releases breaking changes. Floating rc ranges can drift: ${prereleasePeers.join(', ')}.`,
      suggestion: 'Pin these peer dependencies to the exact versions your plugin was tested against.',
    })
  }

  return findings
}

async function inspectPatchFile(dir: string, dshPatch: string | undefined): Promise<boolean | undefined> {
  if (!dshPatch) return undefined
  try {
    await access(path.join(dir, dshPatch))
    return true
  } catch {
    return false
  }
}

function inspectSourceSafety(sourceTexts: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const pattern of SOURCE_SAFETY_PATTERNS) {
    if (sourceTexts.some((text) => pattern.re.test(text))) {
      findings.push({
        id: `safety-${pattern.id}`,
        confidence: 'inferred',
        severity: pattern.severity,
        title: pattern.title,
        detail: pattern.detail,
        suggestion: 'Review the flagged code before trusting this plugin.',
      })
    }
  }
  return findings
}

/** Inspect a plugin directory or a remote spec. Never installs, never writes. */
export async function inspectPlugin(target: string): Promise<InspectionReport> {
  const report: InspectionReport = { target, toolNames: [], findings: [] }

  if (looksLikeSpec(target)) {
    report.findings.push({
      id: 'remote-spec',
      confidence: 'unknown',
      severity: 'info',
      title: 'Remote spec is not inspectable in place',
      detail: `${target} is a remote spec. The doctor does not install packages or hit the network.`,
      suggestion: 'Clone or install the plugin locally, then pass its directory path.',
    })
    return report
  }

  const dir = path.resolve(target)
  report.resolvedPath = dir

  const manifest = await readManifest(dir)
  if (!manifest) {
    report.findings.push({
      id: 'no-package-json',
      confidence: 'confirmed',
      severity: 'blocker',
      title: 'No readable package.json',
      detail: `Could not read ${path.join(dir, 'package.json')}. Is this a plugin directory?`,
    })
    return report
  }
  report.manifest = manifest

  const patchFileExists = await inspectPatchFile(dir, manifest.dshPatch)
  report.patchFileExists = patchFileExists

  report.findings.push(...inspectManifest(manifest, patchFileExists))

  const files = await listSourceFiles(dir)
  const sourceTexts = await readSourceTexts(files)
  report.toolNames = extractToolNames(sourceTexts)

  if (files.length === 0) {
    report.findings.push({
      id: 'no-source-files',
      confidence: 'confirmed',
      severity: 'warn',
      title: 'No source files found',
      detail: 'No .ts/.js source files were found outside skipped vendor directories.',
    })
  }

  report.findings.push(...inspectSourceSafety(sourceTexts))

  if (report.toolNames.length > 0) {
    report.findings.push({
      id: 'tool-names-detected',
      confidence: 'inferred',
      severity: 'info',
      title: `Detected ${report.toolNames.length} possible tool name(s)`,
      detail: `Static scan found: ${report.toolNames.join(', ')}.`,
      suggestion: 'Use plugin_profile_scan to check for collisions against the installed set.',
    })
  }

  return report
}

export function computeVerdict(findings: readonly Finding[]): Verdict {
  const hasBlocker = findings.some((f) => f.severity === 'blocker')
  const hasWarn = findings.some((f) => f.severity === 'warn')
  if (hasBlocker) return 'fail'
  if (hasWarn) return 'warn'
  return 'pass'
}

function count(findings: readonly Finding[], severity: Severity): number {
  return findings.filter((f) => f.severity === severity).length
}

const VERDICT_LABEL: Record<Verdict, string> = {
  pass: 'PASS',
  warn: 'WARN',
  fail: 'FAIL',
}

export function formatReport(report: InspectionReport): string {
  const verdict = computeVerdict(report.findings)
  const blockers = count(report.findings, 'blocker')
  const warnings = count(report.findings, 'warn')
  const infos = count(report.findings, 'info')

  const lines: string[] = []
  lines.push('DSH plugin doctor')
  lines.push(`target : ${report.target}`)
  lines.push(`verdict: ${VERDICT_LABEL[verdict]}  (${blockers} blocker · ${warnings} warn · ${infos} info)`)
  lines.push('')

  if (report.findings.length === 0) {
    lines.push('No findings. The plugin looks clean at a glance.')
  }

  for (const f of report.findings) {
    lines.push(`[${f.severity}] ${f.confidence} — ${f.title}`)
    lines.push(`  ${f.detail}`)
    if (f.suggestion) lines.push(`  → ${f.suggestion}`)
  }

  return lines.join('\n')
}

export function formatReportJson(report: InspectionReport): string {
  const verdict = computeVerdict(report.findings)
  return JSON.stringify(
    {
      target: report.target,
      resolvedPath: report.resolvedPath,
      verdict,
      summary: {
        blockers: count(report.findings, 'blocker'),
        warnings: count(report.findings, 'warn'),
        infos: count(report.findings, 'info'),
      },
      manifest: report.manifest,
      patchFileExists: report.patchFileExists,
      toolNames: report.toolNames,
      findings: report.findings,
    },
    null,
    2,
  )
}
