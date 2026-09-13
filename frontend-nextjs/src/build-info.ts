/**
 * 构建信息（REFACTOR_PLAN_V2_2 A2）
 *
 * 单一真源是构建期环境变量 APP_BUILD（由 docker compose 同时注入后端与前端构建参数）；
 * 运行时可与后端 `GET /api/v1/version` 的 build 字段比对，判断"前后端是否同一构建"。
 *
 * 为什么要它：本项目出现过"容器里已是新代码、全新加载页面验证通过，但用户已打开的标签页
 * 跑的是旧 bundle，于是双方各说各话"。把构建标识显示在界面上并让探针可断言，可一眼分辨
 * "没生效"还是"没刷新"。
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "2.2.0";
export const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV || "development";
