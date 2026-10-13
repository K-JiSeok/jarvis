import { COST_STATE_LABELS, costStates, type DetailResult, type Line, type Status } from "@/lib/costs/detail";
import { RATE_KIND_LABELS, SIZE_LABELS } from "@/lib/costs/rate-cards";
import { cn } from "@/lib/utils";

const won = (n: number | null | undefined) => (n == null ? "-" : `${Math.round(n).toLocaleString("ko-KR")}원`);
const pct = (n: number | null | undefined) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);
const range = (a: number | null, b: number | null) => (a == null ? "-" : a === b ? won(a) : `${won(a)} ~ ${won(b)}`);

const STATUS_LABEL: Record<Status, string> = { CONFIRMED: "확인", ESTIMATED: "추정", UNKNOWN: "미확인" };
const STATUS_TONE: Record<Status, string> = {
  CONFIRMED: "border-emerald-300 text-emerald-700 dark:text-emerald-300",
  ESTIMATED: "border-amber-300 text-amber-700 dark:text-amber-300",
  UNKNOWN: "border-red-300 text-red-700 dark:text-red-300",
};
const GROUP_LABEL: Record<Line["group"], string> = { SUPPLY: "매입", IMPORT: "수입", DOMESTIC: "국내 준비", COUPANG: "쿠팡 판매", SALES: "판매 기타", SCENARIO: "시나리오", TAX: "부가세" };

export function StatusChip({ s }: { s: Status }) {
  return <span className={cn("rounded border px-1.5 py-0.5 text-[11px] whitespace-nowrap", STATUS_TONE[s])}>{STATUS_LABEL[s]}</span>;
}

export function CostStateChips({ result }: { result: DetailResult }) {
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="cost-state">
      {costStates(result).map((k) => (
        <span key={k} data-cost-state={k} className={cn("rounded border px-1.5 py-0.5 text-[11px]", k === "EXPECTED_LOSS" || k === "NOT_ANALYZABLE" || k === "REQUIRED_UNKNOWN" ? "border-red-300 text-red-700 dark:text-red-300" : k === "EXPECTED_PROFIT" || k === "COST_COMPUTABLE" ? "border-emerald-300 text-emerald-700 dark:text-emerald-300" : "border-amber-300 text-amber-700 dark:text-amber-300")}>
          {COST_STATE_LABELS[k]}
        </span>
      ))}
    </span>
  );
}

export function CostResult({ result: d }: { result: DetailResult }) {
  const counts = { CONFIRMED: 0, ESTIMATED: 0, UNKNOWN: 0 } as Record<Status, number>;
  d.lines.forEach((l) => (counts[l.status] += 1));
  return (
    <div className="space-y-5 text-sm" data-testid="cost-result" data-status={d.status}>
      <div className="flex flex-wrap items-center gap-2">
        <CostStateChips result={d} />
        <span className="text-muted-foreground text-xs">
          판매가 {won(d.salePrice)}
          {d.discount ? ` (판매가 ${won(d.listPrice)} − 판매자 할인 ${won(d.discount)})` : ""} · 크기 {d.size ? `${SIZE_LABELS[d.size.type]} (${d.size.status === "CONFIRMED" ? "실측" : "추정"})` : "미확인"} · 비용 항목 확인 {counts.CONFIRMED} · 추정 {counts.ESTIMATED} · 미확인 {counts.UNKNOWN} · {d.version}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <section className="rounded-md border p-3" data-result="A">
          <h3 className="font-semibold">A. 확인된 비용 기준</h3>
          {d.confirmed.computable && d.confirmed.outcome ? (
            <div className="mt-1 space-y-1">
              <p className={cn("text-lg font-semibold tabular-nums", d.confirmed.outcome.profit < 0 && "text-red-600 dark:text-red-400")}>
                이익 {won(d.confirmed.outcome.profit)} · 마진 {pct(d.confirmed.outcome.margin)}
              </p>
              <p className="text-muted-foreground text-xs">
                매출(공급가액) {won(d.confirmed.outcome.revenue)} − 비용 {won(d.confirmed.outcome.totalCost)} · 손익분기 판매가 {won(d.confirmed.breakEven)}
              </p>
              <p className="text-muted-foreground text-xs">
                목표 마진 판매가: {d.confirmed.targets.map((t) => `${Math.round(t.margin * 100)}% ${won(t.price)}`).join(" · ")}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300">제외: {d.confirmed.excluded.join(" / ")}</p>
            </div>
          ) : (
            <div className="mt-1 space-y-1 text-xs">
              <p className="font-medium text-red-700 dark:text-red-300">확정 이익을 표시하지 않음 — 확인되지 않은 필수 항목 {d.confirmed.blocking.length}개</p>
              <ul className="text-muted-foreground list-disc pl-4">
                {d.confirmed.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <section className="rounded-md border p-3" data-result="B">
          <h3 className="font-semibold">B. 추정 비용 포함 시나리오</h3>
          {d.estimated.computable && d.estimated.best && d.estimated.worst ? (
            <div className="mt-1 space-y-1">
              <p className="text-lg font-semibold tabular-nums">
                {won(d.estimated.worst.profit)} ~ {won(d.estimated.best.profit)}
              </p>
              <p className="text-muted-foreground text-xs">
                마진 {pct(d.estimated.worst.margin)} ~ {pct(d.estimated.best.margin)} · 손익분기 판매가 {won(d.estimated.breakEven.best)} ~ {won(d.estimated.breakEven.worst)}
              </p>
              <p className="text-muted-foreground text-xs">
                목표 마진 판매가: {d.estimated.targets.map((t) => `${Math.round(t.margin * 100)}% ${won(t.best)}~${won(t.worst)}`).join(" · ")}
              </p>
              {d.estimated.omitted.length > 0 && <p className="text-xs text-red-700 dark:text-red-300">미포함 (값 없음 — 0 으로 보지 않음): {d.estimated.omitted.join(", ")} → 실제 이익은 더 낮음</p>}
            </div>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">공급 원가 또는 판매가가 없어 시나리오를 만들 수 없습니다.</p>
          )}
        </section>
        <section className="rounded-md border p-3" data-result="C">
          <h3 className="font-semibold">C. 산출 불가 · 확인이 필요한 항목</h3>
          <ul className="mt-1 space-y-1 text-xs">
            {d.insufficient.length === 0 && <li className="text-muted-foreground">없음</li>}
            {d.insufficient.map((x) => (
              <li key={x.key}>
                <span className="font-medium">{x.label}</span> — <span className="text-muted-foreground">{x.reason}</span>
                {x.howTo !== "-" && <span className="text-blue-700 dark:text-blue-300"> → {x.howTo}</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {d.warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
          {d.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <h3 className="mb-1 font-semibold">비용 항목 (판매 1개 · VAT 포함 실제 지출 · 괄호 안은 공제 가능한 부가세)</h3>
        <table className="w-full min-w-[820px] text-xs" data-testid="cost-lines">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-1.5 font-normal">구분</th>
              <th className="py-1.5 font-normal">항목</th>
              <th className="py-1.5 font-normal">상태</th>
              <th className="py-1.5 text-right font-normal">금액</th>
              <th className="py-1.5 pl-3 font-normal">계산식 · 근거</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.key} className="border-b align-top last:border-0" data-line={l.key} data-line-status={l.status}>
                <td className="text-muted-foreground py-1.5 pr-2 whitespace-nowrap">{GROUP_LABEL[l.group]}</td>
                <td className="py-1.5 pr-2">
                  {l.label}
                  {l.required ? "" : <span className="text-muted-foreground"> (선택 · 시나리오)</span>}
                </td>
                <td className="py-1.5 pr-2">
                  <StatusChip s={l.status} />
                </td>
                <td className="py-1.5 text-right whitespace-nowrap tabular-nums">
                  {range(l.min, l.max)}
                  {l.vatMax > 0 && <span className="text-muted-foreground"> ({range(l.vatMin, l.vatMax)})</span>}
                </td>
                <td className="text-muted-foreground py-1.5 pl-3">{l.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {d.storageTable && (
          <section>
            <h3 className="mb-1 font-semibold">보관 기간별 보관비 (개당 · VAT 포함)</h3>
            <table className="text-xs" data-testid="storage-table">
              <tbody>
                {d.storageTable.map((s) => (
                  <tr key={s.days}>
                    <td className="pr-4">{s.days}일</td>
                    <td className="tabular-nums">{won(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground mt-1 text-xs">판매 속도를 몰라 기간별로만 보여 줍니다 (실제 보관일 아님).</p>
          </section>
        )}
        {d.qtyTable.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold">주문 수량별 도착 원가 (판매 1개 · 쿠팡 비용 전)</h3>
            <table className="text-xs" data-testid="qty-table">
              <tbody>
                {d.qtyTable.map((q) => (
                  <tr key={q.qty}>
                    <td className="pr-4">{q.qty.toLocaleString("ko-KR")}개</td>
                    <td className="pr-4">{q.unitPrice}</td>
                    <td className="pr-4 tabular-nums">{range(q.landedMin, q.landedMax)}</td>
                    <td className="text-muted-foreground">{q.unknown ? `미확인 ${q.unknown}개 제외` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      <section>
        <h3 className="mb-1 font-semibold">적용한 요율</h3>
        <ul className="space-y-0.5 text-xs">
          {d.usedCards.map((c) => (
            <li key={c.id}>
              <span className="font-medium">{RATE_KIND_LABELS[c.kind]}</span> · {c.scope} · {c.label} · 확인일 {c.checkedOn} · {c.verification === "OFFICIAL_MANUAL" ? "공식 페이지 수기 확인" : "사용자 입력"}
              {c.promo ? " · 할인가 적용" : ""}
              {c.warnings.filter((w) => !/API 자동 갱신 아님/.test(w)).map((w) => (
                <span key={w} className="text-amber-700 dark:text-amber-300"> · {w}</span>
              ))}
            </li>
          ))}
        </ul>
        {d.release && <p className="text-muted-foreground mt-1 text-xs">반출(재고 회수) 시: 개당 {won(d.release.perUnit)} (월 {d.release.freePerMonth}개 무료, 운송비 별도) — 판매 원가에는 넣지 않음</p>}
      </section>
    </div>
  );
}
