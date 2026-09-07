"use client";

import { useState } from "react";
import { Alert, Button, Card, Checkbox, Space, Tag, Typography, message } from "antd";
import { PlayCircleOutlined, DeploymentUnitOutlined } from "@ant-design/icons";
import { api } from "../services/api";
import type { ClosedLoopResult } from "../services/api";

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
	ok: { color: "green", label: "完成" },
	partial: { color: "orange", label: "部分完成" },
	skipped: { color: "default", label: "已跳过" },
	error: { color: "red", label: "异常" },
};

export default function ClosedLoop() {
	const [result, setResult] = useState<ClosedLoopResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [collect, setCollect] = useState(false);

	const run = async () => {
		setLoading(true);
		try {
			setResult(await api.runClosedLoop(collect));
			message.success("智能闭环执行完成");
		} catch (e) {
			message.error(`闭环执行失败：${(e as Error)?.message || "请配置模型 API Key"}`);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div>
			<Title level={4} style={{ marginTop: 0 }}>
				智能运营闭环 <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>三层 Agent 一键编排</span>
			</Title>

			<Card style={{ marginBottom: 16 }}>
				<Space direction="vertical" size={8} style={{ width: "100%" }}>
					<Text type="secondary">
						<DeploymentUnitOutlined /> 采集 Agent → 知识治理 Agent → 问答/运营 Agent，一次运行串起「发现-采集-治理-图谱-洞察-健康」完整链路。
					</Text>
					<Space wrap>
						<Checkbox checked={collect} onChange={(e) => setCollect(e.target.checked)}>
							包含实时采集（会访问已配置数据源）
						</Checkbox>
						<Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={run}>
							一键运行闭环
						</Button>
					</Space>
				</Space>
			</Card>

			{result && (
				<>
					<Alert
						type={result.status === "ok" ? "success" : "warning"}
						showIcon
						message={result.summary}
						style={{ marginBottom: 16 }}
					/>
					{result.stages.map((s, i) => {
						const st = STATUS_TAG[s.status] || STATUS_TAG.error;
						return (
							<Card key={i} style={{ marginBottom: 12 }}>
								<Space direction="vertical" size={4} style={{ width: "100%" }}>
									<Space>
										<Text strong>{i + 1}. {s.name}</Text>
										<Tag color={st.color}>{st.label}</Tag>
									</Space>
									<Text type="secondary">{s.detail}</Text>
								</Space>
							</Card>
						);
					})}
				</>
			)}

			{!result && (
				<Card>
					<Text type="secondary">点击「一键运行闭环」执行三层 Agent 编排。不勾选实时采集时，将基于现有数据跑治理、图谱、洞察、健康度；勾选后额外采集 active 数据源（best-effort）。</Text>
				</Card>
			)}
		</div>
	);
}
