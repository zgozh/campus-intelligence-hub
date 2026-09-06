'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { RadarStats } from '../services/api';

const cardStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '16px 20px',
  border: '1px solid rgba(128,128,128,0.2)',
  minWidth: 130,
  flex: 1,
};

export default function Radar() {
  const [stats, setStats] = useState<RadarStats | null>(null);

  useEffect(() => {
    api.getRadar().then(setStats).catch(console.error);
  }, []);

  if (!stats) {
    return <div style={{ padding: 24, color: 'var(--color-text-secondary, #aaa)' }}>加载中...</div>;
  }

  const cards = [
    { label: '知识总量', value: stats.total_ko },
    { label: '已发布', value: stats.published },
    { label: '已过期', value: stats.expired },
    { label: '今日新增', value: stats.new_today },
    { label: '待审核', value: stats.review_pending },
    { label: '即将过期', value: stats.expiring },
    { label: '冲突知识', value: stats.conflict_open },
    { label: '来源异常', value: stats.source_error },
  ];

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 'var(--text-2xl, 24px)', fontWeight: 700, marginBottom: 20 }}>知识雷达</h1>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        {cards.map((c) => (
          <div key={c.label} style={cardStyle}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary, #06B6D4)' }}>{c.value}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #aaa)', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 'var(--text-xl, 20px)', fontWeight: 600, marginBottom: 12 }}>来源活跃度</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', maxWidth: 480 }}>
        <tbody>
          {stats.source_activity.map((s) => (
            <tr key={s.name}>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(128,128,128,0.15)' }}>{s.name}</td>
              <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(128,128,128,0.15)', textAlign: 'right', fontWeight: 600 }}>
                {s.count}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
