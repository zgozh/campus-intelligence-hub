"use client";

import { useMemo } from "react";

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

// 简单力导向布局（Fruchterman-Reingold 近似），无第三方依赖
function forceLayout(
	entities: GraphEntity[],
	relations: GraphRelation[],
): Record<string, { x: number; y: number }> {
	const n = entities.length;
	if (n === 0) return {};
	const area = 520 * 520;
	const k = Math.sqrt(area / Math.max(n, 1));
	const pos: Record<string, { x: number; y: number }> = {};
	const idx: Record<string, number> = {};
	entities.forEach((e, i) => {
		idx[e.id] = i;
		const ang = (2 * Math.PI * i) / n;
		pos[e.id] = { x: 260 + 200 * Math.cos(ang), y: 260 + 200 * Math.sin(ang) };
	});

	let temperature = 10;
	const dispatch = (i1: number, i2: number, disp: { x: number; y: number }, force: number) => {
		const a = entities[i1].id;
		const b = entities[i2].id;
		const dx = pos[a].x - pos[b].x;
		const dy = pos[a].y - pos[b].y;
		const len = Math.sqrt(dx * dx + dy * dy) || 0.1;
		pos[a].x += (dx / len) * force;
		pos[a].y += (dy / len) * force;
		pos[b].x -= (dx / len) * force;
		pos[b].y -= (dy / len) * force;
	};

	for (let iter = 0; iter < 220; iter++) {
		const disp: Record<string, { x: number; y: number }> = {};
		entities.forEach((e) => (disp[e.id] = { x: 0, y: 0 }));
		// 斥力
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const a = entities[i].id;
				const b = entities[j].id;
				const dx = pos[a].x - pos[b].x;
				const dy = pos[a].y - pos[b].y;
				let d = Math.sqrt(dx * dx + dy * dy) || 0.1;
				const rep = (k * k) / d;
				disp[a].x += (dx / d) * rep;
				disp[a].y += (dy / d) * rep;
				disp[b].x -= (dx / d) * rep;
				disp[b].y -= (dy / d) * rep;
			}
		}
		// 引力（沿边）
		for (const r of relations) {
			const a = idx[r.head_id];
			const b = idx[r.tail_id];
			if (a === undefined || b === undefined) continue;
			const ha = entities[a].id;
			const hb = entities[b].id;
			const dx = pos[ha].x - pos[hb].x;
			const dy = pos[ha].y - pos[hb].y;
			const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
			const att = (d * d) / k;
			disp[ha].x -= (dx / d) * att;
			disp[ha].y -= (dy / d) * att;
			disp[hb].x += (dx / d) * att;
			disp[hb].y += (dy / d) * att;
		}
		// 限幅位移
		for (const e of entities) {
			const dx = disp[e.id].x;
			const dy = disp[e.id].y;
			const len = Math.sqrt(dx * dx + dy * dy) || 0.1;
			pos[e.id].x += (dx / len) * Math.min(len, temperature);
			pos[e.id].y += (dy / len) * Math.min(len, temperature);
			// 边界
			pos[e.id].x = Math.max(30, Math.min(490, pos[e.id].x));
			pos[e.id].y = Math.max(30, Math.min(490, pos[e.id].y));
		}
		temperature *= 0.97;
	}
	return pos;
}

export default function GraphForce({
	entities,
	relations,
}: {
	entities: GraphEntity[];
	relations: GraphRelation[];
}) {
	const pos = useMemo(
		() => forceLayout(entities, relations),
		[entities, relations],
	);
	const nameById = useMemo(
		() => Object.fromEntries(entities.map((e) => [e.id, e.name])),
		[entities],
	);

	if (entities.length === 0) {
		return (
			<div style={{ height: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>
				暂无图谱数据，请先「构建/更新图谱」。
			</div>
		);
	}

	return (
		<svg width="100%" height="360" viewBox="0 0 520 520" style={{ background: "#fafafa", borderRadius: 8 }}>
			{/* 连线 */}
			{relations.map((r) => {
				const a = pos[r.head_id];
				const b = pos[r.tail_id];
				if (!a || !b) return null;
				return (
					<line
						key={r.id}
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke="#c8c8c8"
						strokeWidth={1.2}
					/>
				);
			})}
			{/* 节点 */}
			{entities.map((e) => {
				const p = pos[e.id];
				const color = PALETTE[e.type] || "#8c8c8c";
				const label = e.name.length > 14 ? e.name.slice(0, 14) + "…" : e.name;
				return (
					<g key={e.id}>
						<circle cx={p.x} cy={p.y} r={13} fill={color} opacity={0.85} />
						<text
							x={p.x}
							y={p.y + 4}
							textAnchor="middle"
							style={{ fontSize: 9, fill: "#fff", pointerEvents: "none" }}
						>
							{e.type.slice(0, 1)}
						</text>
						<text
							x={p.x}
							y={p.y + 28}
							textAnchor="middle"
							style={{ fontSize: 10, fill: "#333" }}
						>
							{label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
