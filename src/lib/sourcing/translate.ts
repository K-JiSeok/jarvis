/**
 * 한국어 상품명 · 키워드 → 중국어 · 영어 도매 검색어 (순수 함수, PHASE 18 · sourcing-dict-v1).
 *
 * 번역 API 키가 없어서(파파고 · 구글 번역 미연결) 상품 용어 사전으로 바꾼다. 사전에 없는 단어는 버리지 않고 unmapped 로 남긴다
 * → 화면에서 원문 검색과 함께 비교한다. 브랜드 · 색상 · 판매 문구(국산 · 프리미엄 · 1+1)는 검색어에서 뺀다.
 * 구성 수량(2개 · 2p · 1+1 · 세트)은 검색어가 아니라 매칭 · 원가 계산(묶음 수량)에 쓴다.
 */

export const SOURCING_DICT_VERSION = "sourcing-dict-v1";

/** 긴 표현을 먼저 찾는다 (얼음트레이 → 트레이보다 먼저) */
const DICT: [string, string, string, string][] = [
  // [한국어, 중국어, 영어, 개념(매칭용)]
  ["얼음트레이", "冰格", "ice cube tray", "ice_tray"],
  ["아이스트레이", "冰格", "ice cube tray", "ice_tray"],
  ["아이스큐브", "冰格", "ice cube tray", "ice_tray"],
  ["얼음틀", "冰格", "ice cube tray", "ice_tray"],
  ["얼음볼", "冰球模具", "ice ball mold", "ice_tray"],
  ["테이블매트", "餐垫", "placemat", "mat"],
  ["식탁매트", "餐垫", "placemat", "mat"],
  ["드라잉매트", "沥水垫", "drying mat", "mat"],
  ["식기건조대", "沥水架", "dish drying rack", "drying_rack"],
  ["건조대", "沥水架", "drying rack", "drying_rack"],
  ["소분용기", "分装盒", "portion container", "container"],
  ["밀폐용기", "密封盒", "airtight container", "container"],
  ["반찬통", "保鲜盒", "food storage container", "container"],
  ["푸드블럭", "冷冻分装盒", "food freezer block", "container"],
  ["이유식", "辅食", "baby food", "baby_food"],
  ["트레이", "托盘", "tray", "tray"],
  ["쟁반", "托盘", "serving tray", "tray"],
  ["플레이트", "盘子", "plate", "plate"],
  ["접시", "盘子", "plate", "plate"],
  ["그릇", "碗", "bowl", "bowl"],
  ["도마", "砧板", "cutting board", "cutting_board"],
  ["받침대", "底座", "stand", "stand"],
  ["받침", "垫", "pad", "mat"],
  ["매트", "垫", "mat", "mat"],
  ["몰드", "模具", "mold", "mold"],
  ["큐브", "方块", "cube", "cube"],
  ["용기", "容器", "container", "container"],
  ["정리함", "收纳盒", "organizer", "organizer"],
  ["수납", "收纳", "storage", "organizer"],
  ["선반", "置物架", "shelf", "shelf"],
  ["실리콘", "硅胶", "silicone", "silicone"],
  ["가죽", "皮革", "leather", "leather"],
  ["원목", "实木", "solid wood", "wood"],
  ["스테인리스", "不锈钢", "stainless steel", "stainless"],
  ["냉동", "冷冻", "freezer", "freezer"],
  ["물빠짐", "沥水", "draining", "draining"],
  ["싱크대", "水槽", "sink", "sink"],
  ["세면대", "洗手台", "washbasin", "bathroom"],
  ["욕실", "浴室", "bathroom", "bathroom"],
  ["주방", "厨房", "kitchen", "kitchen"],
  ["다용도", "多用途", "multipurpose", "multipurpose"],
  ["하이볼", "大冰块", "large ice", "large_ice"],
  ["직사각", "长方形", "rectangular", "rectangle"],
  ["사각", "方形", "square", "square"],
  ["원형", "圆形", "round", "round"],
  ["타원형", "椭圆形", "oval", "oval"],
  ["경사형", "倾斜", "slanted", "slanted"],
  ["대형", "大号", "large", "large"],
  ["소형", "小号", "small", "small"],
  ["미니", "迷你", "mini", "small"],
  ["뚜껑", "带盖", "with lid", "lid"],
  ["펜", "笔", "pen", "pen"],
  ["오피스", "办公", "office", "office"],
  ["인테리어", "装饰", "decor", "decor"],
];

/** 검색어에서 빼는 말 (색상 · 판매 문구) */
const NOISE = [
  "화이트", "블랙", "베이지", "그레이", "핑크", "브라운", "아이보리", "밀크티", "다크그레이", "애쉬그레이", "옐로우", "버터옐로우", "파스텔그린",
  "피치핑크", "크림베이지", "크림", "마블화이트", "아몬드밀크", "인디", "그린", "블루", "레드", "국산", "국내", "생산", "프리미엄", "고급", "모던", "심플", "홈",
  "세트", "타입", "신상", "인기", "특가", "개", "종", "단", "형", "세로형", "가로형", "플러스", "와이드", "트리플", "써클", "일립스", "파스텔",
];

export interface SourcingQuery {
  original: string;
  /** 중국어 검색어 (1688 · 타오바오) */
  zh: string;
  /** 영어 검색어 (Alibaba.com) */
  en: string;
  /** 원문 핵심어 (한국어) — 번역이 틀릴 때 비교용 */
  koCore: string;
  concepts: string[];
  mapped: { ko: string; zh: string; en: string }[];
  /** 사전에 없어 검색어에 넣지 못한 단어 (브랜드일 가능성 포함) */
  unmapped: string[];
  /** 묶음 수량 (2개 · 2p · 1+1 → 2). 모르면 null */
  packQty: number | null;
  /** 칸 수 (6구 · 15구 …) */
  cavities: number | null;
  method: "DICTIONARY";
  dictVersion: string;
}

export function packQtyOf(name: string): number | null {
  const t = name.replace(/\s+/g, "");
  if (/1\+1/.test(t)) return 2;
  const m = t.match(/(\d+)\s*(?:개입|개|p|P|pcs|매|팩)(?![a-z])/);
  return m ? Number(m[1]) : null;
}

export function toSourcingQuery(original: string): SourcingQuery {
  // 괄호 · 쉼표 뒤 옵션(색상 · 수량)은 상품명 뒤쪽에 온다 → 쉼표 앞 본문을 우선 쓰고 수량은 전체에서 찾는다
  const body = original.split(/[,，]/)[0];
  const cavities = Number(original.match(/(\d+)\s*구(?!성)/)?.[1] ?? NaN);
  const tokens = body
    .replace(/[\[\]()（）+]/g, " ")
    .replace(/\d+(\.\d+)?\s*(구|개|p|ml|cm|mm|단|종|세트|L)\b/gi, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const mapped: SourcingQuery["mapped"] = [];
  const concepts: string[] = [];
  const unmapped: string[] = [];
  for (const tok of tokens) {
    if (/^\d+$/.test(tok) || NOISE.includes(tok)) continue;
    let rest = tok;
    let hit = false;
    // 붙여 쓴 말 (실리콘얼음틀 · 다용도트레이) 도 사전 단어로 나눈다
    while (rest) {
      const d = DICT.find(([ko]) => rest.startsWith(ko));
      if (!d) break;
      hit = true;
      if (!mapped.some((m) => m.zh === d[1])) mapped.push({ ko: d[0], zh: d[1], en: d[2] });
      if (!concepts.includes(d[3])) concepts.push(d[3]);
      rest = rest.slice(d[0].length);
    }
    if (!hit || (rest && !NOISE.includes(rest) && rest.length > 1)) {
      const w = hit ? rest : tok;
      if (w && !NOISE.includes(w) && !unmapped.includes(w)) unmapped.push(w);
    }
  }
  // 검색어는 형태 · 재질 · 종류 순서로 최대 4개 (너무 길면 결과가 줄어든다)
  const pick = mapped.slice(0, 4);
  return {
    original,
    zh: pick.map((m) => m.zh).join(""),
    en: pick.map((m) => m.en).join(" "),
    koCore: pick.map((m) => m.ko).join(" "),
    concepts,
    mapped,
    unmapped,
    packQty: packQtyOf(original),
    cavities: Number.isFinite(cavities) ? cavities : null,
    method: "DICTIONARY",
    dictVersion: SOURCING_DICT_VERSION,
  };
}

/** 한국어 · 중국어 · 영어 문장에서 매칭용 개념 (사전 기반) */
export function conceptsOf(text: string): string[] {
  const t = text.toLowerCase().replace(/\s+/g, "");
  const out: string[] = [];
  for (const [ko, zh, en, c] of DICT) {
    if (t.includes(ko) || t.includes(zh) || t.includes(en.replace(/\s+/g, ""))) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/** 상품 종류 개념 (재질 · 크기 · 모양 형용사는 제외) */
export const TYPE_CONCEPTS = ["ice_tray", "mat", "drying_rack", "container", "baby_food", "tray", "plate", "bowl", "cutting_board", "stand", "mold", "organizer", "shelf", "pen"];
export const MATERIAL_CONCEPTS = ["silicone", "leather", "wood", "stainless"];
