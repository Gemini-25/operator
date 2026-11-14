import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  // @ts-expect-error vitest 설정 (vite 의 타입에는 없다)
  test: { include: ['tests/**/*.test.ts'], exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**'], testTimeout: 120000 },
});
