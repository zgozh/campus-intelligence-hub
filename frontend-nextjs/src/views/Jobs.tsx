'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, Col, Row, Space, Steps, Tag, Typography, Empty } from 'antd';
import { ClockCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { CollectionJob } from '../services/api';

const { Title, Text } = Typography;

const statusColor: Record<string, string> = { PENDING: 'orange', RUNNING: 'blue', SUCCESS: 'green', FAILED: 'red', PARTIAL: 'gold' };
const statusZh: Record<string, string> = { PENDING: '等待中', RUNNING: '采集中', SUCCESS: '成功', FAILED: '失败', PARTIAL: '部分成功' };
const STAGES = ['Fetch', 'Parse', 'Clean', 'Classify', 'Dedup', 'Index'];
const STAGE_ZH: Record<string, string> = { Fetch: '抓取', Parse: '解析', Clean: '清洗', Classify: '分类', Dedup: '去重', Index: '入库' };

function st(trace: Record<string, string> | null | undefined, stage: string): string {
  return (trace || {})[stage] || 'pending';
}

function act(trace?: Record<string, string> | null): number {
  // 当前进行到哪一步
  for (let i = 0; i < STAGES.length; i++) {
    const s = st(trace, STAGES[i]);
    if (s === 'running') return i;
  }
  const okCount = STAGES.filter((s) => st(trace, s) === 'ok').length;
  return okCount === STAGES.length ? STAGES.length : Math.min(okCount, STAGES.length);
}

function fmtTime(v?: string | null) {
  return v ? new Date(v).toLocaleString() : '-';
}

// 采集结果后端新增字段（接口类型尚未声明，按可选补充）
type JobResult = NonNullable<CollectionJob['result']> & { updated?: number; skipped?: number };

export default function Jobs() {
  const [jobs, setJobs] = useState<CollectionJob[]>([]);
  const [loading, setLoading] = useState(true);

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
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  if (!loading && jobs.length === 0) {
    return (
      <div>
        <Title level={4} style={{ marginTop: 0 }}>采集任务</Title>
        <Empty description="暂无采集任务，可在「数据源管理」触发采集。" />
      </div>
    );
  }

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>采集任务</Title>
      <Row gutter={[16, 16]}>
        {jobs.map((j) => {
          const result: JobResult = j.result || {};
          const stepStatus = j.status === 'FAILED' ? 'error' : j.status === 'SUCCESS' ? 'finish' : 'process';
          return (
            <Col xs={24} md={12} key={j.id}>
              <Card size="small" loading={loading && !j.id} title={null} style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Space>
                    <SyncOutlined spin={j.status === 'RUNNING'} style={{ color: j.status === 'RUNNING' ? '#1677ff' : '#999' }} />
                    <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{j.id}</Text>
                  </Space>
                  <Tag color={statusColor[j.status] || 'default'}>{statusZh[j.status] || j.status}</Tag>
                </div>

                <Steps
                  size="small"
                  current={stepStatus === 'finish' ? STAGES.length : Math.min(act(j.stage_trace), STAGES.length)} 
                  status={stepStatus}
                  items={STAGES.map((s, i) => ({
                    title: STAGE_ZH[s] || s,
                    status: stepStatus === 'finish' ? 'finish' : st(j.stage_trace, s) === 'ok' ? 'finish' : st(j.stage_trace, s) === 'running' ? 'process' : 'wait',
                  }))}
                  style={{ marginBottom: 12 }}
                />

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Tag>抓取 {result.fetched ?? '-'}</Tag>
                  <Tag color="green">新增 {result.indexed ?? '-'}</Tag>
                  <Tag color="blue">更新 {result.updated ?? '-'}</Tag>
                  <Tag>跳过 {result.skipped ?? '-'}</Tag>
                </div>

                {j.error_message && <div style={{ color: '#ff4d4f', fontSize: 12, marginBottom: 6 }}>{j.error_message}</div>}

                <div style={{ color: '#999', fontSize: 12 }}>
                  <ClockCircleOutlined style={{ marginRight: 4 }} />开始 {fmtTime(j.started_at)} · 结束 {fmtTime(j.completed_at)}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
}
