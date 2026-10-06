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
