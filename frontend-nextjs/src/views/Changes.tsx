'use client';

import { useState, useEffect } from 'react';
import { Table, Tag, Typography, Space, Drawer, Button, Alert } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { ChangeEvent, ChangeDetail } from '../services/api';
import DiffViewer from '../components/DiffViewer';
import { formatDateTime, stripInlineMd } from '../utils/format';

const { Title } = Typography;

const SEVERITY_COLOR: Record<string, string> = { HIGH: 'red', MEDIUM: 'orange', LOW: 'blue' };

const TYPE_ZH: Record<string, string> = {
  TITLE_CHANGED: '标题变更',
  CONTENT_CHANGED: '内容变更',
  DATE_CHANGED: '日期变更',
};

function severityZh(v: string): string {
  return v === 'HIGH' ? '高优先级' : v === 'MEDIUM' ? '中优先级' : '低优先级';
}

// 表格单元不适合渲染 markdown，统一走展示层清洗（stripInlineMd）
export default function Changes() {
  const [items, setItems] = useState<ChangeEvent[]>([]);
  const [detail, setDetail] = useState<ChangeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listChanges()
      .then((d) => setItems(d.changes || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openDiff = async (id: string) => {
    setOpen(true);
    setDetail(null);
    try {
      const d = await api.getChangeDiff(id);
      setDetail(d);
    } catch (e) {
      console.error(e);
      setDetail(null);
    }
  };

  const columns = [
    {
      title: '级别',
      dataIndex: 'severity',
      width: 110,
      render: (v: string) => <Tag color={SEVERITY_COLOR[v] || 'default'}>{severityZh(v)}</Tag>,
    },
    { title: '来源', dataIndex: 'source_name', width: 160 },
    {
      title: '类型',
      dataIndex: 'change_type',
      width: 220,
      render: (types: string[]) => (
        <Space size={[4, 4]} wrap>
          {(types || []).map((t) => (
            <Tag key={t} color="geekblue">{TYPE_ZH[t] || t}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '版本',
      width: 110,
      render: (_: unknown, r: ChangeEvent) =>
        r.old_version != null ? `v${r.old_version} → v${r.new_version}` : '-',
    },
    { title: '变更摘要', dataIndex: 'diff_summary', ellipsis: true, render: (v: string | null) => stripInlineMd(v) },
    { title: '时间', dataIndex: 'detected_at', width: 180, render: (v: string | null) => formatDateTime(v) },
    {
      title: '操作',
      width: 110,
      render: (_: unknown, r: ChangeEvent) => (
        <Button type="link" size="small" onClick={() => openDiff(r.id)}>
          查看 Diff
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        变更雷达{' '}
        <span style={{ fontWeight: 400, fontSize: 14, color: '#888' }}>What changed?</span>
      </Title>
      <Alert
        style={{ marginBottom: 16 }}
        type="info"
        showIcon
        message="系统自动检测校园知识变化：标题 / 内容 / 日期变更会在此汇总，高优先级变化需人工审核后发布。"
      />
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        size="middle"
      />

      <Drawer
        title="变更详情 · Diff"
        open={open}
        onClose={() => setOpen(false)}
        width={760}
        destroyOnClose
      >
        <DiffViewer detail={detail} />
      </Drawer>
    </div>
  );
}
