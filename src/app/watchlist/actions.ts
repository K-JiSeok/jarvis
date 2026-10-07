"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { dbErrorMessage, fail, type FormState } from "@/lib/forms";
import {
  addToWatchlist,
  releaseFromWatchlist,
  updateWatchlistMemo,
  updateWatchlistStatus,
} from "@/lib/repositories/watchlist";
import { isWatchlistStatus } from "@/types/db";

function revalidateWatchlist(productId: string) {
  revalidatePath("/watchlist");
  revalidatePath(`/products/${productId}`);
}

/** 관심상품 등록 (새 행 / DROPPED 였으면 같은 행을 WATCHING 으로) */
export async function addToWatchlistAction(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const keywordId = String(formData.get("keyword_id") ?? "") || null;

  let result;
  try {
    result = await addToWatchlist(productId, keywordId);
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidateWatchlist(productId);
  const message = { ADDED: "관심상품에 등록했습니다.", RESTORED: "다시 관찰 중으로 되돌렸습니다 (이전 이력 유지).", ALREADY: "이미 관심상품입니다." }[result];
  return { ok: true, message, link: { href: "/watchlist", label: "관심상품 목록" } };
}

/** 상태 변경. 이력은 트리거가 기록한다 */
export async function setWatchlistStatusAction(watchlistId: string, productId: string, formData: FormData): Promise<void> {
  if (!(await getCurrentUser())) return;
  const status = String(formData.get("status") ?? "");
  if (!isWatchlistStatus(status)) return;
  await updateWatchlistStatus(watchlistId, status);
  revalidateWatchlist(productId);
}

/** 해제 = DROPPED (행·이력 보존) */
export async function releaseWatchlistAction(watchlistId: string, productId: string): Promise<void> {
  if (!(await getCurrentUser())) return;
  await releaseFromWatchlist(watchlistId);
  revalidateWatchlist(productId);
}

export async function updateWatchlistMemoAction(
  watchlistId: string,
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");
  const memo = String(formData.get("memo") ?? "").trim();
  if (memo.length > 1000) return fail("메모는 1000자 이하로 입력하세요.");
  try {
    await updateWatchlistMemo(watchlistId, memo || null);
  } catch (error) {
    return fail(dbErrorMessage(error));
  }
  revalidateWatchlist(productId);
  return { ok: true, message: "메모를 저장했습니다." };
}
