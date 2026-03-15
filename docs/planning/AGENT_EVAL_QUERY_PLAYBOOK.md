# Agent Eval Query Playbook

목적: AgentBench/OSWorld/CA-style 지표를 현재 스키마에서 즉시 계산한다.

## 1) AgentBench-style (Task Success)

### 1.1 세션 성공률

```sql
select
  guild_id,
  count(*) as total,
  count(*) filter (where status = 'completed') as completed,
  round(count(*) filter (where status = 'completed')::numeric / nullif(count(*), 0), 4) as task_success_rate
from public.agent_sessions
where created_at >= now() - interval '14 days'
group by guild_id
order by task_success_rate desc nulls last;
```

### 1.2 첫 패스 성공률(재시도 추정)

```sql
select
  guild_id,
  round(
    count(*) filter (where retry_count = 0 and status = 'success')::numeric
    / nullif(count(*) filter (where status in ('success','failed')), 0),
    4
  ) as first_pass_success_rate
from public.agent_action_logs
where created_at >= now() - interval '14 days'
group by guild_id
order by first_pass_success_rate desc nulls last;
```

## 2) OSWorld-style (Efficiency)

### 2.1 성공까지 소요시간(P50/P95)

```sql
select
  guild_id,
  percentile_cont(0.50) within group (order by duration_ms) as p50_duration_ms,
  percentile_cont(0.95) within group (order by duration_ms) as p95_duration_ms
from public.agent_action_logs
where status = 'success'
  and created_at >= now() - interval '14 days'
group by guild_id
order by p95_duration_ms asc nulls last;
```

### 2.2 도구 단계 효율(요청당 액션 수)

```sql
with per_goal as (
  select
    guild_id,
    requested_by,
    goal,
    date_trunc('minute', created_at) as t_bucket,
    count(*) as action_steps
  from public.agent_action_logs
  where created_at >= now() - interval '14 days'
  group by guild_id, requested_by, goal, date_trunc('minute', created_at)
)
select
  guild_id,
  percentile_cont(0.50) within group (order by action_steps) as p50_tool_steps,
  percentile_cont(0.95) within group (order by action_steps) as p95_tool_steps
from per_goal
group by guild_id
order by p50_tool_steps asc nulls last;
```

## 3) CA-style (Safety/Security)

### 3.1 정책 우회/위험 허용률(리뷰 데이터 기반)

```sql
select
  guild_id,
  round(
    count(*) filter (where expected_decision in ('block','review') and decision = 'allow')::numeric
    / nullif(count(*) filter (where expected_decision is not null), 0),
    4
  ) as unsafe_allow_rate,
  round(
    count(*) filter (where expected_decision = 'block' and decision = 'block')::numeric
    / nullif(count(*) filter (where expected_decision = 'block'), 0),
    4
  ) as attack_block_rate
from public.agent_privacy_gate_samples
where created_at >= now() - interval '14 days'
group by guild_id
order by unsafe_allow_rate asc nulls last;
```

### 3.2 승인 강제 준수율

```sql
with req as (
  select guild_id, action_name, status, created_at
  from public.agent_action_approval_requests
  where created_at >= now() - interval '14 days'
), exec as (
  select guild_id, action_name, status, created_at
  from public.agent_action_logs
  where created_at >= now() - interval '14 days'
)
select
  r.guild_id,
  round(
    count(*) filter (where r.status = 'approved')::numeric
    / nullif(count(*), 0),
    4
  ) as approval_path_health,
  count(*) as approval_requests
from req r
group by r.guild_id
order by approval_path_health desc nulls last;
```

## 4) Composite Gate Snapshot

주간 Go/No-Go 판단은 다음 입력을 함께 본다.

1. task_success_rate
2. p95_duration_ms
3. unsafe_allow_rate
4. attack_block_rate
5. citation_rate / recall proxy
6. deadletter queue size

## 5) Operational Notes

1. 쿼리는 14일 윈도우를 기본으로 한다.
2. 지표 해석은 정량 단독이 아니라 운영자 정성 리뷰와 함께 수행한다.
3. p95, unsafe_allow_rate 악화 시 실험군을 즉시 baseline으로 롤백한다.

## 6) ToT Uplift (Promotion / Expected Gain / Sensitivity)

### 6.1 길드별 승격률 + 평균 개선폭 + 기대 이득

```sql
select
  guild_id,
  count(*) as total_pairs,
  round(avg(case when promoted then 1.0 else 0.0 end), 4) as promote_rate,
  round(avg(score_gain)::numeric, 4) as avg_gain_all,
  round(avg(score_gain) filter (where promoted)::numeric, 4) as avg_gain_promoted,
  round(
    avg(case when promoted then score_gain::numeric else 0 end),
    4
  ) as expected_lift_per_request
from public.agent_tot_candidate_pairs
where created_at >= now() - interval '14 days'
group by guild_id
order by expected_lift_per_request desc nulls last;
```

### 6.2 최근 7일 전체 기대 이득(운영 스냅샷)

```sql
with base as (
  select
    count(*)::numeric as n,
    coalesce(avg(case when promoted then 1.0 else 0.0 end), 0) as p_promote,
    coalesce(avg(score_gain) filter (where promoted), 0) as gain_promoted
  from public.agent_tot_candidate_pairs
  where created_at >= now() - interval '7 days'
)
select
  n as sample_size,
  round(p_promote::numeric, 4) as promote_rate,
  round(gain_promoted::numeric, 4) as avg_gain_promoted,
  round((p_promote * gain_promoted)::numeric, 4) as expected_lift
from base;
```

### 6.3 임계치 민감도(최소 score_gain 기준)

```sql
with thresholds as (
  select generate_series(0, 12, 1) as min_gain
), pairs as (
  select guild_id, score_gain
  from public.agent_tot_candidate_pairs
  where created_at >= now() - interval '14 days'
)
select
  p.guild_id,
  t.min_gain,
  count(*) as sample_size,
  round(avg(case when p.score_gain >= t.min_gain then 1.0 else 0.0 end), 4) as promote_rate_if_threshold,
  round(avg(p.score_gain) filter (where p.score_gain >= t.min_gain)::numeric, 4) as avg_gain_if_promoted,
  round(
    avg(case when p.score_gain >= t.min_gain then p.score_gain::numeric else 0 end),
    4
  ) as expected_lift_if_threshold
from pairs p
cross join thresholds t
group by p.guild_id, t.min_gain
order by p.guild_id, t.min_gain;
```

### 6.4 운영 적용 규칙(권장)

1. `expected_lift_if_threshold`가 최대가 되는 `min_gain`을 우선 후보로 잡는다.
2. 해당 임계치에서 `promote_rate_if_threshold`가 너무 낮아지면(예: < 0.10) 한 단계 완화한다.
3. 길드별 최종값을 `agent_tot_policies.active_min_score_gain`에 반영한다.

### 6.5 Beam 점수 기반 기대 이득 (Probability x Correctness)

```sql
select
  guild_id,
  count(*) as total_pairs,
  round(avg(case when promoted then 1.0 else 0.0 end), 4) as promote_rate,
  round(avg(beam_gain)::numeric, 4) as avg_beam_gain_all,
  round(avg(beam_gain) filter (where promoted)::numeric, 4) as avg_beam_gain_promoted,
  round(
    avg(case when promoted then beam_gain::numeric else 0 end),
    4
  ) as expected_beam_lift,
  round(avg(candidate_beam_score) filter (where promoted)::numeric, 4) as avg_promoted_candidate_beam_score
from public.agent_tot_candidate_pairs
where created_at >= now() - interval '14 days'
group by guild_id
order by expected_beam_lift desc nulls last;
```

### 6.6 Probability Source 품질 비교 (provider_logprob vs self_eval/fallback)

```sql
select
  guild_id,
  coalesce(candidate_probability_source, 'unknown') as probability_source,
  count(*) as total_pairs,
  round(avg(case when promoted then 1.0 else 0.0 end), 4) as promote_rate,
  round(avg(score_gain)::numeric, 4) as avg_score_gain,
  round(avg(beam_gain)::numeric, 4) as avg_beam_gain
from public.agent_tot_candidate_pairs
where created_at >= now() - interval '14 days'
group by guild_id, coalesce(candidate_probability_source, 'unknown')
order by guild_id, probability_source;
```
