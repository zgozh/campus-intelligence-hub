'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Space, Table, Tag, Typography, message } from 'antd';
import { api } from '../services/api';
import type { ReviewTaskItem } from '../services/api';

const { Title } = Typography;

export default function Review() {
  const [tasks, setTasks] = useState<ReviewTaskItem[]>([]);

  const load = useCallback(async () => {
    try {
      const d = await api.listReviewTasks();
      setTasks(d.tasks || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (id: string) => {
    await api.approveReviewTask(id);
    message.success('已批准');
    await load();
  };
  const reject = async (id: string) => {
    await api.rejectReviewTask(id);
    message.success('已拒绝');
    await load();
  };

  const columns = [
    { title: '类型', dataIndex: 'ko_type', width: 120 },
    {
      title: '原因',
      dataIndex: 'reason',
      width: 120,
      render: (r: string) => (
        <Tag color={r === 'low_confidence' ? 'gold' : 'red'}>{r === 'low_confidence' ? '低置信度' : '冲突'}</Tag>
      ),
    },
    { title: '标题', dataIndex: 'ko_title', ellipsis: true },
    {
      title: '操作',
      width: 170,
      render: (_: unknown, r: ReviewTaskItem) => (
        <Space>
          <Button size="small" type="primary" onClick={() => approve(r.id)}>
            批准
          </Button>
          <Button size="small" danger onClick={() => reject(r.id)}>
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>审核队列</Title>
      {tasks.length === 0 ? (
        <p style={{ color: '#999' }}>暂无待审核任务</p>
      ) : (
        <Table rowKey="id" columns={columns} dataSource={tasks} pagination={false} />
      )}
    </div>
  );
}
