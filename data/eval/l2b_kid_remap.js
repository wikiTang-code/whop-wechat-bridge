/**
 * L2b kid 收敛：不要靠 14B 背 30 个英文 id。
 * 用 evidence+statement 关键词打到表内 kid；对不上就标 candidate，不进金标。
 */
export const KNOWN_KIDS = [
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
];

/** 同义 kid → 表内 */
export const KID_ALIASES = {
  k_friday_v: "k_friday_last_hour_v",
  k_friday_last_hour: "k_friday_last_hour_v",
  k_last_hour_v: "k_friday_last_hour_v",
  k_dont_look_news: "k_look_turns_not_news",
  k_no_news_on_drop: "k_look_turns_not_news",
  k_rubber_ball: "k_rubber_ball_after_gap_fill",
  k_pingpong: "k_rubber_ball_after_gap_fill",
  k_msci_kickout: "k_msci_delete_cascade",
  k_msci_rebalance: "k_msci_delete_cascade",
  k_half_retrace: "k_half_retrace_watch",
  k_theta_no_option: "k_no_option_in_theta_month",
  k_close_mode: "k_stagger_adds_use_close"
};

/**
 * 关键词路由。按从特殊到一般，命中即停。
 * 用来纠正「把任意收盘句都贴成 k_close_auction」这种错绑。
 */
export const ROUTES = [
  { kid: "k_friday_last_hour_v", all: ["周五", "最后一小时"], any: ["找V", "强平"] },
  { kid: "k_friday_long_then_short", all: ["周五"], any: ["先多后空", "上半场", "冲高减"] },
  { kid: "k_msci_delete_cascade", any: ["msci", "MSCI", "剔除指数"] },
  { kid: "k_rubber_ball_after_gap_fill", any: ["皮球"] },
  { kid: "k_look_turns_not_news", any: ["找新闻", "看打仗", "看网站评论"] },
  { kid: "k_sharp_drop_intraday_only", all: ["急跌"], any: ["当日", "日内"] },
  { kid: "k_earnings_fade_batch", all: ["财报"], any: ["跳涨", "转弯"] },
  { kid: "k_second_handshake", any: ["二次握手", "两次握手"] },
  { kid: "k_settlement_day_copy_prior", any: ["结算普涨", "结算日"] },
  { kid: "k_spx_levels_mechanism", any: ["7340", "spx", "SPX"] },
  { kid: "k_half_retrace_watch", any: ["/2", "一半的位置"] },
  { kid: "k_no_option_in_theta_month", any: ["磨损"] },
  { kid: "k_stagger_adds_use_close", any: ["错开加", "不要放一天加完"] },
  { kid: "k_raise_cash_before_friday_double", any: ["双杀"] },
  { kid: "k_a_share_red_then_cut_us_overnight", any: ["上证", "翻红程序"] },
  { kid: "k_close_auction_and_overnight", all: ["尾盘"], any: ["4点", "夜盘"] },
  { kid: "k_t_only_add_on_fast", any: ["仅仅做T", "快进快出"] },
  { kid: "k_unfilled_limit_exit_next_week", any: ["没有进到", "下周先出"] },
  { kid: "k_half_now_half_daily_low", all: ["吸一半"], any: ["日k", "日K"] },
  { kid: "k_higher_low_is_bottom", all: ["最低点"], any: ["高于昨天", "低点上移"] },
  { kid: "k_index_weak_only_mega", any: ["七姐妹", "低于680"] },
  { kid: "k_first_half_hour_passive_plus_friday", any: ["第一个半小时"] },
  { kid: "k_vote_fail_then_conl_band", any: ["投票失败"] },
  { kid: "k_sales_print_tests_high", any: ["销量"] },
  { kid: "k_pre_earnings_avoid_then_range", any: ["8W", "8万"] }
];

export function foldWs(s) {
  return String(s || "").replace(/[，,。、]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function evidenceOk(span, corpus) {
  const a = foldWs(span);
  const b = foldWs(corpus);
  if (a.length < 8) return false;
  if (b.includes(a)) return true;
  // 允许删掉「你/就」后仍命中
  const a2 = a.replace(/你/g, "").replace(/就/g, " ");
  return b.replace(/你/g, "").includes(foldWs(a2));
}

export function routeKid(atom) {
  const text = `${atom.evidence_span || ""} ${atom.statement || ""}`;
  for (const r of ROUTES) {
    const okAll = !r.all || r.all.every((w) => text.includes(w));
    const okAny = !r.any || r.any.some((w) => text.includes(w));
    if (okAll && okAny) return r.kid;
  }
  const aliased = KID_ALIASES[atom.kid] || atom.kid;
  return KNOWN_KIDS.includes(aliased) ? aliased : aliased;
}

export function remapAtom(atom, corpus) {
  const kid = routeKid(atom);
  const span_ok = evidenceOk(atom.evidence_span, corpus);
  return {
    ...atom,
    kid,
    kid_known: KNOWN_KIDS.includes(kid),
    span_ok,
    routed: kid !== atom.kid
  };
}
