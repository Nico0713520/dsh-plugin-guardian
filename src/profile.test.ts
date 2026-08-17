import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  detectDuplicatePlugins,
  detectOfficialToolOverrides,
  detectToolCollisions,
  detectVersionSkew,
  scanProfile,
  type ProfilePlugin,
} from './profile.ts'

const tempDirs: string[] = []

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-guardian-profile-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

function plugin(name: string, toolNames: string[], version?: string): ProfilePlugin {
  return { name, spec: name, toolNames, version }
}

describe('detectToolCollisions', () => {
  it('flags two plugins registering the same tool name', () => {
    const findings = detectToolCollisions([
      plugin('a', ['shared_tool', 'a_only']),
      plugin('b', ['shared_tool', 'b_only']),
    ])
    expect(findings.some((f) => f.id === 'tool-collision-shared_tool' && f.severity === 'blocker')).toBe(true)
  })

  it('does not flag a tool that appears only once', () => {
    const findings = detectToolCollisions([plugin('a', ['a_only']), plugin('b', ['b_only'])])
    expect(findings).toEqual([])
  })

  it('does not flag the same plugin seen twice (handled by duplicate detection)', () => {
    const findings = detectToolCollisions([plugin('a', ['t']), plugin('a', ['t'])])
    expect(findings).toEqual([])
  })
})

describe('detectDuplicatePlugins', () => {
  it('flags a plugin declared twice', () => {
    const findings = detectDuplicatePlugins([plugin('a', []), plugin('a', [])])
    expect(findings.some((f) => f.id === 'duplicate-plugin-a')).toBe(true)
  })
})

describe('detectOfficialToolOverrides', () => {
  it('flags a community plugin that registers an official tool name', () => {
    const findings = detectOfficialToolOverrides([plugin('community-skin', ['bash'])])
    expect(findings.some((f) => f.id === 'official-tool-override-bash' && f.severity === 'blocker')).toBe(true)
  })

  it('normalizes dash vs underscore tool names', () => {
    const findings = detectOfficialToolOverrides([plugin('community-x', ['ask-user'])])
    expect(findings.some((f) => f.id === 'official-tool-override-ask-user')).toBe(true)
  })

  it('ignores tools that are not in the official set', () => {
    const findings = detectOfficialToolOverrides([plugin('community-y', ['my_custom_tool'])])
    expect(findings).toEqual([])
  })

  it('does not flag the official packages themselves', () => {
    const findings = detectOfficialToolOverrides([plugin('@deepseek-ai/dsh-shell', ['bash'])])
    expect(findings).toEqual([])
  })
})

describe('detectVersionSkew', () => {
  it('flags plugins on different versions', () => {
    const findings = detectVersionSkew([plugin('a', [], '1.0.0'), plugin('b', [], '2.0.0')])
    expect(findings.some((f) => f.id === 'version-skew')).toBe(true)
  })

  it('is silent when versions align', () => {
    const findings = detectVersionSkew([plugin('a', [], '1.0.0'), plugin('b', [], '1.0.0')])
    expect(findings).toEqual([])
  })
})

describe('scanProfile', () => {
  it('detects a real tool-name collision across installed plugins', async () => {
    const dir = await makeTempDir()
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { 'plugin-a': '1.0.0', 'plugin-b': '1.0.0' } }),
    )
    await mkdir(path.join(dir, 'node_modules', 'plugin-a', 'src'), { recursive: true })
    await writeFile(
      path.join(dir, 'node_modules', 'plugin-a', 'package.json'),
      JSON.stringify({ name: 'plugin-a', version: '1.0.0' }),
    )
    await writeFile(
      path.join(dir, 'node_modules', 'plugin-a', 'src', 'index.ts'),
      "defineTool({ name: 'clash_tool' })",
    )
    await mkdir(path.join(dir, 'node_modules', 'plugin-b', 'src'), { recursive: true })
    await writeFile(
      path.join(dir, 'node_modules', 'plugin-b', 'package.json'),
      JSON.stringify({ name: 'plugin-b', version: '1.0.0' }),
    )
    await writeFile(
      path.join(dir, 'node_modules', 'plugin-b', 'src', 'index.ts'),
      "defineTool({ name: 'clash_tool' })",
    )

    const report = await scanProfile(dir)
    expect(report.plugins).toHaveLength(2)
    expect(report.findings.some((f) => f.id === 'tool-collision-clash_tool')).toBe(true)
  })

  it('reports a missing profile package.json as a blocker', async () => {
    const dir = await makeTempDir()
    const report = await scanProfile(dir)
    expect(report.findings.some((f) => f.id === 'no-profile-package' && f.severity === 'blocker')).toBe(true)
  })
})
