'use client';

import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Tag, Typography, Progress, Table, Space, Button } from 'antd';
import { WarningOutlined, SafetyOutlined, BulbOutlined, BranchesOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { ChangeEvent, InsightReportItem, KnowledgeGraph, KnowledgeHealth, KnowledgeObject } from '../services/api';
import DashboardMarkdown from '../components/DashboardMarkdown';

const { Title, Paragraph, Text } = Typography;

function healthColor(s: number) {
  return s >= 80 ? '#52c41a' : s >= 60 ? '#faad14' : '#ff4d4f';
}

const sevColor: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };
const sevZh: Record<string, string> = { HIGH: '高', MEDIUM: '中', LOW: '低' };
const typeZh: Record<string, string> = {
  Announcement: '通知公告', Procedure: '办事指南', Regulation: '规章制度', Event: '新闻动态',
};

interface DeptRow { department: string; count: number }

export default function Overview() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);
  const [objects, setObjects] = useState<KnowledgeObject[]>([]);
  const [insight, setInsight] = useState<InsightReportItem | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);

  useEffect(() => {
    api.getKnowledgeHealth().then(setHealth).catch(console.error);
    api.listChanges().then((d) => setChanges((d.changes || []).slice(0, 5))).catch(console.error);
    api.listKnowledgeObjects().then((d) => setObjects(d.objects || [])).catch(console.error);
    api.listInsights(1).then((d) => setInsight((d.reports || [])[0] || null)).catch(console.error);
    api.listKnowledgeGraph().then(setGraph).catch(console.error);
  }, []);

  // 部门知识分布
  const deptMap: Record<string, DeptRow> = {};
  for (const o of objects) {
    const d = o.department || '未分类';
    if (!deptMap[d]) deptMap[d] = { department: d, count: 0 };
    deptMap[d].count++;
  }
  const deptRows = Object.values(deptMap).sort((a, b) => b.count - a.count).slice(0, 8);
  const totalDept = deptRows.reduce((s, r) => s + r.count, 0);

  const deptColumns = [
    { title: '部门', dataIndex: 'department' },
    { title: '知识数', dataIndex: 'count', width: 160 },
    {
      title: '占比',
      dataIndex: 'count',
      width: 200,
      render: (v: number) => (
        <Progress
          percent={totalDept ? Math.round((v / totalDept) * 100) : 0}
          size="small"
          strokeColor={healthColor(health?.health_score ?? 0)}
        />
      ),
    },
  ];

  const critical = changes.filter((c) => c.severity === 'HIGH');
  const riskCount = (health?.coverage.total ?? 0) > 0
    ? Math.round(((health?.freshness.Stale ?? 0) + (health?.coverage.expired ?? 0)) / (health?.coverage.total ?? 1) * 100)
    : 0;

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>校务智汇中台</Title>
      <Paragraph type="secondary" style={{ marginBottom: 20 }}>
        校务知识全局视图：健康度 · 重大变更 · 风险 · 部门分布
      </Paragraph>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size={8}>
          <Text type="secondary">快捷操作：</Text>
          <Button size="small" onClick={() => navigate('/sources')}>数据源</Button>
          <Button size="small" onClick={() => navigate('/knowledge-objects')}>知识对象</Button>
          <Button size="small" onClick={() => navigate('/jobs')}>采集任务</Button>
          <Button size="small" onClick={() => navigate('/review')}>审核队列</Button>
          <Button size="small" onClick={() => navigate('/ask')}>AI 问答</Button>
          <Button size="small" type="primary" onClick={() => navigate('/closed-loop')}>智能闭环</Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><SafetyOutlined style={{ color: '#52c41a', marginRight: 8 }} />校务知识健康度</span>
              <span style={{ fontWeight: 800, fontSize: 32, color: healthColor(health?.health_score ?? 0) }}>
                {health?.health_score ?? 0}
              </span>
            </div>
            <Progress percent={health?.health_score ?? 0} strokeColor={healthColor(health?.health_score ?? 0)} showInfo={false} />
            <div>
              <Statistic title="知识总量" value={health?.coverage.total ?? 0} />
              <Statistic title="已发布" value={health?.coverage.published ?? 0} />
              <Statistic title="来源健康" value={`${health?.source_health.ok ?? 0}/${health?.source_health.total ?? 0}`} />
            </div>
          </Card>
        </Col>

        <Col xs={24} md={16}>
          <Card title="重大变更（Critical Changes）" extra={<ButtonLink onClick={() => navigate('/changes')} />}>
            {critical.length === 0 ? (
              <Typography.Text type="secondary">暂无高优先级变更</Typography.Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }}>
                {critical.slice(0, 5).map((c) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span style={{ flex: 1 }}>
                      <Tag color={sevColor[c.severity] || 'default'}>{sevZh[c.severity]}优先级</Tag>
                      {c.diff_summary}
                    </span>
                    <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {c.source_name}
                    </Typography.Text>
                  </div>
                ))}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={16}>
          <Card
            title={<span><BulbOutlined style={{ color: '#722ed1', marginRight: 8 }} />AI 校务洞察</span>}
            extra={<ButtonLink onClick={() => navigate('/insights')} />}
          >
            {insight ? (
              <DashboardMarkdown content={insight.content} />
            ) : (
              <Typography.Text type="secondary">暂无洞察报告，前往「校务洞察」点击生成。</Typography.Text>
            )}
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card
            title={<span><BranchesOutlined style={{ color: '#1677ff', marginRight: 8 }} />知识图谱</span>}
            extra={<ButtonLink onClick={() => navigate('/knowledge-graph')} />}
          >
            <Statistic title="实体" value={graph?.entity_count ?? 0} />
            <Statistic title="关系" value={graph?.relation_count ?? 0} style={{ marginTop: 8 }} />
            <Button type="primary" block icon={<DeploymentUnitOutlined />} style={{ marginTop: 12 }} onClick={() => navigate('/closed-loop')}>
              一键智能闭环
            </Button>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card title="风险提示">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <WarningOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />知识陈旧占比
                <span style={{ float: 'right', fontWeight: 700, color: '#ff4d4f' }}>{riskCount}%</span>
              </div>
              <div>
                冲突知识
                <span style={{ float: 'right', fontWeight: 700 }}>{health?.today.conflicts ?? 0}</span>
              </div>
              <div>
                待审核积压
                <span style={{ float: 'right', fontWeight: 700 }}>{health?.review_backlog ?? 0}</span>
              </div>
              <div>
                今日变更
                <span style={{ float: 'right', fontWeight: 700 }}>{health?.today.changed ?? 0}</span>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={16}>
          <Card title="部门知识分布">
            <Table rowKey="department" columns={deptColumns} dataSource={deptRows} pagination={false} size="small" />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function ButtonLink({ onClick }: { onClick: () => void }) {
  return <a onClick={onClick} style={{ fontSize: 12 }}>查看全部 →</a>;
}
