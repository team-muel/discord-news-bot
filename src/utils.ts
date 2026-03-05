const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 10000);
const IMAGE_FETCH_MAX_BYTES = Number(process.env.IMAGE_FETCH_MAX_BYTES || 8000000);

export function validateYouTubeUrl(url: string): { valid: boolean; message?: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const allowed = host.includes('youtube.com') || host.includes('youtu.be');
    if (!allowed) {
      return { valid: false, message: 'YouTube URL만 허용됩니다.' };
    }
    return { valid: true };
  } catch {
    return { valid: false, message: '유효한 URL 형식이 아닙니다.' };
  }
}

export async function imageUrlToBase64(imageUrl: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Math.max(3000, IMAGE_FETCH_TIMEOUT_MS));

  try {
    const imgRes = await fetch(imageUrl, {
      signal: controller.signal,
    });
    if (!imgRes.ok) return undefined;

    const contentLengthRaw = imgRes.headers.get('content-length');
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN;
    if (Number.isFinite(contentLength) && contentLength > IMAGE_FETCH_MAX_BYTES) {
      return undefined;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    if (arrayBuffer.byteLength > IMAGE_FETCH_MAX_BYTES) {
      return undefined;
    }

    const buffer = Buffer.from(arrayBuffer);
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...\n(내용이 너무 길어 생략되었습니다)';
}

export function getSafeErrorMessage(error: unknown, context: string): string {
  const fullMsg = error instanceof Error ? error.message : String(error);
  console.error(`[${context}] Error detail:`, fullMsg);

  const lowerMsg = fullMsg.toLowerCase();
  if (lowerMsg.includes('supabase') || lowerMsg.includes('postgres') || lowerMsg.includes('database')) {
    return '데이터 작업 중 오류가 발생했습니다.';
  }
  if (lowerMsg.includes('fetch') || lowerMsg.includes('network') || lowerMsg.includes('timeout')) {
    return '외부 서비스 연결 중 오류가 발생했습니다.';
  }
  if (lowerMsg.includes('discord') || lowerMsg.includes('token')) {
    return 'Discord 연동 중 오류가 발생했습니다.';
  }
  if (lowerMsg.includes('youtube') || lowerMsg.includes('scrape')) {
    return 'YouTube 정보를 가져올 수 없습니다. URL을 확인하세요.';
  }
  return '작업 처리 중 오류가 발생했습니다.';
}

export const MAX_SOURCES_PER_GUILD = 4;
export const DEFAULT_PAGE_LIMIT = 10;
export const MAX_LOGS_DISPLAY = 50;
