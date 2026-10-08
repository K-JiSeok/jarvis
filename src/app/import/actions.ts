"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { todayKst } from "@/lib/forms";
import {
  autoMatch,
  displayCell,
  FIELDS,
  IMPORT_CONFIDENCES,
  IMPORT_SOURCES,
  IMPORT_TYPES,
  isRatioField,
  prepareRows,
  suggestRatioUnit,
  validateMapping,
  type ColumnMapping,
  type ColumnMatch,
  type ImportOptions,
  type ImportType,
  type RatioUnit,
  type RowStatus,
} from "@/lib/import/core";
import { ImportFileError, parseUploadedFile, type ParsedFile } from "@/lib/import/parse-file";
import { DuplicateImportError, findCompletedJob, loadLookups, rollbackImport, runImport, type JobSummary } from "@/lib/repositories/imports";

/*
 * /import Server Functions. 파일은 단계마다 다시 받아 서버에서 다시 읽는다 (브라우저가 바꾼 데이터를 믿지 않는다).
 * 분석 → 미리 보기 → 실행. 실행 직전에도 같은 검증을 다시 한다.
 */

type Fail = { ok: false; error: string };

export interface AnalyzeResult {
  ok: true;
  file: { name: string; size: number; format: string; encoding: string | null; totalRows: number };
  headers: string[];
  sample: string[][];
  matches: ColumnMatch[];
  /** 비율 필드별 단위 기본값 (열 값으로 추정, 화면에서 변경 가능) */
  ratioSuggestions: Record<number, Record<string, RatioUnit>>;
  duplicate: JobSummary | null;
}

export interface PreviewRow {
  rowNumber: number;
  status: RowStatus;
  messages: string[];
  converted: Record<string, string>;
}

export interface PreviewResult {
  ok: true;
  mappingProblems: string[];
  counts: { total: number; ok: number; warning: number; error: number; duplicate: number };
  rows: PreviewRow[];
  unknownProducts: string[];
  unknownKeywords: string[];
  duplicate: JobSummary | null;
}

export type RunResult = { ok: true; job: JobSummary } | { ok: false; error: string; duplicate?: JobSummary };

function readType(formData: FormData): ImportType | null {
  const t = String(formData.get("import_type") ?? "");
  return (IMPORT_TYPES as readonly string[]).includes(t) ? (t as ImportType) : null;
}

/** 브라우저가 보낸 매핑·옵션을 허용 값만 남겨 읽는다 */
function readMappingAndOptions(type: ImportType, formData: FormData, headerCount: number): { mapping: ColumnMapping; options: ImportOptions } | string {
  let mappingRaw: unknown;
  let optionsRaw: { source?: unknown; confidence?: unknown; salesPeriodDays?: unknown; ratioUnits?: unknown };
  try {
    mappingRaw = JSON.parse(String(formData.get("mapping") ?? "{}"));
    optionsRaw = JSON.parse(String(formData.get("options") ?? "{}"));
  } catch {
    return "매핑 정보를 읽을 수 없습니다.";
  }
  const keys = new Set(FIELDS[type].map((f) => f.key));
  const mapping: ColumnMapping = {};
  for (const [i, k] of Object.entries((mappingRaw ?? {}) as Record<string, unknown>)) {
    const index = Number(i);
    if (!Number.isInteger(index) || index < 0 || index >= headerCount) continue;
    mapping[index] = typeof k === "string" && keys.has(k) ? k : "";
  }
  const source = (IMPORT_SOURCES as readonly string[]).includes(String(optionsRaw.source)) ? (optionsRaw.source as ImportOptions["source"]) : null;
  const confidence = (IMPORT_CONFIDENCES as readonly string[]).includes(String(optionsRaw.confidence)) ? (optionsRaw.confidence as ImportOptions["confidence"]) : null;
  if (!source) return "데이터 출처를 선택하세요.";
  if (!confidence) return "신뢰도를 선택하세요.";
  const period = Number(optionsRaw.salesPeriodDays);
  const ratioUnits: Record<string, RatioUnit> = {};
  for (const [k, v] of Object.entries((optionsRaw.ratioUnits ?? {}) as Record<string, unknown>)) {
    if (keys.has(k) && (v === "PERCENT" || v === "DECIMAL")) ratioUnits[k] = v;
  }
  return {
    mapping,
    options: {
      source,
      confidence,
      salesPeriodDays: Number.isInteger(period) && period >= 1 && period <= 366 ? period : null,
      ratioUnits,
      today: todayKst(),
    },
  };
}

async function readFile(formData: FormData): Promise<ParsedFile | string> {
  try {
    return await parseUploadedFile(formData.get("file") as File);
  } catch (error) {
    if (error instanceof ImportFileError) return error.message;
    throw error;
  }
}

const displayRow = (cells: string[]) => cells.map(displayCell);

export async function analyzeImportAction(formData: FormData): Promise<AnalyzeResult | Fail> {
  if (!(await getCurrentUser())) return { ok: false, error: "로그인이 필요합니다." };
  const type = readType(formData);
  if (!type) return { ok: false, error: "가져올 데이터 유형을 선택하세요." };
  const parsed = await readFile(formData);
  if (typeof parsed === "string") return { ok: false, error: parsed };

  const matches = autoMatch(type, parsed.table.headers);
  const ratioSuggestions: AnalyzeResult["ratioSuggestions"] = {};
  parsed.table.headers.forEach((_, index) => {
    const values = parsed.table.rows.map((r) => r.cells[index] ?? "").filter(Boolean);
    ratioSuggestions[index] = Object.fromEntries(
      FIELDS[type].filter((f) => isRatioField(type, f.key)).map((f) => [f.key, suggestRatioUnit(values)]),
    );
  });

  return {
    ok: true,
    file: { name: parsed.fileName, size: parsed.size, format: parsed.format, encoding: parsed.encoding, totalRows: parsed.table.rows.length },
    headers: parsed.table.headers.map(displayCell),
    sample: parsed.table.rows.slice(0, 5).map((r) => displayRow(r.cells)),
    matches,
    ratioSuggestions,
    duplicate: await findCompletedJob(parsed.hash, type),
  };
}

export async function previewImportAction(formData: FormData): Promise<PreviewResult | Fail> {
  if (!(await getCurrentUser())) return { ok: false, error: "로그인이 필요합니다." };
  const type = readType(formData);
  if (!type) return { ok: false, error: "가져올 데이터 유형을 선택하세요." };
  const parsed = await readFile(formData);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  const input = readMappingAndOptions(type, formData, parsed.table.headers.length);
  if (typeof input === "string") return { ok: false, error: input };

  const mappingProblems = validateMapping(type, input.mapping, input.options);
  const empty = { total: parsed.table.rows.length, ok: 0, warning: 0, error: 0, duplicate: 0 };
  if (mappingProblems.length > 0) {
    return { ok: true, mappingProblems, counts: empty, rows: [], unknownProducts: [], unknownKeywords: [], duplicate: null };
  }
  const prepared = prepareRows(type, parsed.table, input.mapping, input.options, await loadLookups());
  // 화면에는 문제 있는 행을 먼저, 최대 300행
  const order: Record<RowStatus, number> = { ERROR: 0, WARNING: 1, DUPLICATE: 2, OK: 3 };
  const rows = [...prepared.rows]
    .sort((a, b) => order[a.status] - order[b.status] || a.rowNumber - b.rowNumber)
    .slice(0, 300)
    .map((r) => ({ rowNumber: r.rowNumber, status: r.status, messages: r.messages, converted: r.converted }));
  return {
    ok: true,
    mappingProblems,
    counts: prepared.counts,
    rows,
    unknownProducts: prepared.unknownProducts.slice(0, 50),
    unknownKeywords: prepared.unknownKeywords.slice(0, 50),
    duplicate: await findCompletedJob(parsed.hash, type),
  };
}

export async function runImportAction(formData: FormData): Promise<RunResult> {
  if (!(await getCurrentUser())) return { ok: false, error: "로그인이 필요합니다." };
  const type = readType(formData);
  if (!type) return { ok: false, error: "가져올 데이터 유형을 선택하세요." };
  const parsed = await readFile(formData);
  if (typeof parsed === "string") return { ok: false, error: parsed };
  const input = readMappingAndOptions(type, formData, parsed.table.headers.length);
  if (typeof input === "string") return { ok: false, error: input };
  const problems = validateMapping(type, input.mapping, input.options);
  if (problems.length > 0) return { ok: false, error: problems.join(" ") };

  const prepared = prepareRows(type, parsed.table, input.mapping, input.options, await loadLookups());
  try {
    const job = await runImport({
      type,
      file: { name: parsed.fileName, size: parsed.size, hash: parsed.hash, format: parsed.format, encoding: parsed.encoding },
      headers: parsed.table.headers,
      mapping: input.mapping,
      options: input.options,
      rows: prepared.rows,
    });
    revalidatePath("/import");
    revalidatePath("/");
    revalidatePath("/products", "layout");
    revalidatePath("/keywords", "layout");
    return { ok: true, job };
  } catch (error) {
    if (error instanceof DuplicateImportError) {
      return { ok: false, error: "같은 파일을 이미 가져왔습니다. 다시 가져오려면 이전 가져오기를 먼저 되돌리세요.", duplicate: error.existing };
    }
    const e = error as { code?: string; message?: string };
    if (e?.code === "23505") return { ok: false, error: "같은 파일을 이미 가져왔습니다 (동시에 두 번 실행됨)." };
    return { ok: false, error: e?.message ?? "가져오기에 실패했습니다." };
  }
}

export async function rollbackImportAction(jobId: string): Promise<{ ok: boolean; message: string }> {
  if (!(await getCurrentUser())) return { ok: false, message: "로그인이 필요합니다." };
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return { ok: false, message: "잘못된 요청입니다." };
  try {
    const r = await rollbackImport(jobId);
    revalidatePath("/import");
    revalidatePath("/");
    revalidatePath("/products", "layout");
    revalidatePath("/keywords", "layout");
    if (!r.ok) {
      const codes = [...new Set(r.conflicts.map((c) => c.code))].join(", ");
      return { ok: false, message: `되돌릴 수 없습니다: 이후에 같은 데이터가 바뀌었습니다 (${codes}). 아무것도 바꾸지 않았습니다.` };
    }
    return { ok: true, message: `되돌렸습니다 (복원 ${r.restored ?? 0}행, 삭제 ${r.deleted ?? 0}행).` };
  } catch (error) {
    return { ok: false, message: (error as Error).message ?? "되돌리기에 실패했습니다." };
  }
}
