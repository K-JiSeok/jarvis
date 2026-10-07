import { releaseCompetitorAction, restoreCompetitorAction, updateCompetitorAction } from "@/app/competitors/actions";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { RELATION_TYPE_HINTS, RELATION_TYPE_LABELS, RELATION_TYPES, type CompetitorRelation, type RelationType } from "@/types/competitor";

export function RelationBadge({ type }: { type: RelationType }) {
  return (
    <Badge variant={type === "SAME_PRODUCT" ? "default" : "secondary"} title={RELATION_TYPE_HINTS[type]}>
      {RELATION_TYPE_LABELS[type]}
    </Badge>
  );
}

export function RelationSelect({ defaultValue = "SIMILAR", className }: { defaultValue?: RelationType; className?: string }) {
  return (
    <NativeSelect name="relation_type" defaultValue={defaultValue} aria-label="관계 유형" className={className ?? "h-8 w-28 text-xs"}>
      {RELATION_TYPES.map((t) => (
        <option key={t} value={t} title={RELATION_TYPE_HINTS[t]}>
          {RELATION_TYPE_LABELS[t]}
        </option>
      ))}
    </NativeSelect>
  );
}

/** 활성 관계: 관계 유형 변경 · 해제 / 해제된 관계: 다시 등록 */
export function CompetitorRowControls({ relation }: { relation: CompetitorRelation }) {
  const { id, base, competitor } = relation;
  if (!relation.isActive) {
    return (
      <form action={restoreCompetitorAction.bind(null, base.id, competitor.id, relation.relationType)}>
        <button type="submit" className="text-foreground text-xs font-medium hover:underline">
          다시 등록
        </button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={updateCompetitorAction.bind(null, id, base.id, competitor.id)} className="flex items-center gap-1">
        <RelationSelect defaultValue={relation.relationType} />
        <input type="hidden" name="memo" value={relation.memo ?? ""} />
        <button type="submit" className="text-foreground text-xs font-medium hover:underline">
          변경
        </button>
      </form>
      <form action={releaseCompetitorAction.bind(null, id, base.id, competitor.id)}>
        <button type="submit" className="text-destructive text-xs font-medium hover:underline" title="관계를 끄고 등록 이력은 남깁니다">
          해제
        </button>
      </form>
    </div>
  );
}
