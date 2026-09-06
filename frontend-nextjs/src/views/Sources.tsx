'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { CampusSource } from '../services/api';

const { Title } = Typography;

const statusColor: Record<string, string> = {
  active: 'green',
  paused: 'orange',
  error: 'red',
};

const PAGE_OPTIONS = [
  { value: 1, label: '1 页（仅最新）' },
  { value: 3, label: '3 页' },
  { value: 5, label: '5 页' },
  { value: 10, label: '10 页' },
  { value: 0, label: '全部（最多 50 页）' },
];

const COLUMN_OPTIONS = [
  { value: '', label: '全部内容' },
  { value: '通知公告', label: '通知公告' },
  { value: '新闻动态', label: '新闻动态' },
  { value: '办事指南', label: '办事指南' },
  { value: '规章制度', label: '规章制度' },
];

export default function Sources() {
  const [sources, setSources] = useState<CampusSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  // 采集弹窗状态
  const [runOpen, setRunOpen] = useState(false);
  const [runSource, setRunSource] = useState<CampusSource | null>(null);
  const [runMaxPages, setRunMaxPages] = useState(1);
  const [runColumn, setRunColumn] = useState('');
  const [runLoading, setRunLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listSources();
      setSources(d.sources || []);
    } catch (e) {
      message.error('加载数据源失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async () => {
    const values = await form.validateFields();
    try {
      await api.createSource(values);
      message.success('创建成功');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (e) {
      message.error('创建失败');
    }
  };

  const openRun = (record: CampusSource) => {
    setRunSource(record);
    setRunMaxPages(1);
    setRunColumn('');
    setRunOpen(true);
  };

  const confirmRun = async () => {
    if (!runSource) return;
    setRunLoading(true);
    try {
      const r = await api.runSource(runSource.id, runMaxPages, runColumn || undefined);
      message.success(`已开始采集，任务 ${r.job_id}`);
      setRunOpen(false);
    } catch (e) {
      message.error('触发采集失败');
    } finally {
      setRunLoading(false);
    }
  };

  const onPause = async (id: string) => {
    await api.pauseSource(id);
    await load();
  };
  const onDelete = async (id: string) => {
    await api.deleteSource(id);
    message.success('已删除');
    await load();
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'source_type', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusColor[s] || 'default'}>{s}</Tag>,
    },
    {
      title: '上次采集',
      dataIndex: 'last_crawled_at',
      width: 170,
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : '-'),
    },
    {
      title: '操作',
      width: 200,
      render: (_: unknown, record: CampusSource) => (
        <Space>
          <Button size="small" type="primary" onClick={() => openRun(record)}>
            采集
          </Button>
          <Button size="small" onClick={() => onPause(record.id)}>
            暂停
          </Button>
          <Popconfirm title="确认删除该数据源？" onConfirm={() => onDelete(record.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>数据源管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          新增数据源
        </Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={sources} loading={loading} pagination={false} />

      {/* 新增数据源 */}
      <Modal title="新增数据源" open={open} onOk={onCreate} onCancel={() => setOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ source_type: 'website' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 广州大学通知公告" />
          </Form.Item>
          <Form.Item name="source_type" label="类型">
            <Select
              options={[
                { value: 'website', label: '官网/网站' },
                { value: 'list_page', label: '通知公告列表页' },
                { value: 'file', label: '上传文件' },
                { value: 'manual', label: '手动录入' },
                { value: 'api', label: 'API' },
              ]}
            />
          </Form.Item>
          <Form.Item name="base_url" label="URL（网站/列表页填）">
            <Input placeholder="https://www.gzhu.edu.cn/z__l/tzgg.htm" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 采集弹窗 */}
      <Modal
        title={`采集「${runSource?.name || ''}」`}
        open={runOpen}
        onOk={confirmRun}
        okText="确认采集"
        confirmLoading={runLoading}
        onCancel={() => setRunOpen(false)}
        destroyOnClose
      >
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>采集页数档位</div>
          <Radio.Group
            options={PAGE_OPTIONS}
            value={runMaxPages}
            onChange={(e) => setRunMaxPages(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          />
        </div>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>采集内容筛选</div>
          <Select
            style={{ width: '100%' }}
            value={runColumn}
            onChange={setRunColumn}
            options={COLUMN_OPTIONS}
          />
        </div>
      </Modal>
    </div>
  );
}
