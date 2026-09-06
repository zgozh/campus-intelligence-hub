'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { AskResponse } from '../services/api';

const inputStyle: CSSProperties = {
  flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.3)',
  background: 'rgba(255,255,255,0.05)', color: 'var(--color-text, #e8e8e8)', fontSize: 14,
};

export default function AskAI() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await api.askQuestion(query.trim());
      setResult(r);
    } catch (e) {
      alert('问答失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>校务 AI 问答</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="例如：教师资格考试什么时候进行？"
          style={inputStyle}
        />
        <button
          onClick={ask}
          disabled={loading}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: 'var(--color-primary, #06B6D4)', color: '#fff', cursor: 'pointer' }}
        >
          {loading ? '思考中...' : '提问'}
        </button>
      </div>

      {result && (
        <div>
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(128,128,128,0.15)', borderRadius: 12, padding: 18, marginBottom: 16, fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {result.answer}
          </div>
          {result.citations.length > 0 && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>来源引用（{result.citations.length}）</h3>
              {result.citations.map((c, i) => (
                <div key={i} style={{ padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(128,128,128,0.12)', fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{c.title}</div>
                  <div style={{ color: 'var(--color-text-secondary, #aaa)', fontSize: 12, marginTop: 2 }}>
                    {c.type} · {c.department || '未知部门'} · 有效期至 {c.effective_to || '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
