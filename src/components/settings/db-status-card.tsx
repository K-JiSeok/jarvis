import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { diffWithCodeWeights, getActiveScoringVersion } from "@/lib/repositories/scoring";
import { countMyRows, type CountedTable } from "@/lib/repositories/status";
import { isSupabaseConfigured } from "@/lib/supabase/env";

const TABLE_LABELS: Record<CountedTable, string> = {
  keywords: "키워드",
  products: "상품",
  product_snapshots: "상품 스냅샷",
  watchlist: "관심상품",
  import_jobs: "가져오기 기록",
};

/** Supabase 연결 · 로그인 · RLS 적용 조회 상태 */
export async function DbStatusCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>DB 연결 상태</CardTitle>
        <CardDescription>Supabase 연결, 로그인, RLS 가 적용된 실제 조회를 확인합니다.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <DbStatusBody />
      </CardContent>
    </Card>
  );
}

async function DbStatusBody() {
  if (!isSupabaseConfigured()) {
    return (
      <Row label="연결" badge={<Badge variant="secondary">DEMO</Badge>}>
        <code>.env.local</code> 이 없어 DEMO 데이터로 동작 중입니다.
      </Row>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <Row label="연결" badge={<Badge>설정됨</Badge>}>Supabase 환경변수가 설정되어 있습니다.</Row>
        <Row label="로그인" badge={<Badge variant="secondary">필요</Badge>}>
          데이터는 로그인한 본인 것만 조회됩니다.{" "}
          <Link href="/login?next=/settings" className="font-medium underline">
            로그인
          </Link>
        </Row>
      </>
    );
  }

  let result;
  try {
    result = await Promise.all([getActiveScoringVersion(), countMyRows()]);
  } catch (error) {
    return (
      <Row label="조회" badge={<Badge variant="destructive">오류</Badge>}>
        {error instanceof Error ? error.message : "DB 조회에 실패했습니다."}
      </Row>
    );
  }
  const [version, counts] = result;
  const diffs = version ? diffWithCodeWeights(version.weights, version.thresholds) : ["활성 버전 없음"];

  return (
    <>
      <Row label="연결" badge={<Badge>정상</Badge>}>Supabase JARVIS 프로젝트</Row>
      <Row label="로그인" badge={<Badge>정상</Badge>}>{user.email}</Row>
      <Row
        label="점수 버전"
        badge={
          diffs.length === 0 ? <Badge>코드와 일치</Badge> : <Badge variant="destructive">불일치</Badge>
        }
      >
        DB 활성 버전 <code>{version?.version ?? "-"}</code>
        {diffs.length > 0 && <span className="text-destructive"> — {diffs.join(", ")}</span>}
      </Row>
      <div>
        <p className="text-muted-foreground mb-2 text-xs">내 데이터 (RLS: 본인 행만)</p>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(Object.keys(TABLE_LABELS) as CountedTable[]).map((table) => (
            <div key={table} className="rounded-md border px-3 py-2">
              <dt className="text-muted-foreground text-xs">{TABLE_LABELS[table]}</dt>
              <dd className="font-semibold tabular-nums">{counts[table].toLocaleString("ko-KR")}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}

function Row({ label, badge, children }: { label: string; badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-muted-foreground w-16 shrink-0 text-xs">{label}</span>
      {badge}
      <span>{children}</span>
    </div>
  );
}
