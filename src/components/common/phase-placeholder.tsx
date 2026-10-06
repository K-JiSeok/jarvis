import { Construction } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

interface PhasePlaceholderProps {
  phase: number;
  items: string[];
}

/** 아직 구현되지 않은 화면. 무엇이 언제 들어올지 명시한다. */
export function PhasePlaceholder({ phase, items }: PhasePlaceholderProps) {
  return (
    <Card className="border-dashed shadow-none">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Construction className="text-muted-foreground size-4" />
          준비 중 · PHASE {phase}에서 구현 예정
        </div>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
