import {
  Calculator,
  FolderTree,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  Star,
  Swords,
  Upload,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** 본격 구현 예정 PHASE */
  plannedPhase: number;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    description: "실제 데이터 현황 · 추천 상품 · 분석 상태",
    plannedPhase: 8,
  },
  {
    href: "/keywords",
    label: "키워드 발굴",
    icon: Search,
    description: "검색량·경쟁강도·WING 비율로 후보 키워드 찾기",
    plannedPhase: 3,
  },
  {
    href: "/categories",
    label: "카테고리 분석",
    icon: FolderTree,
    description: "카테고리별 가격·리뷰·판매 구조",
    plannedPhase: 3,
  },
  {
    href: "/products",
    label: "상품 분석",
    icon: Package,
    description: "상품 하나를 판매할 가치가 있는지 판단",
    plannedPhase: 4,
  },
  {
    href: "/competitors",
    label: "경쟁상품",
    icon: Swords,
    description: "상위 경쟁상품 10~20개 비교",
    plannedPhase: 5,
  },
  {
    href: "/profit",
    label: "수익성 계산",
    icon: Calculator,
    description: "순이익·마진·ROI·손익분기 계산",
    plannedPhase: 6,
  },
  {
    href: "/watchlist",
    label: "관심상품",
    icon: Star,
    description: "검토 중인 상품 모아보기",
    plannedPhase: 4,
  },
  {
    href: "/import",
    label: "데이터 가져오기",
    icon: Upload,
    description: "CSV/Excel import",
    plannedPhase: 9,
  },
  {
    href: "/settings",
    label: "설정",
    icon: Settings,
    description: "점수 가중치 및 기본값",
    plannedPhase: 7,
  },
];

export function findNavItem(href: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.href === href);
}
