export const RETRIEVAL_VARIANT_KEYS = Object.freeze([
  'baseline',
  'graph_lore',
  'intent_prefix',
  'keyword_expansion',
]);

export const RETRIEVAL_NON_BASELINE_VARIANTS = Object.freeze(
  RETRIEVAL_VARIANT_KEYS.filter((variant) => variant !== 'baseline'),
);

const RETRIEVAL_VARIANT_SET = new Set(RETRIEVAL_VARIANT_KEYS);

export const isRetrievalVariant = (value) => RETRIEVAL_VARIANT_SET.has(String(value || '').trim());
