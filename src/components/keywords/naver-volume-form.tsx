"use client";

import Link from "next/link";
import { useActionState } from "react";

import { collectSelectedNaverAction, fetchNaverVolumeAction, type NaverFormState } from "@/app/keywords/actions";
import { Button } from "@/components/ui/button";

const INITIAL: NaverFormState = { ok: false, message: null };
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
const n = (v: number | null | undefined) => (v == null ? "-" : v.toLocaleString("ko-KR"));

export interface NaverStatusView {
  latest: {
    capturedOn: string;
    capturedAt: string;
    total: number | null;
    pc: number | null;
    mobile: number | null;
    previous: number | null;
    growthRate: number | null;
    confidence: string;
  } | null;
  lastAttempt: { at: string; ok: boolean; label: string | null; jobId: string } | null;
}

/** 네이버 검색량은 쿠팡 검색량이 아니다 — 화면마다 같은 문구로 알린다 */
export const NAVER_PROXY_NOTE = "네이버 검색 기준 최근 30일 PC + 모바일 조회수 · 쿠팡 검색 수요의 대리 지표 (쿠팡 검색량 아님)";

function Result({ state }: { state: NaverFormState }) {
  if (!state.message) return null;
  const r = state.result;
  return (
    <div className="space-y-1 text-sm" data-testid="naver-result">
      <p className={state.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>{state.message}</p>
      {r && r.failures.length > 0 && (
        <ul className="text-muted-foreground list-disc pl-5 text-xs">
          {r.failures.map((f) => (
            <li key={f.keyword}>
              {f.keyword}: {f.label}
            </li>
          ))}
        </ul>
      )}
      {r?.jobId && (
        <Link href={`/import?job=${r.jobId}`} className="text-xs hover:underline">
          수집 기록 보기
        </Link>
      )}
    </div>
  );
}

/** 키워드 상세: 이 키워드의 네이버 검색량 상태 + 수집 */
export function NaverVolumeForm({ keyword, configured, mock, status }: { keyword: string; configured: boolean; mock: boolean; status: NaverStatusView | null }) {
  const [state, action, pending] = useActionState(fetchNaverVolumeAction.bind(null, keyword), INITIAL);
  const l = status?.latest;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="naver-status">
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground text-xs">합계 (PC · 모바일)</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {n(l?.total)} <span className="text-muted-foreground text-xs font-normal">({n(l?.pc)} · {n(l?.mobile)})</span>
          </dd>
        </div>
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground text-xs">이전 수집값 · 증감률</dt>
          <dd className="mt-1 font-semibold tabular-nums">
            {n(l?.previous)} · {l?.growthRate == null ? "-" : `${l.growthRate >= 0 ? "+" : ""}${(l.growthRate * 100).toFixed(1)}%`}
          </dd>
        </div>
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground text-xs">출처 · 신뢰도</dt>
          <dd className="mt-1 font-semibold">{l ? `공식 API (네이버) · ${l.confidence}` : "-"}</dd>
        </div>
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground text-xs">마지막 수집</dt>
          <dd className="mt-1 text-xs">
            {status?.lastAttempt ? (
              <>
                {dateTime.format(new Date(status.lastAttempt.at))} ·{" "}
                <span className={status.lastAttempt.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
                  {status.lastAttempt.ok ? "성공" : `실패 — ${status.lastAttempt.label}`}
                </span>
              </>
            ) : (
              "없음"
            )}
          </dd>
        </div>
      </dl>
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "가져오는 중…" : "네이버 검색광고 API 로 검색량 가져오기"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" name="force" className="size-3.5" /> 오늘 수집했어도 다시
        </label>
        <span className="text-muted-foreground text-xs">
          {configured ? (mock ? "개발 모의 서버에 연결됨 (실제 네이버 아님)" : "API 키 설정됨") : "API 키 없음 — 설정 전에는 /import 로 검색량 파일을 넣습니다"}
        </span>
      </form>
      <p className="text-muted-foreground text-xs">{NAVER_PROXY_NOTE}. 클릭 수 · CTR · 경쟁 지표는 수집 기록에만 남기고 Score 에 쓰지 않습니다.</p>
      <Result state={state} />
    </div>
  );
}

/** 키워드 목록: 체크한 키워드만 수집 (표의 체크박스는 form="naver-collect" 로 이 폼에 붙는다) */
export function NaverCollectBar({ configured, mock }: { configured: boolean; mock: boolean }) {
  const [state, action, pending] = useActionState(collectSelectedNaverAction, INITIAL);
  return (
    <div className="space-y-2 rounded-md border p-3">
      <form id="naver-collect" action={action} className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "수집 중…" : "선택 키워드 검색량 수집 (네이버)"}
        </Button>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" name="force" className="size-3.5" /> 오늘 수집한 키워드도 다시 (수동 재시도)
        </label>
        <span className="text-muted-foreground text-xs">
          {configured ? (mock ? "개발 모의 서버에 연결됨 (실제 네이버 아님)" : "API 키 설정됨") : "API 키 없음 — 누르면 설정 방법을 안내합니다"}
        </span>
      </form>
      <p className="text-muted-foreground text-xs">{NAVER_PROXY_NOTE}. 연관 키워드는 등록하지 않습니다. 같은 날 다시 수집해도 스냅샷은 늘지 않고 갱신됩니다.</p>
      <Result state={state} />
    </div>
  );
}
