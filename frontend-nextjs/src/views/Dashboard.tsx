'use client';

import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Typography } from 'antd';
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
import type { RadarStats } from '../services/api';

const { Title, Paragraph } = Typography;

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<RadarStats | null>(null);

  useEffect(() => {
    api.getRadar().then(setStats).catch(console.error);
  }, []);

  const entries = [
    { label: '数据源管理', desc: '新增官网 / URL / 列表页采集源，一键采集', path: '/sources', icon: <DatabaseOutlined style={{ fontSize: 22, color: '#1677ff' }} /> },
    { label: '采集任务', desc: '抓取 → 清洗 → 分类 → 去重 → 入库 六阶段流水', path: '/jobs', icon: <UnorderedListOutlined style={{ fontSize: 22, color: '#52c41a' }} /> },
    { label: '知识对象', desc: '结构化校务知识（类型 / 有效期 / 部门）', path: '/knowledge-objects', icon: <StarOutlined style={{ fontSize: 22, color: '#faad14' }} /> },
    { label: '知识雷达', desc: '运营指标：新增 / 待审 / 冲突 / 将过期', path: '/radar', icon: <RadarChartOutlined style={{ fontSize: 22, color: '#722ed1' }} /> },
    { label: '审核队列', desc: '低置信 / 冲突知识人工审核', path: '/review', icon: <CheckCircleOutlined style={{ fontSize: 22, color: '#13c2c2' }} /> },
    { label: 'AI 问答', desc: '引用式问答（结论 + 来源引用）', path: '/ask', icon: <MessageOutlined style={{ fontSize: 22, color: '#eb2f96' }} /> },
    { label: '日报周报', desc: '自动汇总校园知识动态', path: '/digests', icon: <FileTextOutlined style={{ fontSize: 22, color: '#fa541c' }} /> },
  ];

  const statItems = [
    { label: '知识总量', value: stats?.total_ko ?? 0, color: '#1677ff' },
    { label: '已发布', value: stats?.published ?? 0, color: '#52c41a' },
    { label: '待审核', value: stats?.review_pending ?? 0, color: '#faad14' },
    { label: '冲突知识', value: stats?.conflict_open ?? 0, color: '#ff4d4f' },
    { label: '即将过期', value: stats?.expiring ?? 0, color: '#fa541c' },
  ];

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>校务智汇中台</Title>
      <Paragraph type="secondary">
        AI 自动数据采集与知识管理平台 · 数据进入 → 知识形成 → 业务查询 → 知识反哺
      </Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statItems.map((s) => (
          <Col xs={12} sm={8} md={4} key={s.label}>
            <Card>
              <Statistic title={s.label} value={s.value} valueStyle={{ color: s.color }} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        {entries.map((e) => (
          <Col xs={24} sm={12} md={8} key={e.path}>
            <Card hoverable onClick={() => navigate(e.path)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                {e.icon}
                <span style={{ fontSize: 16, fontWeight: 600 }}>{e.label}</span>
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
