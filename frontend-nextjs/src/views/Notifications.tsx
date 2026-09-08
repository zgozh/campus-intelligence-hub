"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Card, Empty, List, Space, Tag, Typography, message } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { api } from "../services/api";
import type { NotificationItem } from "../services/api";
import DashboardMarkdown from "../components/DashboardMarkdown";

const { Title, Text } = Typography;
const KIND_ZH: Record<string, string> = { brief: "校务快讯", insight: "校务洞察", alert: "告警", expiring: "临期提醒", system: "系统" };

export default function Notifications() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listNotifications(50, unreadOnly);
      setItems(d.notifications || []);
    } catch (e) {
      message.error("通知加载失败");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => { load(); }, [load]);

  const runAlerts = async () => {
    setAlertLoading(true);
    try {
      const r = await api.checkAlerts();
      message.success(`巡检完成：发现 ${r.alerts.length} 项告警`);
      await load();
    } catch (e) {
      message.error("告警巡检失败");
    } finally {
      setAlertLoading(false);
    }
  };

  const done = async (id: string) => {
    await api.markNotificationRead(id);
    await load();
  };
  const readAll = async () => {
    for (const n of items.filter((x) => !x.read)) await api.markNotificationRead(n.id);
    message.success("已全部标记已读");
    await load();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>通知中心 <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>主动推送 · 快讯/洞察/临期</span></Title>
        <Space>
          <Button size="small" icon={<BellOutlined />} loading={alertLoading} onClick={runAlerts}>巡检告警</Button>
          <Button size="small" type={unreadOnly ? "primary" : "default"} onClick={() => setUnreadOnly((v) => !v)}>只看未读</Button>
          <Button size="small" icon={<CheckOutlined />} onClick={readAll}>全部已读</Button>
        </Space>
      </div>

      <Card loading={loading}>
        {items.length === 0 ? (
          <Empty description="暂无通知" />
        ) : (
          <List
            dataSource={items}
            renderItem={(n) => (
              <List.Item
                actions={
                  !n.read ? [<Button key="r" size="small" type="link" icon={<CheckOutlined />} onClick={() => done(n.id)}>已读</Button>] : []
                }
              >
                <List.Item.Meta
                  title={
                    <span style={{ fontWeight: n.read ? 400 : 600 }}>
                      <Tag color={n.read ? "default" : "blue"}>{KIND_ZH[n.kind] || n.kind}</Tag>
                      {n.title}
                    </span>
                  }
                  description={<Text type="secondary" style={{ fontSize: 12 }}>{new Date(n.created_at || "").toLocaleString()}</Text>}
                />
                {n.content && (
                  <div style={{ marginTop: 6, padding: "8px 12px", background: "#fafafa", borderRadius: 6, fontSize: 13 }}>
                    <DashboardMarkdown content={n.content.slice(0, 600)} />
                  </div>
                )}
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
}
