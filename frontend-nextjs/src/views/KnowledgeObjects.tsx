'use client';

import { useState, useEffect } from 'react';
import { Button, Descriptions, Drawer, Input, Modal, Space, Table, Tag, Typography, message } from 'antd';
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
  UPDATED: '已更新',
  DISCOVERED: '已发现',
  PARSED: '已解析',
};

const statusColor: Record<string, string> = {
  PUBLISHED: 'green',
  EXPIRED: 'default',
  REVIEW_REQUIRED: 'gold',
  ARCHIVED: 'gray',
  UPDATED: 'blue',
  DISCOVERED: 'cyan',
  PARSED: 'geekblue',
};

export default function KnowledgeObjects() {
  const [objects, setObjects] = useState<KnowledgeObject[]>([]);
  const [selected, setSelected] = useState<KnowledgeObject | null>(null);
  const [editing, setEditing] = useState<KnowledgeObject | null>(null);
  const [form, setForm] = useState({
    title: '', department: '', effective_from: '', effective_to: '', summary: '',
  });
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.listKnowledgeObjects().then((d) => setObjects(d.objects || [])).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const doPublish = async (id: string) => {
    await api.publishKo(id);
    message.success('已发布');
    await load();
  };

  const doArchive = async (id: string) => {
    await api.archiveKo(id);
    message.success('已归档');
    await load();
  };

  const openEdit = (ko: KnowledgeObject) => {
    setEditing(ko);
    setForm({
      title: ko.title || '',
      department: ko.department || '',
      effective_from: ko.effective_from || '',
      effective_to: ko.effective_to || '',
      summary: ko.summary || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    await api.editKo(editing.id, {
      title: form.title, department: form.department,
      effective_from: form.effective_from, effective_to: form.effective_to, summary: form.summary,
    });
    message.success('已保存（待审核）');
    setEditing(null);
    await load();
  };

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
    { title: '有效期', width: 200, render: (_: unknown, r: KnowledgeObject) => `${r.effective_from || '-'} ~ ${r.effective_to || '-'}` },
    {
      title: '操作',
      width: 210,
      render: (_: unknown, r: KnowledgeObject) => {
        const canPublish = !['PUBLISHED', 'ARCHIVED', 'EXPIRED'].includes(r.status);
        const canArchive = r.status !== 'ARCHIVED';
        return (
          <Space size={4} onClick={(e) => e.stopPropagation()}>
            <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
            {canPublish && <Button type="link" size="small" onClick={() => doPublish(r.id)}>发布</Button>}
            {canArchive && <Button type="link" size="small" danger onClick={() => doArchive(r.id)}>归档</Button>}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>知识对象</Title>
      <Table
        rowKey="id"
        loading={loading}
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
                <a href={selected.source_url} target="_blank" rel="noreferrer">查看官网原文 ↗</a>
              </div>
            )}
          </>
        )}
      </Drawer>

      <Modal
        title="编辑知识对象"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={saveEdit}
        okText="保存"
        cancelText="取消"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div><label>标题</label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div><label>部门</label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}><label>生效日期</label><Input value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} placeholder="YYYY-MM-DD" /></div>
            <div style={{ flex: 1 }}><label>截止日期</label><Input value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} placeholder="YYYY-MM-DD" /></div>
          </div>
          <div><label>摘要</label><Input.TextArea rows={4} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
        </Space>
      </Modal>
    </div>
  );
}
