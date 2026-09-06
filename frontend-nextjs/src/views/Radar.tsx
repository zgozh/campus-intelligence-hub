'use client';

import { useState, useEffect } from 'react';
import { Card, Col, Row, Statistic, Table, Typography } from 'antd';
import { api } from '../services/api';
import type { RadarStats } from '../services/api';

const { Title } = Typography;

export default function Radar() {
  const [stats, setStats] = useState<RadarStats | null>(null);

  useEffect(() => {
    api.getRadar().then(setStats).catch(console.error);
  }, []);

  if (!stats) {
    return <div style={{ padding: 24, color: '#999' }}>加载中...</div>;
  }

  const cards = [
    { label: '知识总量', value: stats.total_ko, color: '#1677ff' },
    { label: '已发布', value: stats.published, color: '#52c41a' },
    { label: '已过期', value: stats.expired, color: '#8c8c8c' },
    { label: '今日新增', value: stats.new_today, color: '#13c2c2' },
    { label: '待审核', value: stats.review_pending, color: '#faad14' },
    { label: '即将过期', value: stats.expiring, color: '#fa541c' },
    { label: '冲突知识', value: stats.conflict_open, color: '#ff4d4f' },
    { label: '来源异常', value: stats.source_error, color: '#eb2f96' },
  ];

  const activityColumns = [
    { title: '来源', dataIndex: 'name' },
    { title: '文档数', dataIndex: 'count', width: 120 },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>知识雷达</Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {cards.map((c) => (
          <Col xs={12} sm={8} md={6} key={c.label}>
            <Card>
              <Statistic title={c.label} value={c.value} valueStyle={{ color: c.color }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Title level={5}>来源活跃度</Title>
      <Table rowKey="name" columns={activityColumns} dataSource={stats.source_activity} pagination={false} style={{ maxWidth: 480 }} />
    </div>
  );
}
