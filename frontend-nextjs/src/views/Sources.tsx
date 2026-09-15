'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ComponentProps, ReactElement } from 'react';
import { Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CompassOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../services/api';
import type { BriefResult, CampusSource, RecommendResult, SourceColumn, SourceMonitor } from '../services/api';
import DashboardMarkdown from '../components/DashboardMarkdown';
import { displayTitle, formatDateTime, formatTime, statusColor } from '../utils/format';

const { Title } = Typography;

/** 监控项（last_success_at / last_error 由后端快照提供，展示层据此统一"最近采集"语义） */
type MonitorItem = SourceMonitor['items'][number];

/** 本地日期 → YYYY-MM-DD（用本地时区，避免 toISOString 的 UTC 偏移算错一天） */
function toDateStr(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 今天往前 offset 天（offset=0 即今天） */
function daysAgo(offset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d;
}

/** 时间筛选档位（T13-2）：近 7 天 = 今天往前 6 天到今天（含首尾，共 7 天） */
type TimeRangeKey = 'all' | '7d' | '30d' | 'custom';

const TIME_RANGE_OPTIONS: { value: TimeRangeKey; label: string }[] = [
  { value: 'all', label: '不限' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'custom', label: '自定义' },
];

/** 复用 antd RangePicker 的 value 类型，无需额外引第三方日期库 */
type RangePickerValue = ComponentProps<typeof DatePicker.RangePicker>['value'];

/**
 * 最近采集时间的统一展示（T13-6）：优先成功时间，其次最近抓取时间；
 * 两者都无显示「尚未采集」；有 last_error 时附红标提示失败原因。
 * 监控卡片与数据源表格共用本组件，保证两处时间一致。
 */
function CollectedAt({ item, prefix = '' }: { item: Pick<MonitorItem, 'last_success_at' | 'last_crawled_at' | 'last_error'>; prefix?: string }): ReactElement {
  const at = formatDateTime(item.last_success_at || item.last_crawled_at);
  return (
    <Space size={4}>
      <span>{at ? `${prefix}${at}` : '尚未采集'}</span>
      {item.last_error ? (
        <Tooltip title={item.last_error}>
          <Tag color="red" style={{ marginInlineEnd: 0 }}>失败</Tag>
        </Tooltip>
      ) : null}
    </Space>
  );
}

/** 监控项里的近期标题（LLM/站点原始标题）统一清洗后再展示 */
function recentTitlesLabel(titles: string[]): string {
  if (!titles.length) return '近 7 天暂无新内容';
  return titles.slice(0, 2).map((t) => displayTitle(t, 30)).join(' / ');
}

const PAGE_OPTIONS = [
  { value: 1, label: '1 页（仅最新）' },
  { value: 3, label: '3 页' },
  { value: 5, label: '5 页' },
  { value: 10, label: '10 页' },
  { value: 0, label: '全部（最多 50 页）' },
];

/** 站点首页判定：URL 无路径（或仅 "/"）→ 它是首页而非栏目列表页。
 *  首页把各板块文章铺在一屏上，采出来会跨栏目/跨站点，且没有「下一页」→ 页数档位无效。 */
function isHomepageUrl(url?: string | null): boolean {
  if (!url) return false;
  return /^https?:\/\/[^/]+\/?$/i.test(url.trim());
}

const HOMEPAGE_HINT = '这是站点首页，不是栏目列表页：1 页 = 首页所有板块的文章（跨栏目甚至跨站点），且页数档位无效。建议改成具体栏目列表页 URL，例如 https://www.gzhu.edu.cn/z__l/tzgg.htm';

const valueColor: Record<string, string> = { high: 'red', medium: 'orange', low: 'default' };
const valueZh: Record<string, string> = { high: '高价值', medium: '一般', low: '低价值' };

// 预置广州大学相关站点（P1-2：自动发现默认推荐源，用户可直接选取）
const DEFAULT_SITES: { name: string; url: string; type: string; value: string; category: string }[] = [
  { name: '广州大学首页', url: 'https://www.gzhu.edu.cn', type: 'website', value: 'medium', category: '官网' },
  { name: '广州大学新闻网', url: 'https://news.gzhu.edu.cn', type: 'list_page', value: 'high', category: '新闻动态' },
  { name: '广州大学-通知公告', url: 'https://www.gzhu.edu.cn/z__l/tzgg.htm', type: 'list_page', value: 'high', category: '通知公告' },
  { name: '广州大学教务处', url: 'https://jwc.gzhu.edu.cn', type: 'website', value: 'high', category: '教务处' },
  { name: '广州大学研究生院', url: 'https://yjsy.gzhu.edu.cn', type: 'website', value: 'high', category: '研究生院' },
  { name: '广州大学学生处', url: 'https://xsc.gzhu.edu.cn', type: 'website', value: 'high', category: '学生处' },
  { name: '广州大学招生办', url: 'https://zsjy.gzhu.edu.cn', type: 'website', value: 'high', category: '招生就业' },
  { name: '广州大学图书馆', url: 'https://lib.gzhu.edu.cn', type: 'website', value: 'medium', category: '图书馆' },
];

export default function Sources() {
  const [sources, setSources] = useState<CampusSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  // 数据源监控
  const [monitor, setMonitor] = useState<SourceMonitor | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [brief, setBrief] = useState<BriefResult | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listSources();
      setSources(d.sources || []);
    } catch (e) {
      message.error('加载数据源失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMonitor = useCallback(async (options?: { notify?: boolean }) => {
    setMonitorLoading(true);
    try {
      const snapshot = await api.monitorSources(7);
      setMonitor(snapshot);
      if (options?.notify) {
        const stamp = formatTime(snapshot.refreshed_at) || formatTime(new Date().toISOString());
        message.success(`已更新 · ${stamp}`);
        await load();
      }
    } catch (e) {
      message.error('监控加载失败');
    } finally {
      setMonitorLoading(false);
    }
  }, [load]);

  const genBrief = async () => {
    setBriefLoading(true);
    try {
      setBrief(await api.generateBrief(7));
      message.success('校务快讯已生成');
    } catch (e) {
      message.error(`快讯生成失败：${(e as Error)?.message || '请配置模型 API Key'}`);
    } finally {
      setBriefLoading(false);
    }
  };

  // 采集弹窗状态
  const [runOpen, setRunOpen] = useState(false);
  const [runSource, setRunSource] = useState<CampusSource | null>(null);
  const [runMaxPages, setRunMaxPages] = useState(1);
  const [runColumn, setRunColumn] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  // 栏目动态发现（T13-1）
  const [runColumns, setRunColumns] = useState<SourceColumn[]>([]);
  const [columnLoading, setColumnLoading] = useState(false);
  const [columnError, setColumnError] = useState('');
  // 时间筛选（T13-2）与仅采新内容（T13-3）
  const [runTimeRange, setRunTimeRange] = useState<TimeRangeKey>('all');
  const [runCustomRange, setRunCustomRange] = useState<RangePickerValue>(null);
  const [runOnlyNew, setRunOnlyNew] = useState(false);
  const [runMaxItems, setRunMaxItems] = useState<number | null>(null);

  // 自动发现
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverUrl, setDiscoverUrl] = useState('');
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discovered, setDiscovered] = useState<RecommendResult['recommended']>([]);
  const [discoveredOrigin, setDiscoveredOrigin] = useState('');

  useEffect(() => {
    load();
    loadMonitor();
  }, [load, loadMonitor]);

  const onCreate = async () => {
    const values = await form.validateFields();
    try {
      await api.createSource(values);
      message.success('创建成功');
      setOpen(false);
      form.resetFields();
      await load();
    } catch (e) {
      message.error('创建失败');
    }
  };

  /** 栏目动态发现：加载中显示 loading，失败或空列表回退「全部内容」并给出可见提示 */
  const loadColumns = useCallback(async (sourceId: string, refresh = false) => {
    setColumnLoading(true);
    setColumnError('');
    try {
      const d = await api.listSourceColumns(sourceId, refresh);
      const cols = d.columns || [];
      setRunColumns(cols);
      if (cols.length === 0) {
        setColumnError('该数据源暂未发现可选栏目，已回退为「全部内容」（可点「刷新栏目」重试）');
      }
    } catch (e) {
      setRunColumns([]);
      setColumnError('栏目加载失败，已回退为「全部内容」（可点「刷新栏目」重试）');
    } finally {
      setColumnLoading(false);
    }
  }, []);

  /** 栏目下拉选项：始终保留「全部内容」，适配器声明但未采到内容的栏目加注说明 */
  const columnOptions = useMemo(
    () => [
      { value: '', label: '全部内容' },
      ...runColumns.map((c) => ({
        value: c.value,
        label: c.origin === 'adapter' && c.count === 0 ? `${c.label}（暂未采集到内容）` : c.label,
      })),
    ],
    [runColumns],
  );

  /** 时间筛选折算结果（弹窗内预览与实际请求参数同源） */
  const runRange = useMemo<{ since?: string; until?: string }>(() => {
    if (runTimeRange === '7d') return { since: toDateStr(daysAgo(6)), until: toDateStr(daysAgo(0)) };
    if (runTimeRange === '30d') return { since: toDateStr(daysAgo(29)), until: toDateStr(daysAgo(0)) };
    if (runTimeRange === 'custom') {
      const start = runCustomRange?.[0]?.format('YYYY-MM-DD');
      const end = runCustomRange?.[1]?.format('YYYY-MM-DD');
      return { since: start || undefined, until: end || undefined };
    }
    return { since: undefined, until: undefined };
  }, [runTimeRange, runCustomRange]);

  const rangePreview = runRange.since && runRange.until
    ? `将按 ${runRange.since} ~ ${runRange.until} 过滤（按发布时间）`
    : runTimeRange === 'custom'
      ? '请选择完整的开始与结束日期（格式 YYYY-MM-DD）'
      : '不限时间：将采集该栏目当前可见的全部内容';

  const openRun = (record: CampusSource) => {
    setRunSource(record);
    setRunMaxPages(1);
    setRunColumn('');
    setRunTimeRange('all');
    setRunCustomRange(null);
    setRunOnlyNew(false);
    setRunMaxItems(null);
    setRunColumns([]);
    setColumnError('');
    setRunOpen(true);
    void loadColumns(record.id);
  };

  const confirmRun = async () => {
    if (!runSource) return;
    // 基本校验：自定义区间必须完整且 since <= until
    if (runTimeRange === 'custom') {
      if (!runRange.since || !runRange.until) {
        message.warning('请选择完整的自定义时间区间');
        return;
      }
      if (runRange.since > runRange.until) {
        message.warning('开始日期不能晚于结束日期');
        return;
      }
    }
    setRunLoading(true);
    try {
      const r = await api.runSource(runSource.id, runMaxPages, runColumn || undefined, {
        since: runRange.since,
        until: runRange.until,
        onlyNew: runOnlyNew,
        ...(runMaxItems !== null ? { maxItems: runMaxItems } : {}),
      });
      message.success(`已开始采集，任务 ${r.job_id}`);
      setRunOpen(false);
    } catch (e) {
      message.error('触发采集失败');
    } finally {
      setRunLoading(false);
    }
  };

  const onDelete = (record: CampusSource) => {
    // 为什么不用 Popconfirm：antd 基于锚点定位的浮层在本项目环境里会算出错误的水平偏移
    // （实测被放到 left=-13420px，整块跑到视口外，用户表现为"点删除没反应"；强制 resize
    // 也无法自我纠正）。项目此前踩过同类问题（右上角通知 Popover），结论一致：
    // 关键交互不要依赖锚点浮层，改用居中 Modal（纯 flex 居中，不依赖 rc-align）。
    Modal.confirm({
      title: '确认删除该数据源？',
      content: `「${record.name}」及其采集文档、知识对象、采集任务与变更记录会被一并清除，且不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          const r = await api.deleteSource(record.id);
          const c = r.cascade || {};
          message.success(
            `已删除（同时清理：文档 ${c.raw_documents ?? 0} · 知识对象 ${c.knowledge_objects ?? 0} · 采集任务 ${c.collection_jobs ?? 0}）`,
          );
          await load();
        } catch (e) {
          // 后端失败必须说出来：历史 bug 里这里没有 try/catch，500 被静默吞掉，
          // 用户看到的就是"删除按钮点了没反应"。
          message.error(`删除失败：${(e as Error)?.message || '未知错误'}`);
        }
      },
    });
  };

  const runDiscover = async () => {
    if (!discoverUrl.trim()) {
      message.warning('请输入官网 URL');
      return;
    }
    setDiscoverLoading(true);
    try {
      const r = await api.recommendSources(discoverUrl.trim());
      setDiscovered(r.recommended || []);
      setDiscoveredOrigin(discoverUrl.trim());
    } catch (e) {
      message.error('自动发现失败，请检查 URL 或网络');
      setDiscovered([]);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const addDiscovered = async (item: { name: string; url: string }) => {
    try {
      await api.createSource({ name: item.name, source_type: 'list_page', base_url: item.url });
      message.success(`已添加数据源「${item.name}」`);
      await load();
    } catch (e) {
      message.error('添加失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (name: string, record: CampusSource) => (
        <Space size={4}>
          <span>{name}</span>
          {isHomepageUrl(record.base_url) && (
            <Tooltip title={HOMEPAGE_HINT}>
              <Tag color="red">首页源</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: '类型', dataIndex: 'source_type', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: string) => <Tag color={statusColor(s)}>{s}</Tag>,
    },
    {
      // 与监控卡片统一：last_success_at ?? last_crawled_at（T13-6）
      title: '最近采集',
      key: 'last_collected',
      width: 200,
      render: (_: unknown, record: CampusSource) => <CollectedAt item={record} />,
    },
    {
      title: '操作',
      width: 220,
      render: (_: unknown, record: CampusSource) => (
        <Space>
          <Button size="small" type="primary" onClick={() => openRun(record)}>采集</Button>
          <Button size="small" danger onClick={() => onDelete(record)}>删除</Button>
        </Space>
      ),
    },
  ];

  const discoverColumns = [
    { title: '栏目/部门', dataIndex: 'name', ellipsis: true },
    { title: '推荐', dataIndex: 'value', width: 90, render: (v: string) => <Tag color={valueColor[v] || 'default'}>{valueZh[v] || v}</Tag> },
    { title: '分类', dataIndex: 'category', width: 100, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: '频率', dataIndex: 'frequency_hours', width: 80, render: (v: number) => (v ? `${v}h` : '-') },
    { title: 'URL', dataIndex: 'url', ellipsis: true, render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, r: { name: string; url: string }) => (
        <Button size="small" type="link" onClick={() => addDiscovered(r)}>添加</Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>数据源管理</Title>
        <Space>
          <Button icon={<CompassOutlined />} onClick={() => setDiscoverOpen(true)}>自动发现</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新增数据源</Button>
        </Space>
      </div>

      <Table rowKey="id" columns={columns} dataSource={sources} loading={loading} pagination={false} />

      {/* 数据源监控：自动巡检最近 7 天新增内容 */}
      <Card
        title={`数据源监控（近 ${monitor?.recent_days ?? 7} 天，共发现 ${monitor?.total_new ?? 0} 条新内容）`}
        style={{ marginTop: 16 }}
        extra={
          <Space size={8}>
            <Button size="small" loading={briefLoading} onClick={genBrief}>一键生成校务快讯</Button>
            <Button size="small" loading={monitorLoading} onClick={() => loadMonitor({ notify: true })}>刷新监控</Button>
          </Space>
        }
      >
        {monitor && monitor.items.length > 0 ? (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {monitor.items.map((m) => (
              <div key={m.source_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
                <Tag color={m.new_count > 0 ? 'red' : 'default'}>{m.new_count} 条新增</Tag>
                <span style={{ fontWeight: 600, width: 160 }}>{m.name}</span>
                <span style={{ flex: 1, color: '#888', fontSize: 12 }}>
                  {recentTitlesLabel(m.recent_titles)}
                </span>
                <span style={{ color: '#999', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <CollectedAt item={m} prefix="最近采集 " />
                </span>
              </div>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">暂无数据源，或近 7 天没有新内容。</Typography.Text>
        )}
        {brief && (
          <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>校务快讯（LLM 巡检）</div>
            <DashboardMarkdown content={brief.content} />
          </div>
        )}
      </Card>

      {/* 新增数据源 */}
      <Modal title="新增数据源" open={open} onOk={onCreate} onCancel={() => setOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ source_type: 'website' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 广州大学通知公告" />
          </Form.Item>
          <Form.Item name="source_type" label="类型">
            <Select
              options={[
                { value: 'website', label: '官网/网站' },
                { value: 'list_page', label: '通知公告列表页' },
                { value: 'file', label: '上传文件' },
                { value: 'manual', label: '手动录入' },
                { value: 'api', label: 'API' },
              ]}
            />
          </Form.Item>
          <Form.Item name="base_url" label="URL（网站/列表页填）">
            <Input placeholder="https://www.gzhu.edu.cn/z__l/tzgg.htm" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 自动发现 */}
      <Modal
        title="AI 智能推荐数据源"
        open={discoverOpen}
        onCancel={() => setDiscoverOpen(false)}
        footer={null}
        width={860}
        destroyOnClose
      >
        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="输入官网 URL，如 https://www.gzhu.edu.cn"
            value={discoverUrl}
            onChange={(e) => setDiscoverUrl(e.target.value)}
            onPressEnter={runDiscover}
          />
          <Button type="primary" onClick={runDiscover} loading={discoverLoading}>智能推荐</Button>
        </Space.Compact>

        {discovered.length === 0 && (
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>默认推荐站点（广州大学，点击「添加」即可）：</Typography.Text>
            <Table rowKey="url" columns={discoverColumns} dataSource={DEFAULT_SITES} pagination={false} size="small" style={{ marginTop: 12 }} />
          </div>
        )}

        {discovered.length > 0 && (
          <div>
            <Typography.Text type="secondary">从 {discoveredOrigin} 智能推荐 {discovered.length} 个候选校务源（LLM 筛高价值 + 分类 + 建议采集频率）：</Typography.Text>
            <Table rowKey="url" columns={discoverColumns} dataSource={discovered} pagination={false} size="small" style={{ marginTop: 12 }} />
          </div>
        )}
      </Modal>

      {/* 采集弹窗 */}
      <Modal
        title={`采集「${runSource?.name || ''}」`}
        open={runOpen}
        onOk={confirmRun}
        okText="确认采集"
        confirmLoading={runLoading}
        onCancel={() => setRunOpen(false)}
        destroyOnClose
      >
        <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fafafa', borderRadius: 6, fontSize: 13 }}>
          <div><b>{runSource?.name}</b> <span style={{ color: '#888', fontSize: 12 }}>{runSource?.source_type}</span></div>
          <div style={{ color: '#888', fontSize: 12, wordBreak: 'break-all' }}>{runSource?.base_url || '-'}</div>
          {isHomepageUrl(runSource?.base_url) && (
            <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>⚠ {HOMEPAGE_HINT}</div>
          )}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>采集页数档位</div>
          <Radio.Group
            options={PAGE_OPTIONS}
            value={runMaxPages}
            onChange={(e) => setRunMaxPages(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>采集内容筛选（栏目）</div>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              style={{ width: '100%' }}
              value={runColumn}
              onChange={setRunColumn}
              options={columnOptions}
              loading={columnLoading}
              placeholder="全部内容"
            />
            <Button
              icon={<ReloadOutlined />}
              loading={columnLoading}
              onClick={() => { if (runSource) void loadColumns(runSource.id, true); }}
            >
              刷新栏目
            </Button>
          </Space.Compact>
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            栏目清单来自该数据源的真实采集分布，括号内为已采集条数。
          </div>
          {columnError && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>{columnError}</Typography.Text>
          )}
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>发布时间筛选</div>
          <Radio.Group
            options={TIME_RANGE_OPTIONS}
            value={runTimeRange}
            onChange={(e) => setRunTimeRange(e.target.value as TimeRangeKey)}
            optionType="button"
            buttonStyle="solid"
          />
          {runTimeRange === 'custom' && (
            <div style={{ marginTop: 8 }}>
              <DatePicker.RangePicker
                format="YYYY-MM-DD"
                value={runCustomRange}
                onChange={(dates) => setRunCustomRange(dates)}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 12, color: '#888' }}>
            近 7 天 = 今天往前 6 天到今天（含首尾）；只采发布时间落在区间内的内容。
          </div>
          <div style={{ marginTop: 6, padding: '6px 10px', background: '#f6ffed', borderRadius: 6, fontSize: 12, color: '#389e0d' }}>
            {rangePreview}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <Checkbox
            checked={runOnlyNew}
            disabled={!runSource?.last_success_at}
            onChange={(e) => setRunOnlyNew(e.target.checked)}
          >
            仅采集晚于上次成功采集的新内容
          </Checkbox>
          <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
            {runSource?.last_success_at
              ? `上次成功采集：${formatDateTime(runSource.last_success_at)}`
              : '该源尚无成功采集记录'}
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>单次入库上限（可选）</div>
          <InputNumber
            min={1}
            max={500}
            value={runMaxItems}
            onChange={(v) => setRunMaxItems(v ?? null)}
            placeholder="默认由后端决定（200）"
            style={{ width: 260 }}
          />
        </div>
        <div style={{ padding: '10px 12px', background: '#f6ffed', borderRadius: 6, fontSize: 12, lineHeight: 1.7 }}>
          <b style={{ color: '#52c41a' }}>采集说明：</b>
          采集会逐页抓取并对比页面内容。内容未变化自动跳过；发生变化则生成新版本知识对象、自动记录变更并纳入变更雷达。建议先选「1 页（仅最新）」试跑，确认站点可访问后再扩大页数。
        </div>
      </Modal>
    </div>
  );
}
