import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPLIANCE_LABELS, type ComplianceStatus } from "@/lib/automation/compliance";
import type { AutomationRunView, KeywordCandidateView } from "@/lib/repositories/automation";
import { cn } from "@/lib/utils";

import { CandidateActions, RunDiscoveryButton } from "./automation-forms";

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("ko-KR") : "-");

const STEP_LABELS: Record<string, string> = {
  "naver-volume": "1. 네이버 검색량 (추적 키워드)",
  "keyword-discovery": "2. 연관 키워드 → 후보",
  "auto-register": "3. 쿠팡 검색 수집 기록 → 미등록 상품 자동 등록",
  compliance: "4. 판매 가능성 사전 검토",
  analysis: "5. Score V1 미리 보기 · 수익성 · 준비 상태",
  pipeline: "파이프라인",
};
const RUN_STATUS: Record<AutomationRunView["status"], string> = { RUNNING: "실행 중", SUCCEEDED: "성공", PARTIAL: "일부 실패", FAILED: "실패" };
const TRIGGER: Record<AutomationRunView["triggeredBy"], string> = { MANUAL: "수동 (지금 실행)", EXTENSION_ALARM: "예약 (확장 프로그램 알람)" };

function stepCounts(c: Record<string, unknown>): string {
  return Object.entries(c)
    .filter(([, v]) => typeof v === "number" || typeof v === "boolean")
    .map(([k, v]) => `${k} ${typeof v === "boolean" ? (v ? "예" : "아니오") : n(v)}`)
    .join(" · ");
}

export function AutomationPanel({
  runs,
  candidates,
  totals,
  naverConfigured,
}: {
  runs: AutomationRunView[];
  candidates: { items: KeywordCandidateView[]; counts: Record<KeywordCandidateView["status"], number>; newBelow10: number };
  /** 상품 수 · 판매 가능성은 지금 DB 기준, 수익성 · V1 판정 수는 마지막 실행의 분석 단계 기준 */
  totals: { products: number; compliance: Partial<Record<ComplianceStatus, number>>; unscreened: number };
  naverConfigured: boolean;
}) {
  const last = runs[0] ?? null;
  const s = (last?.summary ?? {}) as Record<string, unknown>;
  const c = totals.compliance;
  const tiles: [string, string, string?][] = [
    ["새로 발견한 키워드 (마지막 실행)", n(s.newKeywordCandidates), `후보 대기 ${n(candidates.counts.NEW)} · 등록 ${n(candidates.counts.PROMOTED)} · 제외 ${n(candidates.counts.DISMISSED)}`],
    ["새로 등록한 상품 (마지막 실행)", n(s.newProducts), `전체 상품 ${n(totals.products)}`],
    ["중복 제거 (마지막 실행)", n(s.duplicatesRemoved), "이미 등록 · 옵션 반복 칸"],
    ["판매 불가로 제외", n(c.BLOCKED ?? 0), "사용자 확인만"],
    ["인증 · 브랜드 증빙 확인 필요", n((c.REQUIRES_CERTIFICATION ?? 0) + (c.REQUIRES_BRAND_PROOF ?? 0)), `인증 ${n(c.REQUIRES_CERTIFICATION ?? 0)} · 브랜드 ${n(c.REQUIRES_BRAND_PROOF ?? 0)} · 추가 확인 ${n(c.MANUAL_REVIEW ?? 0)}`],
    ["공급처 미확인", n(totals.products - (c.CLEARED ?? 0)), "공급처 데이터 출처 없음 — 확인 완료(사용자) 제외 전부"],
    ["수익성 분석 완료 (마지막 실행)", n(s.profitDone), "대표 시나리오 계산 결과 있음 · 원가는 직접 입력값뿐"],
    ["V1 최종 판정 가능 (마지막 실행)", n(s.v1Final), "9개 요소 모두 계산"],
    [
      "데이터 부족으로 판정 불가 (마지막 실행)",
      typeof s.v1Provisional === "number" || typeof s.v1Insufficient === "number" ? n(Number(s.v1Provisional ?? 0) + Number(s.v1Insufficient ?? 0)) : "-",
      `잠정 ${n(s.v1Provisional)} · 분석 불가 ${n(s.v1Insufficient)}`,
    ],
  ];

  return (
    <>
      <Card data-testid="automation-panel">
        <CardHeader>
          <CardTitle>0. 자동 발굴</CardTitle>
          <CardDescription>
            추적 키워드 → 네이버 검색량 · 연관 키워드 → 쿠팡 검색 수집 기록의 미등록 상품 자동 등록 → 판매 가능성 사전 검토 → Score V1 · 수익성. 점수 · 판정 기준은
            기존 V1 그대로이며, 자동 발굴 결과는 최종 판정이 아닙니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div data-testid="automation-last-run">
              {last ? (
                <>
                  마지막 실행 <strong>{dateTime.format(new Date(last.startedAt))}</strong> · {TRIGGER[last.triggeredBy]} ·{" "}
                  <span className={cn(last.status === "SUCCEEDED" ? "text-emerald-700 dark:text-emerald-300" : last.status === "RUNNING" ? "" : "text-destructive")}>
                    {RUN_STATUS[last.status]}
                  </span>
                  {last.finishedAt && <span className="text-muted-foreground"> ({Math.round((Date.parse(last.finishedAt) - Date.parse(last.startedAt)) / 1000)}초)</span>}
                </>
              ) : (
                <span className="text-muted-foreground">아직 자동 실행 기록이 없습니다.</span>
              )}
            </div>
            <RunDiscoveryButton />
          </div>
          {last?.error && (
            <p className="text-destructive text-xs" role="alert">
              오류: {last.error}
            </p>
          )}

          <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3" data-testid="automation-tiles">
            {tiles.map(([label, value, sub]) => (
              <div key={label} className="rounded-md border px-3 py-2">
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
                {sub && <dd className="text-muted-foreground text-xs">{sub}</dd>}
              </div>
            ))}
          </dl>
          {totals.unscreened > 0 && <p className="text-muted-foreground text-xs">판매 가능성 검토 전 상품 {totals.unscreened}개 — 다음 실행에서 검토합니다.</p>}

          {last && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs" data-testid="automation-steps">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-1.5 font-normal">단계</th>
                    <th className="py-1.5 font-normal">결과</th>
                    <th className="py-1.5 pl-3 font-normal">건수</th>
                    <th className="py-1.5 pl-3 font-normal">비고 · 실패 사유</th>
                  </tr>
                </thead>
                <tbody>
                  {last.steps.map((st) => (
                    <tr key={st.name} className="border-b align-top last:border-0" data-step={st.name} data-step-status={st.status}>
                      <td className="py-1.5 whitespace-nowrap">{STEP_LABELS[st.name] ?? st.name}</td>
                      <td className={cn("py-1.5 whitespace-nowrap", st.status === "FAILED" && "text-destructive", st.status === "SKIPPED" && "text-amber-700 dark:text-amber-300")}>
                        {st.status === "OK" ? "완료" : st.status === "SKIPPED" ? "건너뜀" : "실패"}
                      </td>
                      <td className="py-1.5 pl-3">{stepCounts(st.counts)}</td>
                      <td className="text-muted-foreground py-1.5 pl-3">{st.error ?? st.note ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-muted-foreground space-y-1 text-xs">
            <p>
              <strong>다음 자동 실행:</strong> JARVIS 확장 프로그램의 예약 알람이 하루 1회(마지막 예약 실행 20시간 뒤부터, 1시간마다 확인) 실행합니다. Chrome 이 켜져 있고 확장 프로그램에
              로그인돼 있으며, 이 PC 에서 JARVIS 서버가 실행 중이어야 합니다 (배포 서버 없음).
            </p>
            <p>
              <strong>자동이 아닌 것:</strong> 쿠팡 검색 결과 · 상품 페이지 수집은 확장 프로그램 패널의 버튼으로만 합니다 (자동 탭 열기 · 서버 수집 없음 — 이용약관 ·
              접근 제한 확인 전). 판매량 · 전환율 · 공급 원가는 연결된 출처가 없어 자동으로 채우지 않습니다.
              {!naverConfigured && " 네이버 검색광고 API 키가 없어 검색량 · 연관 키워드 단계는 건너뜁니다."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>키워드 후보 (자동 발견 {n(candidates.counts.NEW)}개)</CardTitle>
          <CardDescription>
            네이버 검색광고 키워드 도구의 연관 키워드 (공식 API · 네이버 검색 수요 참고 지표, 쿠팡 검색량 아님). 후보가 있다고 수요가 있다는 뜻은 아닙니다. 검색량 큰 순 상위{" "}
            {candidates.items.length}개 · 10 미만(값 모름) {n(candidates.newBelow10)}개 포함.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {candidates.items.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              {naverConfigured ? "아직 후보가 없습니다. 추적 키워드가 있으면 자동 발굴 실행 때 연관 키워드를 가져옵니다." : "네이버 검색광고 API 키가 없어 후보를 만들 출처가 없습니다."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs" data-testid="keyword-candidates">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-1.5 font-normal">후보 키워드</th>
                    <th className="py-1.5 text-right font-normal">월 검색량 (PC · 모바일)</th>
                    <th className="py-1.5 pl-3 font-normal">경쟁 (네이버 광고)</th>
                    <th className="py-1.5 pl-3 font-normal">시드 · 발견</th>
                    <th className="py-1.5 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {candidates.items.map((k) => (
                    <tr key={k.id} className="border-b align-top last:border-0" data-candidate={k.keyword}>
                      <td className="py-1.5 font-medium">{k.keyword}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {k.below10 ? <span className="text-muted-foreground">10 미만 (모름)</span> : n(k.searchVolume)}{" "}
                        <span className="text-muted-foreground">
                          ({n(k.monthlyPc)} · {n(k.monthlyMobile)})
                        </span>
                      </td>
                      <td className="py-1.5 pl-3">{k.compIdx ?? "-"}</td>
                      <td className="text-muted-foreground py-1.5 pl-3">
                        {k.seedKeyword} · {k.lastSeenOn} {k.seenCount > 1 ? `(${k.seenCount}회)` : ""}
                      </td>
                      <td className="py-1.5">
                        <CandidateActions id={k.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function ComplianceBadge({ status, decidedBy }: { status: ComplianceStatus | null; decidedBy: "AUTO" | "USER" | null }) {
  if (!status) return <Badge variant="outline">판매 가능성 미검토</Badge>;
  const tone =
    status === "BLOCKED"
      ? "border-red-300 text-red-700 dark:text-red-300"
      : status === "CLEARED"
        ? "border-emerald-300 text-emerald-700 dark:text-emerald-300"
        : "border-amber-300 text-amber-700 dark:text-amber-300";
  return (
    <Badge variant="outline" className={tone} data-compliance={status}>
      {COMPLIANCE_LABELS[status]} · {decidedBy === "USER" ? "사용자 확인" : "자동 사전 검토"}
    </Badge>
  );
}
