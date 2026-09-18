# 统一 WSL2 AI 运行时架构改造方案 (CHG-018 提案)

> **上级索引**：[`README.md`](./README.md) · 账本 [`03-requirements.md`](./03-requirements.md) (`CHG-018`) · 审阅 [`07-review-inbox.md`](./07-review-inbox.md)  
> **提案方**：`agent:gemini`  
> **审阅方**：`agent:cursor`（见 `05` §0.R-A 批次 `PKG-WSL-AI-RUNTIME`）  
> **当前状态**：`accepted`（Cursor 审阅 Done · 2026-09-19；**实施前须过 §6 门禁**；关 Windows LM Studio 切流建议 human 在场）

---

## 1. 背景与痛点诊断

在 RX 7900 XT (20GB 显存) 单卡承载实盘 AI 系统的运行中，暴露出当前混合架构的核心矛盾：

1. **Windows 宿主机内存被严重霸占（7~8 GB 物理 RAM 吞噬）**：
   - 当前 14B 推理服务跑在 Windows 宿主机 LM Studio（基于 Electron + llama.cpp），虽然大部分层 offload 到 GPU，但因 `mmap` 模型映射和 K-V Cache 机制，LM Studio 在 Windows 物理内存中死死咬住 **7.17 GB**（实测 WorkingSet），严重挤占宿主机日常办公与开发资源。
2. **跨系统（Windows ↔ WSL2）显存碎片与分配死锁**：
   - 14B 占用 14.6 GB 显存后，Windows 物理显存处于碎片化状态；
   - 当 WSL2 内部的 PyTorch 启动 1.5B 微调时，ROCm/HIP 因申请不到大块连续 GPU 显存，静默降级（Fallback）到 **系统共享内存（Host System RAM）**；
   - 结果导致微调不仅没用上 GPU 专用显存，反而将几十 GB 张量堆进 WSL 和宿主机内存，造成宿主机物理内存瞬时被挤爆。
3. **缺乏统一底层的时分复用（Time-Division Multiplexing）调度器**：
   - 单卡 20GB 显存无法同时容纳 `14B 推理 (14.5G) + 1.5B 微调 (4.3G) + 桌面显示 (1.2G) = 20.0G` 的极限并发；
   - 必须有统一控制平面在秒级实现显存轮转，而跨系统的进程间难以做到无感原子切换。

---

## 2. 改造目标与核心收益

* **收益 1：彻底消灭 Windows 宿主机的 7~8 GB 内存常驻**  
  将 14B 推理迁移至 WSL2 纯后台无界面轻量运行时，彻底关闭 Windows 端图形化 LM Studio，Windows 物理内存瞬间释放 7+ GB。
* **收益 2：统一在 Linux 命名空间内实现时分秒级轮转（Swap）**  
  在 WSL2 内部通过极简的 GPU 仲裁器（GPU Arbiter）：
  * **日常状态**：14B 独占 GPU 显存（~14GB），处理非交易和深度图谱抽取；
  * **飞轮触发**：自迭代飞轮需微调 1.5B 时，仲裁器通过 API 临时卸载 14B（耗时 1 秒），1.5B 独享显存跑 40 秒完成微调，完成后自动恢复 14B；
  * **杜绝双模型贴脸并发造成的内存溢出**。
* **收益 3：对外 API 契约尽量不变**  
  目标保持宿主机 `http://127.0.0.1:8080/v1` OpenAI 兼容面，使 `ai-router-policy.js` 等业务调用路径少改。  
  **更正（Cursor 审阅）**：`tools/lms-guard.js` 当前绑定 Windows `lms` CLI，**不能**宣称「lms-guard 零改动」；须先落地 Runtime Adapter（见 §6）。

---

## 3. 技术选型与实现方案

### 3.1 运行时选型（三选一对比）

| 方案 | 引擎 | 优点 | 显存控制 | 推荐度 |
|---|---|---|---|:---:|
| **方案 A (推荐)** | **WSL2 `llama.cpp` 原生无界面 Server (ROCm/HIP)** | 与 LM Studio 内核完全一致，直接复用现有的 GGUF 模型文件；无任何图形界面开销；纯后台 Daemon | 提供原生 `/v1/models` 热载与热卸载接口，换入换出速度仅需 1~2 秒 | ⭐⭐⭐⭐⭐ (最稳) |
| **方案 B** | **WSL2 Ollama (Linux ROCm 版)** | 命令行安装极其简单，自动管理内存与空闲释放 | 具有 `keep_alive` 参数（超时自动释放显存，有请求自动秒唤醒） | ⭐⭐⭐⭐ |
| **方案 C** | **WSL2 vLLM (ROCm)** | 吞吐量极高，支持 PagedAttention | 对 7900XT 消费级卡支持较脆，且显存预分配过于霸道（默认占90%） | ⭐⭐ (不推荐) |

👉 **结论（Cursor 审阅锁定）**：默认采用 **方案 A（WSL2 原生 llama-server ROCm）**。方案 B 仅在 A 的 ROCm/稳定性验收失败时启用，并另开短 CHG。

### 3.2 显存仲裁调度器（GPU Arbiter 时分轮转机制）

```mermaid
sequenceDiagram
    autonumber
    actor User as 企微审核/用户
    participant Bridge as 网桥服务 (Node.js)
    participant Arbiter as GPU 显存仲裁器 (WSL2)
    participant Model14B as 14B 推理服务 (:8080)
    participant Trainer as 1.5B ROCm LoRA 微调

    Note over Model14B: 14B 常驻显存 (占用 14.5 GB)
    User->>Bridge: 企微提交第 #95 笔纠错
    Bridge->>Bridge: 纠错增量达标 (delta >= 5)
    Bridge->>Arbiter: 请求启动自迭代飞轮 (flywheel_engine)
    
    rect rgb(240, 248, 255)
    Note over Arbiter,Model14B: 1. 时分轮转：释放 14B
    Arbiter->>Model14B: 发送卸载指令 (Unload model)
    Model14B-->>Arbiter: 显存已排空 (1 秒完成，释放 14.5 GB)
    end

    rect rgb(255, 245, 238)
    Note over Arbiter,Trainer: 2. 1.5B 纯 GPU 独占微调
    Arbiter->>Trainer: 启动 train_rocm_fast.py
    Note over Trainer: 独占 4.2 GB 显存，无内存溢出，耗时 40 秒
    Trainer-->>Arbiter: 训练完成，权重保存完毕
    end

    rect rgb(240, 248, 255)
    Note over Arbiter,Model14B: 3. 自动恢复 14B 推理
    Arbiter->>Model14B: 重新加载 14B 权重 (热载 2 秒)
    Model14B-->>Arbiter: 14B 就绪
    end

    Arbiter-->>Bridge: 飞轮自进化闭环完成
    Bridge->>User: 企微推送飞轮版本升级报告
```

---

## 4. 影响面评估与安全红线

1. **红线对齐（`AGENTS.md`）**：
   - 生产 C2 HITL：仅改动机房本地 AI 运行时，不碰生产 GCP，无 C2 破坏风险；
   - 资金安全隔离：不碰 broker/trading 路径；
   - 企微窄面：推送仅上报飞轮里程碑，走已有的安全 Webhook。
2. **回滚方案（Rollback Guarantee）**：
   - 如果 WSL2 内部服务因偶发故障异常，只需双击打开 Windows 原生 LM Studio，系统在 5 秒内自动秒级回滚到原有模式，业务零阻断。

---

## 5. 执行步骤（审阅通过后 · 门禁达标才可关 LMS）

1. **Step 0（门禁）**：完成 §6 Checklist；Runtime Adapter 单测绿；ROCm smoke 通过。  
2. **Step 1**：WSL2 部署 `llama-server`（方案 A）并配置 ROCm gfx1100；  
3. **Step 2**：`/mnt/c/...` 挂载复用现有 GGUF（禁止复制多份进 VHD）；  
4. **Step 3**：验证宿主机 `127.0.0.1:8080` 连通、WorkingSet/VRAM 对比基线；  
5. **Step 4**：Arbiter 钩入 `flywheel_engine.js` + 与 `lms-guard` 单飞锁合并；写清 deep/fast 空窗策略；  
6. **Step 5（human 在场）**：停 Windows LM Studio，验收内存释放与微调张量在 GPU；失败立即按回滚 SOP 切回。

## 6. 实施门禁 Checklist（Cursor 审阅强制）

- [ ] **引擎锁定**：方案 A；失败才评估 B  
- [ ] **Runtime Adapter**：抽象 `ps/load/unload`，替换对 Windows `lms` CLI 的硬依赖；单测覆盖  
- [ ] **空窗策略**：14B unload/reload 实测耗时写入 runbook；deep 请求排队或明确失败；快车道在训练期行为写死  
- [ ] **显存预算表**：预留 Windows 桌面 ~1–2GB；模型侧按 ≤18GB 规划  
- [ ] **ROCm smoke**：`rocm-smi`、14B 推理、1.5B 微调显存落在 GPU（非 Host RAM）  
- [ ] **回滚 SOP**：停 WSL `:8080` → 启 LM Studio → 健康检查；端口不得双占  
- [ ] **互斥**：飞轮 / 037 deep 批跑 / 人工 deep 共用 Arbiter 单飞  
- [ ] **企微**：里程碑推送不扩 `/ops`（`REJ-008`）  
- [ ] **切流**：关闭 Windows LM Studio 须 human 在场确认一次  

