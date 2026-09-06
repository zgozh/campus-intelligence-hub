'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { CollectionJob } from '../services/api';

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
  fontSize: '13px',
  verticalAlign: 'top',
};

const statusColor: Record<string, string> = {
  PENDING: '#d97706',
  RUNNING: '#06B6D4',
  SUCCESS: '#22c55e',
  FAILED: '#ef4444',
  PARTIAL: '#eab308',
};

const STAGES = ['Fetch', 'Parse', 'Clean', 'Classify', 'Dedup', 'Index'];

export default function Jobs() {
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.listJobs();
      setJobs(data.jobs || []);
    } catch (e) {
      console.error('load jobs failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const trace = (job: CollectionJob) => {
    const t = job.stage_trace || {};
    return STAGES.map((s) => ({ stage: s, state: t[s] || 'pending' }));
  };

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl, 24px)', fontWeight: 700, marginBottom: 'var(--space-4, 16px)' }}>
        采集任务
      </h1>
      {loading && jobs.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary, #aaa)' }}>加载中...</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['任务 ID', '状态', '阶段', '结果', '创建时间'].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{j.id}</td>
                <td style={tdStyle}>
                  <span style={{ color: statusColor[j.status] || '#ccc', fontWeight: 600 }}>{j.status}</span>
                </td>
                <td style={tdStyle}>
                  {trace(j).map((s) => (
                    <span
                      key={s.stage}
                      style={{
                        marginRight: 8,
                        fontSize: 12,
                        color: s.state === 'ok' ? '#22c55e' : s.state === 'running' ? '#06B6D4' : '#666',
                      }}
                    >
                      {s.stage} {s.state === 'ok' ? '✓' : s.state === 'running' ? '…' : '○'}
                    </span>
                  ))}
                </td>
                <td style={tdStyle}>{j.result ? JSON.stringify(j.result) : '-'}</td>
                <td style={tdStyle}>{j.created_at ? new Date(j.created_at).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ marginTop: 12, color: 'var(--color-text-secondary, #aaa)', fontSize: 13 }}>
        共 {jobs.length} 个任务
      </p>
    </div>
  );
}
