'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Col, Input, Row, Space, Table, Tag, Typography, message } from 'antd';
import { BranchesOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { KGAskResult, KnowledgeGraph } from '../services/api';

const { Title } = Typography;

const entityColor: Record<string, string> = {
  部门: 'blue', 政策: 'purple', 事件: 'cyan', 对象: 'green', 时间: 'orange', 文件: 'magenta',
};

export default function KnowledgeGraphPage() {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState<KGAskResult | null>(null);
  const [askLoading, setAskLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.listKnowledgeGraph().then(setGraph).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const build = async () => {
    setBuilding(true);
    try {
      const r = await api.buildKnowledgeGraph();
      message.success(`图谱构建完成：新增 ${r.relations_added} 条关系`);
      await load();
    } catch (e) {
      message.error('图谱构建失败（需模型 API key）');
    } finally {
      setBuilding(false);
    }
  };

  const ask = async () => {
    if (!query.trim()) return;
    setAskLoading(true);
    try {
      setAsked(await api.askKnowledgeGraph(query));
    } catch (e) {
      message.error('图谱问答失败');
    } finally {
      setAskLoading(false);
    }
  };

  const eMap = new Map((graph?.entities || []).map((e) => [e.id, e.name]));
  const typeMap = new Map((graph?.entities || []).map((e) => [e.id, e.type]));

  const entityCols = [
    { title: '实体', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', width: 100, render: (t: string) => <Tag color={entityColor[t] || 'default'}>{t}</Tag> },
  ];
  const relCols = [
    { title: '头实体', dataIndex: 'head_id', render: (id: string) => eMap.get(id) || id },
    { title: '关系', dataIndex: 'relation', width: 100, render: (r: string) => <Tag color="geekblue">{r}</Tag> },
    { title: '尾实体', dataIndex: 'tail_id', render: (id: string) => <span>{eMap.get(id) || id}<span style={{ color: '#999', fontSize: 12 }}>（{typeMap.get(id) || ''}）</span></span> },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        校务知识图谱 <span style={{ fontWeight: 400, fontSize: 14, color: '#888' }}>LLM 自动抽取实体-关系</span>
      </Title>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<BranchesOutlined />} loading={building} onClick={build}>构建/更新图谱</Button>
        <span style={{ color: '#888' }}>实体 {graph?.entity_count ?? 0} · 关系 {graph?.relation_count ?? 0}</span>
      </Space>

      <Card title="图谱问答（多跳关系推理）" style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="如：研究生奖助学金办法由谁发布、适用于谁？"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={ask}
          />
          <Button type="primary" icon={<SendOutlined />} loading={askLoading} onClick={ask}>提问</Button>
        </Space.Compact>
        {asked && (
          <div style={{ marginTop: 12 }}>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{asked.answer}</div>
            {asked.related?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Tag color="blue">涉及实体</Tag>{asked.related.join('、')}
              </div>
            )}
          </div>
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="实体">
            <Table rowKey="id" loading={loading} columns={entityCols} dataSource={graph?.entities || []} pagination={{ pageSize: 8 }} size="small" />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="关系">
            <Table rowKey="id" loading={loading} columns={relCols} dataSource={graph?.relations || []} pagination={{ pageSize: 8 }} size="small" />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
