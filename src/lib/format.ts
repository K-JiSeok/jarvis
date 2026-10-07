const krw = new Intl.NumberFormat("ko-KR");

/** 12,300원 */
export function formatWon(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${krw.format(Math.round(value))}원`;
}

/** 1,234 */
export function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return krw.format(Math.round(value));
}

/** 0.243 → 24.3% */
export function formatPercent(
  ratio: number | null | undefined,
  digits = 1,
): string {
  if (ratio == null) return "-";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 0.12 → +12.0% */
export function formatSignedPercent(ratio: number | null | undefined): string {
  if (ratio == null) return "-";
  const sign = ratio > 0 ? "+" : "";
  return `${sign}${(ratio * 100).toFixed(1)}%`;
}

/** 0.6667 → 0.67 (경쟁강도 등 비율이 아닌 소수) */
export function formatDecimal(value: number | null | undefined, digits = 2): string {
  if (value == null) return "-";
  return krw.format(Number(value.toFixed(digits)));
}

/** 2026-10-07 → 10.07 (같은 해) / 2025.10.07 */
export function formatShortDate(date: string | null | undefined): string {
  if (!date) return "-";
  const [y, m, d] = date.slice(0, 10).split("-");
  const thisYear = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date());
  return y === thisYear ? `${m}.${d}` : `${y}.${m}.${d}`;
}
