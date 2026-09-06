"use client";

import { useMemo } from "react";
import { Avatar, Dropdown, Layout, Menu, Space, theme } from "antd";
import {
  CheckCircleOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileTextOutlined,
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
  { key: "/", icon: <DashboardOutlined />, i18nKey: "navigation.dashboard" },
  { key: "/sources", icon: <DatabaseOutlined />, i18nKey: "navigation.sources" },
  { key: "/jobs", icon: <UnorderedListOutlined />, i18nKey: "navigation.jobs" },
  { key: "/knowledge-objects", icon: <StarOutlined />, i18nKey: "navigation.knowledgeObjects" },
  { key: "/radar", icon: <RadarChartOutlined />, i18nKey: "navigation.radar" },
  { key: "/review", icon: <CheckCircleOutlined />, i18nKey: "navigation.review" },
  { key: "/ask", icon: <MessageOutlined />, i18nKey: "navigation.ask" },
  { key: "/digests", icon: <FileTextOutlined />, i18nKey: "navigation.digests" },
  { key: "/users", icon: <UserOutlined />, i18nKey: "navigation.users" },
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
      <Sider width={220} style={{ position: "sticky", top: 0, height: "100vh", overflow: "auto" }}>
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
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            padding: "0 24px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Dropdown
            menu={{
              items: [
                { key: "logout", icon: <LogoutOutlined />, label: "退出登录", onClick: handleLogout },
              ],
            }}
          >
            <Space style={{ cursor: "pointer" }}>
              <Avatar style={{ background: token.colorPrimary }} icon={<UserOutlined />} />
              <span>{admin?.name || admin?.email || "管理员"}</span>
            </Space>
          </Dropdown>
        </Header>

        <Content style={{ padding: 24, background: token.colorBgLayout, minHeight: "calc(100vh - 64px)" }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
