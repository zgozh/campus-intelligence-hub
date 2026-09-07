'use client';

import { useState, useEffect } from 'react';
import { Button, Card, Col, Drawer, Input, Row, Select, Space, Steps, Table, Tag, Typography, message } from 'antd';
import { BranchesOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { KGAskResult, KnowledgeGraph } from '../services/api';
import GraphForce from '../components/GraphForce';

const { Title, Text } = Typography;

interface BuildInfo { ko_count: number; relations_added: number; skipped: number; elapsed: string; }
type Entity = KnowledgeGraph['entities'][number];

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
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [buildStage, setBuildStage] = useState(-1);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [selEntity, setSelEntity] = useState<Entity | null>(null);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);

  const load = () => {
    setLoading(true);
    api.listKnowledgeGraph().then(setGraph).catch(console.error).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const build = async () => {
    setBuilding(true);
    setBuildInfo(null);
    setBuildError(null);
    setBuildStage(0);
    const t0 = Date.now();
    const timer = setInterval(() => setBuildStage((s) => Math.min(2, s + 1)), 700);
    try {
      const r = await api.buildKnowledgeGraph(20);
      setBuildInfo({ ...r, elapsed: ((Date.now() - t0) / 1000).toFixed(1) });
      setBuildStage(3);
      message.success(`图谱构建完成：新增 ${r.relations_added} 条关系`);
      await load();
    } catch (e) {
      setBuildError((e as Error)?.message || '构建失败');
      setBuildStage(3);
      message.error(`图谱构建失败：${(e as Error)?.message || '请配置模型 API Key 后重试'}`);
    } finally {
      clearInterval(timer);
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

  const allTypes = Array.from(new Set((graph?.entities || []).map((e) => e.type)));
  const displayEntities = filterTypes.length ? (graph?.entities || []).filter((e) => filterTypes.includes(e.type)) : (graph?.entities || []);
  const displayIds = new Set(displayEntities.map((e) => e.id));
  const displayRelations = (graph?.relations || []).filter((r) => displayIds.has(r.head_id) && displayIds.has(r.tail_id));
  const selRels = selEntity ? (graph?.relations || []).filter((r) => r.head_id === selEntity.id || r.tail_id === selEntity.id) : [];
  const typeCounts = allTypes.map((t) => ({ type: t, count: (graph?.entities || []).filter((e) => e.type === t).length }));

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

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={16}>
          <Space>
            <Button type="primary" icon={<BranchesOutlined />} loading={building} onClick={build}>构建/更新图谱</Button>
            <span style={{ color: '#888' }}>实体 {graph?.entity_count ?? 0} · 关系 {graph?.relation_count ?? 0}</span>
          </Space>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" title="构建流程">
            {building ? (
              <Steps size="small" current={buildStage} items={[
                { title: '抽取实体' }, { title: '写入图谱' }, { title: '更新视图' }, { title: '完成' },
              ]} />
            ) : buildInfo ? (
              <>
                <Steps size="small" current={3} status="finish" items={[{ title: '抽取' }, { title: '写入' }, { title: '视图' }, { title: '完成' }]} />
                <div style={{ marginTop: 12, color: '#666' }}>
                  知识对象 {buildInfo.ko_count} · 新增关系 {buildInfo.relations_added} · 跳过 {buildInfo.skipped} · 耗时 {buildInfo.elapsed}s
                </div>
              </>
            ) : buildError ? (
              <Steps size="small" current={3} status="error" items={[{ title: '抽取' }, { title: '写入' }, { title: '视图' }, { title: '失败' }]} />
            ) : (
              <span style={{ color: '#999', fontSize: 12 }}>点击「构建/更新图谱」自动化抽取实体与关系，流程将在此展示。</span>
            )}
            {buildError && <div style={{ marginTop: 8, color: '#ff4d4f', fontSize: 12 }}>{buildError}</div>}
          </Card>
        </Col>
      </Row>

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
            {(asked.intent || asked.department) && (
              <div style={{ marginTop: 8 }}>
                {asked.intent && <Tag color="geekblue">意图：{asked.intent}</Tag>}
                {asked.department && <Tag color="purple">部门：{asked.department}</Tag>}
              </div>
            )}
            {asked.related?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Tag color="blue">涉及实体</Tag>{asked.related.join('、')}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title="图谱可视化（力导向）"
        style={{ marginBottom: 16 }}
        extra={
          <Select
            mode="multiple"
            allowClear
            placeholder="按类型筛选"
            value={filterTypes}
            onChange={setFilterTypes}
            options={allTypes.map((t) => ({ value: t, label: `${t}（${typeCounts.find((c) => c.type === t)?.count ?? 0}）` }))}
            style={{ minWidth: 220 }}
          />
        }
      >
        <GraphForce entities={displayEntities} relations={displayRelations} onNodeClick={setSelEntity} />
      </Card>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        💡 图谱问答用于回答「关系型 / 多跳」问题（如：某办法由谁发布、适用于谁、何时截止）。点击图中任意节点可查看其关联关系，右上角可按类型筛选。
      </Text>

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

      <Drawer title={selEntity?.name} open={!!selEntity} onClose={() => setSelEntity(null)} width={420}>
        {selEntity && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Tag color={entityColor[selEntity.type] || 'default'}>{selEntity.type}</Tag>
              <span style={{ fontWeight: 600 }}>{selEntity.name}</span>
            </div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>关联关系（{selRels.length}）</div>
            {selRels.length === 0 ? (
              <Text type="secondary">暂无关联关系</Text>
            ) : (
              <Space direction="vertical" style={{ width: '100%' }} size={6}>
                {selRels.map((r) => {
                  const isHead = r.head_id === selEntity.id;
                  const other = isHead ? r.tail_id : r.head_id;
                  const dir = isHead ? '→' : '←';
                  return (
                    <div key={r.id} style={{ fontSize: 13 }}>
                      <Tag color="geekblue">{r.relation}</Tag>
                      {eMap.get(selEntity.id)} <b>{dir}</b> {eMap.get(other) || other}
                    </div>
                  );
                })}
              </Space>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
