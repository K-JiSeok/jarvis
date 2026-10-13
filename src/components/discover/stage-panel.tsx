import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STAGE_LABELS, type Stage, type StageCounts } from "@/lib/discover/stage";

import { BulkStartSourcingForm } from "./stage-forms";

export interface ScopeItem {
  id: string;
  name: string;
  stage: Stage;
  blocker: string | null;
  cost: "CONFIRMED" | "ESTIMATE_ONLY" | "NOT_ANALYZABLE";
}

const COST_LABEL = { CONFIRMED: "확인 비용 계산 가능", ESTIMATE_ONLY: "추정 원가만", NOT_ANALYZABLE: "원가 계산 불가" } as const;

/** 발굴 → 후보 → 소싱 → 공급업체 → 원가 (PHASE 21). 단계는 사용자가 정하고, 자동 실행은 소싱 대상만 처리한다 */
export function StagePanel({ counts, shortlisted, scope }: { counts: StageCounts; shortlisted: { id: string; name: string }[]; scope: ScopeItem[] }) {
  const sourced = counts.SOURCED + counts.SUPPLIER_SELECTED;
  const cost = { CONFIRMED: 0, ESTIMATE_ONLY: 0, NOT_ANALYZABLE: 0 };
  for (const s of scope) cost[s.cost] += 1;
  const cells: [string, number, string][] = [
    ["발굴 상품", counts.total, "등록된 전체 상품"],
    ["소싱 검토 후보", counts.SHORTLISTED, "[후보로 선택] — 매입 확정 아님"],
    ["검토 제외", counts.REJECTED, `판매 불가 제외 ${counts.BLOCKED} · 판매 중단 ${counts.STOPPED} 별도`],
    ["소싱 진행", counts.inScope, "[소싱 시작]한 상품 = 자동 실행의 소싱 · 원가 대상"],
    ["공급 후보 확보", sourced, `공급업체 선택 ${counts.SUPPLIER_SELECTED} — 품질 · 가격 검증 아님`],
    ["원가 계산", cost.CONFIRMED + cost.ESTIMATE_ONLY, `확인 비용 ${cost.CONFIRMED} · 추정만 ${cost.ESTIMATE_ONLY}`],
  ];
  return (
    <Card data-testid="stage-panel">
      <CardHeader>
        <CardTitle>발굴 → 후보 → 소싱 → 공급업체 → 원가</CardTitle>
        <CardDescription>
          공급 후보 검색 링크 · 공급 후보 연결 · 원가 재계산 · 상세 원가는 사용자가 [소싱 시작]한 상품만 합니다. 발굴(키워드 · 상품 등록 · 판매 가능성 검토 · Score V1 미리 보기)은 전체 상품 그대로입니다. 단계는 누를 때만 바뀌고 자동 실행은 바꾸지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {cells.map(([label, n, sub]) => (
            <div key={label} className="rounded-md border p-2" data-stage-count={label}>
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{n}</p>
              <p className="text-muted-foreground text-[11px]">{sub}</p>
            </div>
          ))}
        </div>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">소싱 시작할 후보 고르기</h3>
          <BulkStartSourcingForm items={shortlisted} />
        </section>

        <section className="space-y-1">
          <h3 className="text-sm font-semibold">소싱 진행 상품 ({scope.length})</h3>
          {scope.length === 0 ? (
            <p className="text-muted-foreground text-xs">소싱 진행 상품이 없습니다 — 자동 실행의 소싱 · 원가 단계는 건너뜁니다 (기존 공급 후보 · 원가 기록은 그대로).</p>
          ) : (
            <ul className="space-y-1 text-xs" data-testid="scope-list">
              {scope.map((s) => (
                <li key={s.id} className="rounded border px-2 py-1" data-scope-stage={s.stage}>
                  <Link href={`/profit/cost?product=${s.id}`} className="font-medium hover:underline">
                    {s.name}
                  </Link>{" "}
                  · {STAGE_LABELS[s.stage]} · {COST_LABEL[s.cost]}
                  {s.blocker && <span className="text-muted-foreground"> — {s.blocker}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-muted-foreground text-xs">
          자동으로 되는 것: 키워드 · 검색량 수집(네이버 API), 쿠팡 검색 수집 기록의 상품 등록, 판매 가능성 사전 검토, 소싱 대상의 검색어 생성 · 환율 · 원가 재계산. 직접 해야 하는 것: 쿠팡 검색 · 상품 페이지 수집(확장 프로그램), 공급 페이지 열기 · 저장(확장 프로그램 — 공급 사이트 자동 검색 없음), 공급업체 선택, 비용 견적 입력. 예약 실행은 Chrome · 확장 프로그램 로그인 · 로컬 서버가 켜져 있을 때만 됩니다.
        </p>
      </CardContent>
    </Card>
  );
}
