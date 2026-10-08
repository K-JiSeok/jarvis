import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { displayCell, IMPORT_TYPE_LABELS, type ImportType } from "@/lib/import/core";
import type { ImportRowView, JobSummary } from "@/lib/repositories/imports";
import { cn } from "@/lib/utils";
import { SOURCE_TYPE_LABELS, type SourceType } from "@/types/common";

import { RollbackButton } from "./rollback-button";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  SUCCEEDED: { label: "성공", variant: "secondary" },
  PARTIAL: { label: "부분 성공", variant: "outline" },
  FAILED: { label: "실패", variant: "destructive" },
  PROCESSING: { label: "처리 중", variant: "outline" },
  PENDING: { label: "대기", variant: "outline" },
  ROLLED_BACK: { label: "되돌림", variant: "outline" },
};

const RESULT: Record<string, { label: string; cls: string }> = {
  INSERTED: { label: "추가", cls: "text-emerald-700 dark:text-emerald-300" },
  UPDATED: { label: "갱신", cls: "text-sky-700 dark:text-sky-300" },
  SKIPPED: { label: "건너뜀", cls: "text-muted-foreground" },
  FAILED: { label: "실패", cls: "text-destructive" },
  PENDING: { label: "대기", cls: "text-muted-foreground" },
};

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
const typeLabel = (t: string) => (t === "MIXED" ? "혼합" : (IMPORT_TYPE_LABELS[t as ImportType] ?? t));
/** 파일명이 없는 수집 배치(확장 프로그램 등)는 수집 경로·도구 이름으로 표시 */
const jobName = (j: JobSummary) => j.fileName ?? `수집 배치 · ${j.channel}${j.sourceTool ? ` (${j.sourceTool})` : ""}`;
const sourceLabel = (s: string) => SOURCE_TYPE_LABELS[s as SourceType] ?? s;

export function ImportHistory({ jobs, selectedId }: { jobs: JobSummary[]; selectedId: string | null }) {
  if (jobs.length === 0) return <p className="text-muted-foreground py-4 text-center text-sm">아직 가져온 파일이 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-left text-xs">
            <th className="py-2 font-normal">파일명</th>
            <th className="py-2 font-normal">유형</th>
            <th className="py-2 font-normal">출처 · 신뢰도</th>
            <th className="py-2 font-normal">상태</th>
            <th className="py-2 text-right font-normal">총 행</th>
            <th className="py-2 text-right font-normal">성공</th>
            <th className="py-2 text-right font-normal">건너뜀</th>
            <th className="py-2 text-right font-normal">실패</th>
            <th className="py-2 text-right font-normal">등록일</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {jobs.map((j) => (
            <tr key={j.id} className={cn("border-b last:border-0", j.id === selectedId && "bg-muted/50")}>
              <td className="max-w-64 truncate py-2">
                <Link href={`/import?job=${j.id}`} className="font-medium hover:underline">
                  {jobName(j)}
                </Link>
              </td>
              <td className="py-2 text-xs">{typeLabel(j.importType)}</td>
              <td className="py-2 text-xs">
                {sourceLabel(j.sourceType)} · {j.confidence ?? "-"}
              </td>
              <td className="py-2">
                <Badge variant={STATUS[j.status]?.variant ?? "outline"}>{STATUS[j.status]?.label ?? j.status}</Badge>
              </td>
              <td className="py-2 text-right">{j.totalRows}</td>
              <td className="py-2 text-right text-emerald-700 dark:text-emerald-300">{j.insertedRows + j.updatedRows}</td>
              <td className="py-2 text-right">{j.skippedRows}</td>
              <td className={cn("py-2 text-right", j.failedRows > 0 && "text-destructive")}>{j.failedRows}</td>
              <td className="text-muted-foreground py-2 text-right text-xs">{dateTime.format(new Date(j.createdAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportJobDetail({ job, rows }: { job: JobSummary; rows: ImportRowView[] }) {
  const canRollback = ["SUCCEEDED", "PARTIAL", "FAILED"].includes(job.status) && job.insertedRows + job.updatedRows > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <strong>{jobName(job)}</strong>
        <Badge variant={STATUS[job.status]?.variant ?? "outline"}>{STATUS[job.status]?.label ?? job.status}</Badge>
        <span className="text-muted-foreground tabular-nums">
          {typeLabel(job.importType)} · {sourceLabel(job.sourceType)} · 신뢰도 {job.confidence ?? "-"} · 추가 {job.insertedRows} · 갱신 {job.updatedRows} · 건너뜀 {job.skippedRows} ·
          실패 {job.failedRows}
        </span>
        {canRollback && <RollbackButton jobId={job.id} />}
      </div>
      {job.errorSummary && <p className="text-muted-foreground text-xs">실패 사유 요약: {job.errorSummary}</p>}
      <div className="max-h-[420px] overflow-auto rounded-md border">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-background sticky top-0">
            <tr className="text-muted-foreground border-b text-left">
              <th className="px-2 py-1.5 font-normal">행</th>
              <th className="px-2 py-1.5 font-normal">결과</th>
              <th className="px-2 py-1.5 font-normal">원본 데이터</th>
              <th className="px-2 py-1.5 font-normal">사유</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rowNumber} className="border-b align-top last:border-0">
                <td className="px-2 py-1.5 tabular-nums">{r.rowNumber}</td>
                <td className={cn("px-2 py-1.5 font-medium whitespace-nowrap", RESULT[r.result]?.cls)}>{RESULT[r.result]?.label ?? r.result}</td>
                <td className="text-muted-foreground max-w-96 px-2 py-1.5">
                  {Object.entries(r.raw)
                    .filter(([, v]) => v)
                    .slice(0, 6)
                    .map(([k, v]) => `${k}: ${displayCell(v)}`)
                    .join(" · ")}
                </td>
                <td className="px-2 py-1.5">{r.errorMessage ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground text-xs">실패한 행은 파일을 고친 뒤 다시 올리면 됩니다 (같은 파일은 다시 가져오지 않으므로 수정한 파일 또는 되돌린 뒤).</p>
    </div>
  );
}
