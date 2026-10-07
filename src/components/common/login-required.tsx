import Link from "next/link";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** 실데이터 화면에서 로그인하지 않았거나 DB 가 연결되지 않았을 때 */
export function LoginRequired({ next, configured }: { next: string; configured: boolean }) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-col items-start gap-3 text-sm">
        {configured ? (
          <>
            <p>이 화면은 실제 DB 데이터를 사용합니다. 로그인하면 본인 데이터만 표시됩니다.</p>
            <Button asChild size="sm">
              <Link href={`/login?next=${encodeURIComponent(next)}`}>
                <LogIn />
                로그인
              </Link>
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">
            Supabase 환경변수가 없어 DB 에 연결할 수 없습니다. <code>.env.local</code> 을 설정하세요.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
