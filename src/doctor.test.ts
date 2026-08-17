import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { computeVerdict, extractToolNames, inspectPlugin, type Finding } from './doctor.ts'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-guardian-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

async function writePlugin(dir: string, pkg: Record<string, unknown>, files: Record<string, string> = {}) {
  await writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content)
  }
}

const VALID_PKG = {
  name: 'demo-plugin',
  version: '0.1.0',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  main: './dist/index.js',
}

describe('extractToolNames', () => {
  it('extracts and dedupes name literals', () => {
    const names = extractToolNames([
      "defineTool({ name: 'foo_bar' })",
      "defineTool({ name: 'foo_bar' })",
      "defineTool({ name: 'baz' })",
    ])
    expect(names).toEqual(['baz', 'foo_bar'])
  })

  it('ignores text without a name: key', () => {
    expect(extractToolNames(["const x = 'hello'"])).toEqual([])
  })
})

describe('computeVerdict', () => {
  const f = (severity: Finding['severity']): Finding => ({
    id: 'x',
    confidence: 'confirmed',
    severity,
    title: 't',
    detail: 'd',
  })

  it('fails when a blocker is present', () => {
    expect(computeVerdict([f('blocker'), f('info')])).toBe('fail')
  })

  it('warns when only warnings and infos present', () => {
    expect(computeVerdict([f('warn'), f('info')])).toBe('warn')
  })

  it('passes when only infos present', () => {
    expect(computeVerdict([f('info')])).toBe('pass')
  })
})

describe('inspectPlugin', () => {
  it('reports a clean plugin as pass', async () => {
    const dir = await makeTempDir()
    await writePlugin(dir, VALID_PKG, {
      'cordis.patch.yml': '- insert:\n    - id: demo\n',
      'src/index.ts': "defineTool({ name: 'demo_run' })",
    })
    const report = await inspectPlugin(dir)
    expect(computeVerdict(report.findings)).toBe('pass')
    expect(report.manifest?.name).toBe('demo-plugin')
    expect(report.patchFileExists).toBe(true)
    expect(report.toolNames).toContain('demo_run')
  })

  it('flags a missing dsh.bundle.patch as a blocker', async () => {
    const dir = await makeTempDir()
    await writePlugin(dir, { name: 'demo', version: '0.1.0' })
    const report = await inspectPlugin(dir)
    expect(computeVerdict(report.findings)).toBe('fail')
    expect(report.findings.some((f) => f.id === 'missing-dsh-patch')).toBe(true)
  })

  it('flags a declared-but-missing patch file as a blocker', async () => {
    const dir = await makeTempDir()
    await writePlugin(dir, { ...VALID_PKG })
    const report = await inspectPlugin(dir)
    expect(report.findings.some((f) => f.id === 'missing-patch-file')).toBe(true)
  })

  it('flags an install script as a warning', async () => {
    const dir = await makeTempDir()
    await writePlugin(dir, { ...VALID_PKG, scripts: { postinstall: 'node setup.js' } }, {
      'cordis.patch.yml': '- insert:\n    - id: demo\n',
    })
    const report = await inspectPlugin(dir)
    expect(report.findings.some((f) => f.id === 'install-script-postinstall')).toBe(true)
  })

  it('reports remote specs as unknown without touching the network', async () => {
    const report = await inspectPlugin('github:owner/repo')
    expect(report.findings.some((f) => f.confidence === 'unknown' && f.id === 'remote-spec')).toBe(true)
  })

  it('reports a missing package.json as a blocker', async () => {
    const dir = await makeTempDir()
    const report = await inspectPlugin(dir)
    expect(report.findings.some((f) => f.id === 'no-package-json')).toBe(true)
  })
})
