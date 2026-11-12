import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// 后端地址默认取本文件里写的端口，起服务时可以用 VITE_PROXY_TARGET 覆盖，
// 这样换端口调试或做启动探针时前端不用改代码。
const proxyTarget = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000'

/**
 * 把配置的路径前缀规范成 `/prefix/` 形式；未配置或配置为 `/` 时按根路径部署。
 * 例：`metric-insight` → `/metric-insight/`，`/metric-insight/` 原样保留。
 */
function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '' || trimmed === '/') {
    return '/'
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // 部署路径前缀（构建期生效）：
  // - 本地开发（npm run dev）不配置，默认根路径 `/`；
  // - 正式构建由 .env.production 或构建环境变量 VITE_BASE_PATH 给出，
  //   例如 VITE_BASE_PATH=/metric-insight/，静态资源与前端路由都以它为基准。
  const base = normalizeBase(env.VITE_BASE_PATH)

  return {
    base,
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      // 关掉自动打开页面：起服务时只打印地址，不拉起浏览器
      open: false,
      strictPort: false,
      proxy: {
        // API 基准始终是同源根路径 /api，不随前端部署前缀变化，
        // 只由这里代理到后端，不会拼进前端子目录。
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      // 本地验收生产构建：vite preview 按 base 把产物挂在路径前缀下，
      // 同样把 /api 代理到后端，便于在子路径形态下验深链接与刷新。
      host: '127.0.0.1',
      port: 4173,
      open: false,
      strictPort: false,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
