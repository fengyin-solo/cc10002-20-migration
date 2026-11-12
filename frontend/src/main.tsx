import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './styles/global.css'

// 路由基准与构建 base 保持一致：根部署时是 `/`，
// 子路径部署时是 `/metric-insight/`，深链接与刷新都按这个基准解析。
// react-router 的 basename 不带尾斜杠，这里统一去掉。
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
