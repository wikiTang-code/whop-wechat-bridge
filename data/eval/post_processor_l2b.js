/**
 * L2b 确定性后处理。14B 输出先过这里再进 harness / 落库。
 * 不负责创造原子，只负责丢掉非法字段、归一 kid、检查子串。
 */
export const KNOWN_KIDS = new Set([
  "k_debt_name_caps_upside",
  "k_high_lot_wait_low_lot_t",
  "k_close_auction_and_overnight",
  "k_t_only_add_on_fast",
  "k_second_handshake",
  "k_a_share_red_then_cut_us_overnight",
  "k_raise_cash_before_friday_double",
  "k_earnings_fade_batch",
  "k_close_buy_when_puts_surge",
  "k_gap_fill_then_second_confirm",
  "k_passive_redeem_then_rebuy",
  "k_half_retrace_watch",
  "k_settlement_day_copy_prior",
  "k_unfilled_limit_exit_next_week",
  "k_half_now_half_daily_low",
  "k_friday_long_then_short",
  "k_msci_delete_cascade",
  "k_friday_last_hour_v",
  "k_index_weak_only_mega",
  "k_higher_low_is_bottom",
  "k_first_half_hour_passive_plus_friday",
  "k_look_turns_not_news",
  "k_sales_print_tests_high",
  "k_pre_earnings_avoid_then_range",
  "k_sharp_drop_intraday_only",
  "k_vote_fail_then_conl_band",
  "k_stagger_adds_use_close",
  "k_no_option_in_theta_month",
  "k_rubber_ball_after_gap_fill",
  "k_spx_levels_mechanism"
]);

/** 模型爱换的近义 kid → 表内 id */
export const KID_ALIASES = {
  k_friday_v: "k_friday_last_hour_v",
  k_friday_last_hour: "k_friday_last_hour_v",
  k_last_hour_v: "k_friday_last_hour_v",
  k_dont_look_news: "k_look_turns_not_news",
  k_no_news_on_drop: "k_look_turns_not_news",
  k_pingpong: "k_rubber_ball_after_gap_fill",
  k_rubber_ball: "k_rubber_ball_after_gap_fill",
  k_msci_kickout: "k_msci_delete_cascade",
  k_msci_rebalance: "k_msci_delete_cascade",
  k_close_mode: "k_stagger_adds_use_close",
  k_stagger_add: "k_stagger_adds_use_close",
  k_higher_low: "k_higher_low_is_bottom",
  k_mega_only: "k_index_weak_only_mega",
  k_half_retrace: "k_half_retrace_watch",
  k_theta_no_option: "k_no_option_in_theta_month"
};

const TYPES = new Set([
  "playbook", "sizing_rule", "risk_rule", "regime",
  "instrument_view", "calendar_rule", "process_error", "formula"
]);
const STATUSES = new Set(["asserted_by_kol", "conditional", "negated", "uncertain"]);
const ORDER_RE = /\b(BUY|SELL|HOLD|STOP_LOSS|TAKE_PROFIT)\b/i;

export function normalizeWs(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

export function isSubstring(span, corpus) {
  if (!span) return false;
  const a = normalizeWs(span).toLowerCase();
  const b = normalizeWs(corpus).toLowerCase();
  return a.length >= 8 && b.includes(a);
}

export function sourceTextFromCu(cu) {
  const msgs = cu.dialogue_messages || cu.messages || [];
  return msgs
    .filter((m) => (m.role || "kol") === "kol")
    .map((m) => m.text || "")
    .join("\n");
}

function dropOrderLeak(atom) {
  const blob = JSON.stringify(atom);
  if (ORDER_RE.test(blob)) return null;
  if ("price" in atom || "actions" in atom || "fraction" in atom) return null;
  if (/\b\d+\.\d+\s*(出|吸|买|卖)/.test(atom.statement || "")) return null;
  return atom;
}

function normKid(kid) {
  if (!kid) return null;
  let k = String(kid).trim().toLowerCase().replace(/\s+/g, "_");
  if (!k.startsWith("k_")) k = "k_" + k;
  if (KID_ALIASES[k]) k = KID_ALIASES[k];
  if (/\d+\.\d+/.test(k)) return null; // k_bmnr_29_1
  return k;
}

export function cleanAtom(raw, { cuId, corpus }) {
  if (!raw || typeof raw !== "object") return { atom: null, drop: "not_object" };
  const kid = normKid(raw.kid);
  if (!kid) return { atom: null, drop: "bad_kid" };

  const type = TYPES.has(raw.type) ? raw.type : null;
  if (!type) return { atom: null, drop: "bad_type" };

  const statement = normalizeWs(raw.statement).slice(0, 240);
  if (statement.length < 8) return { atom: null, drop: "short_statement" };

  const evidence_span = normalizeWs(raw.evidence_span);
  const span_ok = isSubstring(evidence_span, corpus);
  if (!span_ok) return { atom: null, drop: "span_not_in_source" };

  let atom = {
    kid,
    schema_version: "0.1",
    type,
    statement,
    source_cu: [cuId],
    evidence_span,
    precondition: Array.isArray(raw.precondition) ? raw.precondition.slice(0, 6) : [],
    applies_to: Array.isArray(raw.applies_to)
      ? raw.applies_to.map((t) => String(t).toUpperCase()).slice(0, 8)
      : ["MARKET"],
    status: STATUSES.has(raw.status) ? raw.status : "conditional",
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.5)),
    do_not_use_as_order: true,
    kid_known: KNOWN_KIDS.has(kid)
  };

  atom = dropOrderLeak(atom);
  if (!atom) return { atom: null, drop: "order_leak" };
  return { atom, drop: null };
}

export function postProcessL2b(parsed, cu) {
  const cuId = (parsed && parsed.cu_id) || cu.cu_id;
  const corpus = sourceTextFromCu(cu);
  const incoming = (parsed && parsed.atoms) || [];
  const kept = [];
  const dropped = [];
  const seen = new Set();

  for (const raw of incoming) {
    const { atom, drop } = cleanAtom(raw, { cuId, corpus });
    if (!atom) {
      dropped.push({ drop, raw_kid: raw && raw.kid });
      continue;
    }
    if (seen.has(atom.kid)) {
      dropped.push({ drop: "dup_kid", raw_kid: atom.kid });
      continue;
    }
    seen.add(atom.kid);
    kept.push(atom);
  }

  return {
    cu_id: cuId,
    atoms: kept.slice(0, 3),
    parse_status: "ok",
    confidence: kept.length ? Math.max(...kept.map((a) => a.confidence)) : 0.8,
    dropped,
    order_leak: dropped.some((d) => d.drop === "order_leak"),
    known_kid_rate: kept.length ? kept.filter((a) => a.kid_known).length / kept.length : 1
  };
}
