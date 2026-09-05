/**
 * @file scripts/web_runner.js
 * @description P1-11: Web 看板与健康监控独立进程瘦入口
 *
 * 职责所有权 (纯只读通道，独占 8085 端口与 Tunnel):
 * 1. Express 托管 public/ 静态资产与前端看板
 * 2. 对外输出全局健康检查 GET /health (集成 Ingest 心跳 90s/180s 状态机)
 * 3. 对外输出 GET /api/monitoring/dashboard 只读看板数据
 * 4. 数据库全部以 readonly: true 模式挂载
 *
 * 铁律约束:
 * - READONLY_MODE=1
 * - 绝不加载 persona-engine / news-engine 重型 AI 模块
 * - 绝不启动 startPoller / startQueueWorker / 推送链路
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getReadOnlyArchiveDb, getReadOnlyMonitoringDb } from '../monitoring/db-readonly.js';
import { getIngestHeartbeat } from '../monitoring/monitoring-db.js';
import { evaluateIngestStatus } from '../monitoring/ingest-health.js';
import { buildHealthPayload, registerIngestHeartbeatDbGetter } from '../monitoring/health.js';
import { handleDashboardApi } from '../monitoring/dashboard-api.js';
import { readonlyRouter, readonlyWriteBlockerMiddleware } from '../monitoring/readonly-api-router.js';
import { startCloudflareTunnel } from '../monitoring/tunnel-launcher.js';
import { dashboardBasicAuthMiddleware } from '../monitoring/dashboard-basic-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.ROLE = 'web_dashboard';
process.env.READONLY_MODE = '1';

// 强制 /health 聚合走只读 monitoring 句柄，避免误开写连接（R3 / 单写）
registerIngestHeartbeatDbGetter(() => getReadOnlyMonitoringDb());

const app = express();
const PORT = parseInt(process.env.PORT || '8085', 10);

app.use(express.json());

// 与现网 server.js 对齐：DASHBOARD_USERNAME/PASSWORD Basic Auth（未配置则放行）
app.use(dashboardBasicAuthMiddleware);

app.use(express.static(path.resolve('public')));

// 全局写操作物理拦截中间件 (拦截非 GET/HEAD/OPTIONS 请求返回 403)
app.use(readonlyWriteBlockerMiddleware);

// 挂载只读路由集
app.use(readonlyRouter);

/**
 * GET /health
 * 聚合系统基础健康 + Ingest 跨进程心跳
 */
app.get('/health', async (req, res) => {
  try {
    // 1. 基础系统与探针体征
    const baseHealth = buildHealthPayload();

    // 2. Ingest 进程心跳与假死探测
    const monDb = getReadOnlyMonitoringDb();
    const heartbeat = getIngestHeartbeat('primary', { dbInstance: monDb });
    const ingestHealth = evaluateIngestStatus({ heartbeat });

    // 3. 聚合判定：仅 critical 返回 503；warn 保持 200（可观测 ≠ 看板假死）
    const isIngestCritical = ingestHealth.status === 'critical';
    const isBaseCritical = baseHealth.status === 'critical';

    let overallStatus = 'ok';
    if (isIngestCritical || isBaseCritical) {
      overallStatus = 'critical';
    } else if (ingestHealth.status === 'warn' || baseHealth.status === 'warn') {
      overallStatus = 'warn';
    }

    const payload = {
      ...baseHealth,
      ok: overallStatus === 'ok',
      status: overallStatus,
      subsystems: {
        ...(baseHealth.subsystems || {}),
        ingest: {
          status: ingestHealth.status,
          delaySec: ingestHealth.delaySec,
          description: ingestHealth.description,
          lastOutcome: heartbeat?.outcome || 'unknown',
          lastPollMs: heartbeat?.pollMs || null,
          httpSuggest: ingestHealth.httpStatus,
        },
      },
    };

    const httpCode = overallStatus === 'critical' ? 503 : 200;
    res.status(httpCode).json(payload);
  } catch (err) {
    res.status(503).json({
      ok: false,
      status: 'critical',
      error: err.message,
    });
  }
});

/**
 * GET /api/monitoring/dashboard
 * 核心看板聚合数据 API (只读契约)
 */
app.get('/api/monitoring/dashboard', handleDashboardApi);

/**
 * 启动 Web 服务 (当直接执行此脚本时)
 */
export function startWebServer(port = PORT) {
  return new Promise((resolve) => {
    const server = app.listen(port, '0.0.0.0', () => {
      console.log(`[WebRunner] whop-web-dashboard 已就绪，监听端口 :${port} (READONLY_MODE=1)`);
      startCloudflareTunnel(port);
      resolve(server);
    });
  });
}

// 导出 app 供单测挂载
export { app };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/web_runner.js')) {
  console.log('====================================================');
  console.log(`[WebRunner] 启动独立看板服务 (ROLE=${process.env.ROLE})`);
  console.log('====================================================');
  startWebServer(PORT);
}
