import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser, safeRedirectPath } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/env";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "로그인" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = safeRedirectPath(next);

  if (await getCurrentUser()) redirect(nextPath);

  return (
    <div className="mx-auto w-full max-w-sm pt-8">
      <Card>
        <CardHeader>
          <CardTitle>JARVIS 로그인</CardTitle>
          <CardDescription>
            개인용 앱입니다. 계정은 Supabase 대시보드에서만 만들 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSupabaseConfigured() ? (
            <LoginForm next={nextPath} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Supabase 환경변수가 없습니다. <code>.env.local</code> 을 설정한 뒤 다시 시도하세요.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
