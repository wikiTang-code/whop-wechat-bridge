/**
 * price_extractor.js
 * 工业级交易语义槽位填充引擎 (Tokenizer + Contextual Slot Filling)
 * 彻底告别单体大正则的贪婪回溯、数字切片与拆东墙补西墙陷阱。
 */

export function extractSemanticPrice(rawContent, ticker, action) {
  let fullText = rawContent
    .replace(/\[IMAGE:.*?\]/gi, '')
    .replace(/(\d+)\s*[。，、·]\s*(\d+)/g, '$1.$2')
    .trim();
  let text = fullText;

  // 1. 如果包含多行且指定了 ticker，优先提取包含该 ticker 的关键句
  if (ticker) {
    const lines = fullText.split(/[\n\r；;。]+/).map(s => s.trim()).filter(Boolean);
    const lowerTicker = ticker.toLowerCase();
    const cand = lines.find(l => l.toLowerCase().includes(lowerTicker));
    if (cand) text = cand;
  }

  // 2. 结构化数字 Token 化 (Tokenization: 提取所有独立的合法数字及上下文)
  const numTokens = [];
  const regex = /\b(\d+(?:\.\d+)?)\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const val = parseFloat(match[1]);
    numTokens.push({
      val,
      start: match.index,
      end: match.index + match[0].length,
      raw: match[1]
    });
  }

  if (numTokens.length === 0) {
    return { price: null, sourceLotPrice: null, debug: 'no_numbers' };
  }

  // 3. 槽位定义
  let execPrice = null;
  let sourceLotPrice = null;

  // 槽位解析 A: 买回/做T接回模式 (如 "7.67在买回 7.99卖出的部分conl")
  const buyBackMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:附近)?\s*(?:在|直接|准备)?(?:买回|加回|接回|回买|回吸)\s*(?:之前)?\s*(\d+(?:\.\d+)?)\s*(?:卖出|出掉|出的)/);
  if (buyBackMatch) {
    return {
      price: parseFloat(buyBackMatch[1]),
      sourceLotPrice: parseFloat(buyBackMatch[2]),
      debug: 'buy_back_slot'
    };
  }

  // 槽位解析 B: 平本出模式 (如 "47.8 的iren在47.8 平本出", "13.7附近平本出13.6的tsll")
  const breakevenA = text.match(/(\d+(?:\.\d+)?)\s*(?:附近)?\s*平本出\s*(\d+(?:\.\d+)?)的/);
  if (breakevenA) {
    return {
      price: parseFloat(breakevenA[1]),
      sourceLotPrice: parseFloat(breakevenA[2]),
      debug: 'breakeven_slot_a'
    };
  }
  const breakevenB = text.match(/(\d+(?:\.\d+)?)\s*的.*?在\s*(\d+(?:\.\d+)?)\s*平本出/);
  if (breakevenB) {
    return {
      price: parseFloat(breakevenB[2]),
      sourceLotPrice: parseFloat(breakevenB[1]),
      debug: 'breakeven_slot_b'
    };
  }

  // 槽位解析 C: 区间成交价 (如 "930-931附近出剩下一半", "885-886附近出")
  const rangeMatch = text.match(/(\d+(?:\.\d+)?)\s*[-~至到]\s*(\d+(?:\.\d+)?)\s*(?:附近|左右)?\s*(?:出|卖|加|开|买|接|补|减|平)/);
  if (rangeMatch) {
    const p1 = parseFloat(rangeMatch[1]);
    const p2 = parseFloat(rangeMatch[2]);
    // 排除仓位比例区间的干扰 (如 1-2成仓)
    if (p1 > 5 || p2 > 5) {
      execPrice = Number(((p1 + p2) / 2).toFixed(2));
    }
  }

  // 槽位解析 D: 批次成本槽 (寻找紧跟 "的" 或 "买入成本" 的有效价格)
  for (let i = 0; i < numTokens.length; i++) {
    const t = numTokens[i];
    const afterStr = text.substring(t.end, t.end + 10).trim();
    // 匹配 "855的lite", "7.67的conl", "14.01的tsll", 排除 "885的日内"
    if (afterStr.startsWith('的') && !afterStr.startsWith('的日内') && !afterStr.startsWith('的缺口') && !afterStr.startsWith('的最低')) {
      sourceLotPrice = t.val;
      break;
    }
  }

  // 槽位解析 E: 执行价槽 (从剩余数字中提取与交易动作关联最紧密的数字)
  if (execPrice === null) {
    // 优先：动词前/动作前紧邻的报价 (如 "7.99 也是出一半", "14.41可以卖一半", "865附近 开了")
    const actionPriceMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:附近|左右|元|刀|\$)?\s*(?:也是|先|直接|可以|准备)?\s*(?:开了|加了|买了|建仓|接了|补了|出了|卖了|出掉|平仓|先出|出完|止损|出|卖|买|加|开|减)\s*(?:一半|剩下一半|三分之一|1\/3|常规仓的一半|全部|底仓|\s)/);
    if (actionPriceMatch) {
      execPrice = parseFloat(actionPriceMatch[1]);
    }
  }

  if (execPrice === null) {
    // 备选：从左向右寻找首个非批次、非仓位分母的合法数字
    for (const t of numTokens) {
      if (sourceLotPrice !== null && t.val === sourceLotPrice) continue;
      // 排除仓位修饰词中的小整数 (如 1/3, 1/2, 买2卖1, 开三次)
      if ([1, 2, 3, 4, 5, 6].includes(t.val)) {
        const contextStr = text.substring(Math.max(0, t.start - 4), Math.min(text.length, t.end + 4));
        if (/份|仓|成|倍|\/|分之|次/i.test(contextStr)) continue;
      }
      execPrice = t.val;
      break;
    }
  }

  // 如果依然未提取到执行价，但提取到了 sourceLotPrice 且该单为卖单，兜底使用该数字
  if (execPrice === null && sourceLotPrice !== null) {
    execPrice = sourceLotPrice;
  }

  return {
    price: execPrice,
    sourceLotPrice: sourceLotPrice,
    debug: `tokenizer_slot exec=${execPrice} lot=${sourceLotPrice}`
  };
}

/**
 * 提取交易语义动作 (BUY / SELL)
 */
export function extractSemanticAction(rawContent, ticker) {
  if (!rawContent) return null;
  let text = rawContent.replace(/\[IMAGE:.*?\]/gi, '').trim();
  if (ticker) {
    const lines = text.split(/[\n\r；;。]+/).map(s => s.trim()).filter(Boolean);
    const lowerTicker = ticker.toLowerCase();
    const cand = lines.find(l => l.toLowerCase().includes(lowerTicker));
    if (cand) text = cand;
  }

  // 1. 核心反向买入动作：买回 / 回买 / 接回 / 加回 / 回吸 必为 BUY (防止误判为 SELL)
  if (/买回|加回|接回|回买|回吸|低吸/.test(text)) {
    return 'BUY';
  }

  // 2. 卖出动作：出 / 卖 / 平仓 / 平本出 / 平出 / 减仓 / 止损
  if (/出|卖|平仓|平本出|平出|减仓|止损/.test(text)) {
    return 'SELL';
  }

  // 3. 买入动作：买 / 加 / 开 / 建仓 / 入
  if (/买|加|开|建仓|入/.test(text)) {
    return 'BUY';
  }

  return null;
}

