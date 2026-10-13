import type { Metadata } from "next";
import Link from "next/link";

import { CostSettingsForm, RateCardAddForm, RateCardDeleteButton } from "@/components/costs/cost-forms";
import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { bandLabel, cardFreshness, pickCard, RATE_KIND_LABELS, SIZE_LABELS, type BandTable, type RateCard, type SalesFeeRates } from "@/lib/costs/rate-cards";
import { getCostSettings, listRateCards } from "@/lib/repositories/costs";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "비용 설정 · 요율표" };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

function summary(c: RateCard): string {
  if (c.kind === "SALES_FEE") {
    const r = c.rates as unknown as SalesFeeRates;
    return `${(r.rate * 100).toFixed(1)}%${r.exceptions.length ? ` (예외 ${r.exceptions.length}개: ${r.exceptions.map((e) => `${e.path} ${(e.rate * 100).toFixed(1)}%`).join(", ")})` : ""}`;
  }
  if (c.kind === "SIZE_RULE") return (c.rates as { types: { label: string; maxSumCm: number; maxKg: number }[] }).types.map((t) => `${t.label} ≤${t.maxSumCm}cm · ≤${t.maxKg}kg`).join(" / ");
  if (c.kind === "RG_STORAGE") return (c.rates as { tiers: { fromDay: number; toDay: number | null; base: number; promo: number | null }[] }).tiers.map((t) => `${t.fromDay}~${t.toDay ?? ""}일 ${t.promo != null ? `${t.promo}(기본 ${t.base})` : t.base}원/CBM·일`).join(" · ");
  if (c.kind === "RG_RELEASE") return `개당 ${(c.rates as { perUnit: number }).perUnit}원 (월 ${(c.rates as { freePerMonth: number }).freePerMonth}개 무료)`;
  if (c.kind === "RG_RESTOCK") {
    const r = c.rates as { bands: [number, number | null][]; base: number[]; promo: number[] };
    return r.bands.map((b, i) => `${bandLabel(b)} ${r.promo[i]}(기본 ${r.base[i]})`).join(" · ");
  }
  const t = c.rates as unknown as BandTable;
  return `${t.bands.length}구간 × ${t.sizes.length}유형 · 기본 ${t.sizes.map((s, j) => `${SIZE_LABELS[s]} ${t.base[j]}`).join(" · ")}`;
}

export default async function RatesPage() {
  const title = "비용 설정 · 요율표";
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={title} />
        <LoginRequired next="/profit/rates" configured={isSupabaseConfigured()} />
      </>
    );
  }
  const [cards, settings] = await Promise.all([listRateCards(), getCostSettings()]);
  const t = today();
  return (
    <>
      <PageHeader title={title} description="반복해서 쓰는 수입 · 국내 비용과 쿠팡 로켓그로스 요율을 관리합니다. 요율은 코드에 고정하지 않고 적용 시작일 · 출처 · 확인일과 함께 저장합니다." />
      <Card>
        <CardHeader>
          <CardTitle>반복 비용 설정</CardTitle>
          <CardDescription>
            항목마다 실제 견적 · 사용자 기준값 · 추정 기본값을 구분합니다. 비운 항목은 미설정(0원 아님)이라 확인 비용 기준 이익을 만들지 않습니다. 상품마다 다르면 <Link href="/profit/cost" className="underline">상세 원가</Link>에서 그 상품만 덮어씁니다. 마지막 저장 {settings.updatedAt ? settings.updatedAt.slice(0, 16).replace("T", " ") : "없음"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CostSettingsForm items={settings.items} taxType={settings.taxType} version={settings.updatedAt ?? "new"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>요율표 ({cards.length}행)</CardTitle>
          <CardDescription>
            시스템 요율 = 쿠팡 WING · 판매자 도움말 화면을 사람이 읽어 옮긴 값 (API 자동 갱신 아님 — WING 비용표는 판매자 로그인 화면이라 자동 수집하지 않음). 금액은 모두 VAT 별도. 같은 종류 · 범위면 내가 넣은 요율이 우선하고, 요율이 바뀌어도 과거 계산 이력은 당시 값 그대로입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-xs" data-testid="rate-cards">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-1.5 font-normal">종류</th>
                <th className="py-1.5 font-normal">범위</th>
                <th className="py-1.5 font-normal">요율</th>
                <th className="py-1.5 font-normal">적용</th>
                <th className="py-1.5 font-normal">출처 · 확인</th>
                <th className="py-1.5 font-normal" />
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const active = pickCard(cards, c.kind, c.scope, t)?.id === c.id;
                const warn = cardFreshness(c, t).filter((w) => !/API 자동 갱신 아님/.test(w));
                return (
                  <tr key={c.id} className="border-b align-top last:border-0" data-rate-card={c.kind} data-owner={c.ownerId ? "user" : "system"}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{RATE_KIND_LABELS[c.kind]}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{c.scope}</td>
                    <td className="text-muted-foreground max-w-md py-1.5 pr-2">{summary(c)}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {c.validFrom}~{c.validTo ?? ""}
                      {c.promoUntil ? ` · 할인가 ~${c.promoUntil}` : ""}
                      <br />
                      <span className={active ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}>{active ? "지금 적용" : "적용 안 함 (더 최신 · 내 요율 있음)"}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {c.sourceUrl ? (
                        <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                          {c.sourceLabel}
                        </a>
                      ) : (
                        c.sourceLabel
                      )}
                      <br />
                      확인일 {c.checkedOn} · {c.verification === "OFFICIAL_MANUAL" ? "공식 페이지 수기 확인" : "사용자 입력"}
                      {c.note && <span className="text-muted-foreground"> · {c.note}</span>}
                      {warn.map((w) => (
                        <span key={w} className="block text-amber-700 dark:text-amber-300">
                          {w}
                        </span>
                      ))}
                    </td>
                    <td className="py-1.5">{c.ownerId && <RateCardDeleteButton id={c.id} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>요율 추가 · 갱신</CardTitle>
          <CardDescription>쿠팡 요율이 바뀌었거나 내 상품 카테고리의 요율표가 없을 때, WING 화면에서 확인한 값을 새 적용 시작일로 추가합니다 (기존 행은 수정하지 않음).</CardDescription>
        </CardHeader>
        <CardContent>
          <RateCardAddForm />
        </CardContent>
      </Card>
    </>
  );
}
