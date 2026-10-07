"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth";
import { resolveCategoryFromForm } from "@/lib/category-form";
import { dbErrorMessage, fail, isPgError, readCapturedOn, readNumbers, round4, type FormState } from "@/lib/forms";
import { cleanKeyword, KEYWORD_MAX_LENGTH } from "@/lib/keywords";
import {
  createKeyword,
  findKeywordIdByText,
  saveManualKeywordSnapshot,
  setKeywordSnapshotExcluded,
  updateKeyword,
  type ManualKeywordSnapshot,
} from "@/lib/repositories/keywords";
import { isConfidence } from "@/types/db";

// 키워드 등록 ---------------------------------------------------------------------

export async function createKeywordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const keyword = cleanKeyword(String(formData.get("keyword") ?? ""));
  if (!keyword) return fail("키워드를 입력하세요.");
  if (keyword.length > KEYWORD_MAX_LENGTH) return fail(`키워드는 ${KEYWORD_MAX_LENGTH}자 이하로 입력하세요.`);

  const duplicate = (id: string | null) =>
    fail(`이미 등록된 키워드입니다: ${keyword}`, id ? { href: `/keywords/${id}`, label: "기존 키워드 보기" } : undefined);

  try {
    const existingId = await findKeywordIdByText(keyword);
    if (existingId) return duplicate(existingId);

    const categoryId = await resolveCategoryFromForm(formData);
    await createKeyword({ keyword, categoryId, isTracking: formData.get("is_tracking") === "on" });
  } catch (error) {
    if (isPgError(error, "23505")) return duplicate(await findKeywordIdByText(keyword).catch(() => null));
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  return { ok: true, message: `등록했습니다: ${keyword}` };
}

// 키워드 설정 ---------------------------------------------------------------------

export async function updateKeywordAction(keywordId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const memo = String(formData.get("memo") ?? "").trim();
  try {
    await updateKeyword(keywordId, {
      isTracking: formData.get("is_tracking") === "on",
      categoryId: await resolveCategoryFromForm(formData),
      memo: memo || null,
    });
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
  return { ok: true, message: "저장했습니다." };
}

/** 목록에서 추적 ON/OFF 바로 바꾸기 (삭제 대신 사용) */
export async function setTrackingAction(keywordId: string, isTracking: boolean): Promise<void> {
  if (!(await getCurrentUser())) return;
  await updateKeyword(keywordId, { isTracking });
  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
}

// 지표 수동 입력 -------------------------------------------------------------------

export async function saveSnapshotAction(keywordId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getCurrentUser())) return fail("로그인이 필요합니다.");

  const parsed = parseSnapshotForm(keywordId, formData);
  if ("error" in parsed) return fail(parsed.error);

  let action;
  try {
    action = await saveManualKeywordSnapshot(parsed.snapshot);
  } catch (error) {
    return fail(dbErrorMessage(error));
  }

  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
  const label = { INSERTED: "새로 저장했습니다", UPDATED: "같은 날짜의 직접 입력 값을 갱신했습니다", SKIPPED: "바뀐 값이 없습니다" }[action];
  return { ok: true, message: `${parsed.snapshot.capturedOn} · ${label}.` };
}

// 스냅샷 제외 / 복원 ---------------------------------------------------------------

export async function setSnapshotExcludedAction(
  keywordId: string,
  snapshotId: number,
  excluded: boolean,
  formData: FormData,
): Promise<void> {
  if (!(await getCurrentUser())) return;
  const reason = String(formData.get("reason") ?? "").trim() || "직접 제외";
  await setKeywordSnapshotExcluded(snapshotId, excluded, excluded ? reason : null);
  revalidatePath("/keywords");
  revalidatePath(`/keywords/${keywordId}`);
}

// 입력 해석 -----------------------------------------------------------------------

function parseSnapshotForm(
  keywordId: string,
  formData: FormData,
): { snapshot: ManualKeywordSnapshot } | { error: string } {
  const capturedOn = readCapturedOn(formData);
  if (typeof capturedOn !== "string") return capturedOn;

  const confidence = String(formData.get("confidence") ?? "");
  if (!isConfidence(confidence)) return { error: "신뢰도를 선택하세요." };

  const { values: metrics, errors } = readNumbers(formData, {
    search_volume: { label: "월 검색량", min: 0, integer: true },
    search_volume_previous: { label: "이전 검색량", min: 0, integer: true },
    search_growth_rate: { label: "검색량 증감", min: -100, max: 999999, percent: true },
    coupang_product_count: { label: "쿠팡 상품 수", min: 0, integer: true },
    competition_intensity: { label: "경쟁강도", min: 0, max: 99999999 },
    wing_ratio: { label: "WING 비율", min: 0, max: 100, percent: true },
    rocket_ratio: { label: "로켓 비율", min: 0, max: 100, percent: true },
    average_price: { label: "평균 가격", min: 0, integer: true },
    average_reviews: { label: "평균 리뷰 수", min: 0 },
    brand_concentration: { label: "브랜드 집중도", min: 0, max: 100, percent: true },
    sample_size: { label: "표본 수", min: 1, max: 32767, integer: true },
    ad_bid: { label: "광고 입찰가", min: 0, integer: true },
  });
  if (errors.length > 0) return { error: errors.join(" ") };

  const calculated: string[] = [];
  // 비워 둔 파생 지표는 같은 입력값으로 계산하고 출처를 CALCULATED 로 남긴다
  if (metrics.competition_intensity === undefined && metrics.coupang_product_count !== undefined && metrics.search_volume) {
    metrics.competition_intensity = round4(metrics.coupang_product_count / metrics.search_volume);
    calculated.push("competition_intensity");
  }
  if (metrics.search_growth_rate === undefined && metrics.search_volume !== undefined && metrics.search_volume_previous) {
    metrics.search_growth_rate = round4((metrics.search_volume - metrics.search_volume_previous) / metrics.search_volume_previous);
    calculated.push("search_growth_rate");
  }

  if (Object.keys(metrics).length === 0) return { error: "지표를 하나 이상 입력하세요." };

  return { snapshot: { keywordId, capturedOn, confidence, metrics, calculated } };
}
