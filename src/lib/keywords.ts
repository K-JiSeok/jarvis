/**
 * 키워드 공통 규칙 (서버·클라이언트 공용).
 * keywords.normalized_keyword 는 중복 판정 키이므로 생성 규칙을 여기 한 곳에 둔다.
 */

/** 소문자 + 앞뒤 공백 제거 + 연속 공백 1개 */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/** 화면에 표시할 키워드 원문 정리 (앞뒤 공백 제거 + 연속 공백 1개, 대소문자 유지) */
export function cleanKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ");
}

export const KEYWORD_MAX_LENGTH = 100;
