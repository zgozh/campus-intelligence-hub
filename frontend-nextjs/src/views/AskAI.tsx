'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Collapse, Empty, Input, Spin, Tag } from 'antd';
import { ClearOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { AskResponse } from '../services/api';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: AskResponse['citations'];
  intent?: string;
  department?: string | null;
  graph_hints?: string[];
}

const STORAGE_KEY = 'campus_chat_history';

export default function AskAI() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载历史
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setMessages(JSON.parse(saved));
    } catch (e) {
      /* ignore */
    }
  }, []);

  // 持久化历史
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {
      /* ignore */
    }
  }, [messages]);

  // 自动滚到底部
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages, loading]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');
    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', content: q }]);
    setLoading(true);
    try {
      const r = await api.askQuestion(q);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-a`,
          role: 'assistant',
          content: r.answer,
          citations: r.citations,
          intent: r.intent,
          department: r.department,
          graph_hints: r.graph_hints,
        },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-a`, role: 'assistant', content: '问答失败，请重试' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>校务 AI 问答</h2>
        <Button size="small" icon={<ClearOutlined />} onClick={clearHistory}>
          清空历史
        </Button>
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
        {messages.length === 0 ? (
          <Empty description="开始提问吧，例如：新生报到需要携带什么材料？" style={{ marginTop: 80 }} />
        ) : (
          messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <div
                  style={{
                    maxWidth: '70%',
                    background: '#1677ff',
                    color: '#fff',
                    padding: '10px 14px',
                    borderRadius: 12,
                    borderTopRightRadius: 2,
                  }}
                >
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <div style={{ maxWidth: '88%', width: '88%' }}>
                  <div
                    style={{
                      background: '#fff',
                      border: '1px solid #f0f0f0',
                      padding: '12px 16px',
                      borderRadius: 12,
                      borderTopLeftRadius: 2,
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.7,
                    }}
                  >
                    {m.content}
                  </div>
                  {(m.intent || m.department) && (
                    <div style={{ marginTop: 6 }}>
                      {m.intent && <Tag color="geekblue">意图：{m.intent}</Tag>}
                      {m.department && <Tag color="purple">部门：{m.department}</Tag>}
                    </div>
                  )}
                  {m.graph_hints && m.graph_hints.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <Tag color="cyan">图谱线索</Tag>
                      {m.graph_hints.map((h, i) => (
                        <span key={i} style={{ fontSize: 12, color: '#666', marginRight: 8 }}>{h}</span>
                      ))}
                    </div>
                  )}
                  {m.citations && m.citations.length > 0 && (
                    <Collapse
                      size="small"
                      style={{ marginTop: 8 }}
                      items={[
                        {
                          key: 'citations',
                          label: `来源引用（${m.citations.length}）`,
                          children: m.citations.map((c, i) => (
                            <div key={i} style={{ marginBottom: 8, padding: 10, background: '#fafafa', borderRadius: 6 }}>
                              <div style={{ fontWeight: 600 }}>[{i + 1}] {c.title}</div>
                              <div style={{ color: '#999', fontSize: 12, margin: '6px 0' }}>
                                <Tag>{c.type}</Tag>
                                <Tag color={c.freshness === 'Fresh' ? 'green' : c.freshness === 'Aging' ? 'orange' : c.freshness === 'Stale' ? 'red' : 'default'}>
                                  {c.freshness || '时效未知'}
                                </Tag>
                                {c.department || '未知部门'} · 有效期 {c.effective_from || '?'} ~ {c.effective_to || '长期'}
                                {c.confidence != null && <> · 置信度 {(c.confidence * 100).toFixed(0)}%</>}
                                {c.authority != null && <> · 权威度 {(c.authority * 100).toFixed(0)}</>}
                                {c.version != null && <> · v{c.version}</>}
                              </div>
                              {c.summary && (
                                <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6, marginBottom: 6 }}>{c.summary}</div>
                              )}
                              {c.url && (
                                <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                                  查看官网原文 ↗
                                </a>
                              )}
                            </div>
                          )),
                        },
                      ]}
                    />
                  )}
                </div>
              </div>
            ),
          )
        )}
        {loading && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <Spin size="small" /> 思考中...
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          size="large"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={send}
          placeholder="输入问题，回车发送"
        />
        <Button type="primary" size="large" icon={<SendOutlined />} loading={loading} onClick={send}>
          发送
        </Button>
      </div>
    </div>
  );
}
