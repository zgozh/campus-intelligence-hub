'use client';

import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Typography, Progress, Tag } from 'antd';
import {
  CheckCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  MessageOutlined,
  RadarChartOutlined,
  StarOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { KnowledgeHealth } from '../services/api';

const { Title, Paragraph } = Typography;

function healthColor(score: number) {
  return score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<KnowledgeHealth | null>(null);

  useEffect(() => {
    api.getKnowledgeHealth().then(setHealth).catch(console.error);
  }, []);

  const entries = [
    { label: '数据源管理', desc: '新增官网 / URL / 列表页采集源，一键采集', path: '/sources', icon: <DatabaseOutlined style={{ fontSize: 22, color: '#1677ff' }} /> },
    { label: '采集任务', desc: '抓取 → 清洗 → 分类 → 去重 → 入库 六阶段流水', path: '/jobs', icon: <UnorderedListOutlined style={{ fontSize: 22, color: '#52c41a' }} /> },
    { label: '知识对象', desc: '结构化校务知识（类型 / 有效期 / 部门）', path: '/knowledge-objects', icon: <StarOutlined style={{ fontSize: 22, color: '#faad14' }} /> },
    { label: '变更雷达', desc: '自动检测知识变化 → Diff 对比', path: '/changes', icon: <RadarChartOutlined style={{ fontSize: 22, color: '#722ed1' }} /> },
    { label: '知识雷达', desc: '运营指标：新增 / 待审 / 冲突 / 将过期', path: '/radar', icon: <RadarChartOutlined style={{ fontSize: 22, color: '#13c2c2' }} /> },
    { label: '审核队列', desc: '低置信 / 冲突知识人工审核', path: '/review', icon: <CheckCircleOutlined style={{ fontSize: 22, color: '#eb2f96' }} /> },
    { label: 'AI 问答', desc: '引用式问答（结论 + 来源引用）', path: '/ask', icon: <MessageOutlined style={{ fontSize: 22, color: '#fa541c' }} /> },
    { label: '日报周报', desc: '自动汇总校园知识动态', path: '/digests', icon: <FileTextOutlined style={{ fontSize: 22, color: '#fa8c16' }} /> },
  ];

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>校务智汇中台</Title>
      <Paragraph type="secondary">
        AI 自动数据采集与知识管理平台 · 数据进入 → 知识形成 → 业务查询 → 知识反哺
      </Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} md={4}>
          <Card><Statistic title="今日新增" value={health?.today.new ?? 0} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card><Statistic title="今日变更" value={health?.today.changed ?? 0} valueStyle={{ color: '#fa8c16' }} /></Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card><Statistic title="冲突" value={health?.today.conflicts ?? 0} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card><Statistic title="待审核" value={health?.today.review ?? 0} valueStyle={{ color: '#faad14' }} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} md={8}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>校务知识健康度</span>
              <span style={{ fontWeight: 800, fontSize: 30, color: healthColor(health?.health_score ?? 0) }}>
                {health?.health_score ?? 0}
              </span>
            </div>
            <Progress percent={health?.health_score ?? 0} strokeColor={healthColor(health?.health_score ?? 0)} showInfo={false} size="small" />
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
              公式：{health?.formula}
            </Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card title="知识与来源健康">
            <Row gutter={16}>
              <Col xs={12} sm={6}><Statistic title="知识总量" value={health?.coverage.total ?? 0} /></Col>
              <Col xs={12} sm={6}><Statistic title="已发布" value={health?.coverage.published ?? 0} /></Col>
              <Col xs={12} sm={6}><Statistic title="已过期" value={health?.coverage.expired ?? 0} /></Col>
              <Col xs={12} sm={6}><Statistic title="来源健康" value={`${health?.source_health.ok ?? 0}/${health?.source_health.total ?? 0}`} /></Col>
            </Row>
            <div style={{ marginTop: 12 }}>
              <Tag color="green">Fresh {health?.freshness.Fresh ?? 0}</Tag>
              <Tag color="orange">Aging {health?.freshness.Aging ?? 0}</Tag>
              <Tag color="red">Stale {health?.freshness.Stale ?? 0}</Tag>
              <Tag color="default">Unknown {health?.freshness.Unknown ?? 0}</Tag>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {entries.map((e) => (
          <Col xs={24} sm={12} md={6} key={e.path}>
            <Card hoverable onClick={() => navigate(e.path)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                {e.icon}
                <span style={{ fontSize: 15, fontWeight: 600 }}>{e.label}</span>
              </div>
              <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                {e.desc}
              </Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
