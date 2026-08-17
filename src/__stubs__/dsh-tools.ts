/**
 * Test-only stub for `@deepseek-ai/dsh-tools`.
 *
 * `dsh-tools` declares a large peer dependency tree that only exists at
 * runtime inside a real DeepSeek Harness host. Vitest would need to resolve
 * that whole tree just to import `defineTool`, which is unnecessary for the
 * entry-point smoke test. This stub keeps the unit tests self-contained;
 * the real package is still used for types and for the production build.
 */
export function defineTool(definition: unknown): unknown {
  return definition
}
