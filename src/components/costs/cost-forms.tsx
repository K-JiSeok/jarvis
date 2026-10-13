"use client";

import { useActionState, useState, useTransition, type ComponentProps } from "react";

import { addRateCardAction, deleteRateCardAction, recordDetailAction, saveCostInputAction, saveCostSettingsAction } from "@/app/profit/cost-actions";
import { FormMessage } from "@/components/common/form-message";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { SALES_SCOPES } from "@/lib/costs/category";
import { SETTING_BASIS_LABELS, SETTING_DEFS, SETTING_KEYS, TAX_TYPE_LABELS, type SettingItems, type TaxType } from "@/lib/costs/settings";
import { INITIAL_FORM_STATE, type FormState } from "@/lib/forms";

const GROUP_LABELS = { IMPORT: "수입 (중국 → 국내)", DOMESTIC: "국내 입고 · 포장", SALES: "판매 (광고 · 기타)" } as const;
const pctOf = (v: number | undefined, percent: boolean) => (v == null ? "" : percent ? String(Math.round(v * 1_000_000) / 10_000) : String(v));

/** 설정 항목 칸 묶음 (기본 설정 · 상품별 덮어쓰기 공용). 빈 칸 = 미설정 */
function SettingFields({ prefix, items, compact = false }: { prefix: string; items: SettingItems; compact?: boolean }) {
  return (
    <div className="space-y-4">
      {(Object.keys(GROUP_LABELS) as (keyof typeof GROUP_LABELS)[]).map((g) => (
        <fieldset key={g} className="space-y-2">
          <legend className="text-sm font-semibold">{GROUP_LABELS[g]}</legend>
          <div className="grid gap-2 lg:grid-cols-2">
            {SETTING_KEYS.filter((k) => SETTING_DEFS[k].group === g).map((k) => {
              const def = SETTING_DEFS[k];
              const percent = def.unit === "RATE_OF_GOODS" || def.unit === "RATE_OF_PRICE";
              const it = items[k];
              return (
                <div key={k} className="rounded-md border p-2 text-xs" data-setting={k}>
                  <Label htmlFor={`${prefix}${k}_value`} className="block font-medium">
                    {def.label}
                    {def.hint && <span className="text-muted-foreground font-normal"> — {def.hint}</span>}
                  </Label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Input id={`${prefix}${k}_value`} name={`${prefix}${k}_value`} type="number" min={0} step="any" defaultValue={pctOf(it?.value, percent)} placeholder="미설정" className="h-8 w-28" />
                    <span className="text-muted-foreground">{percent ? "%" : def.unit === "PER_KG" ? "원/kg" : def.unit === "DIVISOR" ? "" : "원"}</span>
                    <NativeSelect name={`${prefix}${k}_basis`} defaultValue={it?.basis ?? "USER"} aria-label="근거" className="h-8 w-32 text-xs">
                      {Object.entries(SETTING_BASIS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name={`${prefix}${k}_vat`} defaultChecked={it?.vatIncluded ?? def.vatDefault} /> 부가세 포함
                    </label>
                  </div>
                  {!compact && <Input name={`${prefix}${k}_source`} defaultValue={it?.source ?? ""} placeholder="근거 (견적서 · 업체명 · 날짜)" maxLength={200} className="mt-1 h-7 text-xs" />}
                  {it?.date && <p className="text-muted-foreground mt-0.5">저장일 {it.date}</p>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function CostSettingsForm({ items, taxType, version }: { items: SettingItems; taxType: TaxType; version: string }) {
  const [state, action, pending] = useActionState(saveCostSettingsAction, INITIAL_FORM_STATE);
  return (
    <form key={version} action={action} className="space-y-4" data-testid="cost-settings-form">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tax_type" className="block">
            사업자 과세 유형 (부가세 처리)
          </Label>
          <NativeSelect id="tax_type" name="tax_type" defaultValue={taxType} className="w-48">
            {Object.entries(TAX_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
        <p className="text-muted-foreground max-w-xl text-xs">
          미확인이면 확인 비용 기준 이익을 만들지 않습니다. 일반과세자 = 매출 부가세 납부 · 세금계산서 받은 매입 부가세 공제 (공급가액 기준 이익). 간이과세자 계산은 소매업 부가가치율 15% 가정 — 세무 확인 필요.
        </p>
      </div>
      <SettingFields prefix="" items={items} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 중…" : "비용 설정 저장"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function RateCardAddForm() {
  const [state, action, pending] = useActionState(addRateCardAction, INITIAL_FORM_STATE);
  const [kind, setKind] = useState("SALES_FEE");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  return (
    <form action={action} className="space-y-3 text-sm" data-testid="rate-card-form">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rc-kind" className="block">
            종류
          </Label>
          <NativeSelect id="rc-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="w-48">
            <option value="SALES_FEE">판매 수수료</option>
            <option value="RG_INOUT">입출고비 (WING 표)</option>
            <option value="RG_DELIVERY">배송비 (WING 표)</option>
            <option value="RG_RETURN_PICKUP">반품 회수비 (WING 표)</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-scope" className="block">
            {kind === "SALES_FEE" ? "수수료 대분류" : "WING 비용 분류 (예: 주방 > 밀폐저장용기)"}
          </Label>
          {kind === "SALES_FEE" ? (
            <NativeSelect id="rc-scope" name="scope" className="w-48">
              {SALES_SCOPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          ) : (
            <Input id="rc-scope" name="scope" required maxLength={100} className="w-64" placeholder="주방 > 밀폐저장용기" />
          )}
        </div>
        {kind === "SALES_FEE" && (
          <div className="space-y-1.5">
            <Label htmlFor="rc-rate" className="block">
              수수료율 (%)
            </Label>
            <Input id="rc-rate" name="rate" type="number" step="any" min={0} max={100} className="w-24" required />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="rc-from" className="block">
            적용 시작일
          </Label>
          <Input id="rc-from" name="valid_from" type="date" defaultValue={today} required className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-checked" className="block">
            확인일
          </Label>
          <Input id="rc-checked" name="checked_on" type="date" defaultValue={today} required className="w-40" />
        </div>
        {kind !== "SALES_FEE" && (
          <div className="space-y-1.5">
            <Label htmlFor="rc-promo" className="block">
              할인가 종료일
            </Label>
            <Input id="rc-promo" name="promo_until" type="date" className="w-40" />
          </div>
        )}
      </div>
      {kind !== "SALES_FEE" && (
        <div className="space-y-1.5">
          <Label htmlFor="rc-table" className="block">
            WING 표 붙여 넣기 — 로켓그로스 비용/수수료 화면에서 카테고리를 고른 뒤 &apos;입출고비만 보기&apos; 또는 &apos;배송비만 보기&apos; 표를 판매가 구간 행까지 복사 (&apos;전체 보기&apos; 합계 표는 나눌 수 없어 쓰지 않음)
          </Label>
          <textarea id="rc-table" name="table" required rows={6} className="border-input w-full rounded-md border bg-transparent p-2 font-mono text-xs" placeholder={"~5,000원 미만 | 1,650원 할인가 925원 | …"} />
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="rc-label" className="block">
            출처 (어디서 확인했는지)
          </Label>
          <Input id="rc-label" name="source_label" required maxLength={200} className="w-80" placeholder="WING 로켓그로스 비용/수수료 화면" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rc-url" className="block">
            출처 주소
          </Label>
          <Input id="rc-url" name="source_url" type="url" maxLength={500} className="w-80" placeholder="https://" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "추가 중…" : "요율 추가"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function RateCardDeleteButton({ id }: { id: string }) {
  const [state, setState] = useState<FormState>(INITIAL_FORM_STATE);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setState(await deleteRateCardAction(id)))}>
        삭제
      </Button>
      <FormMessage state={state} />
    </span>
  );
}

export function RecordDetailButton({ productId }: { productId: string }) {
  const [state, setState] = useState<FormState>(INITIAL_FORM_STATE);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setState(await recordDetailAction(productId)))} data-testid="record-detail">
        {pending ? "저장 중…" : "지금 계산 이력 남기기"}
      </Button>
      <FormMessage state={state} />
    </span>
  );
}

export interface CostInputDefaults {
  salesScope: string | null;
  salesPath: string | null;
  feeGroup: string | null;
  categoryConfirmed: boolean;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  salePrice: number | null;
  sellerDiscount: number | null;
  storageDays: number | null;
  returnRate: number | null;
  hsCode: string | null;
  tariffRate: number | null;
  tariffBasis: string | null;
  tariffConfirmed: boolean;
  orderQty: number | null;
  unitsPerListing: number | null;
  unitCostKrw: number | null;
  unitCostBasis: string | null;
  overrides: SettingItems;
  memo: string | null;
}

const str = (v: number | string | null | undefined) => (v == null ? "" : String(v));
const pct = (v: number | null) => (v == null ? "" : String(Math.round(v * 1_000_000) / 10_000));

export function CostInputForm({ productId, d, feeGroups, guessBasis, observedPrice, version }: { productId: string; d: CostInputDefaults; feeGroups: string[]; guessBasis: string; observedPrice: number | null; version: string }) {
  const [state, action, pending] = useActionState(saveCostInputAction.bind(null, productId), INITIAL_FORM_STATE);
  const field = (name: string, label: string, value: string, extra: ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`ci-${name}`} className="block text-xs">
        {label}
      </Label>
      <Input id={`ci-${name}`} name={name} defaultValue={value} placeholder="모름" className="h-8 w-32" {...extra} />
    </div>
  );
  return (
    <form key={version} action={action} className="space-y-4 text-sm" data-testid="cost-input-form">
      <fieldset className="space-y-2">
        <legend className="font-semibold">카테고리 (판매자 등록 카테고리 기준)</legend>
        <p className="text-muted-foreground text-xs">추정: {guessBasis}</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ci-scope" className="block text-xs">
              판매 수수료 대분류
            </Label>
            <NativeSelect id="ci-scope" name="sales_scope" defaultValue={d.salesScope ?? ""} className="h-8 w-44">
              <option value="">모름</option>
              {SALES_SCOPES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </NativeSelect>
          </div>
          {field("sales_path", "세부 경로 (예외 요율 판단)", d.salesPath ?? "", { className: "h-8 w-64", type: "text", maxLength: 200, placeholder: "예: 보관/밀폐용기 > 아이스트레이/얼음틀" })}
          <div className="space-y-1">
            <Label htmlFor="ci-group" className="block text-xs">
              WING 비용 분류
            </Label>
            <NativeSelect id="ci-group" name="fee_group" defaultValue={d.feeGroup ?? ""} className="h-8 w-52">
              <option value="">모름</option>
              {feeGroups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="category_confirmed" defaultChecked={d.categoryConfirmed} /> WING 상품 등록 카테고리로 확인함
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">판매가 · 포장 (판매 단위 포장 후 실측)</legend>
        <div className="flex flex-wrap items-end gap-3">
          {field("sale_price", `판매가 (원, 비우면 관측가 ${observedPrice != null ? observedPrice.toLocaleString("ko-KR") : "없음"})`, str(d.salePrice), { type: "number", min: 1, className: "h-8 w-40" })}
          {field("seller_discount", "판매자 할인 (원)", str(d.sellerDiscount), { type: "number", min: 0 })}
          {field("length_cm", "가로 (cm)", str(d.lengthCm), { type: "number", step: "any", min: 0 })}
          {field("width_cm", "세로 (cm)", str(d.widthCm), { type: "number", step: "any", min: 0 })}
          {field("height_cm", "높이 (cm)", str(d.heightCm), { type: "number", step: "any", min: 0 })}
          {field("weight_kg", "무게 (kg)", str(d.weightKg), { type: "number", step: "any", min: 0 })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">수입 · 공급</legend>
        <div className="flex flex-wrap items-end gap-3">
          {field("order_qty", "주문 수량 (공급 단위, 비우면 MOQ)", str(d.orderQty), { type: "number", min: 1, className: "h-8 w-40" })}
          {field("units_per_listing", "판매 1개 = 공급 단위 몇 개", str(d.unitsPerListing), { type: "number", step: "any", min: 0 })}
          {field("unit_cost_krw", "공급 원가 직접 입력 (판매 1개당 원)", str(d.unitCostKrw), { type: "number", min: 0, className: "h-8 w-40" })}
          <NativeSelect name="unit_cost_basis" defaultValue={d.unitCostBasis ?? "USER"} aria-label="공급 원가 근거" className="h-8 w-32 text-xs">
            <option value="QUOTE">실제 견적</option>
            <option value="USER">사용자 기준값</option>
          </NativeSelect>
          {field("hs_code", "HS 코드", d.hsCode ?? "", { type: "text", inputMode: "numeric", maxLength: 10 })}
          {field("tariff_rate", "관세율 (%)", pct(d.tariffRate), { type: "number", step: "any", min: 0, max: 100 })}
          {field("tariff_basis", "관세율 근거", d.tariffBasis ?? "", { type: "text", maxLength: 200, className: "h-8 w-56", placeholder: "관세사 · 품목분류 사전심사 등" })}
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" name="tariff_confirmed" defaultChecked={d.tariffConfirmed} /> 관세율 확인됨
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-semibold">시나리오 (판매 후에만 알 수 있는 값 — 추정)</legend>
        <div className="flex flex-wrap items-end gap-3">
          {field("storage_days", "예상 보관일 (비우면 30~180일)", str(d.storageDays), { type: "number", min: 1, max: 730, className: "h-8 w-40" })}
          {field("return_rate", "예상 반품률 (%)", pct(d.returnRate), { type: "number", step: "any", min: 0, max: 100 })}
        </div>
      </fieldset>
      <details>
        <summary className="cursor-pointer font-semibold">이 상품만 다른 비용 (기본 설정은 그대로)</summary>
        <div className="mt-2">
          <SettingFields prefix="ov_" items={d.overrides} compact />
        </div>
      </details>
      {field("memo", "메모", d.memo ?? "", { type: "text", maxLength: 500, className: "h-8 w-full", placeholder: "" })}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "저장 · 계산 중…" : "저장하고 다시 계산"}
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
