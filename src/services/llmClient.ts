const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export type LlmProvider = 'openai' | 'gemini';

export type LlmTextRequest = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  provider?: LlmProvider;
  model?: string;
};

const getOpenAiKey = () => String(process.env.OPENAI_API_KEY || '').trim();
const getGeminiKey = () => String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

export const isAnyLlmConfigured = (): boolean => Boolean(getOpenAiKey() || getGeminiKey());

export const resolveLlmProvider = (): LlmProvider | null => {
  const preferred = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (preferred === 'gemini' && getGeminiKey()) {
    return 'gemini';
  }
  if (preferred === 'openai' && getOpenAiKey()) {
    return 'openai';
  }

  if (getOpenAiKey()) {
    return 'openai';
  }

  if (getGeminiKey()) {
    return 'gemini';
  }

  return null;
};

const requestOpenAi = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  }

  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: params.model || process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 1000,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OPENAI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  return String(data?.choices?.[0]?.message?.content || '').trim();
};

const requestGemini = async (params: LlmTextRequest): Promise<string> => {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
  }

  const model = params.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: params.system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: params.user }],
        },
      ],
      generationConfig: {
        temperature: params.temperature ?? 0.2,
        maxOutputTokens: params.maxTokens ?? 1000,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GEMINI_REQUEST_FAILED: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, any>;
  const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => String(part?.text || '')).join('\n') || '';
  return text.trim();
};

export const generateText = async (params: LlmTextRequest): Promise<string> => {
  const provider = params.provider || resolveLlmProvider();
  if (!provider) {
    throw new Error('LLM_PROVIDER_NOT_CONFIGURED');
  }

  if (provider === 'openai') {
    return requestOpenAi(params);
  }

  return requestGemini(params);
};
