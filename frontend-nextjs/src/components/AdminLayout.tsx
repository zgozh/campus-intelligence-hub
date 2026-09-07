"use client";

import { useMemo } from "react";
import { Avatar, Button, Layout, Menu, theme } from "antd";
import {
  ApartmentOutlined,
  BellOutlined,
  BulbOutlined,
  CheckCircleOutlined,
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

const { Sider, Header, Content } = Layout;

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
  { key: "/digests", icon: <FileTextOutlined />, i18nKey: "navigation.digests" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useAuth();
  const { t } = useTranslation("common");
  const { token } = theme.useToken();

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
          }}
        />
        <Content style={{ padding: 24, background: token.colorBgLayout, minHeight: "calc(100vh - 64px)" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
