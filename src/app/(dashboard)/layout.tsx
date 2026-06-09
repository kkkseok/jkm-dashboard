"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";

/** 라우트별 헤더 표기 제목. */
const PAGE_TITLES: Record<string, string> = {
  "/minus": "마이너스 매출이익률",
  "/group-upload": "그룹 업로드",
  "/products": "상품 마스터",
  "/cal-amount": "후정산금 관리",
  "/group-sources": "그룹 매핑 소스",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const pageTitle = PAGE_TITLES[pathname] ?? "대시보드";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="메뉴 열기"
              />
            }
          >
            <MenuIcon />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>JKM 대시보드</SheetTitle>
            </SheetHeader>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <Link href="/minus" className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-primary text-[11px] font-bold tracking-tight text-primary-foreground">
            JK
          </span>
          <span className="hidden font-semibold tracking-tight sm:inline">
            JKM 대시보드
          </span>
        </Link>

        <div className="h-5 w-px bg-border" aria-hidden="true" />

        <span className="truncate text-sm font-medium text-muted-foreground">
          {pageTitle}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r bg-background md:flex md:flex-col">
          <Sidebar />
        </aside>

        <main className="min-w-0 flex-1 space-y-6 p-6">{children}</main>
      </div>
    </div>
  );
}
