// @ts-nocheck
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // 关键配置：防止 Vite pre-bundle 破坏相对路径引用的 Worker
    exclude: ['@manycore/aholo-viewer'],
  },
});
