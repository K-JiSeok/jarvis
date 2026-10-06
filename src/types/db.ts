/**
 * DB 타입(src/types/database.ts, 자동 생성)과 앱 타입(src/types/common.ts)을 잇는다.
 *
 * - database.ts: DB 그대로. DOMAIN 컬럼(source_type, confidence …)은 string 이다.
 * - common.ts:   앱이 쓰는 좁은 union 타입과 라벨. 화면·엔진은 이쪽만 바라본다.
 * - 이 파일:     DB 값을 앱 타입으로 좁히는 가드와, 자주 쓰는 행 타입 별칭.
 */
import {
  CONFIDENCE_LEVELS,
  RISK_TYPES,
  SOURCE_TYPES,
  VERDICTS,
  type Confidence,
  type RiskSeverity,
  type RiskType,
  type SourceType,
  type Verdict,
} from "./common";
import type { Tables } from "./database";

export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database";

export type ProductRow = Tables<"products">;
export type ProductLatestRow = Tables<"v_product_latest">;
export type KeywordLatestRow = Tables<"v_keyword_latest">;
export type CurrentScoreRow = Tables<"v_current_scores">;
export type WatchlistRow = Tables<"watchlist">;

/** watchlist.status (0007 CHECK 와 동일) */
export const WATCHLIST_STATUSES = [
  "WATCHING",
  "SOURCING",
  "TESTING",
  "SELLING",
  "PAUSED",
  "SOLD_OUT",
  "STOPPED",
  "DROPPED",
] as const;
export type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number];

/** watchlist.outcome — 성과 판정은 상태와 분리한다 */
export const WATCHLIST_OUTCOMES = ["SUCCESS", "BREAK_EVEN", "FAILED"] as const;
export type WatchlistOutcome = (typeof WATCHLIST_OUTCOMES)[number];

const RISK_SEVERITIES = ["LOW", "MEDIUM", "HIGH"] as const satisfies readonly RiskSeverity[];

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export const isSourceType = (v: unknown): v is SourceType => includes(SOURCE_TYPES, v);
export const isConfidence = (v: unknown): v is Confidence => includes(CONFIDENCE_LEVELS, v);
export const isVerdict = (v: unknown): v is Verdict => includes(VERDICTS, v);
export const isRiskType = (v: unknown): v is RiskType => includes(RISK_TYPES, v);
export const isRiskSeverity = (v: unknown): v is RiskSeverity => includes(RISK_SEVERITIES, v);
export const isWatchlistStatus = (v: unknown): v is WatchlistStatus => includes(WATCHLIST_STATUSES, v);
