'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { KnowledgeObject } from '../services/api';

const th: CSSProperties = {
  textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,0.25)',
  fontSize: 13, color: 'var(--color-text-secondary, #aaa)',
};
const td: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid rgba(128,128,128,0.15)', fontSize: 13 };

const statusColor: Record<string, string> = {
  PUBLISHED: '#22c55e',
  EXPIRED: '#9ca3af',
  REVIEW_REQUIRED: '#eab308',
  ARCHIVED: '#6b7280',
};

export default function KnowledgeObjects() {
  const [objects, setObjects] = useState<KnowledgeObject[]>([]);
  const [selected, setSelected] = useState<KnowledgeObject | null>(null);

  useEffect(() => {
    api.listKnowledgeObjects().then((d) => setObjects(d.objects || [])).catch(console.error);
  }, []);

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>知识对象</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['类型', '标题', '状态', '版本', '置信度', '有效期'].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {objects.map((ko) => (
            <tr key={ko.id} onClick={() => setSelected(ko)} style={{ cursor: 'pointer' }}>
              <td style={td}>{ko.type}</td>
              <td style={td}>{ko.title}</td>
              <td style={td}><span style={{ color: statusColor[ko.status] || '#ccc', fontWeight: 600 }}>{ko.status}</span></td>
              <td style={td}>{ko.version}</td>
              <td style={td}>{ko.confidence ?? '-'}</td>
              <td style={td}>{ko.effective_from || '-'} ~ {ko.effective_to || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div style={{ marginTop: 16, padding: 16, background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(128,128,128,0.15)' }}>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{selected.title}</h3>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #aaa)', marginBottom: 8 }}>
            标签：{(selected.tags || []).join('、') || '无'}
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>{selected.summary}</p>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            {(selected.facts || []).map((f, i) => <div key={i}>· {f.field}：{f.value}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
