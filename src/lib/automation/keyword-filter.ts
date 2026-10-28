/**
 * 발굴용 키워드 거르기 (PHASE 23 · kw-filter-v1, PHASE 29 · v2 브랜드 보강 · 오탐 수정) — 순수 함수. 수집 대기열(PHASE 29 kw-opportunity-v1)과 [수집 대기열 상위 N개 추적 등록]에서 쓴다 (후보 자체는 지우지 않음).
 *   BRAND      브랜드 · 제조사 이름이 들어간 키워드 — 정품 · 상표 문제로 중국 소싱 판매가 어렵고, 검색이 그 브랜드 상품으로 몰린다
 *   TOO_BROAD  월 검색량 10만 이상 한 단어 (예: 계산기, 가방, 청소기) — 범위가 너무 넓어 상품 하나로 경쟁하기 어렵다
 * 기준은 가정이다. 걸러진 키워드도 후보 목록에서 직접 [등록]할 수 있다.
 */

export const KW_FILTER_VERSION = "kw-filter-v2";
export const TOO_BROAD_VOLUME = 100_000;

/** 자주 나오는 브랜드 (소문자 비교). 필요하면 늘린다 */
export const BRAND_WORDS = [
  "쿠쿠", "삼성", "엘지", "lg", "다이슨", "필립스", "테팔", "애플", "아이폰", "갤럭시", "에어팟", "나이키", "아디다스", "뉴발란스", "샤오미", "브라운",
  "네스프레소", "일리커피", "락앤락", "코렐", "휘슬러", "해피콜", "키친아트", "3m", "스탠리", "코베아", "노스페이스", "몽벨", "헬리녹스", "지프", "써모스",
  "조지루시", "타이거", "이케아", "다이소", "무인양품", "스타벅스", "레고", "닌텐도", "소니", "캐논", "로지텍", "보스이어폰", "보스헤드폰", "jbl", "디즈니", "산리오",
  // v2 (PHASE 29): 수집된 연관 키워드에서 찾은 브랜드. "일리"(데일리) · "보스"(보스턴백) 오탐을 고쳤다
  "오왈라", "카밀", "크레모아", "콜맨", "스노우피크", "블랙야크", "코닥", "모나미", "쿠첸", "위닉스", "신일", "한일", "보국", "드롱기", "발뮤다", "스메그", "르크루제", "스타우브", "포켓몬", "짱구", "카카오프렌즈", "잔망루피",
  "파세코", "꼴로르", "카즈미", "도쿄크래프트", "마추픽추", "제트스트림", "네이처하이크", "스노우라인", "루메나", "벤딕트", "몽크로스", "캉골", "클래파", "실리만", "홈리아", "차이슨", "일렉트로룩스", "도요토미", "텀스", "포레니아", "그레이바스", "씨투써밋",
];

export type KwFilterReason = "BRAND" | "TOO_BROAD";
export const KW_FILTER_LABELS: Record<KwFilterReason, string> = { BRAND: "브랜드 키워드", TOO_BROAD: "너무 넓은 키워드 (월 10만 이상 한 단어)" };

export function keywordFilter(keyword: string, volume: number | null): KwFilterReason | null {
  const k = keyword.toLowerCase().replace(/\s+/g, "");
  if (BRAND_WORDS.some((b) => k.includes(b))) return "BRAND";
  if (volume != null && volume >= TOO_BROAD_VOLUME && !/\s/.test(keyword.trim())) return "TOO_BROAD";
  return null;
}
