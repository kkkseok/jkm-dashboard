"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = {
  label: string;
  href: string;
  disabled?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "분석",
    items: [
      { label: "마이너스 매출이익률", href: "/minus" },
      { label: "품절 관리", href: "/soldout", disabled: true },
      { label: "그룹 업로드", href: "/group", disabled: true },
    ],
  },
  {
    label: "관리",
    items: [
      { label: "상품 마스터", href: "/products" },
      { label: "후정산금 관리", href: "/cal-amount" },
    ],
  },
];

const APP_VERSION = "v0.1.0";
const USER_EMAIL = "seokcess@glitzy.kr";

export type SidebarProps = {
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-full flex-col gap-1 py-4 text-sm"
      aria-label="기본 메뉴"
    >
      <div className="flex-1 space-y-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="space-y-1">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {section.label}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href;

                if (item.disabled) {
                  return (
                    <li key={item.href}>
                      <div
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center justify-between gap-2 border-l-2 border-transparent px-3 py-2 text-muted-foreground"
                      >
                        <span className="truncate">{item.label}</span>
                        <Badge variant="secondary">예정</Badge>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 border-l-2 px-3 py-2 transition-colors",
                        isActive
                          ? "border-primary bg-accent text-accent-foreground font-medium"
                          : "border-transparent text-foreground hover:bg-muted",
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t px-3 py-3 text-xs text-muted-foreground">
        <div>{APP_VERSION}</div>
        <div className="truncate">{USER_EMAIL}</div>
      </div>
    </nav>
  );
}
