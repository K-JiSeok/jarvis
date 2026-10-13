/**
 * 공급 후보 추천 순서 (PHASE 22 · supply-rank-v1) — 순수 함수. 자동으로 [선택]하지 않는다 (최종 선정은 사용자).
 *
 * 순서 기준 (위에서부터 먼저 비교 — 점수 합산 없음, 근거를 그대로 보여 준다)
 *   1. 제품 일치도: 확정 > 유사 > 불명확 (불명확만 있으면 "추천 없음 — 같은 상품인지 먼저 확인")
 *   2. 추정 도착 원가 (판매 1개, 미확인 비용 제외 하한의 가운데 값) 낮은 순 — 원가 없으면 뒤로
 *   3. 최소 주문 수량 낮은 순 (초도 부담)
 *   4. 공급업체 운영 연차 높은 순 (사이트 표시값, 없으면 뒤로)
 * 허용 원가(목표 마진 30%)가 있으면 이내 · 초과를 함께 표시한다.
 */

export const SUPPLY_RANK_VERSION = "supply-rank-v1";

export interface RankCandidate {
  linkId: string;
  title: string;
  matchLevel: "HIGH" | "SIMILAR" | "UNCLEAR";
  userStatus: "CANDIDATE" | "SELECTED" | "REJECTED";
  landed: { min: number; max: number } | null;
  moq: number | null;
  supplierYears: number | null;
}

export interface Ranked extends RankCandidate {
  rank: number;
  landedMid: number | null;
  reasons: string[];
  withinTarget: boolean | null;
}

const LV = { HIGH: 0, SIMILAR: 1, UNCLEAR: 2 } as const;
const LV_LABEL = { HIGH: "일치 확정", SIMILAR: "유사", UNCLEAR: "일치 불명확" } as const;

export function rankSuppliers(cands: RankCandidate[], allowedCost30: number | null): { ranked: Ranked[]; recommended: Ranked | null; note: string } {
  const active = cands.filter((c) => c.userStatus !== "REJECTED");
  const mid = (c: RankCandidate) => (c.landed ? Math.round((c.landed.min + c.landed.max) / 2) : null);
  const sorted = [...active].sort((a, b) => {
    if (LV[a.matchLevel] !== LV[b.matchLevel]) return LV[a.matchLevel] - LV[b.matchLevel];
    const ma = mid(a);
    const mb = mid(b);
    if (ma != null && mb != null && ma !== mb) return ma - mb;
    if ((ma == null) !== (mb == null)) return ma == null ? 1 : -1;
    if (a.moq != null && b.moq != null && a.moq !== b.moq) return a.moq - b.moq;
    if ((a.moq == null) !== (b.moq == null)) return a.moq == null ? 1 : -1;
    return (b.supplierYears ?? -1) - (a.supplierYears ?? -1);
  });
  const ranked: Ranked[] = sorted.map((c, i) => {
    const m = mid(c);
    const within = m != null && allowedCost30 != null ? m <= allowedCost30 : null;
    const reasons = [
      LV_LABEL[c.matchLevel],
      m != null ? `도착 원가 약 ${m.toLocaleString("ko-KR")}원 (미확인 비용 제외)` : "도착 원가 계산 불가",
      c.moq != null ? `MOQ ${c.moq}` : "MOQ 확인 불가",
      c.supplierYears != null ? `업체 ${c.supplierYears}년` : "업체 연차 확인 불가",
    ];
    if (within != null) reasons.push(within ? `마진 30% 원가 상한(${allowedCost30!.toLocaleString("ko-KR")}원) 이내` : `마진 30% 원가 상한(${allowedCost30!.toLocaleString("ko-KR")}원) 초과`);
    return { ...c, rank: i + 1, landedMid: m, reasons, withinTarget: within };
  });
  const top = ranked[0] ?? null;
  if (!top) return { ranked, recommended: null, note: "공급 후보 없음" };
  if (top.matchLevel === "UNCLEAR") return { ranked, recommended: null, note: "추천 없음 — 일치가 불명확한 후보뿐입니다 (같은 상품인지 먼저 확인)" };
  return { ranked, recommended: top, note: `추천 1순위: ${top.title.slice(0, 40)} — ${top.reasons.join(" · ")} (자동 선택하지 않음)` };
}
