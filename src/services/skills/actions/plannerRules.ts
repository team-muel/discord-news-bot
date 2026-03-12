import type { ActionPlan } from './types';

export const RAG_INTENT_REGEX = /(rag|근거|출처|기억|메모리|memory|회상|리콜|retrieve|retrieval|요약근거)/;
const YOUTUBE_WEBHOOK_INTENT_REGEX = /(웹훅|webhook|알림|전송|post|notify)/;

type QueryArgMode = 'goal' | 'none';

type RulePlanSpec = {
  actionName: string;
  reason: string;
  queryArg?: QueryArgMode;
};

type IntentRuleSpec = {
  id: string;
  pattern: RegExp;
  plans: RulePlanSpec[];
  conditionalPlans?: Array<{
    when: RegExp;
    plans: RulePlanSpec[];
  }>;
};

const pushUnique = (plans: ActionPlan[], next: ActionPlan) => {
  if (plans.some((plan) => plan.actionName === next.actionName)) {
    return;
  }
  plans.push(next);
};

const toArgs = (queryArg: QueryArgMode | undefined, goal: string): Record<string, unknown> => {
  if (queryArg === 'goal') {
    return { query: goal };
  }
  return {};
};

const buildPlansFromSpecs = (specs: RulePlanSpec[], goal: string): ActionPlan[] => {
  return specs.map((spec) => ({
    actionName: spec.actionName,
    args: toArgs(spec.queryArg, goal),
    reason: spec.reason,
  }));
};

const INTENT_RULE_SPECS: IntentRuleSpec[] = [
  {
    id: 'privacy-forget-user-intent',
    pattern: /(잊어|잊혀|forget|erase|삭제|지워|파기|개인정보|프라이버시|gdpr|탈퇴)/,
    plans: [{ actionName: 'privacy.forget.user', reason: 'privacy-forget-user-intent', queryArg: 'none' }],
  },
  {
    id: 'privacy-forget-guild-intent',
    pattern: /(길드|서버).*(삭제|파기|초기화|잊어)|guild.*(delete|remove|forget)|서버.*추방/,
    plans: [{ actionName: 'privacy.forget.guild', reason: 'privacy-forget-guild-intent', queryArg: 'none' }],
  },
  {
    id: 'rag-intent',
    pattern: RAG_INTENT_REGEX,
    plans: [{ actionName: 'rag.retrieve', reason: 'rag-intent', queryArg: 'goal' }],
  },
  {
    id: 'youtube-intent',
    pattern: /(youtube|유튜브)/,
    plans: [{ actionName: 'youtube.search.first', reason: 'youtube-intent', queryArg: 'goal' }],
    conditionalPlans: [
      {
        when: YOUTUBE_WEBHOOK_INTENT_REGEX,
        plans: [{ actionName: 'youtube.search.webhook', reason: 'youtube-webhook-intent', queryArg: 'goal' }],
      },
    ],
  },
  {
    id: 'chart-intent',
    pattern: /(차트|chart)/,
    plans: [{ actionName: 'stock.chart', reason: 'chart-intent', queryArg: 'none' }],
  },
  {
    id: 'quote-intent',
    pattern: /(주가|가격|quote)/,
    plans: [{ actionName: 'stock.quote', reason: 'quote-intent', queryArg: 'none' }],
  },
  {
    id: 'analysis-intent',
    pattern: /(분석|analysis)/,
    plans: [{ actionName: 'investment.analysis', reason: 'analysis-intent', queryArg: 'goal' }],
  },
  {
    id: 'news-intent',
    pattern: /(뉴스|news|헤드라인|기사)/,
    plans: [{ actionName: 'news.google.search', reason: 'news-intent', queryArg: 'goal' }],
  },
  {
    id: 'community-intent',
    pattern: /(커뮤니티|community|게시글|포럼|reddit|디시|클리앙|루리웹|블라인드)/,
    plans: [{ actionName: 'community.search', reason: 'community-intent', queryArg: 'goal' }],
  },
  {
    id: 'web-intent',
    pattern: /(웹\s*검색|웹검색|web\s*search|search|뉴스|자료\s*찾|기사|url|링크|http)/,
    plans: [{ actionName: 'web.fetch', reason: 'web-intent', queryArg: 'none' }],
  },
  {
    id: 'db-intent',
    pattern: /(db|database|데이터베이스|supabase|메모리\s*조회|기억\s*조회|lore)/,
    plans: [{ actionName: 'db.supabase.read', reason: 'db-intent', queryArg: 'none' }],
  },
];

export const buildFallbackPlan = (goal: string): ActionPlan[] => {
  const lower = goal.toLowerCase();
  const plans: ActionPlan[] = [];

  for (const rule of INTENT_RULE_SPECS) {
    if (!rule.pattern.test(lower)) {
      continue;
    }

    if (rule.conditionalPlans) {
      for (const conditional of rule.conditionalPlans) {
        if (!conditional.when.test(lower)) {
          continue;
        }
        for (const next of buildPlansFromSpecs(conditional.plans, goal)) {
          pushUnique(plans, next);
        }
      }
    }

    for (const next of buildPlansFromSpecs(rule.plans, goal)) {
      pushUnique(plans, next);
    }
  }

  return plans;
};
