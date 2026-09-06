'use client';

import { useState, useEffect } from 'react';
import { Descriptions, Drawer, Table, Tag, Typography } from 'antd';
import { api } from '../services/api';
import type { KnowledgeObject } from '../services/api';

const { Title } = Typography;

const statusColor: Record<string, string> = {
  PUBLISHED: 'green',
  EXPIRED: 'default',
  REVIEW_REQUIRED: 'gold',
  ARCHIVED: 'gray',
};

export default function KnowledgeObjects() {
  const [objects, setObjects] = useState<KnowledgeObject[]>([]);
  const [selected, setSelected] = useState<KnowledgeObject | null>(null);

  useEffect(() => {
    api.listKnowledgeObjects().then((d) => setObjects(d.objects || [])).catch(console.error);
  }, []);

  const columns = [
    { title: '类型', dataIndex: 'type', width: 120 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 130, render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag> },
    { title: '版本', dataIndex: 'version', width: 70 },
    { title: '置信度', dataIndex: 'confidence', width: 90 },
    { title: '有效期', width: 220, render: (_: unknown, r: KnowledgeObject) => `${r.effective_from || '-'} ~ ${r.effective_to || '-'}` },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>知识对象</Title>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={objects}
        pagination={{ pageSize: 10 }}
        onRow={(r) => ({ onClick: () => setSelected(r), style: { cursor: 'pointer' } })}
      />

      <Drawer title={selected?.title} open={!!selected} onClose={() => setSelected(null)} width={720}>
        {selected && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="类型">{selected.type}</Descriptions.Item>
              <Descriptions.Item label="状态">{selected.status}</Descriptions.Item>
              <Descriptions.Item label="版本">{selected.version}</Descriptions.Item>
              <Descriptions.Item label="部门">{selected.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="有效期">{selected.effective_from} ~ {selected.effective_to}</Descriptions.Item>
              <Descriptions.Item label="标签">{(selected.tags || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="关键信息">
                {(selected.facts || []).map((f, i) => (
                  <div key={i}>· {f.field}：{f.value}</div>
                ))}
              </Descriptions.Item>
              <Descriptions.Item label="摘要">{selected.summary}</Descriptions.Item>
            </Descriptions>
            {selected.source_url && (
              <div style={{ marginTop: 16 }}>
                <a href={selected.source_url} target="_blank" rel="noreferrer">
                  查看官网原文 ↗
                </a>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
