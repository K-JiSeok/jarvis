/**
 * 판매 가능성 사전 검토 (순수 함수, PHASE 17 · compliance-rules-v2). V1 점수와 별도.
 *
 * v2 (PHASE 28): 전기 · 배터리 단어 보강 (무선 · 청소기 · 가습기 · 랜턴 …), 전파법 적합성평가 규칙 추가.
 *   10-28 실제 데이터에서 차량용청소기 30개 중 1개만 인증 필요로 잡힌 문제를 고쳤다.
 *
 * 법률 판단 · 쿠팡 판매 승인이 아니다. 상품명 · 카테고리 · 브랜드 정보로 "확인이 필요한 규정의 가능성"을 표시하는 사전 선별이다.
 *
 * 원칙
 *   - 자동 판단은 BLOCKED(판매 금지 확정) · CLEARED(확인 완료)를 만들지 않는다. 둘 다 사용자가 근거를 보고 정한다 (DB CHECK 도 같음).
 *   - 단어 하나로 판매 금지를 확정하지 않는다. 판매 제한 가능 단어는 MANUAL_REVIEW(확인 필요)로만 표시한다.
 *   - 모든 상품에 같은 인증이 필요하다고 보지 않는다. 품목 규칙에 걸릴 때만 그 규정을 적는다. 아무 규칙에도 안 걸리면
 *     "해당 없음"이 아니라 UNKNOWN(근거 부족) — 공급처 · 실제 제품 사양을 모르기 때문이다.
 *   - 브랜드 상품이라고 제외하지 않는다. 브랜드를 알면 정품 · 공급 경로 증빙이 필요하다고 표시한다.
 *   - 공급 가능성: 공급처 데이터 출처가 연결돼 있지 않으므로 항상 UNKNOWN (공급 가능으로 확정하지 않음).
 */

export const COMPLIANCE_RULE_VERSION = "compliance-rules-v2";

export const COMPLIANCE_STATUSES = ["BLOCKED", "REQUIRES_CERTIFICATION", "REQUIRES_BRAND_PROOF", "MANUAL_REVIEW", "CLEARED", "UNKNOWN"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const COMPLIANCE_LABELS: Record<ComplianceStatus, string> = {
  BLOCKED: "판매 불가 (사용자 확인)",
  REQUIRES_CERTIFICATION: "인증 · 허가 · 신고 확인 필요",
  REQUIRES_BRAND_PROOF: "브랜드 · 정품 증빙 필요",
  MANUAL_REVIEW: "추가 확인 필요",
  CLEARED: "확인 완료 (사용자)",
  UNKNOWN: "판단 근거 부족",
};

export type ComplianceArea = "PROHIBITED" | "CERTIFICATION" | "BRAND" | "SUPPLY";

export const AREA_LABELS: Record<ComplianceArea, string> = {
  PROHIBITED: "판매 금지 · 제한",
  CERTIFICATION: "인증 · 허가 · 신고",
  BRAND: "브랜드 · 정품 증빙",
  SUPPLY: "공급 가능성",
};

export interface ComplianceFinding {
  area: ComplianceArea;
  status: ComplianceStatus;
  /** 규칙 id (rule_version 안에서 고유) */
  rule: string;
  /** 무엇을 보고 판단했는가 (상품명 · 카테고리의 어떤 단어) */
  evidence: string;
  /** 확인해야 할 규정 · 정책 (법령명 · 공식 문서) */
  source: string;
  /** 사용자가 할 일 */
  action: string;
  checkedAt: string;
  method: "AUTO" | "USER";
}

export interface ComplianceInput {
  productName: string;
  brand: string | null;
  /** 상품 페이지에서 읽은 카테고리 경로 (모르면 null) */
  category: string | null;
}

interface Rule {
  id: string;
  /** 짧은 이름 (판정 위험 문구에 쓴다) */
  label: string;
  area: ComplianceArea;
  status: ComplianceStatus;
  /** 상품명 · 카테고리(공백 제거)에서 찾는 단어 — 이것만으로 규칙 적용 */
  terms: string[];
  /** 여러 용도로 쓰이는 단어 (트레이 · 몰드 …) — with 의 문맥 단어가 함께 있고 unless 가 없을 때만 적용 */
  weakTerms?: string[];
  with?: string[];
  unless?: string[];
  source: string;
  action: string;
}

const LAW = (name: string) => `${name} (국가법령정보센터 law.go.kr)`;

/** 품목별 규정 가능성 (가능성만 — 실제 적용 여부는 제품 재질 · 용도 · 수입 여부에 따라 다르다) */
export const RULES: Rule[] = [
  {
    id: "food-contact",
    label: "식품용 기구 · 용기",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["얼음틀", "얼음트레이", "아이스트레이", "이유식", "밀폐용기", "소분용기", "반찬통", "도마", "식판", "텀블러", "물병", "접시", "그릇", "수저", "젓가락", "냄비", "프라이팬", "베이킹", "조리도구", "푸드블럭"],
    weakTerms: ["트레이", "플레이트", "큐브", "몰드", "용기", "블럭"],
    with: ["실리콘", "식품", "냉동", "소분", "얼음", "조리", "푸드", "쟁반", "주방용품>"],
    // 식품이 아니라 물기 · 소품을 받치는 용도 (식기건조대 · 욕실 · 사무용)
    unless: ["건조대", "물빠짐", "세면대", "욕실", "드라잉매트", "펜트레이", "악세서리", "오피스"],
    source: `${LAW("식품위생법")} 기구 · 용기 · 포장 기준 및 "식품용" 표시 / ${LAW("수입식품안전관리 특별법")} 수입신고`,
    action: "식품에 닿는 용도인지 확인 → 수입이면 수입신고 · 시험성적서, 국내 매입이면 제조 · 수입사의 기준 적합 서류 확보",
  },
  {
    id: "children-product",
    label: "어린이제품 KC",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["유아", "아기", "아동", "어린이", "키즈", "베이비", "신생아", "이유식"],
    source: `${LAW("어린이제품 안전 특별법")} 안전인증 · 안전확인 · 공급자적합성확인 (KC)`,
    action: "만 13세 이하 대상 제품인지 확인 → 해당 KC 인증 번호 · 공급자적합성 서류 확보",
  },
  {
    id: "electric",
    label: "전기용품 KC",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: [
      "충전", "전기", "전동", "usb", "어댑터", "배터리", "건전지", "히터", "램프", "led", "선풍기", "써큘레이터", "드라이기", "멀티탭",
      // v2: 전원이 들어가는 생활가전 · 소형 기기 (상품명에 "충전 · 전기"가 없어도 대부분 전기용품)
      "무선", "청소기", "가습기", "제습기", "공기청정기", "에어건", "송풍기", "랜턴", "손난로", "온열", "전기요", "온수매트", "믹서", "블렌더", "커피머신", "전기포트", "커피포트", "토스터", "에어프라이어", "면도기", "고데기", "안마기", "마사지기", "조명", "무드등",
    ],
    // 전기가 아닌 같은 단어 (손으로 쓰는 청소 도구 · 장식용)
    unless: ["청소솔", "청소포", "밀대", "먼지떨이", "조명커버", "랜턴걸이", "랜턴고리", "전자레인지용"],
    source: `${LAW("전기용품 및 생활용품 안전관리법")} 안전인증 · 안전확인 · 공급자적합성확인 (KC)`,
    action: "전원 · 배터리 · 충전부가 있는지 확인 → KC 인증 번호 확보 (수입이면 수입자 명의 인증 · 비용과 기간 확인)",
  },
  {
    id: "radio",
    label: "전파법 적합성평가",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["블루투스", "bluetooth", "무선이어폰", "이어버드", "와이파이", "wifi", "리모컨", "무선충전", "무전기", "드론", "스마트워치", "스마트밴드", "무선마우스", "무선키보드", "무선스피커", "gps", "rc카", "카메라"],
    source: `${LAW("전파법")} 제58조의2 방송통신기자재등의 적합성평가 (국립전파연구원 KC)`,
    action: "무선 · 전자파 기기인지 확인 → 적합성평가(KC 전파) 인증 번호 확보. 미인증 수입 판매는 불법",
  },
  {
    id: "cosmetics",
    label: "화장품 책임판매",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    // "크림" 단독은 색상 이름(크림 · 크림베이지)과 겹쳐 쓰지 않는다
    terms: ["화장품", "로션", "세럼", "에센스", "앰플", "샴푸", "선크림", "립밤", "클렌징", "수분크림", "핸드크림", "바디크림", "아이크림"],
    source: `${LAW("화장품법")} 화장품책임판매업 등록 · 표시 기준`,
    action: "화장품 해당 여부 확인 → 책임판매업 등록 또는 등록 업체를 통한 판매",
  },
  {
    id: "food-health",
    label: "식품 · 건강기능식품",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["영양제", "비타민", "건강기능식품", "유산균", "프로바이오틱스", "홍삼", "오메가3", "단백질보충", "다이어트식품"],
    source: `${LAW("건강기능식품에 관한 법률")} · ${LAW("식품위생법")} 영업신고 · 표시 / 수입 시 수입신고`,
    action: "식품 · 건강기능식품 해당 여부 확인 → 영업신고 · 수입신고 · 표시사항",
  },
  {
    id: "medical-device",
    label: "의료기기",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["의료기기", "체온계", "혈압계", "보청기", "콘택트렌즈", "kf94", "kf80", "찜질기"],
    source: `${LAW("의료기기법")} 판매업 신고 · 허가 · 인증`,
    action: "의료기기 품목 여부 확인 → 판매업 신고 · 제품 허가 번호",
  },
  {
    id: "household-chemical",
    label: "생활화학제품",
    area: "CERTIFICATION",
    status: "REQUIRES_CERTIFICATION",
    terms: ["세정제", "세제", "방향제", "탈취제", "살균", "소독", "표백", "제습제", "방충"],
    source: `${LAW("생활화학제품 및 살생물제의 안전관리에 관한 법률")} 안전확인대상생활화학제품 신고 · 표시`,
    action: "생활화학제품 해당 여부 확인 → 안전기준 확인 신고 번호",
  },
  {
    id: "restricted-goods",
    label: "판매 제한 품목",
    area: "PROHIBITED",
    status: "MANUAL_REVIEW",
    terms: ["담배", "전자담배", "니코틴", "주류", "의약품", "처방", "모의총", "가스총", "석궁", "도검"],
    source: "쿠팡 판매 금지 · 제한 상품 정책 (WING 판매자 도움말) 및 관련 법령",
    action: "판매 금지 · 제한 품목인지 쿠팡 정책에서 확인 (확인 전에는 일반 후보로 보지 않음)",
  },
  {
    id: "counterfeit-signal",
    label: "위조 · 모방 표현",
    area: "PROHIBITED",
    status: "MANUAL_REVIEW",
    terms: ["레플리카", "이미테이션", "미러급", "짝퉁", "정품아님", "st스타일", "스타일st"],
    source: `${LAW("상표법")} · 쿠팡 지식재산권 침해 신고 정책`,
    action: "위조 · 모방 표현이 있다 — 상표권 침해 가능성 확인 (판매 금지 확정 아님)",
  },
];

const key = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function screenCompliance(input: ComplianceInput, checkedAt: string): { status: ComplianceStatus; findings: ComplianceFinding[] } {
  const name = key(input.productName ?? "");
  const cat = key(input.category ?? "");
  const text = `${name}|${cat}`;
  const findings: ComplianceFinding[] = [];

  for (const r of RULES) {
    const excludedByUnless = r.unless?.some((t) => text.includes(key(t))) ?? false;
    // 강한 단어에도 unless 를 적용한다 (v2 — "청소기"와 "청소솔" 구분). 약한 단어 규칙(food-contact)은 전과 같다
    let hit = r.weakTerms ? r.terms.find((t) => text.includes(key(t))) : excludedByUnless ? undefined : r.terms.find((t) => text.includes(key(t)));
    let ctx: string | undefined;
    if (!hit && r.weakTerms) {
      const weak = r.weakTerms.find((t) => text.includes(key(t)));
      ctx = r.with?.find((t) => text.includes(key(t)));
      const blocked = r.unless?.some((t) => text.includes(key(t)));
      if (weak && ctx && !blocked) hit = weak;
    }
    if (!hit) continue;
    const where = name.includes(key(hit)) ? "상품명" : "카테고리";
    findings.push({
      area: r.area,
      status: r.status,
      rule: r.id,
      evidence: `${where}에 "${hit}"${ctx && ctx !== hit ? ` · "${ctx}"` : ""}${input.category ? ` (카테고리: ${input.category})` : " (카테고리 미수집)"}`,
      source: r.source,
      action: r.action,
      checkedAt,
      method: "AUTO",
    });
  }

  findings.push(
    input.brand
      ? {
          area: "BRAND",
          status: "REQUIRES_BRAND_PROOF",
          rule: "brand-known",
          evidence: `브랜드 "${input.brand}"`,
          source: `${LAW("상표법")} · ${LAW("디자인보호법")} · 쿠팡 브랜드 상품 판매 정책`,
          action: "같은 브랜드 상품을 팔려면 정품 매입 증빙(거래명세서 · 공급 계약) 필요. 유사 상품을 자체 소싱하면 상표 · 디자인 모방 여부 확인",
          checkedAt,
          method: "AUTO",
        }
      : {
          area: "BRAND",
          status: "UNKNOWN",
          rule: "brand-unknown",
          evidence: "브랜드 정보 없음 (검색 · 상품 페이지에서 브랜드를 따로 읽지 않음)",
          source: "-",
          action: "상품명 앞 단어가 브랜드인지 확인. 브랜드 상품이면 정품 증빙 필요",
          checkedAt,
          method: "AUTO",
        },
    {
      area: "SUPPLY",
      status: "UNKNOWN",
      rule: "no-supplier-source",
      evidence: "연결된 공급처(도매 · 제조 · 수입) 데이터 출처 없음",
      source: "-",
      action: "공급처 · 공급가 · 최소 주문 수량 확인 전에는 공급 가능 상품으로 보지 않음",
      checkedAt,
      method: "AUTO",
    },
  );
  if (!findings.some((f) => f.area === "CERTIFICATION")) {
    findings.push({
      area: "CERTIFICATION",
      status: "UNKNOWN",
      rule: "no-rule-matched",
      evidence: "품목 규칙에 걸린 단어 없음 — 규정이 없다는 뜻이 아니다",
      source: "-",
      action: "실제 제품 재질 · 용도 · 수입 여부로 인증 대상인지 확인",
      checkedAt,
      method: "AUTO",
    });
  }
  return { status: overallStatus(findings), findings };
}

/** 영역별 판단 → 상품 상태. 판매 제한 의심 > 인증 > 브랜드 > 기타 확인 > 근거 부족. 모두 사용자 확인 완료일 때만 CLEARED */
export function overallStatus(findings: ComplianceFinding[]): ComplianceStatus {
  if (findings.some((f) => f.status === "BLOCKED")) return "BLOCKED";
  if (findings.some((f) => f.area === "PROHIBITED" && f.status === "MANUAL_REVIEW")) return "MANUAL_REVIEW";
  if (findings.some((f) => f.status === "REQUIRES_CERTIFICATION")) return "REQUIRES_CERTIFICATION";
  if (findings.some((f) => f.status === "REQUIRES_BRAND_PROOF")) return "REQUIRES_BRAND_PROOF";
  if (findings.some((f) => f.status === "MANUAL_REVIEW")) return "MANUAL_REVIEW";
  if (findings.length > 0 && findings.every((f) => f.status === "CLEARED" && f.method === "USER")) return "CLEARED";
  return "UNKNOWN";
}

/** 일반 판매 후보로 볼 수 있는가 — 사용자 확인 완료(CLEARED)만 */
export const isGeneralCandidate = (s: ComplianceStatus | null) => s === "CLEARED";
/** 일반 후보에서 제외 (기록은 남는다) */
export const isExcluded = (s: ComplianceStatus | null) => s === "BLOCKED";

const SEVERITY: Record<ComplianceStatus, number> = { BLOCKED: 5, MANUAL_REVIEW: 4, REQUIRES_CERTIFICATION: 3, REQUIRES_BRAND_PROOF: 2, UNKNOWN: 0, CLEARED: -1 };

export interface EffectiveCompliance {
  status: ComplianceStatus | null;
  /** 걸린 인증 규칙 이름 (전기용품 KC · 전파법 …) */
  certifications: string[];
  /** 저장된 결과가 옛 규칙이라 지금 규칙으로 다시 봤는가 */
  rescreened: boolean;
}

/**
 * 판정에 쓸 판매 가능성 (PHASE 28). 사용자가 정한 상태는 그대로 쓴다.
 * 자동 판단이면 지금 규칙으로 상품명 · 카테고리를 다시 보고, 저장된 상태와 더 엄격한 쪽을 쓴다
 * (다음 자동 발굴 실행 전에도 새 규칙이 판정에 반영된다. 저장값의 브랜드 판단은 유지).
 */
export function effectiveCompliance(
  stored: { status: string; decidedBy: string | null; ruleVersion: string | null } | null,
  input: ComplianceInput,
  checkedAt: string,
): EffectiveCompliance {
  if (stored?.decidedBy === "USER") return { status: stored.status as ComplianceStatus, certifications: [], rescreened: false };
  const now = screenCompliance(input, checkedAt);
  const certifications = now.findings
    .filter((f) => f.area === "CERTIFICATION" && f.status === "REQUIRES_CERTIFICATION")
    .map((f) => RULES.find((r) => r.id === f.rule)?.label ?? f.rule);
  const s = (stored?.status ?? null) as ComplianceStatus | null;
  const status = s && SEVERITY[s] >= SEVERITY[now.status] ? s : now.status;
  return { status, certifications, rescreened: stored?.ruleVersion !== COMPLIANCE_RULE_VERSION };
}
