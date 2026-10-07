import type { Metadata } from "next";
import Link from "next/link";

import { LoginRequired } from "@/components/common/login-required";
import { PageHeader } from "@/components/common/page-header";
import {
  WatchlistEvents,
  WatchlistReleaseButton,
  WatchlistStatusBadge,
  WatchlistStatusForm,
} from "@/components/watchlist/watchlist-controls";
import { WatchlistMemoForm } from "@/components/watchlist/watchlist-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findNavItem } from "@/config/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatShortDate } from "@/lib/format";
import { listWatchlist, listWatchlistEventsFor } from "@/lib/repositories/watchlist";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";
import { WATCHLIST_STATUS_LABELS, WATCHLIST_STATUSES, type WatchlistStatus } from "@/types/watchlist";

const nav = findNavItem("/watchlist")!;

export const metadata: Metadata = { title: "관심상품" };

const FILTERS: { value: WatchlistStatus | "ALL" | undefined; label: string }[] = [
  { value: undefined, label: "진행 중 (해제 제외)" },
  ...WATCHLIST_STATUSES.map((s) => ({ value: s, label: WATCHLIST_STATUS_LABELS[s] })),
  { value: "ALL", label: "전체" },
];

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        <PageHeader title={nav.label} description={nav.description} />
        <LoginRequired next="/watchlist" configured={isSupabaseConfigured()} />
      </>
    );
  }

  const { status: rawStatus } = await searchParams;
  const status = FILTERS.find((f) => f.value && f.value === rawStatus)?.value;
  const items = await listWatchlist({ status });
  const events = await listWatchlistEventsFor(items.map((i) => i.id));

  return (
    <>
      <PageHeader title={nav.label} description={nav.description} actions={<Badge>LIVE</Badge>} />

      <Card>
        <CardHeader>
          <CardTitle>관심상품</CardTitle>
          <CardDescription>
            {items.length}개. 등록은 상품 상세 화면에서 합니다. &quot;해제&quot;는 삭제가 아니라 상태를 &quot;해제(제외)&quot;로 바꾸며 이력은
            남습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <nav className="flex flex-wrap gap-1.5" aria-label="상태 필터">
            {FILTERS.map((f) => (
              <Link
                key={f.label}
                href={f.value ? `/watchlist?status=${f.value}` : "/watchlist"}
                aria-current={f.value === status ? "page" : undefined}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs",
                  f.value === status ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>

          {items.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              관심상품이 없습니다. <Link href="/products" className="underline">상품 분석</Link>에서 등록하세요.
            </p>
          ) : (
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Link href={`/products/${item.productId}`} className="min-w-0 flex-1 font-medium hover:underline">
                      {item.productName}
                      <span className="text-muted-foreground ml-2 text-xs">ID {item.coupangProductId}</span>
                    </Link>
                    <WatchlistStatusBadge status={item.status} />
                    <span className="text-muted-foreground text-xs">발견 키워드 {item.keyword ?? "-"}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">변경 {formatShortDate(item.statusChangedAt)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <WatchlistStatusForm item={item} />
                    <WatchlistReleaseButton item={item} />
                    <div className="min-w-64 flex-1">
                      <WatchlistMemoForm key={item.memo ?? ""} watchlistId={item.id} productId={item.productId} memo={item.memo} />
                    </div>
                  </div>
                  <details className="text-xs">
                    <summary className="text-muted-foreground cursor-pointer select-none">상태 이력 {events.get(item.id)?.length ?? 0}건</summary>
                    <div className="mt-2 pl-3">
                      <WatchlistEvents events={events.get(item.id) ?? []} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
