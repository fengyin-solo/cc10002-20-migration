/** 统一请求封装：拼后端地址、抛网络错误、给页脚留一句可读的说明。 */
// API 基准：默认同源根路径（留空），由 dev server / 反向代理把 /api 转发到后端。
// 注意它与前端部署前缀（vite base）相互独立，绝不拼成 `<前缀>/api`。
const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

/** 把接口路径拼成完整地址；页面里所有直连接口的入口（含新窗口打开）都走这里。 */
export function apiUrl(path: string): string {
  return path.startsWith('http') ? path : `${API_BASE}${path}`
}

export function request(path: string, init?: RequestInit): Promise<Response> {
  const url = apiUrl(path)
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  }).catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : '请求未送达'
    throw new Error(`接口请求失败：${detail}`)
  })
}

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await request(path)
  if (!response.ok) {
    throw new Error(`接口返回 ${response.status}，数据未更新`)
  }
  return (await response.json()) as T
}
