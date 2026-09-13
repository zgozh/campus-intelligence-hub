"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { Avatar, Badge, Button, Drawer, Empty, Layout, List, Menu, Tag, theme } from "antd";
import { APP_VERSION, BUILD_ID } from "../build-info";
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
import { KIND_ZH_COMPACT } from "../utils/constants";

const { Sider, Header, Content } = Layout;

/** 未读数轮询间隔：30s（需求 T11-5） */
const UNREAD_POLL_MS = 30000;

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
  // 前后端构建是否不一致（A2）：不一致只提示，不阻塞
  const [buildMismatch, setBuildMismatch] = useState(false);

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

  // 前后端构建一致性检查（A2）：失败静默（版本信息拿不到不该影响使用）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const info = await api.getVersion();
        if (!cancelled && info?.build && info.build !== "unknown" && info.build !== BUILD_ID) {
          setBuildMismatch(true);
        }
      } catch {
        /* 版本接口不可用时不做提示 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    // data-build：真机探针据此断言"页面跑的是哪个构建"（A2）
    <Layout style={{ minHeight: "100vh" }} data-build={BUILD_ID}>
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
          {/* 构建标识常驻显示（A2）：用户/探针可一眼确认"跑的是不是最新构建" */}
          <div
            data-testid="build-id"
            style={{ marginTop: 10, color: "rgba(255,255,255,0.45)", fontSize: 11, wordBreak: "break-all" }}
          >
            v{APP_VERSION} · {BUILD_ID}
          </div>
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
          {/* 前后端构建不一致提示（A2）：不阻塞使用，只提示"可能跑的不是同一版" */}
          {buildMismatch && (
            <Tag color="warning" style={{ marginRight: 12 }} data-testid="build-mismatch">
              前后端版本不一致
            </Tag>
          )}
          {/* 通知中心改用 Drawer（右侧抽屉）：
              antd 5.29 + @rc-component/trigger 2.3 的 Popover 在此环境下会把纵向对齐算成
              -1000vh，弹层被放到视口外（真机探针实测 top=-1000vh、可见比例 0），
              用户表现为"点了没反应"；且通知多时面板可高达 800px+ 反而超过视口。
              Drawer 用 fixed 定位、无对齐计算，天然可见且可滚动，规避该类缺陷。 */}
          <span
            style={{ display: "inline-flex", cursor: "pointer" }}
            onClick={() => {
              setNotifOpen(true);
              handleNotifOpenChange(true);
            }}
          >
            <Badge count={unread} size="small">
              <Button type="text" icon={<BellOutlined />} aria-label="通知中心" style={{ fontSize: 18 }} />
            </Badge>
          </span>
          <Drawer
            title="通知中心"
            placement="right"
            width={380}
            open={notifOpen}
            onClose={() => setNotifOpen(false)}
            extra={
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
            }
            footer={
              <Button
                block
                type="link"
                size="small"
                icon={<CheckOutlined />}
                loading={readAllLoading}
                onClick={() => { void handleReadAll(); }}
              >
                全部已读
              </Button>
            }
          >
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
                          <Tag color={n.read ? "default" : "blue"}>{KIND_ZH_COMPACT[n.kind] || n.kind}</Tag>
                          {displayTitle(n.title, 30)}
                        </span>
                      }
                      description={formatDateTime(n.created_at)}
                    />
                  </List.Item>
                )}
              />
            )}
          </Drawer>
        </Header>
        <Content style={{ padding: 24, background: token.colorBgLayout, minHeight: "calc(100vh - 64px)" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
