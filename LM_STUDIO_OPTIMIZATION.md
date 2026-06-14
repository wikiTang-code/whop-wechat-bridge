# LM Studio 优化指南 (AMD RX 7900 XT)

## 问题诊断

7900 XT 有 20GB VRAM，理论上跑 qwen2.5-14b 应该很快（<5s）。当前延迟 24-88s 说明 GPU 未正确启用。

## 优化步骤

### 1. 检查 GPU 是否启用

在 LM Studio 中：
- 点击左下角 **齿轮图标** (Settings)
- 选择 **Developer** 选项卡
- 查看 **GPU Offload** 设置
- 确保已启用且层数设为 **Max**（全部卸载到 GPU）

### 2. 使用量化模型

当前可能使用的是 FP16 模型（太大太慢）。建议换用量化版本：

在 LM Studio 搜索并下载：
- `qwen2.5-14b-instruct-q4_k_m` (约 8GB，速度快)
- `qwen2.5-14b-instruct-q5_k_m` (约 10GB，质量更好)
- `qwen2.5-14b-instruct-q6_k` (约 12GB，接近无损)

7900 XT 20GB VRAM 可以轻松跑 Q6_K 量化版本。

### 3. 更新 AMD 驱动

确保安装了最新版 AMD Adrenalin 驱动：
- 下载：https://www.amd.com/en/support
- 安装后重启

### 4. 检查 ROCm 支持

LM Studio 在 Windows 上使用 DirectML 或 ROCm：
- Settings → Developer → 查看 **Backend** 选项
- 如果有 **ROCm** 选项，选择它（比 DirectML 快）
- 如果没有，确保 LM Studio 版本 >= 0.3.x

### 5. 优化 LM Studio 设置

在 Settings → Developer：
- **GPU Offload Layers**: Max
- **Context Length**: 4096 (不需要太长)
- **Thread Count**: 设为 CPU 核心数的一半
- **Batch Size**: 512 或 1024

### 6. 测试优化效果

运行以下测试：

```javascript
// 在 LM Studio Server 页面点击 "Start Server"
// 然后在浏览器访问 http://127.0.0.1:8080/v1/models
// 确认模型已加载

// 测试简单查询
curl http://127.0.0.1:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5-14b-instruct","messages":[{"role":"user","content":"Say hello"}],"max_tokens":10}'
```

预期延迟：< 5s（如果 GPU 正确启用）

## 预期性能

| 配置 | 延迟（简单查询） |
|------|-----------------|
| CPU only | 50-100s |
| GPU (未量化) | 10-20s |
| GPU (Q4_K_M) | 2-5s |
| GPU (Q6_K) | 3-7s |

## 常见问题

### Q: LM Studio 没有 GPU 选项？
A: 确保使用最新版 LM Studio (>= 0.3.x)，旧版可能不支持 AMD GPU。

### Q: 选择 GPU 后崩溃？
A: 可能是 VRAM 不足，尝试更小的量化版本 (Q4_K_M)。

### Q: 仍然很慢？
A: 检查任务管理器 → 性能 → GPU，看 GPU 是否有负载。如果 GPU 负载低，说明未正确启用。
