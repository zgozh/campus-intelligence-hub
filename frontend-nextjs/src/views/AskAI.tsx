'use client';

import { useState } from 'react';
import { Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { AskResponse } from '../services/api';

const { Title, Paragraph } = Typography;

export default function AskAI() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const r = await api.askQuestion(query.trim());
      setResult(r);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>校务 AI 问答</Title>

      <Space.Compact style={{ width: '100%', marginBottom: 20 }}>
        <Input
          size="large"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onPressEnter={ask}
          placeholder="例如：新生报到需要携带什么材料？"
        />
        <Button size="large" type="primary" icon={<SendOutlined />} loading={loading} onClick={ask}>
          提问
        </Button>
      </Space.Compact>

      {result && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0, fontSize: 15, lineHeight: 1.8 }}>
              {result.answer}
            </Paragraph>
          </Card>

          {result.citations.length > 0 && (
            <>
              <Title level={5}>来源引用（{result.citations.length}）</Title>
              <List
                dataSource={result.citations}
                renderItem={(c, i) => (
                  <List.Item>
                    <div>
                      <div style={{ fontWeight: 600 }}>[{i + 1}] {c.title}</div>
                      <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                        <Tag>{c.type}</Tag>
                        {c.department || '未知部门'} · 有效期至 {c.effective_to || '-'}
                      </div>
                    </div>
                  </List.Item>
                )}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
