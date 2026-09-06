'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { api } from '../services/api';
import type { DigestItem } from '../services/api';

const btnStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--color-primary, #06B6D4)',
  color: '#fff',
  cursor: 'pointer',
  fontSize: 13,
};

export default function Digests() {
  const [digests, setDigests] = useState<DigestItem[]>([]);
  const [current, setCurrent] = useState<DigestItem | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.listDigests();
      setDigests(d.digests || []);
      setCurrent((prev) => prev || (d.digests && d.digests[0]) || null);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async (period: string) => {
    setLoading(true);
    try {
      const d = await api.generateDigest(period);
      setCurrent(d);
      await load();
    } catch (e) {
      alert('生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>自动日报 / 周报</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button onClick={() => generate('daily')} disabled={loading} style={btnStyle}>
          生成日报
        </button>
        <button onClick={() => generate('weekly')} disabled={loading} style={btnStyle}>
          生成周报
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          {digests.map((d) => (
            <div
              key={d.id}
              onClick={() => setCurrent(d)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                borderRadius: 8,
                marginBottom: 6,
                background: current?.id === d.id ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(128,128,128,0.15)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #aaa)' }}>
                {new Date(d.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 320,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(128,128,128,0.15)',
            borderRadius: 12,
            padding: 20,
          }}
        >
          {current ? (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              {current.content}
            </pre>
          ) : (
            <p style={{ color: 'var(--color-text-secondary, #aaa)' }}>暂无日报，点击上方按钮生成</p>
          )}
        </div>
      </div>
    </div>
  );
}
