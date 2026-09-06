'use client';

import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { RadarStats } from '../services/api';

const statCard: CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  borderRadius: 12,
  padding: '14px 20px',
  border: '1px solid rgba(128,128,128,0.2)',
  minWidth: 110,
};

const entryCard: CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 12,
  padding: 18,
  border: '1px solid rgba(128,128,128,0.15)',
  cursor: 'pointer',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<RadarStats | null>(null);

  useEffect(() => {
    api.getRadar().then(setStats).catch(console.error);
  }, []);

  const entries = [
    { label: '数据源管理', desc: '新增官网 / URL / 列表页采集源，一键采集', path: '/sources' },
    { label: '采集任务', desc: '抓取 → 清洗 → 分类 → 去重 → 入库 六阶段流水', path: '/jobs' },
    { label: '知识对象', desc: '结构化校务知识（类型 / 有效期 / 部门）', path: '/knowledge-objects' },
    { label: '知识雷达', desc: '运营指标：新增 / 待审 / 冲突 / 将过期', path: '/radar' },
    { label: '审核队列', desc: '低置信 / 冲突知识人工审核', path: '/review' },
    { label: 'AI 问答', desc: '引用式问答（结论 + 来源引用）', path: '/ask' },
    { label: '日报周报', desc: '自动汇总校园知识动态', path: '/digests' },
  ];

  return (
    <div style={{ padding: 'var(--space-6, 24px)' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>校务智汇中台</h1>
      <p style={{ color: 'var(--color-text-secondary, #aaa)', marginBottom: 24, fontSize: 14 }}>
        AI 自动数据采集与知识管理平台 · 数据进入 → 知识形成 → 业务查询 → 知识反哺
      </p>

      {stats && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
          {[
            { label: '知识总量', value: stats.total_ko },
            { label: '已发布', value: stats.published },
            { label: '待审核', value: stats.review_pending },
            { label: '冲突知识', value: stats.conflict_open },
            { label: '即将过期', value: stats.expiring },
          ].map((c) => (
            <div key={c.label} style={statCard}>
              <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary, #06B6D4)' }}>{c.value}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary, #aaa)', marginTop: 2 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
        {entries.map((e) => (
          <div key={e.path} onClick={() => navigate(e.path)} style={entryCard}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{e.label}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary, #aaa)', lineHeight: 1.5 }}>{e.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
