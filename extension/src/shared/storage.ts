/**
 * chrome.storage.local 래퍼. 저장하는 것: JARVIS 로그인 세션(Supabase 토큰) · 마지막 수집 결과.
 * 쿠팡 · WING 로그인 정보는 저장하지 않는다 (확장 프로그램은 쿠팡 계정을 다루지 않는다).
 */

import type { LastRun } from "./types";

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
