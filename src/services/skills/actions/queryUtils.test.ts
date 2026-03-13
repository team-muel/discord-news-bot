import { describe, it, expect } from 'vitest';
import { extractQuery, extractFirstUrl, compactText, stripGoalNoise } from './queryUtils';

describe('compactText', () => {
  it('여러 공백을 하나로 합친다', () => {
    expect(compactText('hello   world\n\nfoo')).toBe('hello world foo');
  });

  it('비문자열 값을 빈 문자열로 처리한다', () => {
    expect(compactText(null)).toBe('');
    expect(compactText(undefined)).toBe('');
  });
});

describe('stripGoalNoise', () => {
  it('세션 스킬 노이즈를 제거한다', () => {
    // 노이즈와 실제 요청을 다른 줄로 분리
    const out = stripGoalNoise('세션 스킬 실행:news.search\n애플 주가');
    expect(out).not.toContain('세션 스킬 실행');
    expect(out).toContain('애플 주가');
  });
});

describe('extractFirstUrl', () => {
  it('goal에서 첫 URL을 추출한다', () => {
    expect(extractFirstUrl('https://example.com 조회해줘')).toBe('https://example.com');
  });

  it('args.url이 우선한다', () => {
    const url = extractFirstUrl('blah', { url: 'https://args.example.com' });
    expect(url).toBe('https://args.example.com');
  });

  it('URL이 없으면 빈 문자열을 반환한다', () => {
    expect(extractFirstUrl('URL 없는 텍스트')).toBe('');
  });
});

describe('extractQuery', () => {
  it('goal에서 필터를 적용해 쿼리를 추출한다', () => {
    const result = extractQuery({
      goal: '뉴스 검색해줘 삼성전자',
      defaultQuery: '기본',
      removePatterns: [/뉴스|검색해줘/gi],
    });
    expect(result).toContain('삼성전자');
    expect(result).not.toContain('뉴스');
  });

  it('빈 결과일 때 defaultQuery를 반환한다', () => {
    const result = extractQuery({
      goal: '',
      defaultQuery: '기본값',
    });
    expect(result).toBe('기본값');
  });
});
