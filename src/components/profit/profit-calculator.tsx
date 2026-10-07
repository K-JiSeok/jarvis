"use client";

import { startTransition, useActionState, useRef, useState } from "react";

import { saveScenarioAction } from "@/app/profit/actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { formatPercent, formatWon } from "@/lib/format";
import { INITIAL_FORM_STATE, type FormState } from "@/lib/forms";
import { calculateProfit, type ProfitResult } from "@/lib/profit/calculate";
import { parseScenarioForm, type AdMode } from "@/lib/profit/form";
import { toProfitInput } from "@/lib/profit/inputs";
import { COST_CURRENCIES, CURRENCY_LABELS, type CostCurrency, type ProfitScenarioInput } from "@/types/profit";

import { MissingNotes, ResultSummary } from "./profit-result";

const EMPTY: ProfitScenarioInput = {
  name: "기본",
  salePrice: null,
  unitCostAmount: null,
  unitCostCurrency: "KRW",
  exchangeRate: 1,
  intlShippingPerUnit: null,
  domesticShippingPerUnit: null,
  coupangFeeRate: null,
  logisticsFeePerUnit: null,
  adCostRate: null,
  adCostPerUnit: null,
  otherCostPerUnit: null,
  fixedCostTotal: null,
  expectedMonthlyUnits: null,
  memo: null,
};

const pct = (v: number | null) => (v == null ? "" : String(Math.round(v * 1000000) / 10000));
const num = (v: number | null) => (v == null ? "" : String(v));

/**
 * 수익성 입력 + 실시간 미리 보기. 입력할 때마다 브라우저에서 같은 순수 함수로 계산하고,
 * 저장하면 서버가 같은 함수로 다시 계산해 결과 행을 남긴다.
 * productId 가 없으면 저장 없이 계산만 한다.
 */
export function ProfitCalculator({
  productId,
  scenario,
  defaultSalePrice,
  categoryFeeRate,
  categoryName,
  isFirstScenario,
}: {
  productId: string | null;
  /** 수정할 시나리오 (없으면 새 시나리오) */
  scenario: (ProfitScenarioInput & { id: string; isPrimary: boolean }) | null;
  defaultSalePrice: number | null;
  categoryFeeRate: number | null;
  categoryName: string | null;
  isFirstScenario: boolean;
}) {
  const initial: ProfitScenarioInput = scenario ?? { ...EMPTY, salePrice: defaultSalePrice };
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<ProfitResult>(() => calculateProfit(toProfitInput(initial, categoryFeeRate)));
  const [expectedUnits, setExpectedUnits] = useState(initial.expectedMonthlyUnits);
  const [adMode, setAdMode] = useState<AdMode>(initial.adCostPerUnit != null ? "amount" : "rate");
  const [currency, setCurrency] = useState<CostCurrency>(initial.unitCostCurrency);
  const [feeBlank, setFeeBlank] = useState(initial.coupangFeeRate == null);
  const [inputErrors, setInputErrors] = useState<string[]>([]);

  const [state, formAction, pending] = useActionState(async (prev: FormState, formData: FormData) => {
    if (!productId) return prev;
    const next = await saveScenarioAction(productId, scenario?.id ?? null, prev, formData);
    // 새 시나리오를 저장했으면 다음 입력을 위해 기본값으로 비운다 (수정은 입력값 = 저장값이라 그대로 둔다)
    if (next.ok && !scenario) formRef.current?.reset();
    return next;
  }, INITIAL_FORM_STATE);

  function recalc() {
    const form = formRef.current;
    if (!form) return;
    const { input, errors } = parseScenarioForm(new FormData(form));
    setInputErrors(errors);
    setExpectedUnits(input.expectedMonthlyUnits);
    setFeeBlank(input.coupangFeeRate == null);
    setResult(calculateProfit(toProfitInput(input, categoryFeeRate)));
  }

  const feeSource = !feeBlank ? "직접 입력" : categoryFeeRate != null ? "카테고리 기본" : "-";
  const feeHint =
    categoryFeeRate != null
      ? `비우면 카테고리(${categoryName}) 기본 ${formatPercent(categoryFeeRate, 2)}`
      : categoryName
        ? `카테고리(${categoryName}) 기본 수수료율 없음 — 직접 입력`
        : "카테고리 미지정 — 직접 입력";

  return (
    <form
      ref={formRef}
      // form action 대신 onSubmit: React 의 자동 reset(이전 기본값으로 되돌림)과 재마운트 없이 결과 메시지를 유지한다
      onSubmit={(e) => {
        e.preventDefault();
        if (!productId) return;
        const formData = new FormData(e.currentTarget);
        startTransition(() => formAction(formData));
      }}
      onInput={recalc}
      onChange={recalc}
      // reset 이벤트는 값이 바뀌기 전에 온다: 표시용 상태는 기본값으로, 미리 보기는 값이 바뀐 뒤 다시 계산
      onReset={() => {
        setCurrency(initial.unitCostCurrency);
        setAdMode(initial.adCostPerUnit != null ? "amount" : "rate");
        setTimeout(recalc, 0);
      }}
      className="grid gap-6 lg:grid-cols-[3fr_2fr]"
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="시나리오 이름" id="pf-name">
            <Input id="pf-name" name="name" defaultValue={initial.name} maxLength={50} />
          </Field>
          <Field label="판매가 (원) *" id="pf-price" hint={!scenario && defaultSalePrice != null ? "현재 판매가 기준" : "쿠팡 노출가 (VAT 포함)"}>
            <Input id="pf-price" name="sale_price" type="number" min={0} step={1} defaultValue={num(initial.salePrice)} />
          </Field>
          <Field label="월 예상 판매량 (개)" id="pf-units">
            <Input id="pf-units" name="expected_monthly_units" type="number" min={0} step={1} defaultValue={num(initial.expectedMonthlyUnits)} />
          </Field>
        </div>

        <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">상품 원가</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="원가 *" id="pf-cost" hint="포장재 등은 기타 비용에">
              <Input id="pf-cost" name="unit_cost_amount" type="number" min={0} step="any" defaultValue={num(initial.unitCostAmount)} />
            </Field>
            <Field label="통화" id="pf-currency">
              <NativeSelect
                id="pf-currency"
                name="unit_cost_currency"
                defaultValue={initial.unitCostCurrency}
                onChange={(e) => setCurrency(e.target.value as CostCurrency)}
              >
                {COST_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="환율 (원)" id="pf-fx" hint={currency === "KRW" ? "원화는 1" : `1 ${currency} = ? 원 (직접 입력)`}>
              <Input
                id="pf-fx"
                name="exchange_rate"
                type="number"
                min={0.0001}
                step="any"
                disabled={currency === "KRW"}
                defaultValue={initial.unitCostCurrency === "KRW" ? "" : num(initial.exchangeRate)}
              />
            </Field>
          </div>
          {result.unitCostKrw != null && currency !== "KRW" && <p className="text-muted-foreground text-xs">원화 원가 {formatWon(result.unitCostKrw)}</p>}
        </fieldset>

        <fieldset className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-semibold">비용 (개당, 원) — 비우면 계산에서 제외</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="해외 배송비" id="pf-intl">
              <Input id="pf-intl" name="intl_shipping_per_unit" type="number" min={0} step={1} defaultValue={num(initial.intlShippingPerUnit)} />
            </Field>
            <Field label="국내 배송비" id="pf-domestic" hint="창고 입고까지">
              <Input id="pf-domestic" name="domestic_shipping_per_unit" type="number" min={0} step={1} defaultValue={num(initial.domesticShippingPerUnit)} />
            </Field>
            <Field label="로켓그로스 물류비" id="pf-logistics" hint="입출고·보관·배송">
              <Input id="pf-logistics" name="logistics_fee_per_unit" type="number" min={0} step={1} defaultValue={num(initial.logisticsFeePerUnit)} />
            </Field>
            <Field label="쿠팡 수수료율 (%) *" id="pf-fee" hint={feeHint}>
              <Input
                id="pf-fee"
                name="coupang_fee_rate"
                type="number"
                min={0}
                max={100}
                step="any"
                defaultValue={pct(initial.coupangFeeRate)}
                placeholder={categoryFeeRate != null ? pct(categoryFeeRate) : ""}
              />
            </Field>
            <Field label={adMode === "rate" ? "광고비 (매출 대비 %)" : "광고비 (개당 원)"} id="pf-ad">
              <div className="flex gap-1.5">
                <NativeSelect
                  name="ad_mode"
                  aria-label="광고비 입력 방식"
                  className="w-20 shrink-0 px-2"
                  defaultValue={initial.adCostPerUnit != null ? "amount" : "rate"}
                  onChange={(e) => setAdMode(e.target.value as AdMode)}
                >
                  <option value="rate">%</option>
                  <option value="amount">원</option>
                </NativeSelect>
                <Input
                  id="pf-ad"
                  name="ad_value"
                  type="number"
                  min={0}
                  step="any"
                  defaultValue={initial.adCostPerUnit != null ? num(initial.adCostPerUnit) : pct(initial.adCostRate)}
                />
              </div>
            </Field>
            <Field label="기타 비용" id="pf-other" hint="포장재·기타 플랫폼 비용">
              <Input id="pf-other" name="other_cost_per_unit" type="number" min={0} step={1} defaultValue={num(initial.otherCostPerUnit)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="초기 고정비 (원)" id="pf-fixed" hint="샘플·촬영·인증 등 1회성 → 손익분기 판매량">
              <Input id="pf-fixed" name="fixed_cost_total" type="number" min={0} step={1} defaultValue={num(initial.fixedCostTotal)} />
            </Field>
          </div>
        </fieldset>

        {productId && (
          <>
            <Field label="메모" id="pf-memo">
              <Input id="pf-memo" name="memo" defaultValue={initial.memo ?? ""} maxLength={1000} />
            </Field>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_primary" defaultChecked={scenario?.isPrimary ?? isFirstScenario} disabled={scenario?.isPrimary} className="size-4" />
                대표 시나리오 {isFirstScenario && !scenario && <span className="text-muted-foreground text-xs">(첫 시나리오는 자동 대표)</span>}
              </label>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "저장 중…" : scenario ? "수정 · 다시 계산" : "시나리오 저장"}
              </Button>
              <FormMessage state={state} />
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">계산 결과 (미리 보기)</h3>
          <span className="text-muted-foreground text-[10px]">
            {result.formulaVersion} · 자체 계산 · 수수료 {feeSource}
          </span>
        </div>
        <ResultSummary figures={result} expectedMonthlyUnits={expectedUnits} />
        {result.complete && (
          <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs tabular-nums">
            <dt>원가 (원화)</dt>
            <dd className="text-right">{formatWon(result.unitCostKrw)}</dd>
            <dt>쿠팡 수수료</dt>
            <dd className="text-right">{formatWon(result.feeAmount)}</dd>
            <dt>광고비</dt>
            <dd className="text-right">{formatWon(result.adCostAmount)}</dd>
            <dt>투자원가 (원가+배송비)</dt>
            <dd className="text-right">{formatWon(result.investmentPerUnit)}</dd>
          </dl>
        )}
        <MissingNotes
          missingRequired={result.missingRequired}
          omitted={result.omitted}
          errors={[...inputErrors, ...result.errors]}
          warnings={result.warnings}
        />
        <p className="text-muted-foreground text-[10px]">판매가는 VAT 포함 금액을 그대로 사용합니다 (부가세 정산은 반영하지 않음).</p>
      </div>
    </form>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}
