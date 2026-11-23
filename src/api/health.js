import request from "@/api/request";

/**
 * @file 服务健康探针（api-2-health-checks.md）。
 *
 * 本模块是 `api/` 下唯一**不返回统一信封**的接口：`/healthz` 直接返回扁平 JSON，
 * 没有 `{ ok, data, req_id }`（响应里的 `ok` 是服务自身字段，不是信封字段）。
 *
 * - 接口：`GET /api-mist/healthz`（反代把它映射到 `/api/healthz`，与 `/healthz` 同一份响应）
 * - 鉴权：无（不读访问令牌，只探测服务是否可用）
 * - 副作用：无；默认只做轻量存活检查，深度检查要 `?deep=1`（本封装不传）
 *
 */

/**
 * `request` 抛出的接口错误。
 * @typedef {Error & { status: number, code: string, reasonCode: string, payload: Object }} ApiError
 */

/**
 * 存活探针响应。
 * @typedef {Object} HealthProbeResult
 * @property {boolean} ok 服务可用时一般为 `true`（业务字段，不是统一信封）
 * @property {string} service 服务名，如 `mistarg-api`
 * @property {string} version 后端版本号
 * @property {string} env 运行环境，如 `production`
 * @property {number} uptime_s 进程已运行秒数
 * @property {number} pid 进程 id
 * @property {number} rss_mb 常驻内存（MB）
 */

/**
 * 探测服务是否可用（注册页状态条用）。
 *
 * - 接口：`GET /api-mist/healthz`
 * - 鉴权：无
 * - 文档：api-2-health-checks.md §2.1
 *
 * 只用于轻量存活检查。
 *
 * @returns {Promise<HealthProbeResult>} 扁平响应体（**没有** `data` 包裹）
 * @throws {ApiError}
 *   - 非 2xx（如服务端返回 503）：`error.status` / `error.payload` 可用于展示或上报
 *   - 网络层失败：`fetch` 直接抛出 `TypeError`，调用方按「服务不可用」处理
 */
export async function probeHealth() {
  return request("/api-mist/healthz", {
    method: "GET",
  });
}

export default probeHealth;
