"use client";

import { useState, useEffect } from "react";
import {
	Button,
	Card,
	Col,
	Row,
	Statistic,
	Tag,
	Typography,
	Spin,
	Collapse,
	message,
} from "antd";
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { api } from "../services/api";
import type { InsightReportItem, InsightResult } from "../services/api";
import DashboardMarkdown from "../components/DashboardMarkdown";
import { displayTitle, formatDateTime } from "../utils/format";

const { Title, Paragraph } = Typography;

// 历史报告条目：title 由后端生成（可能为 null，前端回退到正文首行清洗结果）
type HistoryItem = InsightReportItem;

export default function InsightsPage() {
	const [result, setResult] = useState<InsightResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [history, setHistory] = useState<HistoryItem[]>([]);

	useEffect(() => {
		api
			.listInsights()
			.then((d) => setHistory(d.reports || []))
			.catch(() => {});
	}, []);

	const generate = async () => {
		setLoading(true);
		try {
			setResult(await api.generateInsights());
		} catch (e) {
			message.error(`生成洞察失败：${(e as Error)?.message || "请配置模型 API Key"}`);
		} finally {
			setLoading(false);
		}
	};

	const stats = result?.data?.统计;

	return (
		<div>
			<Title level={4} style={{ marginTop: 0 }}>
				AI 校务洞察 <span style={{ fontWeight: 400, fontSize: 14, color: "#888" }}>基于运营数据的智能解读</span>
			</Title>

			<Button
				type="primary"
				icon={<BulbOutlined />}
				loading={loading}
				onClick={generate}
				style={{ marginBottom: 16 }}
			>
				{result ? "重新生成" : "生成今日洞察"}
			</Button>

			{loading && (
				<Card style={{ marginBottom: 16 }}>
					<Spin tip="正在生成洞察…" style={{ display: "block", padding: 32 }}>
						<div style={{ height: 80 }} />
					</Spin>
				</Card>
			)}

			{result && (
				<>
					<Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
						<Col xs={12} md={4}>
							<Card><Statistic title="今日新增" value={stats?.今日新增 ?? 0} /></Card>
						</Col>
						<Col xs={12} md={4}>
							<Card><Statistic title="已发布知识" value={stats?.已发布知识 ?? 0} /></Card>
						</Col>
						<Col xs={12} md={4}>
							<Card><Statistic title="开放冲突" value={stats?.开放冲突 ?? 0} /></Card>
						</Col>
						<Col xs={12} md={4}>
							<Card><Statistic title="待审核" value={stats?.待审核 ?? 0} /></Card>
						</Col>
						<Col xs={12} md={4}>
							<Card><Statistic title="异常来源" value={stats?.异常来源 ?? 0} /></Card>
						</Col>
					</Row>

					<Card title="洞察内容" style={{ marginBottom: 16 }}>
						<DashboardMarkdown content={result.content} />
					</Card>

					{stats?.部门分布 && Object.keys(stats.部门分布).length > 0 && (
						<Card title="知识部门分布">
							{Object.entries(stats.部门分布).map(([k, v]) => (
								<Tag color="geekblue" key={k} style={{ marginBottom: 8 }}>
									{k}：{v} 条
								</Tag>
							))}
						</Card>
					)}
				</>
			)}

			{!result && !loading && (
				<Card>
					<div style={{ color: "#999" }}>点击「生成今日洞察」，AI 将结合新增、变更、冲突、审核积压、来源异常与临期事项，输出本期要点、趋势、风险与建议。</div>
				</Card>
			)}

			{history.length > 0 && (
				<Card title="历史洞察报告" style={{ marginTop: 16 }}>
					<Collapse
						items={history.map((h) => ({
							key: h.id || String(Math.random()),
							label: `${formatDateTime(h.created_at)} · ${h.title || displayTitle(h.content?.split("\n")[0], 40)}`,
							children: (
								<DashboardMarkdown content={h.content} />
							),
						}))}
					/>
				</Card>
			)}
		</div>
	);
}
