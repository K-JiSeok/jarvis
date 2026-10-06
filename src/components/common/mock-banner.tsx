import { TriangleAlert } from "lucide-react";

/** DEMO/MOCK 데이터가 화면에 있을 때 반드시 표시하는 배너 */
export function MockBanner({
  message = "아래 수치는 화면 확인용 가상 데이터입니다. 실제 쿠팡 데이터가 아닙니다.",
}: {
  message?: string;
}) {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="mr-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-xs font-bold text-white">
          DEMO
        </span>
        {message}
      </p>
    </div>
  );
}
