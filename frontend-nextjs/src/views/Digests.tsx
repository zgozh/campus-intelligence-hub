'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button, Card, List, Space, Typography, message } from 'antd';
import { api } from '../services/api';
import type { DigestItem } from '../services/api';
import DashboardMarkdown from '../components/DashboardMarkdown';

const { Title } = Typography;

export default function Digests() {
  const [digests, setDigests] = useState<DigestItem[]>([]);
  const [current, setCurrent] = useState<DigestItem | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.listDigests();
      setDigests(d.digests || []);
      setCurrent((prev) => prev || (d.digests && d.digests[0]) || null);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const generate = async (period: string) => {
    setLoading(true);
    try {
      const d = await api.generateDigest(period);
      setCurrent(d);
      await load();
      message.success('生成成功');
    } catch (e) {
      message.error('生成失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>自动日报 / 周报</Title>

      <Space style={{ marginBottom: 20 }}>
        <Button type="primary" loading={loading} onClick={() => generate('daily')}>
          生成日报
        </Button>
        <Button loading={loading} onClick={() => generate('weekly')}>
          生成周报
        </Button>
      </Space>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 260, flexShrink: 0 }}>
          <List
            dataSource={digests}
            renderItem={(d) => (
              <List.Item
                onClick={() => setCurrent(d)}
                style={{
                  cursor: 'pointer',
                  background: current?.id === d.id ? '#e6f4ff' : undefined,
                  borderRadius: 8,
                  padding: '8px 12px',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{new Date(d.created_at).toLocaleString()}</div>
                </div>
              </List.Item>
            )}
          />
        </div>

        <Card style={{ flex: 1, minWidth: 320 }}>
          {current ? (
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <DashboardMarkdown content={current.content} />
            </div>
          ) : (
            <p style={{ color: '#999' }}>暂无日报，点击上方按钮生成</p>
          )}
        </Card>
      </div>
    </div>
  );
}
