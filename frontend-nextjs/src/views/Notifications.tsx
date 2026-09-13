"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, Card, Empty, List, Space, Tabs, Tag, Typography, message } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type { NotificationItem } from "../services/api";
import DashboardMarkdown from "../components/DashboardMarkdown";
import { displayTitle, formatDateTime } from "../utils/format";
import { KIND_ZH } from "../utils/constants";

const { Title, Text } = Typography;

/** 分类筛选：全部 + 后端支持的四类业务通知（T11-7） */
const KIND_TABS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "brief", label: "快讯" },
  { key: "insight", label: "洞察" },
  { key: "alert", label: "告警" },
  { key: "system", label: "系统" },
];

export default function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [kind, setKind] = useState("all");
  const [alertLoading, setAlertLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listNotifications(50, unreadOnly, kind === "all" ? undefined : kind);
      setItems(d.notifications || []);
    } catch (e) {
      message.error("通知加载失败");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly, kind]);

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

  /** 点击条目：先标记已读，有 link 则跳转对应页面 */
  const openItem = async (n: NotificationItem) => {
    try {
      await api.markNotificationRead(n.id);
    } catch (e) {
      /* 标记失败不阻断跳转 */
    }
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    if (n.link) navigate(n.link);
  };

  const done = async (id: string) => {
    try {
      await api.markNotificationRead(id);
    } catch (e) {
      message.error("标记已读失败");
      return;
    }
    await load();
  };

  const readAll = async () => {
    try {
      await api.readAllNotifications();
      message.success("已全部标记已读");
      await load();
    } catch (e) {
      message.error("全部已读失败");
    }
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

      <Tabs
        size="small"
        activeKey={kind}
        onChange={setKind}
        items={KIND_TABS.map((k) => ({ key: k.key, label: k.label }))}
        style={{ marginBottom: 8 }}
      />

      <Card loading={loading}>
        {items.length === 0 ? (
          <Empty description="暂无通知" />
        ) : (
          <List
            dataSource={items}
            renderItem={(n) => (
              <List.Item
                onClick={() => { void openItem(n); }}
                style={{ cursor: "pointer" }}
                actions={
                  !n.read
                    ? [
                        <Button
                          key="r"
                          size="small"
                          type="link"
                          icon={<CheckOutlined />}
                          onClick={(e) => {
                            e.stopPropagation();
                            void done(n.id);
                          }}
                        >
                          已读
                        </Button>,
                      ]
                    : []
                }
              >
                <List.Item.Meta
                  title={
                    <span style={{ fontWeight: n.read ? 400 : 600 }}>
                      <Tag color={n.read ? "default" : "blue"}>{KIND_ZH[n.kind] || n.kind}</Tag>
                      {displayTitle(n.title, 40)}
                    </span>
                  }
                  description={<Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(n.created_at)}</Text>}
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
