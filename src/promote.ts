import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { computeVerdict, inspectPlugin, type InspectionReport } from './doctor.ts'

/**
 * "Promote" a plugin from an ephemeral source directory into a durable,
 * validated, versioned location on disk — the "转正" half of the guardian.
 *
 * Pipeline: validate (doctor gate) → hash → stage → marker → atomic rename.
 * Optionally registers into the live DSH profile via `dsh plugin add`.
 *
 * Safe by default: `register` is false, so promote only writes to a managed
 * staging directory and never touches the live profile unless explicitly asked.
 */

const MARKER_OWNER = 'dsh-plugin-guardian'
const MARKER_SCHEMA = 1

export interface PromoteOptions {
  /** Source plugin directory to promote. */
  source: string
  /** Root under which promoted plugins are staged. Defaults to $DSH_HOME/.guardian-plugins or ./.guardian-plugins. */
  outputDir?: string
  /** Run `dsh plugin add` to register the staged plugin into the profile. Defaults to false. */
  register?: boolean
  /** DSH profile name. Defaults to 'web'. */
  profile?: string
  /** Timeout for the `dsh` subprocess. Defaults to 60_000. */
  timeoutMs?: number
}

export interface PromoteResult {
  ok: boolean
  status: 'promoted' | 'blocked' | 'failed'
  name?: string
  version?: string
  sourceHash?: string
  stagedPath?: string
  doctor?: InspectionReport
  installCommand?: string
  installOutput?: string
  error?: string
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** sha256 over the sorted directory tree, matching the marker/hash pattern in DSH desktop. */
export async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function visit(dir: string, prefix = ''): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${rel}\0`)
      if (entry.isDirectory()) {
        await visit(path.join(dir, entry.name), rel)
      } else {
        hash.update(await readFile(path.join(dir, entry.name)))
      }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

function runDsh(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      'dsh',
      args,
      { timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 })
          return
        }
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT') {
          reject(Object.assign(new Error('dsh executable not found'), { dshError: 'not-installed' }))
          return
        }
        resolve({ stdout, stderr, exitCode: 1 })
      },
    )
  })
}

export async function promotePlugin(options: PromoteOptions): Promise<PromoteResult> {
  const source = path.resolve(options.source)
  const profile = options.profile ?? 'web'
  const timeoutMs = options.timeoutMs ?? 60_000

  // 1. Validate with the doctor (the gate).
  const doctor = await inspectPlugin(source)
  const verdict = computeVerdict(doctor.findings)
  if (verdict === 'fail') {
    return {
      ok: false,
      status: 'blocked',
      doctor,
      error: 'promote blocked: the doctor found blockers. Fix them and retry.',
    }
  }

  const name = doctor.manifest?.name
  if (!name) {
    return {
      ok: false,
      status: 'blocked',
      doctor,
      error: 'promote blocked: the plugin has no package "name".',
    }
  }
  const version = doctor.manifest?.version

  // 2. Hash the source for provenance and dedup.
  const sourceHash = await hashTree(source)

  // 3. Stage into a temp dir, write marker, then atomically rename into place.
  const outputRoot = options.outputDir
    ?? (process.env.DSH_HOME ? path.join(process.env.DSH_HOME, '.guardian-plugins') : path.join(process.cwd(), '.guardian-plugins'))

  let staging: string | undefined
  try {
    await mkdir(outputRoot, { recursive: true })
    staging = await mkdtemp(path.join(outputRoot, `.stage-${name}-`))
    await cp(source, staging, { recursive: true })

    const marker = {
      owner: MARKER_OWNER,
      schema: MARKER_SCHEMA,
      name,
      version,
      sourceHash,
      promotedAt: new Date().toISOString(),
      source,
      doctorVerdict: verdict,
    }
    await writeJson(path.join(staging, '.guardian-managed.json'), marker)

    // Unique final path: never overwrite an existing promotion.
    let finalDir = path.join(outputRoot, name)
    if (await exists(finalDir)) {
      finalDir = path.join(outputRoot, `${name}-${sourceHash.slice(0, 8)}`)
    }
    await rename(staging, finalDir)
    staging = undefined

    const installCommand = `dsh plugin --profile ${profile} add link:${finalDir}`

    let installOutput: string | undefined
    if (options.register) {
      try {
        const { stdout, stderr, exitCode } = await runDsh(
          ['plugin', '--profile', profile, 'add', `link:${finalDir}`],
          timeoutMs,
        )
        installOutput = [stdout, stderr].filter(Boolean).join('\n').trim()
          || `(dsh exited ${exitCode} with no output)`
      } catch (error) {
        installOutput = error instanceof Error ? error.message : String(error)
      }
    }

    return {
      ok: true,
      status: 'promoted',
      name,
      version,
      sourceHash,
      stagedPath: finalDir,
      doctor,
      installCommand,
      installOutput,
    }
  } catch (error) {
    if (staging !== undefined && await exists(staging)) {
      await rm(staging, { recursive: true, force: true })
    }
    return {
      ok: false,
      status: 'failed',
      name,
      version,
      sourceHash,
      doctor,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

export function formatPromoteResult(result: PromoteResult): string {
  const lines: string[] = []
  lines.push('DSH plugin promote')
  lines.push(`status : ${result.status.toUpperCase()}`)
  if (result.name) lines.push(`name   : ${result.name}${result.version ? `@${result.version}` : ''}`)
  if (result.sourceHash) lines.push(`sha256 : ${result.sourceHash}`)

  if (result.status === 'blocked') {
    lines.push('')
    lines.push('The doctor blocked the promotion. Fix these blockers first:')
    for (const f of (result.doctor?.findings ?? []).filter((x) => x.severity === 'blocker')) {
      lines.push(`  [${f.id}] ${f.title}`)
      lines.push(`    ${f.detail}`)
    }
  } else if (result.status === 'promoted') {
    lines.push(`staged : ${result.stagedPath}`)
    lines.push(`install: ${result.installCommand}`)
    if (result.installOutput) {
      lines.push('')
      lines.push('install output:')
      lines.push(result.installOutput)
    } else if (result.installCommand && !result.installOutput) {
      lines.push('')
      lines.push('(not registered — pass register=true or run the install command above)')
    }
  } else {
    lines.push(`error  : ${result.error}`)
  }

  return lines.join('\n')
}
