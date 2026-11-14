import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  // 화면 자동 검사(scripts/ui-check.cjs)는 자기 캐시 폴더를 쓴다: 작업 폴더 여럿이 node_modules 를 링크로 함께 쓰면
  // 다른 개발 서버가 의존성 캐시를 다시 만들 때 이쪽 페이지가 도중에 새로고침된다
  cacheDir: process.env.AR_VITE_CACHE || 'node_modules/.vite',
  // @ts-expect-error vitest 설정 (vite 의 타입에는 없다)
  test: { include: ['tests/**/*.test.ts'], exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'], testTimeout: 120000 },
});
