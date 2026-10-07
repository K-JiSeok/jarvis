"use server";

import { redirect } from "next/navigation";

import { safeRedirectPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export interface LoginState {
  error: string | null;
  email: string;
}

/** 이메일 + 비밀번호 로그인. 회원가입은 없다 (Supabase 에서 가입 차단, 계정은 대시보드에서 생성). */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isSupabaseConfigured()) {
    return { error: "Supabase 환경변수가 설정되지 않았습니다 (.env.local).", email };
  }
  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력하세요.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // 계정 존재 여부를 드러내지 않도록 같은 문구를 쓴다
    return { error: "로그인에 실패했습니다. 이메일 또는 비밀번호를 확인하세요.", email };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
