/**
 * chrome.storage.local 래퍼. 저장하는 것: JARVIS 로그인 세션(Supabase 토큰) · 마지막 수집 결과 · 마지막 예약 자동 발굴 결과.
 * 쿠팡 · WING 로그인 정보는 저장하지 않는다 (확장 프로그램은 쿠팡 계정을 다루지 않는다).
 */

import type { AutoRunState, AutoSummary } from "./auto-collect";
import type { LastAuto, LastRun, SupplyTarget } from "./types";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** 만료 시각 (epoch 초) */
  expiresAt: number;
  email: string | null;
}

export async function getSession(): Promise<StoredSession | null> {
  const { session } = await chrome.storage.local.get("session");
  return (session as StoredSession | undefined) ?? null;
}

export async function setSession(session: StoredSession | null): Promise<void> {
  if (session) await chrome.storage.local.set({ session });
  else await chrome.storage.local.remove("session");
}

export async function getLastRun(): Promise<LastRun | null> {
  const { lastRun } = await chrome.storage.local.get("lastRun");
  return (lastRun as LastRun | undefined) ?? null;
}

export async function setLastRun(lastRun: LastRun): Promise<void> {
  await chrome.storage.local.set({ lastRun });
}

export async function getLastAuto(): Promise<LastAuto | null> {
  const { lastAuto } = await chrome.storage.local.get("lastAuto");
  return (lastAuto as LastAuto | undefined) ?? null;
}

export async function setLastAuto(lastAuto: LastAuto): Promise<void> {
  await chrome.storage.local.set({ lastAuto });
}

const TARGET_TTL_MS = 2 * 3_600_000;

export async function getSupplyTarget(): Promise<SupplyTarget | null> {
  const { supplyTarget } = await chrome.storage.local.get("supplyTarget");
  const t = supplyTarget as SupplyTarget | undefined;
  return t && Date.now() - Date.parse(t.at) < TARGET_TTL_MS ? t : null;
}

export async function setSupplyTarget(target: SupplyTarget): Promise<void> {
  await chrome.storage.local.set({ supplyTarget: target });
}

// 검색 결과 자동 수집 (PHASE 27) ---------------------------------------------------------

/** 사용자가 팝업에서 끌 수 있다. 기본은 켜짐 (사용자 승인 2026-10-28) */
export async function getAutoCollectEnabled(): Promise<boolean> {
  const { autoCollectEnabled } = await chrome.storage.local.get("autoCollectEnabled");
  return autoCollectEnabled !== false;
}

export async function setAutoCollectEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ autoCollectEnabled: enabled });
}

/** 진행 중인 실행 (서비스 워커가 잠들어도 이어서 하도록 저장) */
export async function getAutoRun(): Promise<AutoRunState | null> {
  const { autoRun } = await chrome.storage.local.get("autoRun");
  return (autoRun as AutoRunState | undefined) ?? null;
}

export async function setAutoRun(autoRun: AutoRunState | null): Promise<void> {
  if (autoRun) await chrome.storage.local.set({ autoRun });
  else await chrome.storage.local.remove("autoRun");
}

export async function getAutoSummary(): Promise<AutoSummary | null> {
  const { autoSummary } = await chrome.storage.local.get("autoSummary");
  return (autoSummary as AutoSummary | undefined) ?? null;
}

export async function setAutoSummary(autoSummary: AutoSummary): Promise<void> {
  await chrome.storage.local.set({ autoSummary });
}
