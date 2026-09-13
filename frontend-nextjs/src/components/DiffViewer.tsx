'use client';

import { Card, Tag, Typography, Space, Divider, Skeleton } from 'antd';
import type { ChangeDetail } from '../services/api';
import { formatDateTime, stripInlineMd } from '../utils/format';

const { Text } = Typography;

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: 'red',
  MEDIUM: 'orange',
  LOW: 'blue',
};

const TYPE_ZH: Record<string, string> = {
  TITLE_CHANGED: '标题变更',
  CONTENT_CHANGED: '内容变更',
  DATE_CHANGED: '日期变更',
};

function severityZh(v: string): string {
  return v === 'HIGH' ? '高优先级' : v === 'MEDIUM' ? '中优先级' : '低优先级';
}

export default function DiffViewer({ detail }: { detail: ChangeDetail | null }) {
  if (!detail) {
    return <Skeleton active paragraph={{ rows: 8 }} />;
  }

  return (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <Space size="small" wrap style={{ marginBottom: 16 }}>
        <Tag color={SEVERITY_COLOR[detail.severity] || 'default'}>{severityZh(detail.severity)}</Tag>
        {(detail.change_type || []).map((t) => (
          <Tag key={t} color="geekblue">{TYPE_ZH[t] || t}</Tag>
        ))}
        <Text type="secondary">来源：{detail.source_name}</Text>
        {detail.old_version != null && (
          <Text type="secondary">v{detail.old_version} → v{detail.new_version}</Text>
        )}
        <Text type="secondary">{formatDateTime(detail.detected_at)}</Text>
      </Space>

      {detail.diff_summary && (
        <Text strong style={{ display: 'block', marginBottom: 16 }}>{stripInlineMd(detail.diff_summary)}</Text>
      )}

      {(detail.title_before || detail.title_after) && (
        <div style={{ marginBottom: 16, wordBreak: 'break-word' }}>
          <Text type="secondary">标题：</Text>
          {detail.title_before && (
            <Text delete style={{ color: '#cf1322', marginRight: 8 }}>{stripInlineMd(detail.title_before)}</Text>
          )}
          {detail.title_after && (
            <Text style={{ color: '#237804' }}>{stripInlineMd(detail.title_after)}</Text>
          )}
        </div>
      )}

      <Divider style={{ margin: '8px 0 12px' }}>内容对照</Divider>

      <div style={{ maxHeight: 460, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 8 }}>
        {detail.changes && detail.changes.length > 0 ? (
          detail.changes.map((seg, idx) => (
            <div key={idx}>
              {seg.lines.map((line, li) => (
                <div
                  key={li}
                  style={{
                    padding: '1px 12px',
                    lineHeight: '22px',
                    fontFamily: 'SFMono-Regular, Consolas, monospace',
                    fontSize: 13,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    backgroundColor:
                      seg.type === 'removed' ? '#fff1f0' : seg.type === 'added' ? '#f6ffed' : undefined,
                    color: seg.type === 'removed' ? '#cf1322' : seg.type === 'added' ? '#237804' : 'rgba(0,0,0,0.75)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 24,
                      textAlign: 'right',
                      marginRight: 12,
                      color: '#bbb',
                      userSelect: 'none',
                    }}
                  >
                    {seg.type === 'removed' ? '−' : seg.type === 'added' ? '+' : ' '}
                  </span>
                  {line || ' '}
                </div>
              ))}
            </div>
          ))
        ) : (
          <div style={{ padding: 24, color: '#999', textAlign: 'center' }}>无内容变化</div>
        )}
      </div>
    </Card>
  );
}
