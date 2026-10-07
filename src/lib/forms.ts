/**
 * Server Function 폼 처리 공통 규칙 (키워드·상품·관심상품).
 * 빈 칸 = 모름(null). 0 은 0 으로 받는다.
 */

export interface FormState {
  ok: boolean;
  message: string | null;
  /** 예: 중복일 때 기존 항목으로 가는 링크 */
  link?: { href: string; label: string };
}

export const INITIAL_FORM_STATE: FormState = { ok: false, message: null };

export class FormError extends Error {}

export function fail(message: string, link?: FormState["link"]): FormState {
  return { ok: false, message, link };
}

export interface NumberRule {
  label: string;
  min?: number;
  max?: number;
  integer?: boolean;
  /** 화면에서 % 로 받고 0~1 로 저장 */
  percent?: boolean;
}

/** 숫자 칸 읽기. 빈 칸이면 null, 잘못된 값이면 오류 문구(string) */
export function readNumber(formData: FormData, name: string, rule: NumberRule): number | null | string {
  const raw = String(formData.get(name) ?? "").replace(/,/g, "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${rule.label}: 숫자를 입력하세요.`;
  if (rule.integer && !Number.isInteger(n)) return `${rule.label}: 정수로 입력하세요.`;
  const unit = rule.percent ? "%" : "";
  if (rule.min !== undefined && n < rule.min) return `${rule.label}: ${rule.min}${unit} 이상이어야 합니다.`;
  if (rule.max !== undefined && n > rule.max) return `${rule.label}: ${rule.max}${unit} 이하여야 합니다.`;
  return rule.percent ? round4(n / 100) : n;
}

/** 여러 숫자 칸을 한 번에 읽고, 오류 문구와 값(입력된 것만)을 나눠 돌려준다 */
export function readNumbers<K extends string>(
  formData: FormData,
  rules: Record<K, NumberRule>,
): { values: Partial<Record<K, number>>; errors: string[] } {
  const values: Partial<Record<K, number>> = {};
  const errors: string[] = [];
  for (const [name, rule] of Object.entries(rules) as [K, NumberRule][]) {
    const v = readNumber(formData, name, rule);
    if (typeof v === "string") errors.push(v);
    else if (v !== null) values[name] = v;
  }
  return { values, errors };
}

/** 텍스트 칸: 앞뒤 공백 제거, 연속 공백 1개, 빈 칸은 null */
export function readText(formData: FormData, name: string, maxLength: number): string | null {
  const value = String(formData.get(name) ?? "").trim().replace(/\s+/g, " ");
  if (!value) return null;
  if (value.length > maxLength) throw new FormError(`${maxLength}자 이하로 입력하세요.`);
  return value;
}

/** 목록 중 하나 또는 빈 칸(null) */
export function readChoice<T extends string>(formData: FormData, name: string, allowed: readonly T[]): T | null {
  const value = String(formData.get(name) ?? "");
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** 수집일 (KST, 미래 불가) */
export function readCapturedOn(formData: FormData): string | { error: string } {
  const capturedOn = String(formData.get("captured_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(capturedOn)) return { error: "수집일을 입력하세요." };
  if (capturedOn > todayKst()) return { error: "수집일은 오늘(KST) 이후일 수 없습니다." };
  return capturedOn;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function isPgError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === code;
}

export function dbErrorMessage(error: unknown): string {
  if (error instanceof FormError) return error.message;
  if (isPgError(error, "23514")) return "허용 범위를 벗어난 값이 있습니다.";
  if (isPgError(error, "23503")) return "연결 대상(카테고리·키워드·상품)을 찾을 수 없습니다.";
  if (isPgError(error, "42501")) return "권한이 없습니다. 다시 로그인하세요.";
  if (isPgError(error, "P0001")) return "수정할 수 없는 기록입니다.";
  return error instanceof Error ? error.message : "저장에 실패했습니다.";
}
