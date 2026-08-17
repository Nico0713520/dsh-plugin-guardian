/**
 * Official DeepSeek Harness plugin baseline.
 *
 * The guardian compares community plugins against this baseline to answer the
 * question "is a community plugin colliding with what DSH ships out of the box?"
 *
 * Two kinds of data live here:
 *   - OFFICIAL_PACKAGES: the `@deepseek-ai/dsh-*` package names DSH ships with.
 *   - OFFICIAL_TOOL_NAMES: the tool identifiers the official core plugins
 *     register. These are taken from the official docs ("内置工具一览":
 *     read/write/edit/glob/grep, bash/pwsh, web_search/web_fetch,
 *     ask-user/todo/jobs, skill/subagent/workflow/goal/ralph,
 *     str-replace-editor/cordis, run_code).
 *
 * DSH is in developer preview and iterates fast. This baseline is pinned to a
 * specific DSH version and MUST be refreshed when DSH releases a new rc. The
 * tool-name comparison normalizes `-` / `_` so `ask-user` and `ask_user` match.
 */

/** DSH version this baseline was collected against. */
export const BASELINE_DSH_VERSION = '0.1.0-rc.6'

/** Official `@deepseek-ai/dsh-*` packages shipped with DeepSeek Harness. */
export const OFFICIAL_PACKAGES: readonly string[] = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/dsh-anonymous-user-id',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-bash-local',
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-code-runtime',
  '@deepseek-ai/dsh-compaction',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-fs',
  '@deepseek-ai/dsh-host-directory-picker',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-jobs',
  '@deepseek-ai/dsh-native-command',
  '@deepseek-ai/dsh-output-retention',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-session-persistence',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-session-telemetry',
  '@deepseek-ai/dsh-session-title-llm',
  '@deepseek-ai/dsh-shell',
  '@deepseek-ai/dsh-spill',
  '@deepseek-ai/dsh-subagent-in-process-driver',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-workflow',
]

/** Tool identifiers registered by the official core plugins (from official docs). */
const OFFICIAL_TOOLS_RAW: readonly string[] = [
  // file
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  // shell / code
  'bash',
  'pwsh',
  'run_code',
  'str_replace_editor',
  // network
  'web_search',
  'web_fetch',
  // collaboration
  'ask_user',
  'ask_user_question',
  'todo',
  'todo_write',
  'jobs',
  // agents / workflow
  'skill',
  'subagent',
  'workflow',
  'goal',
  'ralph',
  // runtime
  'cordis',
]

/** Normalize a tool name so `-` and `_` are equivalent and case is ignored. */
export function normalizeToolName(name: string): string {
  return name.replace(/[-_\s]/g, '_').toLowerCase()
}

/** Normalized set of official tool names. */
export const OFFICIAL_TOOL_NAMES: ReadonlySet<string> = new Set(
  OFFICIAL_TOOLS_RAW.map(normalizeToolName),
)

/** True when a package name belongs to the official `@deepseek-ai` scope. */
export function isOfficialPackage(name: string): boolean {
  return name.startsWith('@deepseek-ai/')
}

/** Normalized official tool names, exposed for callers that need the raw list. */
export function officialToolNames(): readonly string[] {
  return [...OFFICIAL_TOOL_NAMES].sort()
}
