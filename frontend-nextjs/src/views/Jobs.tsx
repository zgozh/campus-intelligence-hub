'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography } from 'antd';
import { api } from '../services/api';
import type { CollectionJob } from '../services/api';

const { Title } = Typography;

const statusColor: Record<string, string> = {
  PENDING: 'orange',
  RUNNING: 'blue',
  SUCCESS: 'green',
  FAILED: 'red',
  PARTIAL: 'gold',
};

const STAGES = ['Fetch', 'Parse', 'Clean', 'Classify', 'Dedup', 'Index'];

export default function Jobs() {
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.listJobs();
      setJobs(d.jobs || []);
    } catch (e) {
      console.error(e);
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

  const columns = [
    { title: '任务 ID', dataIndex: 'id', width: 180, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
    },
    {
      title: '阶段',
      dataIndex: 'stage_trace',
      render: (trace: Record<string, string> | null) => (
        <span>
          {STAGES.map((s) => {
            const state = (trace || {})[s] || 'pending';
            const color = state === 'ok' ? 'green' : state === 'running' ? 'blue' : 'default';
            return (
              <Tag key={s} color={color} style={{ marginRight: 4 }}>
                {s} {state === 'ok' ? '✓' : state === 'running' ? '…' : '○'}
              </Tag>
            );
          })}
        </span>
      ),
    },
    { title: '结果', dataIndex: 'result', width: 220, render: (r: CollectionJob['result']) => (r ? JSON.stringify(r) : '-') },
    { title: '创建时间', dataIndex: 'created_at', width: 180, render: (v: string) => new Date(v).toLocaleString() },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>采集任务</Title>
      <Table rowKey="id" columns={columns} dataSource={jobs} loading={loading} pagination={false} />
    </div>
  );
}
