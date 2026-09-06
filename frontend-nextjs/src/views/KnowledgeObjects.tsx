'use client';

import { useState, useEffect } from 'react';
import { Descriptions, Drawer, Table, Tag, Typography } from 'antd';
import { api } from '../services/api';
import type { KnowledgeObject } from '../services/api';

const { Title } = Typography;

const typeZh: Record<string, string> = {
  Announcement: '通知公告',
  Procedure: '办事指南',
  Regulation: '规章制度',
  Event: '新闻动态',
  Policy: '政策',
  Course: '课程',
  Department: '部门',
  Contact: '联系方式',
  FAQ: '常见问题',
  Research: '科研',
};

const statusZh: Record<string, string> = {
  PUBLISHED: '已发布',
  EXPIRED: '已过期',
  REVIEW_REQUIRED: '待审核',
  ARCHIVED: '已归档',
};

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
    { title: '类型', dataIndex: 'type', width: 110, render: (t: string) => typeZh[t] || t },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={statusColor[s] || 'default'}>{statusZh[s] || s}</Tag>,
    },
    { title: '版本', dataIndex: 'version', width: 70 },
    { title: '置信度', dataIndex: 'confidence', width: 90 },
    { title: '有效期', width: 210, render: (_: unknown, r: KnowledgeObject) => `${r.effective_from || '-'} ~ ${r.effective_to || '-'}` },
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
              <Descriptions.Item label="类型">{typeZh[selected.type] || selected.type}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusZh[selected.status] || selected.status}</Descriptions.Item>
              <Descriptions.Item label="版本">{selected.version}</Descriptions.Item>
              <Descriptions.Item label="部门">{selected.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="有效期">{selected.effective_from} ~ {selected.effective_to}</Descriptions.Item>
              <Descriptions.Item label="标签">{(selected.tags || []).join('、') || '-'}</Descriptions.Item>
              <Descriptions.Item label="关键信息">
                {(selected.facts || []).map((f, i) => (
                  <div key={i}>· {f.field}：{f.value}</div>
                ))}
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>正文</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 14 }}>
                {selected.content || selected.summary || '暂无正文'}
              </div>
            </div>

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
