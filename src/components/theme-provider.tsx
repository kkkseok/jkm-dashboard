"use client"

import { ThemeProvider as NextThemesProvider } from "next-themes"

/** next-themes 래퍼. .dark 클래스 토글 방식으로 globals.css 의 다크 토큰을 활성화한다. */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
