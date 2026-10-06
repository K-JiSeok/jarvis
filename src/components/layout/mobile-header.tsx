"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Brand } from "./brand";
import { NavLinks } from "./nav-links";

/** 모바일(lg 미만) 상단 헤더 + 펼침 메뉴 */
export function MobileHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="bg-sidebar border-sidebar-border sticky top-0 z-30 border-b lg:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Brand />
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <div className="border-sidebar-border border-t px-3 py-2">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
      )}
    </header>
  );
}
