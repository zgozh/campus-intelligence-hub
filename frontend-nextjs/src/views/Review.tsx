'use client';

import { useState, useEffect, useCallback } from 'react';
import { Alert, Button, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { AIReviewSuggest, ReviewTaskItem } from '../services/api';
import DashboardMarkdown from '../components/DashboardMarkdown';

const { Title, Paragraph } = Typography;

export default function Review() {
  const [tasks, setTasks] = useState<ReviewTaskItem[]>([]);
  const [suggest, setSuggest] = useState<AIReviewSuggest | null>(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<ReviewTaskItem | null>(null);

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

  const aiSuggest = async (row: ReviewTaskItem) => {
    setActiveTask(row);
    setSuggest(null);
    setSuggestLoading(true);
    try {
      setSuggest(await api.aiSuggestReviewTask(row.id));
    } catch (e) {
      message.error(`AI 审核失败：${(e as Error)?.message || '请配置模型 API Key'}`);
    } finally {
      setSuggestLoading(false);
    }
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
      width: 250,
      render: (_: unknown, r: ReviewTaskItem) => (
        <Space>
          <Button size="small" icon={<RobotOutlined />} loading={suggestLoading && activeTask?.id === r.id} onClick={() => aiSuggest(r)}>
            AI 建议
          </Button>
          <Button size="small" type="primary" onClick={() => approve(r.id)}>批准</Button>
          <Button size="small" danger onClick={() => reject(r.id)}>拒绝</Button>
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

      <Modal
        open={!!activeTask}
        title="AI 审核建议"
        loading={suggestLoading}
        onCancel={() => setActiveTask(null)}
        footer={[
          <Button key="close" onClick={() => setActiveTask(null)}>关闭</Button>,
          ...(activeTask && suggest ? [
            <Button
              key="ok"
              type="primary"
              loading={suggestLoading}
              onClick={async () => {
                await approve(activeTask.id);
                setActiveTask(null);
              }}
            >
              按 AI 建议批准
            </Button>,
          ] : []),
        ]}
      >
        {suggestLoading ? (
          <p>正在调用模型生成审核意见…</p>
        ) : suggest ? (
          <div>
            <div style={{ marginBottom: 8 }}><b>要点：</b></div>
            <DashboardMarkdown content={suggest.summary || '（无摘要）'} />
            <Paragraph>
              <b>推荐动作：</b>
              <Tag color={suggest.recommendation === 'approve' ? 'green' : suggest.recommendation === 'reject' ? 'red' : 'orange'}>
                {suggest.recommendation === 'approve' ? '批准' : suggest.recommendation === 'reject' ? '拒绝' : '合并'}
              </Tag>
              <span style={{ color: '#888', marginLeft: 8 }}>置信度 {suggest.confidence ?? '-'}</span>
            </Paragraph>
            {(suggest.risks || []).length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="风险提示"
                description={suggest.risks.join('；')}
              />
            )}
            {suggest.reason && (
              <div style={{ marginTop: 12 }}>
                <b>理由：</b>
                <DashboardMarkdown content={suggest.reason} />
              </div>
            )}
            {suggest.error && <Alert type="error" message={suggest.error} />}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
