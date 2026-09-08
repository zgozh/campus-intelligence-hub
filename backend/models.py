import hashlib
import uuid

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Integer,
    Text,
    Boolean,
    ForeignKey,
    JSON,
    Enum as SQLEnum,
    Index,
    Float,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from config import DEFAULT_AGENT_MAX_TOKENS, DEFAULT_AGENT_SIMILARITY_THRESHOLD


def normalize_url(url: str) -> str:
    """规范化URL（去重用）"""
    url = url.strip().lower()
    # 移除末尾斜杠
    if url.endswith("/"):
        url = url[:-1]
    # 移除www前缀
    if url.startswith("https://www."):
        url = url.replace("https://www.", "https://", 1)
    elif url.startswith("http://www."):
        url = url.replace("http://www.", "http://", 1)
    return url


def compute_content_hash(content: str) -> str:
    """计算内容哈希（用于去重）"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


class Workspace(Base):
    """工作空间模型"""

    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, default="Default Workspace")
    owner_email = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    agents = relationship(
        "Agent", back_populates="workspace", cascade="all, delete-orphan"
    )
    quotas = relationship("WorkspaceQuota", back_populates="workspace", uselist=False)
    admin_users = relationship("AdminUser", back_populates="workspace")


class Agent(Base):
    """Agent模型"""

    __tablename__ = "agents"

    id = Column(
        String(50), primary_key=True, default=lambda: f"agt_{uuid.uuid4().hex[:12]}"
    )
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=False, index=True
    )

    # 基本信息
    name = Column(String(100), nullable=False, default="AI Agent")
    description = Column(Text, nullable=True)
    agent_type = Column(String(50), nullable=False, default="website_support")
    channel_mode = Column(String(50), nullable=False, default="web_widget")
    avatar = Column(String(500), nullable=True)

    # LLM配置
    system_prompt = Column(
        Text, nullable=False, default="You are a helpful customer service assistant."
    )
    model = Column(String(100), nullable=False, default="gpt-4o-mini")
    temperature = Column(Float, nullable=False, default=0.7)
    max_tokens = Column(Integer, nullable=False, default=DEFAULT_AGENT_MAX_TOKENS)

    # API配置
    api_key = Column(String(500), nullable=True)
    api_base = Column(String(500), nullable=True, default="https://api.openai.com/v1")

    # Jina Embedding API Key
    jina_api_key = Column(String(500), nullable=True)

    # SiliconFlow Embedding API Key
    siliconflow_api_key = Column(String(500), nullable=True)

    # AI服务商配置
    provider_type = Column(
        SQLEnum(
            "openai",
            "openai_native",
            "google",
            "anthropic",
            "xai",
            "openrouter",
            "zai",
            "deepseek",
            "volcengine",
            "moonshot",
            "aliyun_bailian",
            "siliconflow",
            name="llm_provider",
        ),
        nullable=True,
        default="openai",
    )

    # Azure OpenAI特定配置
    azure_endpoint = Column(String(500), nullable=True)
    azure_deployment_name = Column(String(100), nullable=True)
    azure_api_version = Column(String(20), nullable=True)

    # Anthropic特定配置
    anthropic_version = Column(String(20), nullable=True, default="2023-06-01")

    # Google特定配置
    google_project_id = Column(String(100), nullable=True)
    google_region = Column(String(50), nullable=True)

    # 通用提供商配置
    provider_config = Column(JSON, nullable=True)

    # 嵌入配置
    embedding_provider = Column(String(20), nullable=False, default="jina")
    embedding_api_base = Column(String(500), nullable=True)
    embedding_model = Column(String(100), nullable=False, default="jina-embeddings-v3")
    embedding_batch_size = Column(Integer, nullable=False, default=4)
    # 知识库初始化状态
    kb_setup_completed = Column(Boolean, nullable=False, default=False)
    # URL抓取配置
    crawl_max_depth = Column(Integer, nullable=False, default=2)  # 全站爬取深度
    crawl_max_pages = Column(Integer, nullable=False, default=20)  # 全站爬取最大页面数
    url_fetch_interval_days = Column(
        Integer, nullable=False, default=7
    )  # URL自动抓取间隔（天）
    enable_auto_fetch = Column(
        Boolean, nullable=False, default=False
    )  # 是否启用自动抓取

    # 检索配置
    top_k = Column(Integer, nullable=False, default=8)
    similarity_threshold = Column(
        Float, nullable=False, default=DEFAULT_AGENT_SIMILARITY_THRESHOLD
    )
    enable_context = Column(Boolean, nullable=False, default=False)

    # AI对话限制配置
    rate_limit_per_minute = Column(
        Integer, nullable=False, default=20
    )  # 每分钟对话限制（0表示不限制）
    restricted_reply = Column(
        Text, nullable=True, default="抱歉，当前服务受限，请稍后再试。"
    )  # 自动回复（速率限制、AI 服务异常等场景）
    last_error_code = Column(String(50), nullable=True)
    last_error_message = Column(Text, nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    allowed_widget_origins = Column(JSON, nullable=True, default=None)

    # 人设类型
    persona_type = Column(
        String(20), nullable=False, default="general"
    )  # general, customer-service, sales, custom

    # Widget 配置
    widget_title = Column(String(100), nullable=True, default="AI 客服")
    widget_color = Column(String(20), nullable=True, default="#06B6D4")
    welcome_message = Column(
        Text, nullable=True, default="您好！我是Basjoo助手，有什么可以帮您的吗？"
    )
    history_days = Column(Integer, nullable=False, default=30)

    # 状态
    is_active = Column(Boolean, default=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    purge_after = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 知识库关联（新增）
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=True, index=True
    )

    # 关系
    workspace = relationship("Workspace", back_populates="agents")
    url_sources = relationship(
        "URLSource", back_populates="agent", cascade="all, delete-orphan"
    )
    knowledge_files = relationship(
        "KnowledgeFile", back_populates="agent", cascade="all, delete-orphan"
    )
    chat_sessions = relationship(
        "ChatSession", back_populates="agent", cascade="all, delete-orphan"
    )
    members = relationship(
        "AgentMember", back_populates="agent", cascade="all, delete-orphan"
    )
    knowledge_base = relationship("KnowledgeBase", back_populates="agents")


class URLSource(Base):
    """URL知识源模型"""

    __tablename__ = "url_sources"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # URL信息
    url = Column(String(1000), nullable=False, index=True)
    normalized_url = Column(String(1000), nullable=False, index=True)  # 规范化后的URL

    # 抓取状态
    status = Column(
        SQLEnum("pending", "fetching", "success", "failed", name="url_status"),
        default="pending",
        index=True,
    )
    last_fetch_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)

    # 抓取内容
    title = Column(String(500), nullable=True)
    content = Column(Text, nullable=True)  # 清洗后的正文
    content_hash = Column(String(64), nullable=True)  # 用于去重

    # 元数据
    fetch_metadata = Column(
        JSON, nullable=True
    )  # etag, last_modified, content_length等
    is_indexed = Column(Boolean, nullable=False, default=False)  # 是否已训练
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="url_sources")

    # 索引和约束
    __table_args__ = (
        Index("ix_url_sources_agent_status", "agent_id", "status"),
        UniqueConstraint("agent_id", "normalized_url", name="uq_agent_normalized_url"),
    )


class KnowledgeFile(Base):
    """知识文件模型"""

    __tablename__ = "knowledge_files"

    id = Column(
        String(50), primary_key=True, default=lambda: f"kf_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 文件信息
    filename = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)  # bytes
    file_type = Column(String(50), nullable=True)  # pdf, txt, csv, etc.

    # 状态
    status = Column(
        SQLEnum(
            "uploading", "processing", "ready", "failed", "pending", name="file_status"
        ),
        default="uploading",
        index=True,
    )
    error_message = Column(Text, nullable=True)

    # 元数据
    metadata_json = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="knowledge_files")

    # 索引
    __table_args__ = (Index("ix_knowledge_files_agent", "agent_id"),)


class ChatSession(Base):
    """聊天会话模型"""

    __tablename__ = "chat_sessions"

    id = Column(
        String(50), primary_key=True, default=lambda: f"sess_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 会话标识
    session_id = Column(
        String(100), nullable=False, index=True
    )  # 客户端提供的session_id
    locale = Column(String(10), nullable=True, default="zh-CN")

    # 访客信息
    visitor_id = Column(String(100), nullable=True, index=True)  # 访客标识
    visitor_ip = Column(String(50), nullable=True)  # 访客 IP
    visitor_user_agent = Column(String(500), nullable=True)  # 访客浏览器信息
    visitor_country = Column(String(50), nullable=True)  # 访客国家
    visitor_region = Column(String(50), nullable=True)  # 访客省份/地区
    visitor_city = Column(String(50), nullable=True)  # 访客城市

    # 会话状态: active-活跃, taken_over-已接管, closed-已关闭
    status = Column(String(20), nullable=False, default="active", index=True)

    # 统计
    message_count = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="chat_sessions")
    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )

    # 索引
    __table_args__ = (
        Index(
            "uq_chat_sessions_active_session",
            "agent_id",
            "session_id",
            unique=True,
            sqlite_where=text("status != 'closed'"),
        ),
        Index("ix_chat_sessions_agent_session", "agent_id", "session_id"),
        Index("ix_chat_sessions_updated", "updated_at"),
    )


class ChatMessage(Base):
    """聊天消息模型"""

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        String(50), ForeignKey("chat_sessions.id"), nullable=False, index=True
    )

    # 消息内容
    role = Column(
        SQLEnum("user", "assistant", "system", name="message_role"), nullable=False
    )
    content = Column(Text, nullable=False)

    # 发送者信息（用于区分人工和 Agent）
    sender_type = Column(String(20), nullable=True)  # 'agent', 'human'
    sender_id = Column(String(50), nullable=True)  # 管理员ID（人工发送时）

    # 引用来源
    sources = Column(
        JSON, nullable=True
    )  # [{"type": "url", "title": "...", "url": "...", "snippet": "..."}]

    # Token使用
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    session = relationship("ChatSession", back_populates="messages")

    # 索引
    __table_args__ = (
        Index("ix_chat_messages_session_created", "session_id", "created_at"),
    )


class WorkspaceQuota(Base):
    """工作空间配额模型"""

    __tablename__ = "workspace_quotas"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=False, unique=True, index=True
    )

    # 配额限制
    max_agents = Column(Integer, default=10)
    max_urls = Column(Integer, default=500)
    max_qa_items = Column(Integer, default=100)
    max_messages_per_day = Column(Integer, default=1500)
    max_total_text_mb = Column(Integer, default=20)  # 最大文本量MB

    # 当前使用量
    used_urls = Column(Integer, default=0)
    used_qa_items = Column(Integer, default=0)
    used_messages_today = Column(Integer, default=0)
    used_total_text_mb = Column(Float, default=0.0)

    # 重置时间
    last_message_reset = Column(DateTime(timezone=True), nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    workspace = relationship("Workspace", back_populates="quotas")


class AgentMember(Base):
    """Per-agent admin membership."""

    __tablename__ = "agent_members"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    admin_user_id = Column(
        Integer, ForeignKey("admin_users.id"), nullable=False, index=True
    )
    role = Column(String(50), default="admin", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    agent = relationship("Agent", back_populates="members")
    admin_user = relationship("AdminUser", back_populates="agent_members")

    __table_args__ = (
        UniqueConstraint("agent_id", "admin_user_id", name="uq_agent_member_admin"),
    )


class IndexJob(Base):
    """索引构建任务模型"""

    __tablename__ = "index_jobs"

    id = Column(
        String(50), primary_key=True, default=lambda: f"job_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 任务信息
    job_type = Column(
        SQLEnum("full", "incremental", "url_refetch", name="job_type"), nullable=False
    )
    status = Column(
        SQLEnum("queued", "running", "completed", "failed", name="job_status"),
        default="queued",
        index=True,
    )

    # 任务参数
    params = Column(JSON, nullable=True)  # {"url_ids": [...], "force": true}

    # 执行结果
    result = Column(JSON, nullable=True)  # {"chunks_indexed": 100, "errors": []}
    error_message = Column(Text, nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # 索引
    __table_args__ = (
        Index("ix_jobs_agent_status", "agent_id", "status"),
        Index("ix_jobs_created", "created_at"),
    )


class AdminUser(Base):
    """管理员用户模型（用于管理后台登录）"""

    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    role = Column(String(50), default="admin", nullable=False)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=True, index=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    workspace = relationship("Workspace", back_populates="admin_users")
    agent_members = relationship(
        "AgentMember", back_populates="admin_user", cascade="all, delete-orphan"
    )


class Tenant(Base):
    """租户表（多租户顶层）"""

    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    plan = Column(String(20), nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    knowledge_bases = relationship(
        "KnowledgeBase", back_populates="tenant", cascade="all, delete-orphan"
    )


class KnowledgeBase(Base):
    """知识库表（每 agent 独立 KB）"""

    __tablename__ = "knowledge_bases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    embedding_model = Column(String(100), nullable=False, default="BAAI/bge-m3")
    embedding_base_url = Column(String(500), nullable=True)
    vector_backend = Column(String(20), nullable=False, default="qdrant")
    qdrant_collection = Column(String(50), unique=True, nullable=False, index=True)
    is_locked = Column(
        Boolean, nullable=False, default=False
    )  # 有 chunk 后锁定 embedding 配置
    chunk_size = Column(Integer, nullable=False, default=512)
    chunk_overlap = Column(Integer, nullable=False, default=64)
    status = Column(
        SQLEnum(
            "active",
            "resetting",
            "processing",
            "error",
            name="kb_status",
        ),
        default="active",
        nullable=False,
        index=True,
    )
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="knowledge_bases")
    documents = relationship(
        "KbDocument", back_populates="knowledge_base", cascade="all, delete-orphan"
    )
    agents = relationship("Agent", back_populates="knowledge_base")


class KbDocument(Base):
    """文档表"""

    __tablename__ = "kb_documents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )
    tenant_id = Column(
        String(36), ForeignKey("tenants.id"), nullable=False, index=True
    )  # 冗余，方便过滤
    filename = Column(String(500), nullable=False)
    file_type = Column(String(20), nullable=True)
    status = Column(
        SQLEnum("pending", "processing", "ready", "error", name="kb_doc_status"),
        default="pending",
        index=True,
    )
    chunk_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    file_size = Column(Integer, nullable=True)
    storage_path = Column(String(1000), nullable=True)
    # Metadata for document source info (e.g., URL for crawled pages)
    metadata_json = Column(JSON, nullable=True, default=None)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    knowledge_base = relationship("KnowledgeBase", back_populates="documents")
    chunks = relationship(
        "KbChunk", back_populates="document", cascade="all, delete-orphan"
    )


class KbChunk(Base):
    """Chunk 元数据表"""

    __tablename__ = "kb_chunks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )
    doc_id = Column(
        String(36), ForeignKey("kb_documents.id"), nullable=False, index=True
    )
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=False, index=True)
    vector_id = Column(String(100), nullable=True, index=True)  # Qdrant point id
    chunk_index = Column(Integer, nullable=False)
    content_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("KbDocument", back_populates="chunks")


class Source(Base):
    """校务数据源模型（spec §6.2）"""

    __tablename__ = "sources"

    id = Column(
        String(50), primary_key=True, default=lambda: f"src_{uuid.uuid4().hex[:12]}"
    )
    name = Column(String(200), nullable=False)
    source_type = Column(
        SQLEnum("manual", "website", "list_page", "file", "api", name="source_type"),
        nullable=False,
        default="website",
        index=True,
    )
    base_url = Column(String(1000), nullable=True)
    crawl_frequency = Column(Integer, nullable=False, default=24)  # 采集间隔（小时）
    max_pages = Column(Integer, nullable=False, default=1)  # 单次采集页数档位（0=全部封顶50）
    authority = Column(Float, nullable=False, default=0.9)  # 来源权威度（配置化，#22）
    status = Column(
        SQLEnum("active", "paused", "error", name="source_status"),
        nullable=False,
        default="active",
        index=True,
    )
    last_crawled_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    jobs = relationship(
        "CollectionJob", back_populates="source", cascade="all, delete-orphan"
    )


class CollectionJob(Base):
    """采集任务模型（spec §6.3）"""

    __tablename__ = "collection_jobs"

    id = Column(
        String(50), primary_key=True, default=lambda: f"cjob_{uuid.uuid4().hex[:12]}"
    )
    source_id = Column(String(50), ForeignKey("sources.id"), nullable=False, index=True)
    status = Column(
        SQLEnum(
            "PENDING", "RUNNING", "SUCCESS", "FAILED", "PARTIAL",
            name="collection_job_status",
        ),
        nullable=False,
        default="PENDING",
        index=True,
    )
    stage_trace = Column(JSON, nullable=True)  # Fetch/Parse/Clean/Classify/Dedup/Index 各阶段
    params = Column(JSON, nullable=True)
    result = Column(JSON, nullable=True)  # {"fetched": n, "indexed": n, "errors": []}
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    source = relationship("Source", back_populates="jobs")


class RawDocument(Base):
    """采集到的原始文档（spec §24 RawDocument）。"""

    __tablename__ = "raw_documents"

    id = Column(
        String(50), primary_key=True, default=lambda: f"rdoc_{uuid.uuid4().hex[:12]}"
    )
    source_id = Column(String(50), ForeignKey("sources.id"), nullable=False, index=True)
    url = Column(String(1000), nullable=False, index=True)
    normalized_url = Column(String(1000), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    canonical_title = Column(String(500), nullable=True, index=True)  # 规范化标题（版本匹配）
    content = Column(Text, nullable=True)  # 清洗后正文
    content_hash = Column(String(64), nullable=True, index=True)  # 去重
    version = Column(Integer, nullable=False, default=1)  # 版本号（标题同、正文异时 +1）
    publish_time = Column(String(20), nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())
    source_site = Column(String(50), nullable=True)
    column = Column(String(50), nullable=True)
    department = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    source = relationship("Source", backref="documents")


class KnowledgeObject(Base):
    """知识对象（spec §8.1，原创核心）。"""

    __tablename__ = "knowledge_objects"

    id = Column(
        String(50), primary_key=True, default=lambda: f"ko_{uuid.uuid4().hex[:12]}"
    )
    raw_document_id = Column(
        String(50), ForeignKey("raw_documents.id"), nullable=True, index=True
    )
    type = Column(String(30), nullable=False, default="Announcement", index=True)
    title = Column(String(500), nullable=False)
    department = Column(String(100), nullable=True)
    effective_from = Column(String(20), nullable=True)
    effective_to = Column(String(20), nullable=True)
    entities = Column(JSON, nullable=True)  # [{"name":..., "type":...}]
    facts = Column(JSON, nullable=True)  # [{"field":..., "value":...}]
    summary = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)  # [tag1, ...]
    relations = Column(JSON, nullable=True)  # [{"target":..., "relation":...}]
    confidence = Column(Float, nullable=True, default=0.8)
    status = Column(
        String(20), nullable=False, default="PUBLISHED", index=True
    )  # DISCOVERED/PROCESSING/REVIEW_REQUIRED/PUBLISHED/UPDATED/EXPIRED/ARCHIVED
    version = Column(Integer, nullable=False, default=1)
    source_url = Column(String(1000), nullable=True)
    authority = Column(Float, nullable=True, default=0.8)  # 来源权威度（配置化，用于融合检索）
    freshness_level = Column(String(20), nullable=False, default="Unknown")  # Fresh/Aging/Stale/Unknown
    source_version = Column(Integer, nullable=False, default=1)  # 对应 SourceVersion
    last_verified_at = Column(DateTime(timezone=True), nullable=True)  # 最近核实/更新时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    raw_document = relationship("RawDocument", backref="knowledge_objects")


class Conflict(Base):
    """知识冲突（spec §14 / §24 Conflict）。"""

    __tablename__ = "conflicts"

    id = Column(
        String(50), primary_key=True, default=lambda: f"cf_{uuid.uuid4().hex[:12]}"
    )
    object_a = Column(String(50), nullable=False)  # KnowledgeObject id
    object_b = Column(String(50), nullable=False)  # KnowledgeObject id
    field = Column(String(50), nullable=False)  # 冲突字段（如 截止日期）
    value_a = Column(String(200), nullable=True)
    value_b = Column(String(200), nullable=True)
    confidence = Column(Float, nullable=True, default=0.8)
    status = Column(String(20), nullable=False, default="open", index=True)  # open/resolved
    resolved_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class ReviewTask(Base):
    """审核任务（spec §20 / §24 ReviewTask）。"""

    __tablename__ = "review_tasks"

    id = Column(
        String(50), primary_key=True, default=lambda: f"rt_{uuid.uuid4().hex[:12]}"
    )
    knowledge_object_id = Column(
        String(50), ForeignKey("knowledge_objects.id"), nullable=False, index=True
    )
    reason = Column(String(50), nullable=False)  # low_confidence / conflict
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending/approved/rejected
    note = Column(Text, nullable=True)
    reviewed_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    reviewed_at = Column(DateTime(timezone=True), nullable=True)


class Digest(Base):
    """自动日报/周报（spec §13 / §24 Digest）。"""

    __tablename__ = "digests"

    id = Column(
        String(50), primary_key=True, default=lambda: f"dg_{uuid.uuid4().hex[:12]}"
    )
    period = Column(String(20), nullable=False, default="daily")  # daily/weekly
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)  # Markdown
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChangeEvent(Base):
    """变更事件（spec §33）：自动采集发现的页面变化，支撑 Change Radar / Diff Viewer。

    由采集对比前后两个版本触发：标题/正文/日期变化 + 严重度 + diff 摘要。
    """

    __tablename__ = "change_events"

    id = Column(
        String(50), primary_key=True, default=lambda: f"ce_{uuid.uuid4().hex[:12]}"
    )
    source_id = Column(String(50), ForeignKey("sources.id"), nullable=False, index=True)
    normalized_url = Column(String(1000), nullable=False, index=True)
    old_raw_document_id = Column(String(50), nullable=True)
    new_raw_document_id = Column(String(50), nullable=True)
    old_version = Column(Integer, nullable=True)
    new_version = Column(Integer, nullable=True)
    change_type = Column(JSON, nullable=True)  # ["TITLE_CHANGED","CONTENT_CHANGED","DATE_CHANGED"]
    severity = Column(String(20), nullable=False, default="LOW")  # HIGH/MEDIUM/LOW
    diff_summary = Column(Text, nullable=True)  # 人类可读的变更摘要
    content_hash = Column(String(64), nullable=True)  # 新版本内容 hash
    requires_review = Column(Boolean, nullable=False, default=True)
    detected_at = Column(DateTime(timezone=True), server_default=func.now())


class KGEntity(Base):
    """知识图谱实体（spec 增强 A：校务知识图谱，参考 DocPolicyKG/UniAI-GraphRAG）。"""

    __tablename__ = "kg_entities"

    id = Column(
        String(50), primary_key=True, default=lambda: f"e_{uuid.uuid4().hex[:12]}"
    )
    name = Column(String(200), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False, default="对象")  # 部门/政策/事件/对象/时间/文件
    ko_id = Column(String(50), nullable=True)  # 来源知识对象
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KGRelation(Base):
    """知识图谱关系（head -relation-> tail 三元组）。"""

    __tablename__ = "kg_relations"

    id = Column(
        String(50), primary_key=True, default=lambda: f"r_{uuid.uuid4().hex[:12]}"
    )
    head_id = Column(String(50), ForeignKey("kg_entities.id"), nullable=False, index=True)
    tail_id = Column(String(50), ForeignKey("kg_entities.id"), nullable=False, index=True)
    relation = Column(String(50), nullable=False)  # 发布/废止/修订/适用/隶属/关联/截止
    ko_id = Column(String(50), nullable=True)  # 来源知识对象
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InsightReport(Base):
    """AI 校务洞察报告（F）：由运营数据 + LLM 生成的洞察叙事，定时/手动均可落地存储。"""

    __tablename__ = "insight_reports"

    id = Column(
        String(50), primary_key=True, default=lambda: f"ins_{uuid.uuid4().hex[:12]}"
    )
    content = Column(Text, nullable=False)  # Markdown 洞察叙事
    data = Column(JSON, nullable=True)  # 生成时的运营数据快照
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BriefReport(Base):
    """校务快讯（自动化巡检）：按来源/部门汇总近 N 天新增内容 + 重要变更 + 临期提醒。"""

    __tablename__ = "brief_reports"

    id = Column(
        String(50), primary_key=True, default=lambda: f"br_{uuid.uuid4().hex[:12]}"
    )
    content = Column(Text, nullable=False)  # Markdown 校务快讯
    data = Column(JSON, nullable=True)  # 生成时的监控数据快照
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """站内通知（主动推送）：校务快讯 / 洞察 / 临期等自动推送。"""

    __tablename__ = "notifications"

    id = Column(
        String(50), primary_key=True, default=lambda: f"ntf_{uuid.uuid4().hex[:12]}"
    )
    kind = Column(String(30), nullable=False)  # brief / insight / expiring / system
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=True)  # markdown 摘要
    read = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class DecisionLog(Base):
    """Agent 决策日志（可视化时间线）：三层闭环每层 Agent 的决策记录。"""

    __tablename__ = "decision_logs"

    id = Column(
        String(50), primary_key=True, default=lambda: f"dec_{uuid.uuid4().hex[:12]}"
    )
    run_id = Column(String(50), nullable=False, index=True)  # 一次闭环运行的决策分组
    agent = Column(String(50), nullable=False)  # 采集/知识治理/问答运营/…
    decision = Column(String(200), nullable=False)  # 简短决策
    detail = Column(Text, nullable=True)  # 说明
    status = Column(String(20), nullable=False, default="ok")  # ok/partial/error/skip
    created_at = Column(DateTime(timezone=True), server_default=func.now())
