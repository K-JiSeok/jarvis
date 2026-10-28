/**
 * 1,000행 넘는 조회 (PHASE 29).
 *
 * Supabase API(PostgREST)는 한 번에 최대 1,000행만 돌려준다 (프로젝트 기본 설정). `.limit(20000)` 을 붙여도
 * 1,000행에서 잘리고 오류도 나지 않는다. 수집 기록이 쌓이면 오래된 리뷰 수 기록이 빠져 판매 추정이 틀어진다.
 * 그래서 .range() 로 1,000행씩 끝까지 읽는다. 쿼리에는 순서가 바뀌지 않는 정렬(id 등)이 있어야 한다.
 */

export const PAGE_ROWS = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

export async function fetchAllRows<T>(page: (from: number, to: number) => PageResult<T>, { max = 100_000 }: { max?: number } = {}): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_ROWS) break;
  }
  return out;
}
