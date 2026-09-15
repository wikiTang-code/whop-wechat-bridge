/**
 * export_training_data.js
 * REQ-036 大V交易语义专有 SLM 微调数据飞轮导出管道
 * 
 * 功能：
 * 1. 从 SQLite (whop_archive.db) 抽取真实历史大V交易单 (follow_replay_queue, 830笔)
 * 2. 结合人工纠错记录 (corrected_json) 构建黄金正样本与 DPO 偏好对 (chosen vs rejected)
 * 3. 从 messages 表采样大盘宏观点评、日常闲聊等非交易文本作为抗幻觉负样本 (Negative/No-trade)
 * 4. 导出为工业界主流微调格式：
 *    - data/slm/alpaca_trade_sft.json (Alpaca 格式，适用于 LLaMA-Factory / Unsloth)
 *    - data/slm/sharegpt_trade_sft.jsonl (ShareGPT 多轮/单轮格式)
 *    - data/slm/dpo_preference_pairs.jsonl (DPO 偏好对比集)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = path.resolve('whop_archive.db');
const OUTPUT_DIR = path.resolve('data/slm');

const SYSTEM_PROMPT = `你是一个顶级美股量化交易信号提取器，专门解析交易大V的中文口语喊单和调仓发言。
你的任务是严格从用户文本中提取交易动作要素并输出纯 JSON 对象，禁止输出任何多余解释或 Markdown 格式。

【输出Schema】
{
  "has_trade": boolean,
  "trades": [
    {
      "symbol": string,         // 标的大写代码 (如 TSLL, LITE, CONL, IREN, CIFR, CRWV)
      "action": "BUY" | "SELL", // 买入/加仓/加回/开仓 为 BUY；卖出/减仓/出掉/平仓/止损 为 SELL
      "price_type": "LIMIT" | "MARKET" | "RANGE",
      "price": number,          // 本次执行价格 (区间价取均值)
      "source_lot_price": number | null, // 做T买回原卖出批次，或指定卖出的买入成本批次
      "fraction_desc": string,  // 仓位描述 (如 "三分之一常规仓", "半仓", "出剩下一半")
      "fraction_ratio": number, // 数字化比例 (0.333, 0.5, 1.0)
      "stop_loss": number | null,
      "is_day_trade": boolean
    }
  ]
}`;

// 常见非美股标的黑名单（宏观指标、点位、闲聊词，防止误判）
const MACRO_NOISE_WORDS = ['A股', '港股', '大盘', '纳指', '标普', '缺口', '支撑', '阻力', '非农', 'CPI', '鲍威尔', '降息'];

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

export function exportSLMTrainingData() {
  ensureOutputDir();
  const db = new Database(DB_PATH, { readonly: true, timeout: 5000 });

  console.log('====================================================');
  console.log('🚀 启动 REQ-036 交易语义 SLM 微调数据飞轮抽取流水线');
  console.log('====================================================\n');

  // 1. 抽取黄金正样本 (从 follow_replay_queue)
  const replayRows = db.prepare(`
    SELECT id, message_id, raw_content, parsed_ticker, parsed_action, parsed_price, 
           source_lot_price, fraction_desc, fraction_ratio, status, corrected_json
    FROM follow_replay_queue
    ORDER BY created_at ASC
  `).all();

  console.log(`[数据抽取] follow_replay_queue 读取到 ${replayRows.length} 条记录`);

  const sftAlpacaList = [];
  const sftShareGPTList = [];
  const dpoPairList = [];

  let validTradeCount = 0;
  let correctedPairCount = 0;

  for (const row of replayRows) {
    if (!row.raw_content || !row.raw_content.trim()) continue;

    // 清洗掉图片标签
    const cleanInput = row.raw_content.replace(/\[IMAGE:.*?\]/gi, '').trim();
    if (!cleanInput) continue;

    let targetTicker = row.parsed_ticker;
    let targetAction = row.parsed_action;
    let targetPrice = row.parsed_price;
    let targetSourceLot = row.source_lot_price;
    let targetFracDesc = row.fraction_desc || '常规仓位';
    let targetFracRatio = row.fraction_ratio || 0.333;

    // 如果有人工纠错记录，优先使用人工纠错的 Ground Truth！
    let isCorrected = false;
    let rejectedTrade = null;

    if (row.corrected_json) {
      try {
        const corr = JSON.parse(row.corrected_json);
        if (corr.parsed_ticker) targetTicker = corr.parsed_ticker;
        if (corr.parsed_action) targetAction = corr.parsed_action;
        if (corr.parsed_price !== undefined) targetPrice = Number(corr.parsed_price);
        if (corr.source_lot_price !== undefined) targetSourceLot = corr.source_lot_price ? Number(corr.source_lot_price) : null;
        if (corr.fraction_desc) targetFracDesc = corr.fraction_desc;
        if (corr.fraction_ratio) targetFracRatio = Number(corr.fraction_ratio);
        isCorrected = true;

        // 构造 DPO 对比对：Rejected 为未人工修正前的原始解析
        rejectedTrade = {
          symbol: row.parsed_ticker,
          action: row.parsed_action,
          price_type: 'LIMIT',
          price: row.parsed_price,
          source_lot_price: row.source_lot_price,
          fraction_desc: row.fraction_desc,
          fraction_ratio: row.fraction_ratio,
          stop_loss: null,
          is_day_trade: cleanInput.includes('日内')
        };
      } catch (e) {
        console.warn(`[WARN] 解析 corrected_json 失败 (id=${row.id}):`, e.message);
      }
    }

    if (!targetTicker || targetPrice === null || targetPrice === undefined) {
      continue;
    }

    const goldOutput = {
      has_trade: true,
      trades: [
        {
          symbol: targetTicker.toUpperCase(),
          action: targetAction ? targetAction.toUpperCase() : 'BUY',
          price_type: 'LIMIT',
          price: Number(targetPrice),
          source_lot_price: targetSourceLot !== null && targetSourceLot !== undefined ? Number(targetSourceLot) : null,
          fraction_desc: targetFracDesc,
          fraction_ratio: targetFracRatio ? Number(targetFracRatio.toFixed(3)) : 0.333,
          stop_loss: null,
          is_day_trade: cleanInput.includes('日内')
        }
      ]
    };

    const goldOutputStr = JSON.stringify(goldOutput);

    // 1) Alpaca 格式
    sftAlpacaList.push({
      instruction: SYSTEM_PROMPT,
      input: cleanInput,
      output: goldOutputStr
    });

    // 2) ShareGPT 格式
    sftShareGPTList.push({
      conversations: [
        { from: 'system', value: SYSTEM_PROMPT },
        { from: 'human', value: cleanInput },
        { from: 'gpt', value: goldOutputStr }
      ]
    });

    // 3) DPO 偏好对
    if (isCorrected && rejectedTrade) {
      const rejectedOutputStr = JSON.stringify({
        has_trade: true,
        trades: [rejectedTrade]
      });

      dpoPairList.push({
        system: SYSTEM_PROMPT,
        prompt: cleanInput,
        chosen: goldOutputStr,
        rejected: rejectedOutputStr
      });
      correctedPairCount++;
    }

    validTradeCount++;
  }

  console.log(`[正样本构建] 成功构建有效交易正样本: ${validTradeCount} 组 (含纠错偏好对: ${correctedPairCount} 组)`);

  // 2. 抽取非交易抗幻觉负样本 (Negative / No-trade Samples)
  // 从 messages 表中筛选发言长于 15 字符且不含明确买卖成交词的大盘宏观分析
  const negativeRows = db.prepare(`
    SELECT content FROM messages
    WHERE content NOT LIKE '%买%' 
      AND content NOT LIKE '%卖%' 
      AND content NOT LIKE '%加仓%' 
      AND content NOT LIKE '%建仓%' 
      AND content NOT LIKE '%出掉%' 
      AND content NOT LIKE '%平本%' 
      AND content NOT LIKE '%出了%'
      AND length(content) BETWEEN 20 AND 120
    ORDER BY RANDOM()
    LIMIT 200
  `).all();

  let negativeCount = 0;
  const noTradeOutput = JSON.stringify({ has_trade: false, trades: [] });

  for (const nRow of negativeRows) {
    const cleanNeg = nRow.content.replace(/\[IMAGE:.*?\]/gi, '').trim();
    if (!cleanNeg || cleanNeg.length < 15) continue;

    // Alpaca
    sftAlpacaList.push({
      instruction: SYSTEM_PROMPT,
      input: cleanNeg,
      output: noTradeOutput
    });

    // ShareGPT
    sftShareGPTList.push({
      conversations: [
        { from: 'system', value: SYSTEM_PROMPT },
        { from: 'human', value: cleanNeg },
        { from: 'gpt', value: noTradeOutput }
      ]
    });

    negativeCount++;
  }

  console.log(`[负样本采样] 成功采样宏观/闲聊抗幻觉负样本: ${negativeCount} 组`);

  // 3. 写入文件
  const alpacaPath = path.join(OUTPUT_DIR, 'alpaca_trade_sft.json');
  fs.writeFileSync(alpacaPath, JSON.stringify(sftAlpacaList, null, 2), 'utf-8');
  console.log(`[文件导出] Alpaca SFT: ${alpacaPath} (${sftAlpacaList.length} 条)`);

  const sharegptPath = path.join(OUTPUT_DIR, 'sharegpt_trade_sft.jsonl');
  const sharegptLines = sftShareGPTList.map(item => JSON.stringify(item)).join('\n');
  fs.writeFileSync(sharegptPath, sharegptLines, 'utf-8');
  console.log(`[文件导出] ShareGPT SFT: ${sharegptPath} (${sftShareGPTList.length} 条)`);

  const dpoPath = path.join(OUTPUT_DIR, 'dpo_preference_pairs.jsonl');
  const dpoLines = dpoPairList.map(item => JSON.stringify(item)).join('\n');
  fs.writeFileSync(dpoPath, dpoLines, 'utf-8');
  console.log(`[文件导出] DPO 偏好对: ${dpoPath} (${dpoPairList.length} 对)`);

  // 4. 生成数据分布与统计报告
  const summary = {
    exported_at: new Date().toISOString(),
    total_samples: sftAlpacaList.length,
    positive_trade_samples: validTradeCount,
    negative_no_trade_samples: negativeCount,
    dpo_contrast_pairs: correctedPairCount,
    positive_ratio: `${((validTradeCount / sftAlpacaList.length) * 100).toFixed(1)}%`,
    negative_ratio: `${((negativeCount / sftAlpacaList.length) * 100).toFixed(1)}%`
  };

  const summaryPath = path.join(OUTPUT_DIR, 'dataset_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`[文件导出] 数据集概览: ${summaryPath}`);
  console.log('数据统计:', summary);

  return summary;
}

// 支持直接命令行执行
if (process.argv[1] && process.argv[1].endsWith('export_training_data.js')) {
  exportSLMTrainingData();
}
