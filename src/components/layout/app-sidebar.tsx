import { NavLinks } from "./nav-links";
import { Brand } from "./brand";

/** 데스크톱(lg 이상) 고정 사이드바 */
export function AppSidebar() {
  return (
    <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r lg:flex">
      <div className="px-5 py-5">
        <Brand />
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <NavLinks />
      </div>
      <div className="text-muted-foreground border-sidebar-border border-t px-5 py-3 text-xs">
        V1 · 개인용
      </div>
    </aside>
  );
}
