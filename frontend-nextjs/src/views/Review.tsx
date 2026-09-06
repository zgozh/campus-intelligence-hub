'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { ReviewTaskItem } from '../services/api';

const th: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,0.25)',
  fontSize: 13, color: 'var(--color-text-secondary, #aaa)',
};
const td: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,0.15)', fontSize: 14 };
const baseBtn: CSSProperties = { padding: '6px 12px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: 12, color: '#fff' };

export default function Review() {
  const [tasks, setTasks] = useState<ReviewTaskItem[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api.listReviewTasks();
      setTasks(d.tasks || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: string) => { await api.approveReviewTask(id); await load(); };
  const reject = async (id: string) => { await api.rejectReviewTask(id); await load(); };

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>审核队列</h1>
      {tasks.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary, #aaa)' }}>暂无待审核任务</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>{['类型', '原因', '标题', '操作'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td style={td}>{t.ko_type}</td>
                <td style={td}>{t.reason === 'low_confidence' ? '低置信度' : '冲突'}</td>
                <td style={td}>{t.ko_title}</td>
                <td style={td}>
                  <button onClick={() => approve(t.id)} style={{ ...baseBtn, background: '#22c55e' }}>批准</button>{' '}
                  <button onClick={() => reject(t.id)} style={{ ...baseBtn, background: 'rgba(220,60,60,0.85)' }}>拒绝</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
