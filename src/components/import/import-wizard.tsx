"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { analyzeImportAction, previewImportAction, runImportAction, type AnalyzeResult, type PreviewResult } from "@/app/import/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import {
  FIELDS,
  IMPORT_CONFIDENCES,
  IMPORT_SOURCES,
  IMPORT_TYPE_LABELS,
  IMPORT_TYPES,
  isRatioField,
  MAX_DATA_ROWS,
  MAX_FILE_BYTES,
  type ImportConfidence,
  type ImportSource,
  type ImportType,
  type RatioUnit,
  type RowStatus,
} from "@/lib/import/core";
import { cn } from "@/lib/utils";
import { CONFIDENCE_LABELS, SOURCE_TYPE_LABELS } from "@/types/common";
import type { JobSummary } from "@/lib/repositories/imports";

type Step = "SELECT" | "MAPPING" | "PREVIEW" | "DONE";

const TYPE_HINTS: Record<ImportType, string> = {
  PRODUCT_SNAPSHOTS: "쿠팡 상품 ID · 수집일 필수. 가격·리뷰·판매량·전환율 등 → 상품 스냅샷",
  KEYWORD_METRICS: "키워드 · 수집일 필수. 검색량·상품 수·WING 비율 등 → 키워드 스냅샷",
  SEARCH_RANKS: "키워드 · 쿠팡 상품 ID · 수집일 · 순위 필수 → 키워드 검색 순위",
};

const STATUS_STYLE: Record<RowStatus, { label: string; cls: string }> = {
  OK: { label: "정상", cls: "text-emerald-700 dark:text-emerald-300" },
  WARNING: { label: "주의", cls: "text-amber-700 dark:text-amber-300" },
  ERROR: { label: "오류", cls: "text-destructive" },
  DUPLICATE: { label: "중복", cls: "text-muted-foreground" },
};

const STATUS_LABELS: Record<string, string> = {
  SUCCEEDED: "성공",
  PARTIAL: "부분 성공",
  FAILED: "실패",
  PROCESSING: "처리 중",
  ROLLED_BACK: "되돌림",
  PENDING: "대기",
};

function DuplicateNotice({ job }: { job: JobSummary }) {
  return (
    <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      같은 파일을 이미 가져왔습니다 ({new Date(job.createdAt).toLocaleString("ko-KR")}, {STATUS_LABELS[job.status] ?? job.status}). 같은 데이터가 두 번 들어가지
      않도록 다시 가져오지 않습니다. 다시 가져오려면 아래 이력에서{" "}
      <Link href={`/import?job=${job.id}`} className="underline">
        이전 가져오기
      </Link>
      를 먼저 되돌리세요.
    </p>
  );
}

export function ImportWizard() {
  const [step, setStep] = useState<Step>("SELECT");
  const [type, setType] = useState<ImportType>("PRODUCT_SNAPSHOTS");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [ratioUnits, setRatioUnits] = useState<Record<string, RatioUnit>>({});
  const [source, setSource] = useState<ImportSource>("MANUAL");
  const [confidence, setConfidence] = useState<ImportConfidence>("B");
  const [period, setPeriod] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<JobSummary | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"ANALYZE" | "PREVIEW" | "RUN" | null>(null);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const fields = FIELDS[type];

  function formData(): FormData {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("import_type", type);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("options", JSON.stringify({ source, confidence, salesPeriodDays: period ? Number(period) : null, ratioUnits }));
    return fd;
  }

  function reset() {
    setStep("SELECT");
    setFile(null);
    setAnalysis(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setMapping({});
    setRatioUnits({});
    setPeriod("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function analyze() {
    setError(null);
    if (!file) return setError("파일을 선택하세요.");
    if (file.size > MAX_FILE_BYTES) return setError(`파일이 너무 큽니다 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
    setBusy("ANALYZE");
    startTransition(async () => {
      const r = await analyzeImportAction(formData());
      setBusy(null);
      if (!r.ok) return setError(r.error);
      setAnalysis(r);
      const m: Record<number, string> = {};
      const units: Record<string, RatioUnit> = {};
      for (const c of r.matches) {
        m[c.index] = c.field ?? "";
        if (c.field && isRatioField(type, c.field)) units[c.field] = r.ratioSuggestions[c.index]?.[c.field] ?? "DECIMAL";
      }
      setMapping(m);
      setRatioUnits(units);
      setPreview(null);
      setStep("MAPPING");
    });
  }

  function setColumn(index: number, key: string) {
    setMapping((prev) => ({ ...prev, [index]: key }));
    if (key && isRatioField(type, key) && analysis) {
      setRatioUnits((prev) => ({ ...prev, [key]: prev[key] ?? analysis.ratioSuggestions[index]?.[key] ?? "DECIMAL" }));
    }
    setPreview(null);
  }

  function runPreview() {
    setError(null);
    setBusy("PREVIEW");
    startTransition(async () => {
      const r = await previewImportAction(formData());
      setBusy(null);
      if (!r.ok) return setError(r.error);
      setPreview(r);
      setStep("PREVIEW");
    });
  }

  function runImport() {
    if (running.current || !preview) return;
    const savable = preview.counts.ok + preview.counts.warning;
    if (savable === 0 && !confirm("저장할 수 있는 행이 없습니다. 실패 기록만 남기고 진행할까요?")) return;
    running.current = true;
    setError(null);
    setBusy("RUN");
    startTransition(async () => {
      const r = await runImportAction(formData());
      setBusy(null);
      running.current = false;
      if (!r.ok) return setError(r.error);
      setResult(r.job);
      setStep("DONE");
    });
  }

  const mappedKeys = Object.values(mapping).filter(Boolean);
  const mappedRatio = [...new Set(mappedKeys.filter((k) => isRatioField(type, k)))];
  const needsPeriod =
    type === "PRODUCT_SNAPSHOTS" &&
    mappedKeys.some((k) => ["sales_actual", "sales_estimated", "revenue_actual", "revenue_estimated"].includes(k)) &&
    !mappedKeys.includes("sales_period_days");
  const ambiguousOpen = analysis?.matches.filter((c) => c.status === "AMBIGUOUS" && !mapping[c.index]) ?? [];

  return (
    <div className="space-y-6">
      <ol className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        {(["SELECT", "MAPPING", "PREVIEW", "DONE"] as Step[]).map((s, i) => (
          <li key={s} className={cn("rounded-full border px-2.5 py-0.5", s === step && "bg-primary text-primary-foreground border-transparent")}>
            {i + 1}. {{ SELECT: "파일 선택", MAPPING: "컬럼 매핑", PREVIEW: "검증 · 미리 보기", DONE: "완료" }[s]}
          </li>
        ))}
      </ol>

      {/* 1. 유형 · 파일 ------------------------------------------------------------ */}
      <fieldset disabled={pending || step === "DONE"} className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {IMPORT_TYPES.map((t) => (
            <label key={t} className={cn("cursor-pointer rounded-lg border p-3 text-sm", type === t && "border-primary ring-primary/30 ring-2")}>
              <input
                type="radio"
                name="import_type"
                value={t}
                checked={type === t}
                onChange={() => {
                  setType(t);
                  setStep("SELECT");
                  setAnalysis(null);
                  setPreview(null);
                }}
                className="mr-2"
              />
              <span className="font-medium">{IMPORT_TYPE_LABELS[t]}</span>
              <p className="text-muted-foreground mt-1 text-xs">{TYPE_HINTS[t]}</p>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="import-file" className="block">
              파일 (.csv, .xlsx · 최대 10MB · {MAX_DATA_ROWS.toLocaleString("ko-KR")}행)
            </Label>
            <Input
              ref={fileInput}
              id="import-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="w-80 py-1.5"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setStep("SELECT");
                setAnalysis(null);
                setPreview(null);
                setError(null);
              }}
            />
          </div>
          <Button type="button" size="sm" onClick={analyze} disabled={!file || pending}>
            {busy === "ANALYZE" ? "파일 분석 중…" : "파일 분석"}
          </Button>
          {!file && <span className="text-muted-foreground text-xs">파일 없음</span>}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {/* 2. 매핑 --------------------------------------------------------------------- */}
      {analysis && step !== "DONE" && (
        <section className="space-y-4">
          <div className="text-muted-foreground text-xs">
            {analysis.file.name} · {analysis.file.format.toUpperCase()}
            {analysis.file.encoding && ` (${analysis.file.encoding})`} · {(analysis.file.size / 1024).toFixed(1)}KB · 데이터 {analysis.file.totalRows}행
          </div>
          {analysis.duplicate && <DuplicateNotice job={analysis.duplicate} />}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 font-normal">원본 컬럼</th>
                  <th className="py-2 font-normal">값 예시</th>
                  <th className="py-2 font-normal">JARVIS 필드</th>
                  <th className="py-2 font-normal">상태</th>
                </tr>
              </thead>
              <tbody>
                {analysis.matches.map((c) => {
                  const key = mapping[c.index] ?? "";
                  const examples = analysis.sample.map((r) => r[c.index]).filter(Boolean).slice(0, 3);
                  const ordered = [...fields].sort((a, b) => Number(c.candidates.includes(b.key)) - Number(c.candidates.includes(a.key)));
                  return (
                    <tr key={c.index} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 font-medium">{c.header || `(열 ${c.index + 1})`}</td>
                      <td className="text-muted-foreground max-w-56 truncate py-2 pr-3 text-xs">{examples.join(" · ") || "-"}</td>
                      <td className="py-2 pr-3">
                        <NativeSelect
                          aria-label={`${c.header} 연결 필드`}
                          value={key}
                          onChange={(e) => setColumn(c.index, e.target.value)}
                          disabled={pending}
                          className="h-8 w-60 text-xs"
                        >
                          <option value="">사용 안 함</option>
                          {ordered.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                              {f.required ? " *" : ""}
                              {c.candidates.includes(f.key) && c.status === "AMBIGUOUS" ? " (후보)" : ""}
                            </option>
                          ))}
                        </NativeSelect>
                        {key && isRatioField(type, key) && (
                          <NativeSelect
                            aria-label={`${c.header} 비율 단위`}
                            value={ratioUnits[key] ?? "DECIMAL"}
                            onChange={(e) => {
                              setRatioUnits((p) => ({ ...p, [key]: e.target.value as RatioUnit }));
                              setPreview(null);
                            }}
                            disabled={pending}
                            className="mt-1 h-8 w-60 text-xs"
                          >
                            <option value="PERCENT">숫자는 퍼센트 (15.5 = 15.5%)</option>
                            <option value="DECIMAL">숫자는 소수 (0.155 = 15.5%)</option>
                          </NativeSelect>
                        )}
                        {key && fields.find((f) => f.key === key)?.hint && (
                          <p className="text-muted-foreground mt-0.5 text-[11px]">{fields.find((f) => f.key === key)!.hint}</p>
                        )}
                      </td>
                      <td className="py-2 text-xs whitespace-nowrap">
                        {key ? (
                          <span className="text-emerald-700 dark:text-emerald-300">✓ {c.status === "AUTO" && c.field === key ? "자동" : "선택"}</span>
                        ) : c.status === "AMBIGUOUS" ? (
                          <span className="text-amber-700 dark:text-amber-300">선택 필요: {c.candidates.map((k) => fields.find((f) => f.key === k)?.label).join(" / ")}</span>
                        ) : (
                          <span className="text-muted-foreground">사용 안 함</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ambiguousOpen.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              뜻이 둘 이상인 컬럼은 자동으로 정하지 않습니다 ({ambiguousOpen.map((c) => c.header).join(", ")}). 실제/추정 중 맞는 것을 고르거나 사용 안 함으로 두세요. 예측
              판매량은 가져오지 않습니다.
            </p>
          )}
          {mappedRatio.length > 0 && (
            <p className="text-muted-foreground text-xs">
              비율 칸: &quot;%&quot; 가 붙은 값은 항상 퍼센트로 읽습니다. % 없는 숫자는 고른 단위로 읽습니다 (기본값은 열의 값으로 추정 — 미리 보기에서 변환 결과를 확인하세요).
            </p>
          )}

          <div className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-source" className="block">
                데이터 출처 (파일의 값이 어디서 왔는지)
              </Label>
              <NativeSelect id="import-source" value={source} onChange={(e) => (setSource(e.target.value as ImportSource), setPreview(null))} disabled={pending}>
                {IMPORT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_TYPE_LABELS[s]} ({s})
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-confidence" className="block">
                신뢰도
              </Label>
              <NativeSelect id="import-confidence" value={confidence} onChange={(e) => (setConfidence(e.target.value as ImportConfidence), setPreview(null))} disabled={pending}>
                {IMPORT_CONFIDENCES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {CONFIDENCE_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {needsPeriod && (
              <div className="space-y-1.5">
                <Label htmlFor="import-period" className="block">
                  판매량·매출 집계 기간 (일) *
                </Label>
                <Input
                  id="import-period"
                  type="number"
                  min={1}
                  max={366}
                  step={1}
                  value={period}
                  onChange={(e) => (setPeriod(e.target.value), setPreview(null))}
                  placeholder="예: 28"
                  disabled={pending}
                />
                <p className="text-muted-foreground text-[11px]">파일에 기간 열이 없어 모든 행에 같은 기간을 씁니다.</p>
              </div>
            )}
          </div>

          <Button type="button" size="sm" onClick={runPreview} disabled={pending}>
            {busy === "PREVIEW" ? "검증 중…" : "검증 · 미리 보기"}
          </Button>
        </section>
      )}

      {/* 3. 미리 보기 ------------------------------------------------------------------ */}
      {preview && step === "PREVIEW" && (
        <section className="space-y-4">
          {preview.mappingProblems.length > 0 ? (
            <ul className="text-destructive space-y-1 text-sm">
              {preview.mappingProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["총 행", preview.counts.total, ""],
                    ["정상", preview.counts.ok, "text-emerald-700 dark:text-emerald-300"],
                    ["주의 (일부 값 비움)", preview.counts.warning, "text-amber-700 dark:text-amber-300"],
                    ["오류 (저장 안 함)", preview.counts.error, "text-destructive"],
                    ["파일 내 중복 (건너뜀)", preview.counts.duplicate, "text-muted-foreground"],
                  ] as const
                ).map(([label, n, cls]) => (
                  <div key={label} className="rounded-md border px-3 py-2">
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className={cn("text-xl font-bold tabular-nums", cls)}>{n}</dd>
                  </div>
                ))}
              </dl>
              {preview.unknownProducts.length > 0 && (
                <p className="text-sm">
                  <Badge variant="destructive" className="mr-1.5">
                    등록되지 않은 상품 {preview.unknownProducts.length}개
                  </Badge>
                  <span className="font-mono">{preview.unknownProducts.join(", ")}</span> —{" "}
                  <Link href="/products" className="underline">
                    /products 에서 먼저 등록
                  </Link>
                  하세요 (자동으로 만들지 않습니다).
                </p>
              )}
              {preview.unknownKeywords.length > 0 && (
                <p className="text-sm">
                  <Badge variant="destructive" className="mr-1.5">
                    등록되지 않은 키워드 {preview.unknownKeywords.length}개
                  </Badge>
                  <span>{preview.unknownKeywords.join(", ")}</span> —{" "}
                  <Link href="/keywords" className="underline">
                    /keywords 에서 먼저 등록
                  </Link>
                  하세요.
                </p>
              )}
              {preview.duplicate && <DuplicateNotice job={preview.duplicate} />}

              <div className="max-h-[480px] overflow-auto rounded-md border">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-background sticky top-0">
                    <tr className="text-muted-foreground border-b text-left">
                      <th className="px-2 py-1.5 font-normal">행</th>
                      <th className="px-2 py-1.5 font-normal">상태</th>
                      {fields
                        .filter((f) => mappedKeys.includes(f.key) || ["discount_rate", "competition_intensity", "search_growth_rate", "sales_period_days"].includes(f.key))
                        .map((f) => (
                          <th key={f.key} className="px-2 py-1.5 font-normal whitespace-nowrap">
                            {f.label}
                          </th>
                        ))}
                      <th className="px-2 py-1.5 font-normal">메시지</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.rowNumber} className="border-b align-top last:border-0">
                        <td className="px-2 py-1.5 tabular-nums">{r.rowNumber}</td>
                        <td className={cn("px-2 py-1.5 font-medium whitespace-nowrap", STATUS_STYLE[r.status].cls)}>{STATUS_STYLE[r.status].label}</td>
                        {fields
                          .filter((f) => mappedKeys.includes(f.key) || ["discount_rate", "competition_intensity", "search_growth_rate", "sales_period_days"].includes(f.key))
                          .map((f) => (
                            <td key={f.key} className="px-2 py-1.5 whitespace-nowrap tabular-nums">
                              {r.converted[f.key] || <span className="text-muted-foreground">-</span>}
                            </td>
                          ))}
                        <td className="px-2 py-1.5">{r.messages.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.counts.total > preview.rows.length && (
                <p className="text-muted-foreground text-xs">문제 있는 행부터 {preview.rows.length}행만 표시합니다 (전체 {preview.counts.total}행).</p>
              )}
              <p className="text-muted-foreground text-xs">
                저장: 정상·주의 행만. 같은 대상·수집일·출처의 기존 스냅샷이 있으면 갱신하고, 파일에서 비어 있는 값은 기존 값을 지우지 않습니다. 점수는 자동으로 다시
                계산하지 않습니다.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={runImport} disabled={pending || !!preview.duplicate}>
                  {busy === "RUN" ? "가져오는 중… (창을 닫지 마세요)" : `가져오기 실행 (${preview.counts.ok + preview.counts.warning}행 저장)`}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setStep("MAPPING")} disabled={pending}>
                  매핑 수정
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {/* 4. 완료 ------------------------------------------------------------------------- */}
      {result && step === "DONE" && (
        <section className="space-y-3 rounded-lg border p-4">
          <p className="text-lg font-semibold">
            {{ SUCCEEDED: "가져오기 완료", PARTIAL: "부분 성공", FAILED: "가져오기 실패" }[result.status as "SUCCEEDED"] ?? result.status}
          </p>
          <p className="text-sm tabular-nums">
            총 {result.totalRows}행 · 성공 {result.insertedRows + result.updatedRows} (추가 {result.insertedRows} · 갱신 {result.updatedRows}) · 건너뜀 {result.skippedRows} · 실패{" "}
            {result.failedRows}
          </p>
          {result.errorSummary && <p className="text-muted-foreground text-xs">실패 사유: {result.errorSummary}</p>}
          <p className="text-muted-foreground text-xs">
            Dashboard 의 데이터 상태에 바로 반영됩니다. Opportunity Score 는 상품 상세에서 &quot;점수 다시 계산&quot; 을 눌러야 갱신됩니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={`/import?job=${result.id}`}>결과 상세</Link>
            </Button>
            <Button type="button" size="sm" onClick={reset}>
              새 파일 가져오기
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
