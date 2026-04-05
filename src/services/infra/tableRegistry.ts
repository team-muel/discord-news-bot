/**
 * Centralized table name registry.
 *
 * All Supabase table names must be defined here. Service code should
 * import from this file instead of using string literals. This:
 *   - Prevents typos (compile-time catch via const)
 *   - Makes schema rename/migration a single-file change
 *   - Enables grep-free impact analysis
 *
 * Convention: group by domain with comments matching the Supabase schema.
 */

// ── Discord & Users ─────────────────────────────────────────────────────────

export const T_USERS = 'users' as const;
export const T_USER_PROFILES = 'user_profiles' as const;
export const T_GUILD_MEMBERSHIPS = 'guild_memberships' as const;
export const T_DISCORD_LOGIN_SESSIONS = 'discord_login_sessions' as const;
export const T_GUILD_CHANNEL_ROUTING = 'guild_channel_routing' as const;

// ── Sources & News ──────────────────────────────────────────────────────────

export const T_SOURCES = 'sources' as const;
export const T_NEWS_SENTIMENT = 'news_sentiment' as const;
export const T_NEWS_CAPTURE_FINGERPRINTS = 'news_capture_fingerprints' as const;

// ── Memory ──────────────────────────────────────────────────────────────────

export const T_MEMORY_ITEMS = 'memory_items' as const;
export const T_MEMORY_SOURCES = 'memory_sources' as const;
export const T_MEMORY_JOBS = 'memory_jobs' as const;
export const T_MEMORY_JOB_DEADLETTERS = 'memory_job_deadletters' as const;
export const T_MEMORY_FEEDBACK = 'memory_feedback' as const;
export const T_MEMORY_CONFLICTS = 'memory_conflicts' as const;
export const T_MEMORY_RETRIEVAL_LOGS = 'memory_retrieval_logs' as const;
export const T_MEMORY_ITEM_LINKS = 'memory_item_links' as const;
export const T_USER_EMBEDDINGS = 'user_embeddings' as const;

// ── Agent Sessions & Steps ──────────────────────────────────────────────────

export const T_AGENT_SESSIONS = 'agent_sessions' as const;
export const T_AGENT_STEPS = 'agent_steps' as const;
export const T_AGENT_ACTION_LOGS = 'agent_action_logs' as const;
export const T_AGENT_CONVERSATION_THREADS = 'agent_conversation_threads' as const;
export const T_AGENT_CONVERSATION_TURNS = 'agent_conversation_turns' as const;
export const T_AGENT_LLM_CALL_LOGS = 'agent_llm_call_logs' as const;
export const T_AGENT_ANSWER_QUALITY_REVIEWS = 'agent_answer_quality_reviews' as const;
export const T_AGENT_SEMANTIC_ANSWER_CACHE = 'agent_semantic_answer_cache' as const;

// ── Agent GOT (Graph of Thought) ────────────────────────────────────────────

export const T_AGENT_GOT_RUNS = 'agent_got_runs' as const;
export const T_AGENT_GOT_NODES = 'agent_got_nodes' as const;
export const T_AGENT_GOT_EDGES = 'agent_got_edges' as const;
export const T_AGENT_GOT_SELECTION_EVENTS = 'agent_got_selection_events' as const;
export const T_AGENT_GOT_CUTOVER_PROFILES = 'agent_got_cutover_profiles' as const;

// ── Agent Policies & Config ─────────────────────────────────────────────────

export const T_AGENT_RUNTIME_POLICIES = 'agent_runtime_policies' as const;
export const T_AGENT_PRIVACY_POLICIES = 'agent_privacy_policies' as const;
export const T_AGENT_PRIVACY_GATE_SAMPLES = 'agent_privacy_gate_samples' as const;
export const T_AGENT_TOT_POLICIES = 'agent_tot_policies' as const;
export const T_AGENT_TOT_CANDIDATE_PAIRS = 'agent_tot_candidate_pairs' as const;
export const T_AGENT_WORKFLOW_PROFILES = 'agent_workflow_profiles' as const;
export const T_AGENT_ACTION_APPROVAL_REQUESTS = 'agent_action_approval_requests' as const;

// ── Agent Learning ──────────────────────────────────────────────────────────

export const T_AGENT_TOOL_LEARNING_CANDIDATES = 'agent_tool_learning_candidates' as const;
export const T_AGENT_TOOL_LEARNING_RULES = 'agent_tool_learning_rules' as const;
export const T_AGENT_WEEKLY_REPORTS = 'agent_weekly_reports' as const;

// ── Evaluation ──────────────────────────────────────────────────────────────

export const T_RETRIEVAL_EVAL_RUNS = 'retrieval_eval_runs' as const;
export const T_RETRIEVAL_EVAL_SETS = 'retrieval_eval_sets' as const;
export const T_RETRIEVAL_EVAL_CASES = 'retrieval_eval_cases' as const;
export const T_RETRIEVAL_EVAL_TARGETS = 'retrieval_eval_targets' as const;
export const T_RETRIEVAL_EVAL_RESULTS = 'retrieval_eval_results' as const;
export const T_RETRIEVAL_RANKER_EXPERIMENTS = 'retrieval_ranker_experiments' as const;
export const T_RETRIEVAL_RANKER_ACTIVE_PROFILES = 'retrieval_ranker_active_profiles' as const;
export const T_EVAL_AB_RUNS = 'eval_ab_runs' as const;
export const T_REWARD_SIGNAL_SNAPSHOTS = 'reward_signal_snapshots' as const;

// ── Community ───────────────────────────────────────────────────────────────

export const T_USER_ACTIVITY = 'user_activity' as const;

export const T_COMMUNITY_ACTOR_PROFILES = 'community_actor_profiles' as const;
export const T_COMMUNITY_INTERACTION_EVENTS = 'community_interaction_events' as const;
export const T_COMMUNITY_RELATIONSHIP_EDGES = 'community_relationship_edges' as const;

// ── Obsidian ────────────────────────────────────────────────────────────────

export const T_OBSIDIAN_CACHE = 'obsidian_cache' as const;
export const T_GUILD_LORE_DOCS = 'guild_lore_docs' as const;

// ── Operations ──────────────────────────────────────────────────────────────

export const T_SCHEMA_MIGRATIONS = 'schema_migrations' as const;
export const T_DISTRIBUTED_LOCKS = 'distributed_locks' as const;
export const T_OBSERVATIONS = 'observations' as const;
export const T_ENTITY_SELF_NOTES = 'entity_self_notes' as const;
export const T_SHADOW_GRAPH_DIVERGENCE_LOGS = 'shadow_graph_divergence_logs' as const;

// ── Sprint ──────────────────────────────────────────────────────────────────

export const T_SPRINT_PIPELINES = 'sprint_pipelines' as const;
export const T_SPRINT_LEARNING_JOURNAL = 'sprint_learning_journal' as const;

// ── Worker Generation ───────────────────────────────────────────────────────

export const T_WORKER_APPROVAL_REQUESTS = 'worker_approval_requests' as const;

// ── Workflow ────────────────────────────────────────────────────────────────

export const T_WORKFLOW_RUNS = 'workflow_runs' as const;
export const T_TRAFFIC_ROUTING_RULES = 'traffic_routing_rules' as const;

// ── FinOps ──────────────────────────────────────────────────────────────────

export const T_FINOPS_COST_EVENTS = 'finops_cost_events' as const;
export const T_FINOPS_BUDGETS = 'finops_budgets' as const;

// ── Task Routing ────────────────────────────────────────────────────────────

export const T_TASK_ROUTING_DECISIONS = 'task_routing_decisions' as const;
export const T_TASK_ROUTING_FEEDBACK = 'task_routing_feedback' as const;

// ── Rate Limiting ───────────────────────────────────────────────────────────

export const T_RATE_LIMIT_BUCKETS = 'rate_limit_buckets' as const;

// ── Idempotency ─────────────────────────────────────────────────────────────

export const T_IDEMPOTENCY_KEYS = 'idempotency_keys' as const;

// ── Go/No-Go ────────────────────────────────────────────────────────────────

export const T_GO_NOGO_DECISIONS = 'go_nogo_decisions' as const;

// ── Structured Error Logs ───────────────────────────────────────────────────

export const T_STRUCTURED_ERROR_LOGS = 'structured_error_logs' as const;

// ── LLM Experiment Analytics ────────────────────────────────────────────────

export const T_LLM_EXPERIMENT_VARIANTS = 'llm_experiment_variants' as const;
export const T_LLM_EXPERIMENT_RESULTS = 'llm_experiment_results' as const;
