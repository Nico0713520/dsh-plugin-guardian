import { describe, expect, it } from 'vitest'
import { apply, inject, name } from './index.ts'

interface RegisteredTool {
  name?: string
  description?: string
  execute?: (...args: unknown[]) => unknown
}

function makeMockContext() {
  const registered: RegisteredTool[] = []
  const ctx = {
    tools: {
      register: (tool: RegisteredTool) => {
        registered.push(tool)
      },
    },
  } as unknown as Parameters<typeof apply>[0]
  return { ctx, registered }
}

describe('plugin entry', () => {
  it('exports a valid dsh plugin signature', () => {
    expect(name).toBe('plugin-guardian')
    expect(inject).toContain('tools')
  })

  it('registers all four tools when applied', () => {
    const { ctx, registered } = makeMockContext()
    apply(ctx)
    expect(registered.map((tool) => tool.name)).toEqual([
      'plugin_doctor',
      'plugin_profile_scan',
      'plugin_promote',
      'plugin_install',
    ])
    for (const tool of registered) {
      expect(tool.description?.length).toBeGreaterThan(20)
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('survives an apply with explicit config', () => {
    const { ctx, registered } = makeMockContext()
    apply(ctx, { profileDir: '/tmp/profile' })
    expect(registered).toHaveLength(4)
  })
})
