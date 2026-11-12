import { useCallback, useEffect, useMemo, useState } from 'react'

import { apiUrl, request } from '@/api/client'

const ENDPOINT = '/api/abtest'
const columns = [
  "方案编号",
  "实验名称",
  "对照组配置",
  "实验组配置",
  "流量分配比例",
  "核心指标",
  "最小样本量",
  "置信水平"
]
const actions = [
  "提交审批",
  "启动实验",
  "停止实验",
  "归档实验"
]
const statuses = [
  "草稿",
  "待审批",
  "运行中",
  "已完成",
  "已终止"
]
const stats = [
  {
    "label": "实验方案总数",
    "value": 0
  },
  {
    "label": "运行中实验",
    "value": 0
  },
  {
    "label": "已完成实验",
    "value": 0
  }
]

type Row = Record<string, string | number | null>

export default function AbtestView() {
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const filterFields = useMemo(() => columns.slice(0, 3), [])

  const reload = useCallback(async () => {
    setErrorMessage('')
    const query = new URLSearchParams(filters).toString()
    try {
      const response = await request(`${ENDPOINT}?${query}`)
      if (!response.ok) {
        throw new Error('实验方案列表读取失败')
      }
      const payload = await response.json()
      setRows(payload.items ?? [])
      setTotal(payload.total ?? 0)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'AB实验列表读取失败')
    }
  }, [filters])

  useEffect(() => {
    void reload()
  }, [reload])

  async function runAction(action: string, row: Row) {
    setErrorMessage('')
    try {
      const response = await request(`${ENDPOINT}/${row.id}/actions`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      if (!response.ok) {
        throw new Error('AB实验动作未生效，请稍后重试')
      }
      await reload()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'AB实验操作失败')
    }
  }

  return (
    <section className="page" data-module="abtest">
      <header className="page-head">
        <div>
          <h2>AB实验管理</h2>
          <p className="page-desc">维护AB实验方案的输入、执行约束与结果记录，为实验评估提供可验证的数据工程流程。</p>
        </div>
        <div className="page-actions">
          <button className="btn primary" type="button" onClick={() => setErrorMessage('实验方案登记入口尚未接入审批流')}>
            登记实验方案
          </button>
          <button className="btn" type="button" onClick={() => window.open(apiUrl(`${ENDPOINT}/export`), '_blank')}>
            导出AB实验清单
          </button>
        </div>
      </header>

      <div className="stat-row">
        {stats.map((item) => (
          <article key={item.label} className="stat-card">
            <span className="stat-label">{item.label}</span>
            <strong className="stat-value">{item.value}</strong>
          </article>
        ))}
      </div>

      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); void reload() }}>
        {filterFields.map((field) => (
          <label key={field} className="filter-item">
            <span>{field}</span>
            <input
              value={filters[field] ?? ''}
              placeholder={`按${field}检索`}
              onChange={(event) => setFilters((prev) => ({ ...prev, [field]: event.target.value }))}
            />
          </label>
        ))}
        <button className="btn" type="submit">查询</button>
        <button className="btn ghost" type="button" onClick={() => setFilters({})}>重置条件</button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => <th key={column}>{column}</th>)}
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.id)}>
              {columns.map((column) => <td key={column}>{row[column] ?? '—'}</td>)}
              <td className="row-actions">
                {actions.map((action) => (
                  <button key={action} className="link" type="button" onClick={() => void runAction(action, row)}>
                    {action}
                  </button>
                ))}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="empty-state" colSpan={columns.length + 1}>暂无AB实验数据，可先登记实验方案</td>
            </tr>
          )}
        </tbody>
      </table>

      <footer className="page-foot">
        <span>共 {total} 条AB实验记录</span>
        {errorMessage && <span className="error-text">{errorMessage}</span>}
      </footer>
    </section>
  )
}
