"use client";

import { useState, useEffect } from "react";
import {
	Alert,
	Button,
	Card,
	Checkbox,
	Col,
	Row,
	Space,
	Tag,
	Typography,
	message,
} from "antd";
import {
	PlayCircleOutlined,
	DeploymentUnitOutlined,
	DatabaseOutlined,
	ApartmentOutlined,
	CheckCircleOutlined,
	BulbOutlined,
	MessageOutlined,
	StarOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import type { ClosedLoopResult } from "../services/api";

const { Title, Text } = Typography;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
	ok: { color: "green", label: "完成" },
	partial: { color: "orange", label: "部分完成" },
	skipped: { color: "default", label: "已跳过" },
	error: { color: "red", label: "异常" },
};

// AI 智能体能力矩阵（校务中台的各个 Agent）
const AGENTS = [
	{ name: "采集 Agent", icon: <DatabaseOutlined />, color: "#1677ff", desc: "数据源发现 / Crawl4AI 智能推荐 / 自动采集", path: "/sources" },
	{ name: "知识治理 Agent", icon: <CheckCircleOutlined />, color: "#52c41a", desc: "冲突检测 / 审核队列 / 归档过期 / 发布流程", path: "/review" },
	{ name: "图谱 Agent", icon: <ApartmentOutlined />, color: "#722ed1", desc: "LLM 三元组抽取 / 关系路径 / GraphRAG 子图", path: "/knowledge-graph" },
	{ name: "洞察 Agent", icon: <BulbOutlined />, color: "#fa8c16", desc: "运营数据 → 校务洞察 / 自动日报 / 趋势风险", path: "/insights" },
	{ name: "问答 Agent", icon: <MessageOutlined />, color: "#13c2c2", desc: "融合检索 + Rerank + 意图/部门路由 + 防幻觉", path: "/ask" },
	{ name: "审核助手 Agent", icon: <StarOutlined />, color: "#eb2f96", desc: "AI 预审摘要 / 风险 / 推荐动作(批准/拒绝/合并)", path: "/review" },
];

export default function ClosedLoop() {
	const navigate = useNavigate();
	const [result, setResult] = useState<ClosedLoopResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [collect, setCollect] = useState(false);
	const [stats, setStats] = useState({ sources: 0, pending: 0, entities: 0, relations: 0, reports: 0, health: 0 });

	useEffect(() => {
		api.listSources().then((d) => setStats((s) => ({ ...s, sources: d.total }))).catch(() => {});
		api.listReviewTasks().then((d) => setStats((s) => ({ ...s, pending: d.total }))).catch(() => {});
		api.listKnowledgeGraph().then((d) => setStats((s) => ({ ...s, entities: d.entity_count, relations: d.relation_count }))).catch(() => {});
		api.listInsights(1).then((d) => setStats((s) => ({ ...s, reports: d.total }))).catch(() => {});
		api.getKnowledgeHealth().then((h) => setStats((s) => ({ ...s, health: h.health_score }))).catch(() => {});
	}, []);

	const statusOf = (name: string): string => {
		switch (name) {
			case "采集 Agent": return `数据源 ${stats.sources}`;
			case "知识治理 Agent": return `待审 ${stats.pending}`;
			case "图谱 Agent": return `${stats.entities} 实体 · ${stats.relations} 关系`;
			case "洞察 Agent": return `${stats.reports} 份报告`;
			case "问答 Agent": return `健康度 ${stats.health}`;
			case "审核助手 Agent": return `待审 ${stats.pending}`;
			default: return "";
		}
	};

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
				AI 智能体中心 <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>三层编排 + 能力矩阵</span>
			</Title>

			<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
				{AGENTS.map((a) => (
					<Col xs={24} sm={12} md={8} key={a.name}>
						<Card size="small">
							<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
								<span style={{ color: a.color, fontSize: 18 }}>{a.icon}</span>
								<Text strong>{a.name}</Text>
								<Tag color="blue" style={{ marginLeft: "auto" }}>{statusOf(a.name)}</Tag>
							</div>
							<div style={{ color: "#666", fontSize: 13, minHeight: 36 }}>{a.desc}</div>
							<Button size="small" type="link" style={{ padding: 0 }} onClick={() => navigate(a.path)}>
								进入 →
							</Button>
						</Card>
					</Col>
				))}
			</Row>

			<Card style={{ marginBottom: 16 }}>
				<Space direction="vertical" size={8} style={{ width: "100%" }}>
					<Text type="secondary">
						<DeploymentUnitOutlined /> 一键运行「采集 → 知识治理 → 问答/运营」三层编排，串起发现-采集-治理-图谱-洞察-健康完整链路。
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
		</div>
	);
}
