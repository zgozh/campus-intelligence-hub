'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { CampusSource } from '../services/api';

const inputStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--color-text, #e8e8e8)',
  fontSize: '14px',
};
const btnStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--color-primary, #06B6D4)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: '13px',
};
const dangerBtn: CSSProperties = { ...btnStyle, background: 'rgba(220,60,60,0.85)' };
const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid rgba(128,128,128,0.25)',
  fontSize: '13px',
  color: 'var(--color-text-secondary, #aaa)',
};
const tdStyle: CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(128,128,128,0.15)',
  fontSize: '14px',
};

export default function Sources() {
  const [sources, setSources] = useState<CampusSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState('website');
  const [baseUrl, setBaseUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSources();
      setSources(data.sources || []);
    } catch (e) {
      alert('加载数据源失败：' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!name.trim()) {
      alert('请输入名称');
      return;
    }
    try {
      await api.createSource({
        name: name.trim(),
        source_type: sourceType,
        base_url: baseUrl.trim() || undefined,
      });
      setName('');
      setBaseUrl('');
      await load();
    } catch (e) {
      alert('创建失败：' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const run = async (id: string) => {
    try {
      const r = await api.runSource(id);
      alert(`已触发采集任务 ${r.job_id}`);
    } catch (e) {
      alert('触发失败：' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const pause = async (id: string) => {
    try {
      await api.pauseSource(id);
      await load();
    } catch (e) {
      alert('操作失败');
    }
  };

  const del = async (id: string) => {
    if (!confirm('确认删除该数据源？')) return;
    try {
      await api.deleteSource(id);
      await load();
    } catch (e) {
      alert('删除失败');
    }
  };

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl, 24px)', fontWeight: 700, marginBottom: 'var(--space-4, 16px)' }}>
        数据源管理
      </h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名称（如 学校官网）"
          style={inputStyle}
        />
        <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} style={inputStyle}>
          <option value="website">官网/网站</option>
          <option value="list_page">通知公告列表页</option>
          <option value="file">上传文件</option>
          <option value="manual">手动录入</option>
          <option value="api">API</option>
        </select>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="URL（网站/列表页填）"
          style={{ ...inputStyle, flex: 1, minWidth: 220 }}
        />
        <button onClick={create} style={btnStyle}>
          新增数据源
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-secondary, #aaa)' }}>加载中...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['名称', '类型', '状态', '上次采集', '操作'].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td style={tdStyle}>{s.name}</td>
                <td style={tdStyle}>{s.source_type}</td>
                <td style={tdStyle}>{s.status}</td>
                <td style={tdStyle}>{s.last_crawled_at ? new Date(s.last_crawled_at).toLocaleString() : '-'}</td>
                <td style={tdStyle}>
                  <button onClick={() => run(s.id)} style={btnStyle}>
                    立即采集
                  </button>{' '}
                  <button onClick={() => pause(s.id)} style={btnStyle}>
                    暂停
                  </button>{' '}
                  <button onClick={() => del(s.id)} style={dangerBtn}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 12, color: 'var(--color-text-secondary, #aaa)', fontSize: 13 }}>
        共 {sources.length} 个数据源
      </p>
    </div>
  );
}
