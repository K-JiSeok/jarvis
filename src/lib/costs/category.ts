/**
 * 카테고리 추정 (PHASE 20) — 쿠팡 상품 페이지의 노출 카테고리 경로 · 상품명으로 판매 수수료 대분류 · WING 비용 분류를 '추정'만 한다.
 * 노출 카테고리(예: "결혼준비 > 주방용품 > 테이블웨어")는 판매자 등록 카테고리와 다를 수 있어 추정값은 확인 비용 계산에 쓰지 않는다.
 * 사용자가 상품별 비용 입력에서 확인해야 확정 (product_cost_inputs.category_confirmed).
 */

export const SALES_SCOPES = [
  "가전디지털", "가구/홈인테리어", "도서", "음반", "문구/사무용품", "출산/유아", "스포츠/레저용품", "뷰티",
  "생활용품", "식품", "완구/취미", "자동차용품", "주방용품", "패션", "반려/애완용품",
] as const;

/** 노출 카테고리 대분류 → 판매 수수료 대분류 (이름이 같거나 분명한 것만) */
const SCOPE_ALIASES: Record<string, (typeof SALES_SCOPES)[number]> = {
  주방용품: "주방용품",
  생활용품: "생활용품",
  "가구/홈데코": "가구/홈인테리어",
  "홈인테리어": "가구/홈인테리어",
  "가전디지털": "가전디지털",
  "뷰티": "뷰티",
  "식품": "식품",
  "완구/취미": "완구/취미",
  "출산/유아동": "출산/유아",
  "스포츠/레저": "스포츠/레저용품",
  "자동차용품": "자동차용품",
  "반려동물용품": "반려/애완용품",
  "문구/오피스": "문구/사무용품",
  "도서": "도서",
};

/** WING 입출고/배송 비용 분류 (요율표가 있는 것만). 키워드는 노출 경로 · 상품명 기준 */
const FEE_GROUP_RULES: { group: string; scope: string; words: RegExp }[] = [
  { group: "주방 > 밀폐저장용기", scope: "주방용품", words: /얼음틀|아이스\s*트레이|아이스트레이|큐브\s*트레이|밀폐|보관용기|저장용기/ },
  { group: "주방 > 테이블웨어", scope: "주방용품", words: /테이블웨어|쟁반|트레이|식탁보|테이블\s*매트|식탁매트|플레이스\s*매트/ },
];

export interface CategoryGuess {
  salesScope: string | null;
  feeGroup: string | null;
  basis: string;
}

export function guessCategory(productName: string, coupangPath: string | null): CategoryGuess {
  const segs = (coupangPath ?? "").split(">").map((s) => s.trim()).filter(Boolean);
  const scopeSeg = segs.find((s) => SCOPE_ALIASES[s]);
  const salesScope = scopeSeg ? SCOPE_ALIASES[scopeSeg] : null;
  // 경로에 있는 단어를 상품명보다 먼저 본다 (경로가 더 구체적)
  const rule = FEE_GROUP_RULES.find((r) => r.words.test(coupangPath ?? "")) ?? FEE_GROUP_RULES.find((r) => r.words.test(productName));
  const feeGroup = rule && (!salesScope || salesScope === rule.scope) ? rule.group : null;
  const parts = [
    coupangPath ? `노출 카테고리 "${coupangPath}"` : "노출 카테고리 없음",
    salesScope ? `→ 수수료 대분류 ${salesScope}` : feeGroup ? `→ 수수료 대분류 ${rule!.scope} (비용 분류에서 추정)` : "→ 수수료 대분류 판단 불가",
    feeGroup ? `→ 비용 분류 ${feeGroup} (${rule!.words.test(coupangPath ?? "") ? "경로" : "상품명"} 단어 기준)` : "→ 비용 분류 판단 불가",
  ];
  return { salesScope: salesScope ?? (feeGroup ? rule!.scope : null), feeGroup, basis: `${parts.join(" ")} — 추정, 판매자 등록 카테고리 확인 필요` };
}
