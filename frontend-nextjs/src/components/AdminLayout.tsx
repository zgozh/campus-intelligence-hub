"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { Avatar, Badge, Button, Empty, Layout, List, Menu, Popover, Tag, theme } from "antd";
import {
  ApartmentOutlined,
  BellOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  DeploymentUnitOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FundOutlined,
  LogoutOutlined,
  MessageOutlined,
  RadarChartOutlined,
  StarOutlined,
  UnorderedListOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { api } from "../services/api";
import type { NotificationItem } from "../services/api";
import { displayTitle, formatDateTime } from "../utils/format";

const { Sider, Header, Content } = Layout;

/** 未读数轮询间隔：30s（需求 T11-5） */
const UNREAD_POLL_MS = 30000;

/** 通知分类中文名（与通知中心页保持一致） */
const KIND_ZH: Record<string, string> = {
  brief: "快讯",
  insight: "洞察",
  alert: "告警",
  expiring: "临期",
  system: "系统",
};

const MENU_ITEMS = [
  { key: "/overview", icon: <FundOutlined />, i18nKey: "navigation.overview" },
  { key: "/", icon: <DashboardOutlined />, i18nKey: "navigation.dashboard" },
  { key: "/sources", icon: <DatabaseOutlined />, i18nKey: "navigation.sources" },
  { key: "/jobs", icon: <UnorderedListOutlined />, i18nKey: "navigation.jobs" },
  { key: "/knowledge-objects", icon: <StarOutlined />, i18nKey: "navigation.knowledgeObjects" },
  { key: "/knowledge-graph", icon: <ApartmentOutlined />, i18nKey: "navigation.knowledgeGraph" },
  { key: "/changes", icon: <BellOutlined />, i18nKey: "navigation.changes" },
  { key: "/radar", icon: <RadarChartOutlined />, i18nKey: "navigation.radar" },
  { key: "/review", icon: <CheckCircleOutlined />, i18nKey: "navigation.review" },
  { key: "/ask", icon: <MessageOutlined />, i18nKey: "navigation.ask" },
  { key: "/insights", icon: <BulbOutlined />, i18nKey: "navigation.insights" },
  { key: "/closed-loop", icon: <DeploymentUnitOutlined />, i18nKey: "navigation.closedLoop" },
  { key: "/digests", icon: <FileTextOutlined />, i18nKey: "navigation.digests" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useAuth();
  const { t } = useTranslation("common");
  const { token } = theme.useToken();
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  // 通知面板：受控展开（T11-1），加载失败必须可见（T11-6）
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifError, setNotifError] = useState(false);
  const [readAllLoading, setReadAllLoading] = useState(false);

  /** 未读数：轮询与手动刷新共用；失败保留上次值（不把数字清零误导用户） */
  const refreshUnread = useCallback(async () => {
    try {
      const d = await api.getUnreadCount();
      setUnread(d.unread ?? 0);
    } catch {
      /* 未读数失败不打断界面 */
    }
  }, []);

  /** 通知列表：失败置错误态，由面板内的「重试」按钮重新拉取 */
  const loadNotifications = useCallback(async () => {
    setNotifLoading(true);
    try {
      const d = await api.listNotifications(20);
      setNotifications(d.notifications || []);
      setNotifError(false);
    } catch {
      setNotifError(true);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    void refreshUnread();
  }, [loadNotifications, refreshUnread]);

  // 未读数 30s 轮询：组件卸载必须清理定时器，避免泄漏
  useEffect(() => {
    const timer = setInterval(() => {
      void refreshUnread();
    }, UNREAD_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshUnread]);

  /** 点击通知：先标记已读（本地即时生效 + 刷新未读数），有 link 再跳转 */
  const handleNotificationClick = async (n: NotificationItem) => {
    try {
      await api.markNotificationRead(n.id);
    } catch {
      /* 标记失败不阻断跳转 */
    }
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    void refreshUnread();
    if (n.link) {
      setNotifOpen(false);
      navigate(n.link);
    }
  };

  /** 全部已读：调用后端幂等接口后即时刷新列表与未读数 */
  const handleReadAll = async () => {
    setReadAllLoading(true);
    try {
      await api.readAllNotifications();
      setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
      await Promise.all([loadNotifications(), refreshUnread()]);
    } catch {
      setNotifError(true);
    } finally {
      setReadAllLoading(false);
    }
  };

  const handleNotifOpenChange = (next: boolean) => {
    setNotifOpen(next);
    if (next) {
      void loadNotifications();
      void refreshUnread();
    }
  };

  const menuItems = useMemo(
    () =>
      MENU_ITEMS.map((m) => ({
        key: m.key,
        icon: m.icon,
        label: t(m.i18nKey),
      })),
    [t],
  );

  const selectedKey = useMemo(() => {
    const found = MENU_ITEMS.find(
      (m) => m.key === location.pathname || (m.key !== "/" && location.pathname.startsWith(m.key + "/")),
    );
    return found ? found.key : "/";
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={220}
        style={{ position: "sticky", top: 0, height: "100vh", overflow: "hidden" }}
      >
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <div
          style={{
            height: 64,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 1,
            flexShrink: 0,
          }}
        >
          校务智汇中台
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ flex: 1, borderRight: 0, overflow: "auto" }}
        />
        <div
          style={{
            padding: 16,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Avatar style={{ background: token.colorPrimary }} icon={<UserOutlined />} />
            <span style={{ color: "#fff", fontSize: 14 }}>{admin?.name || admin?.email || "管理员"}</span>
          </div>
          <Button block icon={<LogoutOutlined />} onClick={handleLogout}>
            退出登录
          </Button>
        </div>
        </div>
      </Sider>

      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            padding: "0 24px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Popover
            trigger="click"
            placement="bottomRight"
            open={notifOpen}
            onOpenChange={handleNotifOpenChange}
            content={
              <div style={{ width: 340 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <b>通知中心</b>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => {
                      setNotifOpen(false);
                      navigate("/notifications");
                    }}
                  >
                    查看全部
                  </Button>
                </div>
                {notifError ? (
                  <div style={{ padding: "12px 0", textAlign: "center" }}>
                    <div style={{ color: token.colorError, fontSize: 12, marginBottom: 8 }}>
                      通知加载失败，点击重试
                    </div>
                    <Button size="small" loading={notifLoading} onClick={() => { void loadNotifications(); }}>
                      重试
                    </Button>
                  </div>
                ) : notifications.length === 0 ? (
                  <Empty description="暂无通知" imageStyle={{ height: 50 }} />
                ) : (
                  <List
                    size="small"
                    loading={notifLoading}
                    dataSource={notifications}
                    renderItem={(n) => (
                      <List.Item
                        onClick={() => { void handleNotificationClick(n); }}
                        style={{ cursor: "pointer" }}
                      >
                        <List.Item.Meta
                          title={
                            <span style={{ fontWeight: n.read ? 400 : 600 }}>
                              <Tag color={n.read ? "default" : "blue"}>{KIND_ZH[n.kind] || n.kind}</Tag>
                              {displayTitle(n.title, 30)}
                            </span>
                          }
                          description={formatDateTime(n.created_at)}
                        />
                      </List.Item>
                    )}
                  />
                )}
                <div
                  style={{
                    borderTop: `1px solid ${token.colorBorderSecondary}`,
                    marginTop: 8,
                    paddingTop: 8,
                    textAlign: "center",
                  }}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckOutlined />}
                    loading={readAllLoading}
                    onClick={() => { void handleReadAll(); }}
                  >
                    全部已读
                  </Button>
                </div>
              </div>
            }
          >
            {/* Popover 需要能接收事件/ref 的单一子元素：用原生 span 承载，Badge 包裹会导致 trigger 失效 */}
            <span style={{ display: "inline-flex", cursor: "pointer" }}>
              <Badge count={unread} size="small">
                <Button type="text" icon={<BellOutlined />} aria-label="通知中心" style={{ fontSize: 18 }} />
              </Badge>
            </span>
          </Popover>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout, minHeight: "calc(100vh - 64px)" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
