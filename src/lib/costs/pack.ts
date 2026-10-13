/** 공급 페이지 포장 문구 "30X20X30 cm" · "10*10*5cm" · "17.5 x 14.5 x 4 cm" → cm (모르면 null). mm 표기면 cm 로 */
export function parsePackageText(text: string | null | undefined): { l: number; w: number; h: number } | null {
  if (!text) return null;
  const m = text.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?)\s*(mm|cm)?/i);
  if (!m) return null;
  const k = m[4]?.toLowerCase() === "mm" ? 0.1 : 1;
  const [l, w, h] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * k * 100) / 100);
  return l > 0 && w > 0 && h > 0 ? { l, w, h } : null;
}
