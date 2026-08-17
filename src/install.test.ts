import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { auditSpec, formatInstallResult, installPlugin, parseSpec } from './install.ts'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-guardian-install-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('parseSpec', () => {
  it('parses npm: spec', () => {
    expect(parseSpec('npm:some-plugin')).toEqual({ kind: 'npm', value: 'some-plugin' })
  })

  it('parses github: spec', () => {
    expect(parseSpec('github:owner/repo')).toEqual({ kind: 'github', value: 'owner/repo' })
  })

  it('parses a local relative path', () => {
    expect(parseSpec('./my-plugin')).toEqual({ kind: 'local', value: './my-plugin' })
  })

  it('defaults a bare name to npm', () => {
    expect(parseSpec('some-plugin')).toEqual({ kind: 'npm', value: 'some-plugin' })
  })
})

describe('installPlugin (audit-only)', () => {
  it('audits a local path without installing when approve is false', async () => {
    const dir = await makeTempDir()
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'demo-plugin', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }),
    )
    await writeFile(path.join(dir, 'cordis.patch.yml'), '- insert:\n    - id: demo-plugin\n')

    const result = await installPlugin({ spec: dir, approve: false })
    expect(result.status).toBe('audited')
    expect(result.ok).toBe(true)
    expect(result.installCommand).toContain('dsh plugin --profile web add')
    expect(result.audit?.findings.some((f) => f.severity === 'blocker')).toBe(false)
  })

  it('blocks install when approve=true and the audit finds blockers', async () => {
    const dir = await makeTempDir() // empty dir → no package.json → blocker
    const result = await installPlugin({ spec: dir, approve: true })
    expect(result.status).toBe('blocked')
    expect(result.ok).toBe(false)
  })

  it('reports a github spec as unknown and does not install', async () => {
    const result = await installPlugin({ spec: 'github:owner/repo', approve: false })
    expect(result.status).toBe('audited')
    expect(result.audit?.findings.some((f) => f.id === 'github-spec-not-audited')).toBe(true)
  })
})

describe('auditSpec', () => {
  it('audits a local directory via the doctor', async () => {
    const dir = await makeTempDir()
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }))
    const report = await auditSpec(dir)
    expect(report.manifest?.name).toBe('x')
    expect(report.findings.some((f) => f.id === 'missing-dsh-patch')).toBe(true)
  })
})

describe('formatInstallResult', () => {
  it('renders the install command for an audited result', () => {
    const text = formatInstallResult({
      ok: true,
      status: 'audited',
      spec: 'npm:foo',
      installCommand: 'dsh plugin --profile web add npm:foo',
      audit: { target: 'npm:foo', toolNames: [], findings: [] },
    })
    expect(text).toContain('DSH plugin install')
    expect(text).toContain('dsh plugin --profile web add npm:foo')
    expect(text).toContain('nothing was installed')
  })
})
