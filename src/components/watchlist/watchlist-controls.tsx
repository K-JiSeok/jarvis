import { releaseWatchlistAction, setWatchlistStatusAction } from "@/app/watchlist/actions";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { WATCHLIST_STATUS_LABELS, WATCHLIST_STATUSES, type WatchlistEventView, type WatchlistItem } from "@/types/watchlist";

/** 상태 변경 (이력은 트리거가 기록). DROPPED 는 "해제" 버튼으로만 */
export function WatchlistStatusForm({ item }: { item: WatchlistItem }) {
  return (
    <form action={setWatchlistStatusAction.bind(null, item.id, item.productId)} className="flex items-center gap-1.5">
      <NativeSelect name="status" defaultValue={item.status} aria-label="관심상품 상태" className="h-8 w-36 text-xs">
        {WATCHLIST_STATUSES.filter((s) => s !== "DROPPED" || item.status === "DROPPED").map((s) => (
          <option key={s} value={s}>
            {WATCHLIST_STATUS_LABELS[s]}
          </option>
        ))}
      </NativeSelect>
      <button type="submit" className="text-foreground text-xs font-medium hover:underline">
        변경
      </button>
    </form>
  );
}

/** 해제 = DROPPED (행·이력 보존) */
export function WatchlistReleaseButton({ item }: { item: WatchlistItem }) {
  if (item.status === "DROPPED") return null;
  return (
    <form action={releaseWatchlistAction.bind(null, item.id, item.productId)}>
      <button type="submit" className="text-destructive text-xs font-medium hover:underline" title="목록에서 숨기고 이력은 남깁니다">
        해제
      </button>
    </form>
  );
}

export function WatchlistStatusBadge({ status }: { status: WatchlistItem["status"] }) {
  return <Badge variant={status === "DROPPED" ? "outline" : "default"}>{WATCHLIST_STATUS_LABELS[status]}</Badge>;
}

/** 상태 이력 (log_watchlist_status 트리거 기록) */
export function WatchlistEvents({ events }: { events: WatchlistEventView[] }) {
  if (events.length === 0) return <p className="text-muted-foreground text-xs">이력 없음</p>;
  const fmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" });
  return (
    <ol className="space-y-1 text-xs">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap gap-x-2">
          <span className="text-muted-foreground tabular-nums">{fmt.format(new Date(e.changedAt))}</span>
          <span>
            {e.fromStatus ? WATCHLIST_STATUS_LABELS[e.fromStatus] : "등록"} → <strong>{WATCHLIST_STATUS_LABELS[e.toStatus]}</strong>
          </span>
        </li>
      ))}
    </ol>
  );
}
