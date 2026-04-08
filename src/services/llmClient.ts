/**
 * Barrel re-export for backward compatibility.
 * The LLM client is now split into:
 *   - llm/providers.ts  (HTTP implementations)
 *   - llm/routing.ts    (fallback chains, policy, experiments)
 *   - llm/client.ts     (entry points, cache, logging)
 */
export * from './llm/client';