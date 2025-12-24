# EchoSmith ASR 性能优化方案

## 当前状态

| 项目 | 状态 | 说明 |
|------|------|------|
| 引擎 | sherpa-onnx | 已从 FunASR 迁移 |
| 模型 | SenseVoice INT8 | 228MB，比 FP32 (894MB) 小 4x |
| RTF | ~0.042 | 即 1 小时音频约 2.5 分钟转写 |

---

## 已实施的优化

### 1. 引擎迁移：FunASR → sherpa-onnx

**收益**：
- 依赖从 ~3GB (PyTorch) 降至 ~15MB
- 启动时间从 30s+ 降至 2-3s
- 内存占用减少 70%+

**实现**：
```python
# backend/asr_engine.py
import sherpa_onnx

self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=model_path,
    tokens=tokens_path,
    num_threads=4,
    language="auto",
    use_itn=True,
    provider="cpu",
)
```

### 2. INT8 量化模型

**收益**：
- 模型体积: 894MB → 228MB (4x 压缩)
- 推理速度: 提升约 30-50%
- 精度损失: < 1% (几乎无感知)

**模型位置**：`~/.cache/sherpa-onnx/sense-voice/model.int8.onnx`

### 3. 分块处理 + 进度更新

**收益**：
- 支持超长音频（>30分钟）
- 实时进度显示
- 避免 UI 卡顿

**实现**：
```python
# 30秒分块
chunk_size = sample_rate * 30
for chunk_idx in range(num_chunks):
    progress = 0.1 + 0.8 * (chunk_idx / num_chunks)
    progress_cb(progress, f"转写中 {chunk_idx + 1}/{num_chunks}", partial_text)
```

---

## 未实施的进阶优化

### 1. CoreML 加速 (macOS)

**原理**：使用 Apple Neural Engine 加速推理

**状态**：sherpa-onnx 暂不支持 CoreML provider

**潜在收益**：2-5x 速度提升

**实现路径**：
```python
# 等待 sherpa-onnx 支持后
self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    ...
    provider="coreml",  # 目前不可用
)
```

### 2. CUDA 加速 (NVIDIA GPU)

**原理**：使用 NVIDIA GPU 并行计算

**状态**：sherpa-onnx 支持，但需要 NVIDIA 显卡

**潜在收益**：10-50x 速度提升

**实现**：
```python
self._recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    ...
    provider="cuda",
)
```

**依赖**：
- NVIDIA GPU (RTX 20xx+)
- CUDA Toolkit 11.x+
- cuDNN 8.x+

### 3. 批量并行处理

**原理**：多个音频文件同时转写

**状态**：需要修改架构

**潜在收益**：N 个文件 → N 核并行

**实现思路**：
```python
import concurrent.futures

def batch_transcribe(audio_files, max_workers=4):
    with concurrent.futures.ThreadPoolExecutor(max_workers) as executor:
        futures = [executor.submit(transcribe, f) for f in audio_files]
        return [f.result() for f in futures]
```

**注意**：需要控制内存使用，每个 worker 约占用 500MB

### 4. VAD 预处理

**原理**：先用 VAD 检测静音段，跳过无语音区域

**状态**：sherpa-onnx 支持 silero-vad

**潜在收益**：减少 20-40% 处理时间（取决于静音比例）

**实现**：
```python
vad = sherpa_onnx.VoiceActivityDetector(
    silero_vad_model_path,
    sample_rate=16000,
    threshold=0.5,
)
# 只处理有语音的片段
```

### 5. 流式识别

**原理**：边录边转，实时输出

**状态**：SenseVoice 不支持，需换用 Paraformer-streaming

**潜在收益**：实时反馈，无需等待完整音频

**代价**：准确率下降 3-5%

---

## 性能对比总结

| 方案 | RTF | 速度提升 | 实现难度 | 状态 |
|------|-----|----------|----------|------|
| FunASR (baseline) | ~0.3 | 1x | - | 已弃用 |
| sherpa-onnx FP32 | ~0.06 | 5x | 低 | 可用 |
| sherpa-onnx INT8 | ~0.042 | 7x | 低 | ✅ 已实施 |
| + CoreML | ~0.01 | 30x | 中 | 等待支持 |
| + CUDA | ~0.005 | 60x | 中 | 需 NVIDIA GPU |
| + 批量并行 | ~0.01/file | Nx | 中 | 可实施 |

---

## 推荐下一步

1. **短期**：保持当前 INT8 方案，已足够快（7x 加速）
2. **中期**：关注 sherpa-onnx CoreML 支持进展
3. **长期**：如有大量转写需求，考虑服务器端 CUDA 加速

---

## 参考资源

- [sherpa-onnx GitHub](https://github.com/k2-fsa/sherpa-onnx)
- [SenseVoice 模型](https://github.com/FunAudioLLM/SenseVoice)
- [ONNX Runtime 优化指南](https://onnxruntime.ai/docs/performance/tune-performance.html)
