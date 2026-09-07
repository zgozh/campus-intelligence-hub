"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface GraphEntity {
	id: string;
	name: string;
	type: string;
	ko_id?: string | null;
}

interface GraphRelation {
	id: string;
	head_id: string;
	tail_id: string;
	relation: string;
}

const PALETTE: Record<string, string> = {
	部门: "#1677ff",
	政策: "#722ed1",
	事件: "#13c2c2",
	对象: "#52c41a",
	时间: "#fa8c16",
	文件: "#eb2f96",
};

export default function GraphForce({
	entities,
	relations,
}: {
	entities: GraphEntity[];
	relations: GraphRelation[];
}) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;
		if (entities.length === 0) return;

		const chart = echarts.init(ref.current);
		const types = Array.from(new Set(entities.map((e) => e.type)));
		const categories = types.map((t) => ({
			name: t,
			itemStyle: { color: PALETTE[t] || "#8c8c8c" },
		}));
		const typeIndex: Record<string, number> = {};
		types.forEach((t, i) => (typeIndex[t] = i));

		const data = entities.map((e) => ({
			id: e.id,
			name: e.name,
			category: typeIndex[e.type] ?? 0,
			draggable: true,
			symbolSize: 26,
		}));
		const links = relations
			.filter((r) => entities.some((e) => e.id === r.head_id) && entities.some((e) => e.id === r.tail_id))
			.map((r) => ({ source: r.head_id, target: r.tail_id, value: r.relation }));

		chart.setOption({
			backgroundColor: "#fafafa",
			tooltip: {
				formatter: (p: any) => {
					if (p.dataType === "edge") {
						const s = entities.find((e) => e.id === p.data.source)?.name || p.data.source;
						const t = entities.find((e) => e.id === p.data.target)?.name || p.data.target;
						return `${s} <b>→</b> ${t}<br/>关系：${p.data.value || "关联"}`;
					}
					const ent = entities.find((e) => e.id === p.data.id);
					return `${p.name}<br/>类型：${ent?.type || ""}`;
				},
			},
			series: [
				{
					type: "graph",
					layout: "force",
					roam: true,
					draggable: true,
					animation: true,
					data,
					links,
					categories,
					force: {
						repulsion: 240,
						edgeLength: 100,
						gravity: 0.08,
						layoutAnimation: true,
					},
					label: { show: true, position: "bottom", fontSize: 10, color: "#333" },
					lineStyle: { color: "#c8c8c8", width: 1.2, curveness: 0.1 },
					edgeSymbol: ["none", "arrow"],
					edgeSymbolSize: 6,
					emphasis: {
						focus: "adjacency",
						lineStyle: { width: 2.4 },
						label: { fontWeight: "bold" },
					},
				},
			],
		});

		const ro = new ResizeObserver(() => chart.resize());
		ro.observe(ref.current);
		return () => {
			ro.disconnect();
			chart.dispose();
		};
	}, [entities, relations]);

	if (entities.length === 0) {
		return (
			<div style={{ height: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
				暂无图谱数据，请先「构建/更新图谱」。
			</div>
		);
	}

	return (
		<div style={{ position: "relative", width: "100%" }}>
			<div ref={ref} style={{ width: "100%", height: 420 }} />
			<div
				style={{
					position: "absolute",
					top: 8,
					right: 12,
					fontSize: 12,
					color: "#999",
					background: "rgba(255,255,255,0.8)",
					padding: "2px 8px",
					borderRadius: 6,
					pointerEvents: "none",
				}}
			>
				滚轮缩放 · 拖拽平移 / 节点拖拽
			</div>
		</div>
	);
}
