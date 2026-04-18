import type {
  ApiError,
  AuthMeResponse,
  FredPlaygroundResponse,
  FredRange,
  HealthResponse,
  QuantPanelResponse,
  ResearchPresetHistoryResponse,
  ResearchPresetKey,
  ResearchPresetResponse,
} from './api.types';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestOptions = {
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
};

const trimSlash = (value: string) => value.replace(/\/+$/, '');

const buildUrl = (baseUrl: string, path: string, params?: URLSearchParams) => {
  const query = params?.toString();
  return `${trimSlash(baseUrl)}${path}${query ? `?${query}` : ''}`;
};

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : await response.text().catch(() => '');

  if (!response.ok) {
    const apiError: ApiError = {
      status: response.status,
      error: typeof (payload as { error?: unknown })?.error === 'string'
        ? String((payload as { error?: string }).error)
        : 'HTTP_ERROR',
      message: typeof (payload as { message?: unknown })?.message === 'string'
        ? String((payload as { message?: string }).message)
        : undefined,
      raw: payload,
    };
    throw apiError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return payload as T;
}

export function createMuelApiClient(baseUrl: string) {
  const request = async <T>(path: string, options: RequestOptions = {}, params?: URLSearchParams): Promise<T> => {
    const response = await fetch(buildUrl(baseUrl, path, params), {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });

    return parseResponse<T>(response);
  };

  return {
    getHealth(signal?: AbortSignal) {
      return request<HealthResponse>('/health', { signal });
    },

    getApiStatus(signal?: AbortSignal) {
      return request<{ status: string; now: string }>('/api/status', { signal });
    },

    getAuthLoginUrl(signal?: AbortSignal) {
      return request<{ authorizeUrl: string }>('/api/auth/login', { signal }, new URLSearchParams({ mode: 'json' }));
    },

    getMe(signal?: AbortSignal) {
      return request<AuthMeResponse>('/api/auth/me', { signal });
    },

    devAuthSdk(code: string, signal?: AbortSignal) {
      return request<{ ok: true; user: { id: string; username: string; avatar: string | null } }>(
        '/api/auth/sdk',
        { method: 'POST', body: { code }, signal },
      );
    },

    logout(signal?: AbortSignal) {
      return request<void>('/api/auth/logout', { method: 'POST', signal });
    },

    getQuantPanel(signal?: AbortSignal) {
      return request<QuantPanelResponse>('/api/quant/panel', { signal });
    },

    getFredPlayground(ids: string[], range: FredRange, signal?: AbortSignal) {
      const params = new URLSearchParams({
        ids: ids.join(','),
        range,
      });
      return request<FredPlaygroundResponse>('/api/fred/playground', { signal }, params);
    },

    getBotStatus(signal?: AbortSignal) {
      return request<Record<string, unknown>>('/api/bot/status', { signal });
    },

    reconnectBot(reason = 'front-uiux', signal?: AbortSignal) {
      return request<{ ok: boolean; message: string }>(
        '/api/bot/reconnect',
        { method: 'POST', body: { reason }, signal },
      );
    },

    runAutomationJob(jobName: 'news-analysis' | 'youtube-monitor', signal?: AbortSignal) {
      return request<{ ok: boolean; message: string }>(`/api/bot/automation/${jobName}/run`, { method: 'POST', signal });
    },

    getResearchPreset(presetKey: ResearchPresetKey, signal?: AbortSignal) {
      return request<ResearchPresetResponse>(`/api/research/preset/${presetKey}`, { signal });
    },

    getResearchPresetHistory(presetKey: ResearchPresetKey, limit = 20, signal?: AbortSignal) {
      return request<ResearchPresetHistoryResponse>(
        `/api/research/preset/${presetKey}/history`,
        { signal },
        new URLSearchParams({ limit: String(limit) }),
      );
    },
  };
}
