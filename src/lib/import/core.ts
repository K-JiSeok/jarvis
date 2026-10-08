/**
 * Import 파이프라인 핵심 (순수 함수, import-v1).
 *
 *   파일(CSV/XLSX) → 표(headers + rows, 모두 문자열) → 컬럼 매핑 → 값 변환·검증 → 정규화 레코드 → (서버) 기존 RPC/테이블 저장
 *
 * 정규화 레코드(Normalized*)는 파일 형식과 무관하다. 이후 확장 프로그램 등 다른 입력도 같은 레코드를 만들어
 * 같은 저장 경로(src/lib/repositories/imports.ts)를 쓰면 된다.
 *
 * 원칙
 * - 빈 칸 = NULL(모름), 0 = 실제 0. 모르는 값을 채우지 않는다.
 * - 뜻이 둘 이상인 컬럼(예: "판매량" → 실제? 추정?)은 자동으로 정하지 않고 사용자가 고른다. 예측 판매량은 가져오지 않는다.
 * - 상품·키워드는 이미 등록된 것만 쓴다 (자동 생성 없음).
 * 다른 모듈은 타입도 import 하지 않는다 (Node 테스트 스크립트에서 직접 실행).
 */

export const IMPORT_SCHEMA_VERSION = "import-v1";
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_DATA_ROWS = 2000;

// 유형 ------------------------------------------------------------------------------------

/** import_jobs.import_type 의 기존 값 (0003 CHECK) 중 이번에 지원하는 것 */
export const IMPORT_TYPES = ["PRODUCT_SNAPSHOTS", "KEYWORD_METRICS", "SEARCH_RANKS"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  PRODUCT_SNAPSHOTS: "상품 데이터",
  KEYWORD_METRICS: "키워드 데이터",
  SEARCH_RANKS: "키워드 순위 데이터",
};

/** 사용자가 고를 수 있는 출처 (파일 데이터가 어디서 왔는지). CALCULATED · ESTIMATED · OFFICIAL_API 는 제외 */
export const IMPORT_SOURCES = ["MANUAL", "EXTENSION", "COUPANG_PAGE", "WING_SESSION"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_CONFIDENCES = ["A", "B", "C"] as const;
export type ImportConfidence = (typeof IMPORT_CONFIDENCES)[number];

// 필드 정의 -------------------------------------------------------------------------------

type FieldKind =
  | "productId"
  | "keyword"
  | "date"
  | "int"
  | "money"
  | "decimal"
  | "ratio"
  | "signedRatio"
  | "rating"
  | "bool"
  | "delivery"
  | "seller"
  | "text";

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** 이 이름이면 자동 매칭 (정규화한 헤더 기준) */
  aliases: string[];
  /** 이 이름이면 후보로만 제시하고 자동으로 정하지 않는다 (뜻이 둘 이상) */
  ambiguous?: string[];
  hint?: string;
}

const PRODUCT_ID_ALIASES = ["coupangproductid", "productid", "상품id", "상품아이디", "쿠팡상품id", "쿠팡상품아이디", "쿠팡상품번호", "상품번호"];
const DATE_ALIASES = ["capturedon", "date", "날짜", "수집일", "수집일자", "기준일", "기준일자", "조회일", "일자"];
const KEYWORD_ALIASES = ["keyword", "키워드", "검색어", "검색키워드"];
const SALES_AMBIGUOUS = ["판매량", "월판매량", "28일판매량", "30일판매량", "sales", "판매수량"];
const REVENUE_AMBIGUOUS = ["매출", "월매출", "28일매출", "revenue", "매출액"];

export const FIELDS: Record<ImportType, FieldDef[]> = {
  PRODUCT_SNAPSHOTS: [
    { key: "coupang_product_id", label: "쿠팡 상품 ID", kind: "productId", required: true, aliases: PRODUCT_ID_ALIASES },
    { key: "captured_on", label: "수집일", kind: "date", required: true, aliases: DATE_ALIASES },
    { key: "product_name_observed", label: "관측 상품명", kind: "text", aliases: ["상품명", "productname", "제품명"] },
    { key: "price", label: "판매가", kind: "money", aliases: ["price", "판매가", "판매가격", "가격", "현재가", "할인가"] },
    { key: "original_price", label: "정가", kind: "money", aliases: ["originalprice", "정가", "원가격", "할인전가격"] },
    { key: "discount_rate", label: "할인율", kind: "ratio", aliases: ["discountrate", "할인율"] },
    { key: "review_count", label: "리뷰 수", kind: "int", aliases: ["reviewcount", "리뷰수", "리뷰", "상품평수", "리뷰개수"] },
    { key: "rating", label: "평점", kind: "rating", aliases: ["rating", "평점", "별점"] },
    { key: "category_rank", label: "카테고리 순위", kind: "int", aliases: ["categoryrank", "카테고리순위", "카테고리랭킹"] },
    {
      key: "sales_actual",
      label: "실제 판매량",
      kind: "int",
      aliases: ["salesactual", "실제판매량", "실판매량"],
      ambiguous: SALES_AMBIGUOUS,
      hint: "직접 확인된 실제 판매량만",
    },
    {
      key: "sales_estimated",
      label: "추정 판매량",
      kind: "int",
      aliases: ["salesestimated", "추정판매량", "예상판매량"],
      ambiguous: SALES_AMBIGUOUS,
      hint: "외부 도구·역산한 추정치",
    },
    { key: "sales_period_days", label: "판매량 집계 기간(일)", kind: "int", aliases: ["salesperioddays", "집계기간", "판매기간", "기간일수", "기간"] },
    { key: "revenue_actual", label: "실제 매출", kind: "money", aliases: ["revenueactual", "실제매출"], ambiguous: REVENUE_AMBIGUOUS },
    { key: "revenue_estimated", label: "추정 매출", kind: "money", aliases: ["revenueestimated", "추정매출", "예상매출"], ambiguous: REVENUE_AMBIGUOUS },
    { key: "conversion_rate", label: "전환율", kind: "ratio", aliases: ["conversionrate", "전환율", "구매전환율"] },
    {
      key: "views_28d",
      label: "28일 조회수",
      kind: "int",
      aliases: ["views28d", "28일조회수", "조회수28일", "viewcount28d"],
      ambiguous: ["조회수", "viewcount", "views", "상품조회수"],
      hint: "최근 28일 기준일 때만",
    },
    { key: "delivery_type", label: "배송 유형", kind: "delivery", aliases: ["deliverytype", "배송유형", "배송", "배송타입"] },
    { key: "seller_type_observed", label: "판매자 유형", kind: "seller", aliases: ["sellertype", "sellertypeobserved", "판매자유형", "판매유형", "판매자"] },
  ],
  KEYWORD_METRICS: [
    { key: "keyword", label: "키워드", kind: "keyword", required: true, aliases: KEYWORD_ALIASES },
    { key: "captured_on", label: "수집일", kind: "date", required: true, aliases: DATE_ALIASES },
    { key: "search_volume", label: "월 검색량", kind: "int", aliases: ["searchvolume", "검색량", "월검색량", "월간검색량", "검색수"] },
    { key: "search_volume_previous", label: "이전 검색량", kind: "int", aliases: ["searchvolumeprevious", "이전검색량", "전월검색량"] },
    { key: "search_growth_rate", label: "검색량 증감률", kind: "signedRatio", aliases: ["searchgrowthrate", "검색량증감", "검색량증감률", "증감률", "성장률"] },
    { key: "coupang_product_count", label: "쿠팡 상품 수", kind: "int", aliases: ["productcount", "coupangproductcount", "상품수", "쿠팡상품수", "등록상품수"] },
    { key: "competition_intensity", label: "경쟁강도 (상품수÷검색량)", kind: "decimal", aliases: ["competitionintensity", "경쟁강도"] },
    { key: "wing_ratio", label: "WING 비율", kind: "ratio", aliases: ["wingratio", "wing비율", "윙비율"] },
    { key: "rocket_ratio", label: "로켓 비율", kind: "ratio", aliases: ["rocketratio", "로켓비율", "로켓배송비율"] },
    { key: "brand_concentration", label: "브랜드 집중도", kind: "ratio", aliases: ["brandconcentration", "브랜드집중도", "브랜드점유율"] },
    { key: "average_price", label: "평균 가격", kind: "money", aliases: ["averageprice", "평균가격", "평균가", "1페이지평균가격"] },
    { key: "average_reviews", label: "평균 리뷰 수", kind: "decimal", aliases: ["averagereviews", "평균리뷰", "평균리뷰수", "1페이지평균리뷰수"] },
    { key: "ad_bid", label: "광고 입찰가", kind: "money", aliases: ["adbid", "광고입찰가", "입찰가", "평균입찰가"] },
  ],
  SEARCH_RANKS: [
    { key: "keyword", label: "키워드", kind: "keyword", required: true, aliases: KEYWORD_ALIASES },
    { key: "coupang_product_id", label: "쿠팡 상품 ID", kind: "productId", required: true, aliases: PRODUCT_ID_ALIASES },
    { key: "captured_on", label: "수집일", kind: "date", required: true, aliases: DATE_ALIASES },
    { key: "rank_position", label: "순위", kind: "int", required: true, aliases: ["rank", "rankposition", "순위", "노출순위", "검색순위", "랭킹"] },
    { key: "is_ad", label: "광고 여부", kind: "bool", aliases: ["isad", "ad", "광고", "광고여부", "광고상품"], hint: "비우면 자연 노출" },
    { key: "page", label: "페이지", kind: "int", aliases: ["page", "페이지"] },
  ],
};

export function fieldDef(type: ImportType, key: string): FieldDef | undefined {
  return FIELDS[type].find((f) => f.key === key);
}

/** 0~1 비율 · 증감률 칸 (단위 선택 대상) */
export function isRatioField(type: ImportType, key: string): boolean {
  const k = fieldDef(type, key)?.kind;
  return k === "ratio" || k === "signedRatio";
}

// 표 / CSV ---------------------------------------------------------------------------------

export interface ParsedTable {
  headers: string[];
  /** 데이터 행 (헤더 다음부터, 빈 행 제외) + 원본 파일 행 번호 */
  rows: { rowNumber: number; cells: string[] }[];
}

/** 바이트 → 텍스트. UTF-8(BOM 포함) 우선, UTF-8 이 아니면 EUC-KR(엑셀 한글 CSV 기본) */
export function decodeText(bytes: Uint8Array): { text: string; encoding: "utf-8" | "euc-kr" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" };
  }
}

/** 구분자 추정: 첫 줄에서 따옴표 밖의 , · 탭 · ; 개수 */
function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (d: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n += 1;
    }
    return n;
  };
  const candidates = [",", "\t", ";"].map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

/** RFC 4180 CSV → 2차원 문자열 배열 (따옴표 안의 구분자·줄바꿈·"" 처리) */
export function parseCsv(text: string): string[][] {
  const d = detectDelimiter(text);
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === d) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** 2차원 셀 → 헤더 + 데이터 행. 첫 번째 비어 있지 않은 행이 헤더 */
export function toTable(grid: string[][]): ParsedTable {
  const clean = grid.map((r) => r.map((c) => (c ?? "").replace(/ /g, " ").trim()));
  const headerIndex = clean.findIndex((r) => r.some((c) => c !== ""));
  if (headerIndex < 0) return { headers: [], rows: [] };
  const headers = clean[headerIndex];
  // 오른쪽 끝의 빈 헤더 열은 버린다
  let width = headers.length;
  while (width > 0 && headers[width - 1] === "") width -= 1;
  const rows: ParsedTable["rows"] = [];
  for (let i = headerIndex + 1; i < clean.length; i += 1) {
    const cells = clean[i].slice(0, width);
    if (cells.every((c) => c === "")) continue;
    while (cells.length < width) cells.push("");
    rows.push({ rowNumber: i + 1, cells });
  }
  return { headers: headers.slice(0, width), rows };
}

// 컬럼 매핑 -------------------------------------------------------------------------------

/** 헤더 정규화: 소문자, 공백·밑줄·하이픈·괄호·점·슬래시 제거 */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_\-()[\]{}.·/\\:]/g, "");
}

export interface ColumnMatch {
  index: number;
  header: string;
  /** 자동으로 정한 필드 (없으면 null) */
  field: string | null;
  status: "AUTO" | "AMBIGUOUS" | "NONE";
  /** 뜻이 둘 이상일 때 고를 수 있는 필드 */
  candidates: string[];
}

/** 헤더 → 필드 자동 매칭. 같은 필드에 두 열이 맞으면 앞 열만 자동 지정 */
export function autoMatch(type: ImportType, headers: string[]): ColumnMatch[] {
  const used = new Set<string>();
  return headers.map((header, index) => {
    const h = normalizeHeader(header);
    const exact = FIELDS[type].find((f) => f.aliases.includes(h));
    if (exact && !used.has(exact.key)) {
      used.add(exact.key);
      return { index, header, field: exact.key, status: "AUTO", candidates: [exact.key] };
    }
    const ambiguous = FIELDS[type].filter((f) => f.ambiguous?.includes(h)).map((f) => f.key);
    if (ambiguous.length > 0) return { index, header, field: null, status: "AMBIGUOUS", candidates: ambiguous };
    return { index, header, field: null, status: "NONE", candidates: [] };
  });
}

/** 열 번호 → 필드 key ("" = 사용 안 함) */
export type ColumnMapping = Record<number, string>;

export type RatioUnit = "PERCENT" | "DECIMAL";

export interface ImportOptions {
  source: ImportSource;
  confidence: ImportConfidence;
  /** 판매량·매출 열이 있는데 기간 열이 없을 때 쓰는 집계 기간 (일) */
  salesPeriodDays: number | null;
  /** 비율 칸의 % 기호 없는 숫자 해석: PERCENT = 15.5 → 15.5%, DECIMAL = 0.155 → 15.5% */
  ratioUnits: Record<string, RatioUnit>;
  /** 오늘 (KST, YYYY-MM-DD) — 미래 날짜 검사 */
  today: string;
}

/** 매핑 자체의 문제 (있으면 가져오기 전체를 막는다) */
export function validateMapping(type: ImportType, mapping: ColumnMapping, options: Pick<ImportOptions, "salesPeriodDays">): string[] {
  const problems: string[] = [];
  const mapped = Object.values(mapping).filter(Boolean);
  for (const f of FIELDS[type]) {
    if (f.required && !mapped.includes(f.key)) problems.push(`필수 컬럼 "${f.label}" 을(를) 연결하세요.`);
    if (mapped.filter((k) => k === f.key).length > 1) problems.push(`"${f.label}" 에 두 개 이상의 열이 연결되었습니다.`);
  }
  for (const k of mapped) if (!fieldDef(type, k)) problems.push(`알 수 없는 필드 ${k}`);
  if (type === "PRODUCT_SNAPSHOTS") {
    const hasSales = mapped.some((k) => ["sales_actual", "sales_estimated", "revenue_actual", "revenue_estimated"].includes(k));
    if (hasSales && !mapped.includes("sales_period_days") && !options.salesPeriodDays) {
      problems.push("판매량·매출을 가져오려면 집계 기간 열을 연결하거나 집계 기간(일)을 입력하세요.");
    }
  }
  return problems;
}

/** 비율 칸 단위 기본값: % 기호 없는 숫자 중 절댓값이 1 을 넘는 값이 있으면 PERCENT, 아니면 DECIMAL (화면에서 바꿀 수 있음) */
export function suggestRatioUnit(values: string[]): RatioUnit {
  return values.some((v) => {
    if (v.includes("%")) return false;
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) && Math.abs(n) > 1;
  })
    ? "PERCENT"
    : "DECIMAL";
}

// 값 변환 ---------------------------------------------------------------------------------

const NULL_TOKENS = new Set(["", "-", "–", "—", "n/a", "na", "null", "none", "없음", "모름"]);

export function isBlank(raw: string): boolean {
  return NULL_TOKENS.has(raw.trim().toLowerCase());
}

/** "12,500원" · "15.5%" · " 1 234 " → 숫자. 숫자가 아니면 NaN */
export function parseNumberCell(raw: string): { value: number; percent: boolean } {
  const percent = raw.includes("%");
  const s = raw.replace(/[,\s원₩개건회위%]/g, "").replace(/^\+/, "");
  if (!/^-?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i.test(s)) return { value: Number.NaN, percent };
  return { value: Number(s), percent };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 날짜 + 선택적 시각 → KST 날짜 / captured_at. 형식이 틀리거나 없는 날짜면 null */
export function parseDateCell(raw: string): { date: string; capturedAt: string } | null {
  const m = raw
    .trim()
    .match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/) ?? raw.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const hh = m[4] != null ? Number(m[4]) : 0;
  const mm = m[5] != null ? Number(m[5]) : 0;
  const ss = m[6] != null ? Number(m[6]) : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  return { date, capturedAt: `${date}T${pad(hh)}:${pad(mm)}:${pad(ss)}+09:00` };
}

const DELIVERY_MAP: Record<string, string> = {
  rocket: "ROCKET", 로켓: "ROCKET", 로켓배송: "ROCKET",
  rocketgrowth: "ROCKET_GROWTH", 로켓그로스: "ROCKET_GROWTH", 그로스: "ROCKET_GROWTH",
  rocketfresh: "ROCKET_FRESH", 로켓프레시: "ROCKET_FRESH",
  sellerdelivery: "SELLER_DELIVERY", 판매자배송: "SELLER_DELIVERY", 일반배송: "SELLER_DELIVERY", 업체배송: "SELLER_DELIVERY",
  overseas: "OVERSEAS", 해외: "OVERSEAS", 해외배송: "OVERSEAS", 로켓직구: "OVERSEAS",
  other: "OTHER", 기타: "OTHER",
};
const SELLER_MAP: Record<string, string> = {
  coupangretail: "COUPANG_RETAIL", 쿠팡: "COUPANG_RETAIL", 쿠팡직매입: "COUPANG_RETAIL", 직매입: "COUPANG_RETAIL", 로켓배송: "COUPANG_RETAIL",
  rocketgrowthseller: "ROCKET_GROWTH_SELLER", 로켓그로스: "ROCKET_GROWTH_SELLER", 로켓그로스판매자: "ROCKET_GROWTH_SELLER",
  wingseller: "WING_SELLER", wing: "WING_SELLER", 윙: "WING_SELLER", 마켓플레이스: "WING_SELLER", 판매자배송: "WING_SELLER",
  unknown: "UNKNOWN",
};
const TRUE_TOKENS = new Set(["true", "1", "y", "yes", "o", "예", "광고", "ad", "sponsored", "광고상품"]);
const FALSE_TOKENS = new Set(["false", "0", "n", "no", "x", "아니오", "아니요", "일반", "자연", "자연노출", "organic"]);

export type CellResult = { value: number | string | boolean | null; issue?: string };

/** 셀 1개를 필드 종류에 맞게 변환. issue 가 있으면 값은 null */
export function convertCell(field: FieldDef, raw: string, unit: RatioUnit): CellResult {
  if (field.kind === "bool") {
    if (isBlank(raw)) return { value: false };
    const t = normalizeHeader(raw);
    if (TRUE_TOKENS.has(t)) return { value: true };
    if (FALSE_TOKENS.has(t)) return { value: false };
    return { value: null, issue: `${field.label}: "${raw}" 을(를) 광고 여부로 읽을 수 없습니다.` };
  }
  if (isBlank(raw)) return { value: null };

  switch (field.kind) {
    case "text":
      return { value: raw.trim().replace(/\s+/g, " ").slice(0, 300) };
    case "keyword":
      return { value: raw.trim().replace(/\s+/g, " ") };
    case "productId": {
      const fromUrl = raw.match(/\/products\/(\d+)/);
      const id = fromUrl ? fromUrl[1] : raw.replace(/\s/g, "").replace(/\.0+$/, "");
      return /^\d{1,20}$/.test(id) ? { value: id } : { value: null, issue: `${field.label}: "${raw}" 은(는) 숫자 상품 ID 가 아닙니다.` };
    }
    case "date": {
      const d = parseDateCell(raw);
      return d ? { value: d.date } : { value: null, issue: `${field.label}: "${raw}" 은(는) 날짜 형식이 아닙니다 (예: 2026-10-08).` };
    }
    case "delivery":
    case "seller": {
      const map = field.kind === "delivery" ? DELIVERY_MAP : SELLER_MAP;
      const upper = raw.trim().toUpperCase();
      if (Object.values(map).includes(upper)) return { value: upper };
      const mapped = map[normalizeHeader(raw)];
      return mapped ? { value: mapped } : { value: null, issue: `${field.label}: "${raw}" 은(는) 알 수 없는 값이라 비워 둡니다.` };
    }
  }

  const { value: n, percent } = parseNumberCell(raw);
  if (!Number.isFinite(n)) return { value: null, issue: `${field.label}: "${raw}" 은(는) 숫자가 아닙니다.` };

  switch (field.kind) {
    case "int":
    case "money":
      if (!Number.isInteger(n)) return { value: null, issue: `${field.label}: "${raw}" 은(는) 정수가 아닙니다.` };
      if (n < 0) return { value: null, issue: `${field.label}: 음수는 넣을 수 없습니다.` };
      if (field.key === "rank_position" || field.key === "page" || field.key === "sales_period_days") {
        if (n < 1) return { value: null, issue: `${field.label}: 1 이상이어야 합니다.` };
      }
      return { value: n };
    case "decimal":
      return n < 0 ? { value: null, issue: `${field.label}: 음수는 넣을 수 없습니다.` } : { value: n };
    case "rating":
      return n < 0 || n > 5 ? { value: null, issue: `${field.label}: 0~5 범위가 아닙니다.` } : { value: n };
    case "ratio":
    case "signedRatio": {
      const v = Math.round((percent || unit === "PERCENT" ? n / 100 : n) * 10000) / 10000;
      if (field.kind === "ratio" && (v < 0 || v > 1)) return { value: null, issue: `${field.label}: "${raw}" → ${v * 100}% 는 0~100% 범위가 아닙니다.` };
      return { value: v };
    }
  }
  return { value: null, issue: `${field.label}: 처리할 수 없는 값` };
}

// 정규화 레코드 ---------------------------------------------------------------------------

interface NormalizedBase {
  source: ImportSource;
  confidence: ImportConfidence;
  capturedOn: string;
  capturedAt: string;
}

/** 상품 스냅샷 1건 (product_snapshots 컬럼명) */
export interface NormalizedProductSnapshot extends NormalizedBase {
  kind: "PRODUCT_SNAPSHOT";
  coupangProductId: string;
  metrics: Record<string, number | string>;
  /** 같은 행의 값으로 계산한 항목 → metric_meta CALCULATED */
  calculated: string[];
}

export interface NormalizedKeywordSnapshot extends NormalizedBase {
  kind: "KEYWORD_SNAPSHOT";
  keyword: string;
  metrics: Record<string, number>;
  calculated: string[];
}

export interface NormalizedRank extends NormalizedBase {
  kind: "KEYWORD_PRODUCT_RANK";
  keyword: string;
  coupangProductId: string;
  rankPosition: number;
  isAd: boolean;
  page: number | null;
}

export type NormalizedRecord = NormalizedProductSnapshot | NormalizedKeywordSnapshot | NormalizedRank;

/** 등록된 상품·키워드 (정규화 키 → id) */
export interface Lookups {
  products: Map<string, string>;
  keywords: Map<string, string>;
}

export type RowStatus = "OK" | "WARNING" | "ERROR" | "DUPLICATE";

export interface PreparedRow {
  rowNumber: number;
  status: RowStatus;
  messages: string[];
  /** 원본 셀 (헤더 → 값) */
  raw: Record<string, string>;
  /** 변환 결과 (필드 → 화면 표시용 값) */
  converted: Record<string, string>;
  recordKey: string | null;
  target: { productId?: string; keywordId?: string };
  record: NormalizedRecord | null;
  errorCode?: "REQUIRED" | "INVALID" | "PRODUCT_NOT_FOUND" | "KEYWORD_NOT_FOUND" | "FUTURE_DATE" | "DUPLICATE_IN_FILE" | "NO_VALUES";
}

export interface Prepared {
  rows: PreparedRow[];
  counts: { total: number; ok: number; warning: number; error: number; duplicate: number };
  unknownProducts: string[];
  unknownKeywords: string[];
}

/** keywords.normalized_keyword 와 같은 규칙 (src/lib/keywords.ts normalizeKeyword) */
export function normalizeKeyword(k: string): string {
  return k.trim().replace(/\s+/g, " ").toLowerCase();
}

const show = (v: number | string | boolean | null, field: FieldDef): string => {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "광고" : "자연";
  if (typeof v === "number" && (field.kind === "ratio" || field.kind === "signedRatio")) return `${Math.round(v * 1000000) / 10000}%`;
  return String(v);
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** 표 + 매핑 + 옵션 → 행별 검증 결과와 정규화 레코드 */
export function prepareRows(type: ImportType, table: ParsedTable, mapping: ColumnMapping, options: ImportOptions, lookups: Lookups): Prepared {
  const columns = Object.entries(mapping)
    .filter(([, key]) => key)
    .map(([i, key]) => ({ index: Number(i), field: fieldDef(type, key)! }))
    .filter((c) => c.field);
  const seen = new Map<string, number>();
  const unknownProducts = new Set<string>();
  const unknownKeywords = new Set<string>();

  const rows = table.rows.map(({ rowNumber, cells }): PreparedRow => {
    const raw = Object.fromEntries(table.headers.map((h, i) => [h || `열${i + 1}`, cells[i] ?? ""]));
    const values: Record<string, number | string | boolean | null> = {};
    const converted: Record<string, string> = {};
    const warnings: string[] = [];
    const errors: string[] = [];
    let errorCode: PreparedRow["errorCode"];
    let capturedAt: string | null = null;

    for (const { index, field } of columns) {
      const r = convertCell(field, cells[index] ?? "", options.ratioUnits[field.key] ?? "DECIMAL");
      // 시각이 있으면 captured_at 에 쓴다 (없으면 그 날짜 00:00 KST)
      if (field.key === "captured_on" && r.value) capturedAt = parseDateCell(cells[index])!.capturedAt;
      values[field.key] = r.value;
      converted[field.key] = show(r.value, field);
      if (r.issue) {
        if (field.required) {
          errors.push(r.issue);
          errorCode ??= "INVALID";
        } else warnings.push(r.issue);
      }
    }
    for (const f of FIELDS[type]) {
      if (f.required && values[f.key] == null && !errors.some((e) => e.startsWith(`${f.label}:`))) {
        errors.push(`${f.label}: 값이 없습니다.`);
        errorCode ??= "REQUIRED";
      }
    }

    const date = values.captured_on as string | null;
    if (date && date > options.today) {
      errors.push(`수집일 ${date} 은(는) 오늘(KST) 이후입니다.`);
      errorCode ??= "FUTURE_DATE";
    }

    const target: PreparedRow["target"] = {};
    const productId = values.coupang_product_id as string | null;
    const keyword = values.keyword as string | null;
    if (productId) {
      const id = lookups.products.get(productId);
      if (id) target.productId = id;
      else {
        unknownProducts.add(productId);
        errors.push(`쿠팡 상품 ID ${productId}: 등록되지 않은 상품입니다. /products 에서 먼저 등록하세요.`);
        errorCode ??= "PRODUCT_NOT_FOUND";
      }
    }
    if (keyword) {
      const id = lookups.keywords.get(normalizeKeyword(keyword));
      if (id) target.keywordId = id;
      else {
        unknownKeywords.add(keyword);
        errors.push(`키워드 "${keyword}": 등록되지 않은 키워드입니다. /keywords 에서 먼저 등록하세요.`);
        errorCode ??= "KEYWORD_NOT_FOUND";
      }
    }

    // 자연키 (같은 파일 안 중복 판정 · import_rows.record_key)
    let recordKey: string | null = null;
    if (date) {
      if (type === "PRODUCT_SNAPSHOTS" && productId) recordKey = `product_snapshot:${productId}:${date}:${options.source}`;
      if (type === "KEYWORD_METRICS" && keyword) recordKey = `keyword_snapshot:${normalizeKeyword(keyword)}:${date}:${options.source}`;
      if (type === "SEARCH_RANKS" && keyword && productId) {
        recordKey = `keyword_product_rank:${normalizeKeyword(keyword)}:${productId}:${date}:${options.source}:${values.is_ad ? "ad" : "organic"}`;
      }
    }

    const base = { rowNumber, raw, converted, recordKey, target };
    if (errors.length > 0) return { ...base, status: "ERROR", messages: [...errors, ...warnings], record: null, errorCode };

    if (recordKey) {
      const first = seen.get(recordKey);
      if (first != null) {
        return {
          ...base,
          status: "DUPLICATE",
          messages: [`${first}행과 같은 대상·날짜입니다. 첫 행만 사용하고 이 행은 건너뜁니다.`],
          record: null,
          errorCode: "DUPLICATE_IN_FILE",
        };
      }
      seen.set(recordKey, rowNumber);
    }

    const common = { source: options.source, confidence: options.confidence, capturedOn: date!, capturedAt: capturedAt ?? `${date}T00:00:00+09:00` };
    let record: NormalizedRecord;

    if (type === "SEARCH_RANKS") {
      record = {
        kind: "KEYWORD_PRODUCT_RANK",
        ...common,
        keyword: keyword!,
        coupangProductId: productId!,
        rankPosition: values.rank_position as number,
        isAd: values.is_ad === true,
        page: (values.page as number | null) ?? null,
      };
    } else {
      const metrics: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (["coupang_product_id", "keyword", "captured_on"].includes(k) || v == null || typeof v === "boolean") continue;
        metrics[k] = v;
      }
      const calculated: string[] = [];
      if (type === "PRODUCT_SNAPSHOTS") {
        const hasSales = ["sales_actual", "sales_estimated", "revenue_actual", "revenue_estimated"].some((k) => metrics[k] != null);
        if (hasSales && metrics.sales_period_days == null && options.salesPeriodDays) {
          metrics.sales_period_days = options.salesPeriodDays;
          converted.sales_period_days = `${options.salesPeriodDays} (입력값)`;
        }
        // 수동 입력과 같은 파생 규칙: 판매가 ≤ 정가 일 때 할인율 = 1 − 판매가 ÷ 정가
        const price = metrics.price as number | undefined;
        const original = metrics.original_price as number | undefined;
        if (metrics.discount_rate == null && price != null && original && price <= original) {
          metrics.discount_rate = round4(1 - price / original);
          calculated.push("discount_rate");
        }
      } else {
        const vol = metrics.search_volume as number | undefined;
        const count = metrics.coupang_product_count as number | undefined;
        const prev = metrics.search_volume_previous as number | undefined;
        if (metrics.competition_intensity == null && count != null && vol) {
          metrics.competition_intensity = round4(count / vol);
          calculated.push("competition_intensity");
        }
        if (metrics.search_growth_rate == null && vol != null && prev) {
          metrics.search_growth_rate = round4((vol - prev) / prev);
          calculated.push("search_growth_rate");
        }
      }
      for (const k of calculated) converted[k] = show(metrics[k] as number, fieldDef(type, k)!) + " (계산)";
      if (Object.keys(metrics).length === 0) {
        return { ...base, status: "ERROR", messages: ["가져올 지표 값이 하나도 없습니다.", ...warnings], record: null, errorCode: "NO_VALUES" };
      }
      record =
        type === "PRODUCT_SNAPSHOTS"
          ? { kind: "PRODUCT_SNAPSHOT", ...common, coupangProductId: productId!, metrics, calculated }
          : { kind: "KEYWORD_SNAPSHOT", ...common, keyword: keyword!, metrics: metrics as Record<string, number>, calculated };
    }

    return { ...base, status: warnings.length ? "WARNING" : "OK", messages: warnings, record };
  });

  const counts = { total: rows.length, ok: 0, warning: 0, error: 0, duplicate: 0 };
  for (const r of rows) {
    if (r.status === "OK") counts.ok += 1;
    else if (r.status === "WARNING") counts.warning += 1;
    else if (r.status === "ERROR") counts.error += 1;
    else counts.duplicate += 1;
  }
  return { rows, counts, unknownProducts: [...unknownProducts], unknownKeywords: [...unknownKeywords] };
}

/** 화면에 원본 값을 보여 줄 때: 수식처럼 보이는 셀(=, +, -, @ 시작)은 앞에 ' 를 붙여 데이터임을 표시 */
export function displayCell(raw: string): string {
  return /^[=+\-@\t\r]/.test(raw) && !/^-?\d/.test(raw) ? `'${raw}` : raw;
}

// 파일 형식 · 엑셀 셀 (parse-file.ts 가 쓴다) --------------------------------------------

export type FileFormat = "csv" | "xlsx";

/** 확장자 + 파일 시그니처로 형식 판별. 지원하지 않으면 오류 문구 */
export function detectFormat(fileName: string, bytes: Uint8Array): FileFormat | { error: string } {
  const name = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (name.endsWith(".xls") || isOle) return { error: "구형 엑셀(.xls)은 지원하지 않습니다. 엑셀에서 .xlsx 또는 .csv 로 저장한 뒤 올려 주세요." };
  if (name.endsWith(".xlsx")) return isZip ? "xlsx" : { error: "올바른 .xlsx 파일이 아닙니다." };
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    return isZip || bytes.subarray(0, 4096).includes(0) ? { error: "텍스트(CSV) 파일이 아닙니다." } : "csv";
  }
  return { error: "지원하지 않는 파일 형식입니다. .csv 또는 .xlsx 파일을 올려 주세요." };
}

/** 엑셀 셀 → 문자열. 날짜 셀은 UTC 기준 날짜(·시각) (엑셀 날짜에는 시간대가 없다). 수식은 저장된 결과 값만 읽힌다 */
export function excelCellToString(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const date = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return hasTime ? `${date} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : date;
  }
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  return String(v);
}
