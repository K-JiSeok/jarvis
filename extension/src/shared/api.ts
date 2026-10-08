/**
 * JARVIS 서버 · Supabase 인증 호출 (배경 서비스 워커에서만 쓴다).
 *
 * 인증: 사용자가 팝업에서 JARVIS 계정(이메일 · 비밀번호)으로 로그인 → Supabase Auth 가 이 확장 프로그램용 세션을 따로 발급.
 *   웹 앱 세션(쿠키)과 섞지 않으므로 서로의 토큰 갱신이 충돌하지 않는다. 비밀번호는 저장하지 않는다.
 *   요청마다 Authorization: Bearer <access token>, 만료 1분 전이면 refresh token 으로 갱신.
 */

import { EXT_TOOL, EXT_VERSION, JARVIS_API_BASE, SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants";
import { getSession, setSession, type StoredSession } from "./storage";
import type { IngestRecord, IngestResult } from "./types";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string | null };
}

async function tokenRequest(grant: "password" | "refresh_token", body: Record<string, string>): Promise<StoredSession> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(grant === "password" ? "로그인에 실패했습니다. 이메일 또는 비밀번호를 확인하세요." : "로그인이 만료됐습니다. 다시 로그인하세요.");
  }
  const t = (await res.json()) as TokenResponse;
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_at ?? Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600),
    email: t.user?.email ?? null,
  };
}

export async function login(email: string, password: string): Promise<StoredSession> {
  const session = await tokenRequest("password", { email, password });
  await setSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const session = await getSession();
  await setSession(null);
  if (session) {
    // 이 확장 프로그램 세션만 끝낸다 (웹 앱 로그인은 그대로)
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` },
    }).catch(() => undefined);
  }
}

let refreshing: Promise<StoredSession | null> | null = null;

/** 유효한 access token (필요하면 갱신). 로그인하지 않았으면 null */
export async function validSession(): Promise<StoredSession | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.expiresAt - 60 > Date.now() / 1000) return session;
  // 동시에 여러 번 갱신하지 않는다 (refresh token 은 한 번 쓰면 바뀐다)
  refreshing ??= tokenRequest("refresh_token", { refresh_token: session.refreshToken })
    .then(async (next) => {
      await setSession({ ...next, email: next.email ?? session.email });
      return next;
    })
    .catch(async () => {
      await setSession(null);
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** 개발 빌드 전용 시험: 본문 문자열을 그대로 보낸다 (로그인 토큰 · 확장 프로그램 origin 은 실제와 같다) */
export async function sendRaw(body: string): Promise<{ status: number; json: unknown }> {
  const session = await validSession();
  const res = await fetch(`${JARVIS_API_BASE}/api/ingest`, {
    method: "POST",
    headers: { ...(session && { Authorization: `Bearer ${session.accessToken}` }), "Content-Type": "application/json" },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** 수집 레코드 전송. 네트워크 오류면 같은 idempotencyKey 로 한 번 더 보낸다 (서버는 replay 로 처리) */
export async function sendRecords(records: IngestRecord[]): Promise<IngestResult> {
  const session = await validSession();
  if (!session) return { ok: false, error: "JARVIS 에 로그인하지 않았습니다. 팝업에서 로그인하세요.", httpStatus: 401 };

  const body = JSON.stringify({ idempotencyKey: crypto.randomUUID(), tool: EXT_TOOL, version: EXT_VERSION, records });
  const send = () =>
    fetch(`${JARVIS_API_BASE}/api/ingest`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body,
    });

  let res: Response;
  try {
    res = await send();
  } catch {
    try {
      res = await send();
    } catch {
      return { ok: false, error: `JARVIS 서버(${JARVIS_API_BASE})에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.` };
    }
  }
  const data = (await res.json().catch(() => ({}))) as IngestResult;
  if (res.status === 401) await setSession(null);
  return { ...data, ok: res.ok && data.ok !== false, httpStatus: res.status };
}
