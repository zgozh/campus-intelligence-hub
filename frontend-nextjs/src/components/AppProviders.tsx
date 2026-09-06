"use client";

import type { ReactNode } from "react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { I18nextProvider } from "react-i18next";
import i18n from "../i18n/config";
import { AuthProvider } from "../context/AuthContext";
import { ThemeProvider } from "../context/ThemeContext";
import { ErrorBoundary } from "./ErrorBoundary";

export function AppProviders({ children }: { children: ReactNode }) {
	return (
		<ErrorBoundary>
			<ConfigProvider locale={zhCN}>
				<ThemeProvider>
					<I18nextProvider i18n={i18n}>
						<AuthProvider>{children}</AuthProvider>
					</I18nextProvider>
				</ThemeProvider>
			</ConfigProvider>
		</ErrorBoundary>
	);
}
