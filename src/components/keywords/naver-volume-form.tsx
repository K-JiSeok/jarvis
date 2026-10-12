"use client";

import { useActionState } from "react";

import { fetchNaverVolumeAction } from "@/app/keywords/actions";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/forms";

/** 네이버 검색광고 API 로 이 키워드의 월 검색량 가져오기 (키가 없으면 안내만) */
export function NaverVolumeForm({ keywordId, keyword, configured }: { keywordId: string; keyword: string; configured: boolean }) {
  const [state, action, pending] = useActionState(fetchNaverVolumeAction.bind(null, keywordId, keyword), INITIAL_FORM_STATE);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "가져오는 중…" : "네이버 검색광고 API 로 검색량 가져오기"}
        </Button>
        <span className="text-muted-foreground text-xs">
          {configured ? "API 키 설정됨" : "API 키 없음 — 지금은 /import 에서 검색량 파일을 넣습니다"} · 네이버 검색 기준 최근 30일 PC + 모바일 (쿠팡 검색량 아님)
        </span>
      </div>
      {state.message && <p className={state.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-destructive text-sm"}>{state.message}</p>}
    </form>
  );
}
