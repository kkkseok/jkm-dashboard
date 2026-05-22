import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Node 환경 (DB/UI 의존성 없음 — minus 파이프라인 단위 테스트)
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    // SSR 또는 next 전역 의존성 없음
    globals: false,
  },
})
