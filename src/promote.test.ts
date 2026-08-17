import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashTree, promotePlugin } from './promote.ts'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-guardian-promote-'))
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

describe('hashTree', () => {
  it('is deterministic for identical content', async () => {
    const a = await makeTempDir()
    const b = await makeTempDir()
    await writePlugin(a, VALID_PKG, { 'src/index.ts': 'hello' })
    await writePlugin(b, VALID_PKG, { 'src/index.ts': 'hello' })
    expect(await hashTree(a)).toBe(await hashTree(b))
  })

  it('differs when content differs', async () => {
    const a = await makeTempDir()
    const b = await makeTempDir()
    await writePlugin(a, VALID_PKG, { 'src/index.ts': 'hello' })
    await writePlugin(b, VALID_PKG, { 'src/index.ts': 'world' })
    expect(await hashTree(a)).not.toBe(await hashTree(b))
  })
})

describe('promotePlugin', () => {
  it('promotes a valid plugin and writes a provenance marker', async () => {
    const source = await makeTempDir()
    const out = await makeTempDir()
    await writePlugin(source, VALID_PKG, {
      'cordis.patch.yml': '- insert:\n    - id: demo\n',
      'src/index.ts': "defineTool({ name: 'demo_run' })",
    })

    const result = await promotePlugin({ source, outputDir: out })
    expect(result.status).toBe('promoted')
    expect(result.ok).toBe(true)
    expect(result.name).toBe('demo-plugin')
    expect(result.stagedPath).toBe(path.join(out, 'demo-plugin'))
    expect(result.installCommand).toContain('dsh plugin --profile web add link:')

    const marker = JSON.parse(await readFile(path.join(result.stagedPath!, '.guardian-managed.json'), 'utf8'))
    expect(marker.owner).toBe('dsh-plugin-guardian')
    expect(marker.name).toBe('demo-plugin')
    expect(marker.sourceHash).toBe(result.sourceHash)
  })

  it('blocks promotion when the doctor finds blockers', async () => {
    const source = await makeTempDir()
    const out = await makeTempDir()
    await writePlugin(source, { name: 'demo', version: '0.1.0' }) // missing dsh.bundle.patch

    const result = await promotePlugin({ source, outputDir: out })
    expect(result.status).toBe('blocked')
    expect(result.ok).toBe(false)
    expect(result.doctor).toBeDefined()
  })

  it('blocks promotion when the plugin has no name', async () => {
    const source = await makeTempDir()
    const out = await makeTempDir()
    await writePlugin(source, { version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } } })

    const result = await promotePlugin({ source, outputDir: out })
    expect(result.status).toBe('blocked')
    expect(result.doctor?.findings.some((f) => f.id === 'manifest-no-name')).toBe(true)
  })

  it('does not overwrite an existing promotion', async () => {
    const source = await makeTempDir()
    const out = await makeTempDir()
    await writePlugin(source, VALID_PKG, { 'cordis.patch.yml': '- insert:\n    - id: demo\n' })

    const first = await promotePlugin({ source, outputDir: out })
    const second = await promotePlugin({ source, outputDir: out })
    expect(first.status).toBe('promoted')
    expect(second.status).toBe('promoted')
    expect(second.stagedPath).not.toBe(first.stagedPath)
  })
})
