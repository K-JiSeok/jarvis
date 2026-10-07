import "server-only";

import { toCompetitorRelation, toProductRef, toRelationType, type CompetitorRow } from "@/lib/mappers/competitor";
import { toKeywordRankView, toProductMetrics } from "@/lib/mappers/product";
import { createClient } from "@/lib/supabase/server";
import type { ProductLatestRow } from "@/types/db";
import type { CandidateGroup, CompetitorCandidate, CompetitorRelation, RelationType } from "@/types/competitor";

/*
 * 경쟁상품 = competitors 관계 (기준 상품 → 경쟁상품, 한 방향).
 * 경쟁상품도 products / product_snapshots 를 그대로 쓴다. 해제는 is_active = false (행 보존).
 * 같은 (기준, 경쟁) 쌍은 UNIQUE(product_id, competitor_product_id) 로 1행만 존재한다.
 * 로그인 사용자 세션(RLS)으로만 접근한다.
 */

// 두 FK 가 모두 products 를 가리키므로 FK 이름으로 구분한다 (한 줄 문자열이어야 타입 추론이 된다)
const SELECT = "*, base:products!competitors_product_fk(id, product_name, coupang_product_id, lifecycle_status), competitor:products!competitors_competitor_product_fk(id, product_name, coupang_product_id, lifecycle_status), keywords(keyword)";

export type CompetitorStatusFilter = "ACTIVE" | "RELEASED" | "ALL";

async function latestRows(productIds: string[]): Promise<Map<string, ProductLatestRow>> {
  const result = new Map<string, ProductLatestRow>();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return result;
  const supabase = await createClient();
  const { data, error } = await supabase.from("v_product_latest").select("*").in("product_id", ids);
  if (error) throw error;
  for (const row of data) if (row.product_id) result.set(row.product_id, row);
  return result;
}

async function toRelations(rows: CompetitorRow[]): Promise<CompetitorRelation[]> {
  const latest = await latestRows(rows.map((r) => r.competitor_product_id));
  return rows.map((row) => toCompetitorRelation(row, latest));
}

/** /competitors 목록. 기본은 활성 관계만 */
export async function listCompetitors({
  status = "ACTIVE",
  relationType,
  query,
}: { status?: CompetitorStatusFilter; relationType?: RelationType; query?: string } = {}): Promise<CompetitorRelation[]> {
  const supabase = await createClient();
  let q = supabase.from("competitors").select(SELECT).order("updated_at", { ascending: false });
  if (status === "ACTIVE") q = q.eq("is_active", true);
  if (status === "RELEASED") q = q.eq("is_active", false);
  if (relationType) q = q.eq("relation_type", relationType);
  const { data, error } = await q;
  if (error) throw error;

  let relations = await toRelations(data);
  const text = query?.trim().toLowerCase();
  if (text) {
    relations = relations.filter((r) =>
      [r.base.productName, r.base.coupangProductId, r.competitor.productName, r.competitor.coupangProductId, r.keyword ?? ""]
        .some((v) => v.toLowerCase().includes(text)),
    );
  }
  return relations;
}

/** 이 상품이 기준인 관계 (해제 포함) */
export async function getCompetitorsForProduct(productId: string): Promise<CompetitorRelation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitors")
    .select(SELECT)
    .eq("product_id", productId)
    .order("is_active", { ascending: false })
    .order("created_at");
  if (error) throw error;
  return toRelations(data);
}

/** 이 상품을 경쟁상품으로 둔 다른 상품 (역방향, 활성만). 자동으로 관계를 만들지는 않는다 */
export async function getCompetitorReferences(productId: string): Promise<CompetitorRelation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitors")
    .select(SELECT)
    .eq("competitor_product_id", productId)
    .eq("is_active", true)
    .order("created_at");
  if (error) throw error;
  return toRelations(data);
}

/**
 * 경쟁상품 후보: 이 상품이 순위로 연결된 키워드 → 각 키워드의 가장 최근 수집일 검색 결과 → 다른 상품들.
 * 자연 노출 우선, 순위 순. 상품당 키워드마다 1건. 자동 등록하지 않는다.
 */
export async function getCompetitorCandidates(productId: string, { perKeyword = 10 } = {}): Promise<CandidateGroup[]> {
  const supabase = await createClient();

  const { data: own, error: ownError } = await supabase
    .from("keyword_product_ranks")
    .select("keyword_id")
    .eq("product_id", productId);
  if (ownError) throw ownError;
  const keywordIds = [...new Set(own.map((r) => r.keyword_id))];
  if (keywordIds.length === 0) return [];

  const [{ data: ranks, error }, { data: relations, error: relError }] = await Promise.all([
    supabase
      .from("keyword_product_ranks")
      .select("*, keywords(keyword), products(product_name, coupang_product_id, lifecycle_status)")
      .in("keyword_id", keywordIds)
      .order("captured_on", { ascending: false })
      .order("is_ad")
      .order("rank_position"),
    supabase.from("competitors").select("id, competitor_product_id, is_active, relation_type").eq("product_id", productId),
  ]);
  if (error) throw error;
  if (relError) throw relError;

  const existing = new Map(relations.map((r) => [r.competitor_product_id, r]));
  const groups: CandidateGroup[] = [];

  for (const keywordId of keywordIds) {
    const rows = ranks.filter((r) => r.keyword_id === keywordId);
    if (rows.length === 0) continue;
    const latest = rows.reduce((max, r) => (r.captured_on > max ? r.captured_on : max), rows[0].captured_on);
    const sameDay = rows.filter((r) => r.captured_on === latest);
    const baseRow = sameDay.find((r) => r.product_id === productId && !r.is_ad);

    const seen = new Set<string>();
    const picked = sameDay
      .filter((r) => r.product_id !== productId)
      .sort((a, b) => Number(a.is_ad) - Number(b.is_ad) || a.rank_position - b.rank_position)
      .filter((r) => (seen.has(r.product_id) ? false : (seen.add(r.product_id), true)))
      .slice(0, perKeyword);

    groups.push({
      keywordId,
      keyword: rows[0].keywords?.keyword ?? "",
      baseRank: baseRow?.rank_position ?? null,
      capturedOn: latest,
      candidates: picked.map((r) => {
        const view = toKeywordRankView(r);
        const rel = existing.get(r.product_id);
        return {
          keywordId,
          keyword: view.keyword,
          rank: view.rank,
          isAd: view.isAd,
          capturedOn: view.capturedOn,
          source: view.source,
          confidence: view.confidence,
          product: toProductRef(
            r.products ? { id: r.product_id, ...r.products } : null,
            r.product_id,
          ),
          metrics: null,
          existing: rel ? { id: rel.id, isActive: rel.is_active, relationType: toRelationType(rel.relation_type) } : null,
        } satisfies CompetitorCandidate;
      }),
    });
  }

  const latestMap = await latestRows(groups.flatMap((g) => g.candidates.map((c) => c.product.id)));
  for (const group of groups) {
    for (const c of group.candidates) {
      const row = latestMap.get(c.product.id);
      c.metrics = row ? toProductMetrics(row) : null;
    }
  }
  return groups;
}

export type CreateResult = "ADDED" | "RESTORED" | "ALREADY";

/**
 * 경쟁상품 등록. 같은 (기준, 경쟁) 관계가 있으면 새 행을 만들지 않는다:
 * 활성이면 그대로(ALREADY), 해제됐던 관계면 같은 행을 다시 활성화(RESTORED, 관계 유형·맥락 키워드 갱신).
 */
export async function createCompetitor(input: {
  productId: string;
  competitorProductId: string;
  relationType: RelationType;
  keywordId: string | null;
  memo: string | null;
}): Promise<CreateResult> {
  if (input.productId === input.competitorProductId) throw new Error("자기 자신을 경쟁상품으로 등록할 수 없습니다.");
  const supabase = await createClient();

  const { data: existing, error: findError } = await supabase
    .from("competitors")
    .select("id, is_active")
    .eq("product_id", input.productId)
    .eq("competitor_product_id", input.competitorProductId)
    .maybeSingle();
  if (findError) throw findError;

  if (existing?.is_active) return "ALREADY";
  if (existing) {
    const { error } = await supabase
      .from("competitors")
      .update({
        is_active: true,
        relation_type: input.relationType,
        ...(input.keywordId && { keyword_id: input.keywordId }),
        ...(input.memo !== null && { memo: input.memo }),
      })
      .eq("id", existing.id);
    if (error) throw error;
    return "RESTORED";
  }

  const { error } = await supabase.from("competitors").insert({
    product_id: input.productId,
    competitor_product_id: input.competitorProductId,
    relation_type: input.relationType,
    keyword_id: input.keywordId,
    memo: input.memo,
    source_type: "MANUAL",
  });
  if (error) {
    // 동시에 같은 관계가 만들어진 경우 (UNIQUE 최종 방어선)
    if ((error as { code?: string }).code === "23505") return "ALREADY";
    throw error;
  }
  return "ADDED";
}

/** 관계 유형 · 메모 수정 */
export async function updateCompetitor(id: string, patch: { relationType?: RelationType; memo?: string | null }): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("competitors")
    .update({
      ...(patch.relationType && { relation_type: patch.relationType }),
      ...(patch.memo !== undefined && { memo: patch.memo }),
    })
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("경쟁상품 관계를 찾을 수 없습니다.");
}

/** 해제 = is_active false. 행(등록 이력)은 남긴다 */
export async function releaseCompetitor(id: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("competitors").update({ is_active: false }).eq("id", id).select("id");
  if (error) throw error;
  if (data.length === 0) throw new Error("경쟁상품 관계를 찾을 수 없습니다.");
}
