#!/usr/bin/env node
/**
 * 本地验收服务器：复刻 deploy/nginx.conf 的路由语义，
 * 用于在没有 nginx 的环境里验收“反向代理子路径部署”。
 *
 * 用法：
 *   node deploy/local-verify-server.mjs --webroot /path/to/webroot --port 8080 --api-target http://127.0.0.1:8000
 *
 * 路由规则（与 nginx.conf 一一对应）：
 *   /metric-insight/assets/**   current/assets/ 下的哈希资源，immutable 长缓存
 *   /metric-insight/index.html  入口 HTML，no-cache
 *   /metric-insight/**          静态文件优先，缺失则 SPA fallback 到入口 HTML
 *   /api/**                     反代到 --api-target（根路径，不进前端前缀）
 *   /assets/**                  legacy/ 下的旧构建资源，immutable
 *   其余                        301 到 /metric-insight<原路径>（历史 URL 映射）
 */
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

const args = process.argv.slice(2)
function argOf(name, fallback) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const WEBROOT = resolve(argOf('webroot', './webroot'))
const PORT = Number(argOf('port', '8080'))
const API_TARGET = new URL(argOf('api-target', 'http://127.0.0.1:8000'))
const BASE_PATH = '/metric-insight'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
}

function sendFile(res, file, cacheControl) {
  const stream = createReadStream(file)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': cacheControl,
  })
  stream.pipe(res)
}

/** 把 URL 路径安全映射到目录内，防路径穿越。 */
function safeJoin(dir, urlPath) {
  const target = resolve(join(dir, urlPath))
  return target.startsWith(resolve(dir) + '/') || target === resolve(dir) ? target : null
}

function proxyApi(req, res) {
  const doRequest = API_TARGET.protocol === 'https:' ? httpsRequest : httpRequest
  const upstream = doRequest(
    {
      hostname: API_TARGET.hostname,
      port: API_TARGET.port || (API_TARGET.protocol === 'https:' ? 443 : 80),
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: API_TARGET.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`上游不可达：${err.message}`)
  })
  req.pipe(upstream)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = decodeURIComponent(url.pathname)
  const current = join(WEBROOT, 'current')

  // API：根路径反代，不进入前端前缀
  if (path === '/api' || path.startsWith('/api/')) {
    proxyApi(req, res)
    return
  }

  // 新入口：哈希资源（共享资源池，新旧版本交错共存）
  if (path.startsWith(`${BASE_PATH}/assets/`)) {
    const file = safeJoin(join(WEBROOT, 'assets-pool'), path.slice(`${BASE_PATH}/assets/`.length))
    if (file && existsSync(file) && statSync(file).isFile()) {
      sendFile(res, file, 'public, max-age=31536000, immutable')
      return
    }
    res.writeHead(404).end('asset not found')
    return
  }

  // 新入口：入口 HTML 与其余前端路由（SPA fallback）
  if (path === `${BASE_PATH}/index.html` || path.startsWith(`${BASE_PATH}/`) || path === BASE_PATH) {
    const rel = path.slice(BASE_PATH.length).replace(/^\//, '')
    const file = rel ? safeJoin(current, rel) : null
    if (file && existsSync(file) && statSync(file).isFile() && !rel.endsWith('index.html')) {
      sendFile(res, file, 'no-cache')
      return
    }
    const indexHtml = join(current, 'index.html')
    if (existsSync(indexHtml)) {
      sendFile(res, indexHtml, 'no-cache')
      return
    }
    res.writeHead(503).end('前端尚未发布')
    return
  }

  // 旧根构建资源：过渡期可访问
  if (path.startsWith('/assets/')) {
    const file = safeJoin(join(WEBROOT, 'legacy', 'assets'), path.slice('/assets/'.length))
    if (file && existsSync(file) && statSync(file).isFile()) {
      sendFile(res, file, 'public, max-age=31536000, immutable')
      return
    }
    res.writeHead(404).end('legacy asset not found')
    return
  }

  // 历史 URL 映射：旧根入口 301 到新前缀（保留查询串）
  const target = `${BASE_PATH}${path}${url.search}`
  res.writeHead(301, { Location: target })
  res.end(`Moved Permanently -> ${target}`)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`验收服务器已启动: http://127.0.0.1:${PORT}`)
  console.log(`  部署根目录: ${WEBROOT}`)
  console.log(`  API 反代:   /api -> ${API_TARGET.origin}`)
})
