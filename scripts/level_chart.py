#!/usr/bin/env python3
"""
交互式点位 K 线图生成器 (Interactive Level Chart Generator)
============================================================
功能特性：
1. 日线 / 小时线 (1D / 1H) 双周期动态切换；
2. 离线交互式单文件 HTML (基于 Plotly)，支持平移、缩放、价格悬停；
3. 多源点位叠加与独立分组显隐控制：
   - 1) GEX KING
   - 2) GEX FLOOR
   - 3) GEX 前 3 大正墙与前 3 大负墙 (标注金额与到期日)
   - 4) 波动哥最新日内点位 (标注发布日期)
   - 5) SPXL 3x 杠杆非线性映射线 (SPXL = 246.75 * (1 + 3 * (SPX / 7376.86 - 1)))
   - 6) 手动点位配置
4. 现价最近上下两条关键线高亮并实时计算点数差与百分比；
5. 标的快捷下拉选择与全局总览门户；
6. 支持 CLI 参数绘制任意代码 (如 --symbol PLTR)。

用法示例：
  # 1. 为验收四标的生成 HTML 与 PNG：
  python scripts/level_chart.py --symbols SPY,SPX,SPXL,NVDA --png

  # 2. 绘制任意标的 (如不在默认列表的 PLTR)：
  python scripts/level_chart.py --symbol PLTR

  # 3. 批量生成全部标的及索引页面：
  python scripts/level_chart.py --all
"""

import argparse
import json
import os
import sys
import time
import traceback
from datetime import datetime
from typing import Dict, List, Optional, Tuple

if sys.platform == "win32":
    import io
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import pandas as pd
import plotly.graph_objects as go
import yaml
import yfinance as yf

# 导入点位数据源协议与实现
try:
    from level_sources import (
        BodonggeLevelSource,
        GexLevelSource,
        KeyLevel,
        ManualLevelSource,
        SPXLMappingLevelSource,
    )
except ImportError:
    from scripts.level_sources import (
        BodonggeLevelSource,
        GexLevelSource,
        KeyLevel,
        ManualLevelSource,
        SPXLMappingLevelSource,
    )

DEFAULT_CONFIG_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "config", "level_chart.yaml")
)


def load_config(config_path: str = DEFAULT_CONFIG_PATH) -> dict:
    if not os.path.exists(config_path):
        print(f"[Config] 配置文件不存在: {config_path}，使用内置默认配置")
        return {}
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class LevelChartBuilder:
    def __init__(self, config: dict, snapshot_path: Optional[str] = None, out_dir: Optional[str] = None):
        self.config = config
        self.out_dir = out_dir or config.get("output", {}).get(
            "dir",
            os.path.normpath(
                os.path.join(os.path.dirname(__file__), "..", "..", "scratch", "level-chart-20261111", "out")
            ),
        )
        os.makedirs(self.out_dir, exist_ok=True)

        # 1. 初始化 GEX 数据源
        gex_cfg = config.get("gex", {})
        snap_path = snapshot_path or gex_cfg.get("snapshot_path", "")
        fallbacks = gex_cfg.get("fallback_paths", [])
        self.gex_source = GexLevelSource(snap_path, fallbacks)

        # 2. 初始化 波动哥数据源
        bdg_cfg = config.get("level_sources", {}).get("bodongge", {})
        bdg_path = bdg_cfg.get("path", "")
        bdg_fallbacks = bdg_cfg.get("fallback_paths", [])
        spxl_cfg = config.get("spxl_mapping", {})
        self.bodongge_source = BodonggeLevelSource(
            file_path=bdg_path,
            fallback_paths=bdg_fallbacks,
            target_symbol=bdg_cfg.get("target_symbol", "SPX"),
            spxl_base_spxl=float(spxl_cfg.get("base_spxl", 246.75)),
            spxl_base_spx=float(spxl_cfg.get("base_spx", 7376.86)),
            spxl_factor=float(spxl_cfg.get("factor", 3.0)),
        )

        # 3. 初始化 SPXL 映射数据源
        self.spxl_source = SPXLMappingLevelSource(
            base_spxl=float(spxl_cfg.get("base_spxl", 246.75)),
            base_spx=float(spxl_cfg.get("base_spx", 7376.86)),
            factor=float(spxl_cfg.get("factor", 3.0)),
            reference_points=spxl_cfg.get("reference_points", []),
            gex_source=self.gex_source,
        )

        # 4. 初始化 手动点位数据源
        self.manual_source = ManualLevelSource(config.get("manual_levels", {}))

    def fetch_klines(self, symbol: str) -> Tuple[Optional[pd.DataFrame], Optional[pd.DataFrame]]:
        """
        拉取 1D 与 1H K线数据
        """
        sym = symbol.upper()
        symbol_map = self.config.get("market_data", {}).get("symbol_map", {})
        yf_symbol = symbol_map.get(sym, sym)

        periods_cfg = self.config.get("market_data", {}).get("periods", {})
        daily_period = periods_cfg.get("daily", {}).get("period", "3mo")
        daily_interval = periods_cfg.get("daily", {}).get("interval", "1d")
        hourly_period = periods_cfg.get("hourly", {}).get("period", "1mo")
        hourly_interval = periods_cfg.get("hourly", {}).get("interval", "1h")

        try:
            ticker = yf.Ticker(yf_symbol)
            df_daily = ticker.history(period=daily_period, interval=daily_interval)
            df_hourly = ticker.history(period=hourly_period, interval=hourly_interval)

            if df_daily.empty:
                print(f"[MarketData] 警告: 未获取到 {sym} ({yf_symbol}) 日线数据")
                df_daily = None
            if df_hourly.empty:
                print(f"[MarketData] 警告: 未获取到 {sym} ({yf_symbol}) 小时线数据")
                df_hourly = None

            return df_daily, df_hourly
        except Exception as e:
            print(f"[MarketData] 获取行情失败 {sym}: {e}")
            return None, None

    def aggregate_levels(self, symbol: str) -> List[KeyLevel]:
        """汇总该标的所有源的关键点位"""
        levels: List[KeyLevel] = []
        sym = symbol.upper()

        # GEX
        levels.extend(self.gex_source.get_levels(sym))

        # 波动哥
        levels.extend(self.bodongge_source.get_levels(sym))

        # SPXL 专用映射
        if sym == "SPXL":
            levels.extend(self.spxl_source.get_levels(sym))

        # 手动点位
        levels.extend(self.manual_source.get_levels(sym))

        return levels

    def _determine_nearest_levels(
        self, spot: float, levels: List[KeyLevel]
    ) -> Tuple[Optional[KeyLevel], Optional[KeyLevel]]:
        """计算离现价最近的上下两条点位线"""
        above_candidates = [lv for lv in levels if lv.price > spot]
        below_candidates = [lv for lv in levels if lv.price < spot]

        nearest_above = min(above_candidates, key=lambda x: x.price) if above_candidates else None
        nearest_below = max(below_candidates, key=lambda x: x.price) if below_candidates else None

        return nearest_above, nearest_below

    def generate_chart(self, symbol: str, export_png: bool = False) -> str:
        sym = symbol.upper()
        print(f"\n================ 正在生成标的: {sym} ================")
        start_t = time.time()

        # 1. 获取行情
        df_daily, df_hourly = self.fetch_klines(sym)
        if df_daily is None and df_hourly is None:
            raise RuntimeError(f"无法拉取 {sym} 的行情数据")

        # 确定主数据与现价 spot
        base_df = df_daily if df_daily is not None else df_hourly
        last_close = float(base_df["Close"].iloc[-1])

        # 如果在 GEX 快照中有 spot 则参考快照，否则以最新收盘价为准
        gex_spot = None
        if sym in self.gex_source.data.get("zero_dte", {}):
            gex_spot = self.gex_source.data["zero_dte"][sym].get("spot")
        elif sym in self.gex_source.data.get("matrix", {}):
            gex_spot = self.gex_source.data["matrix"][sym].get("spot")

        current_spot = float(gex_spot) if gex_spot is not None else last_close

        # 2. 收集各源点位
        all_levels = self.aggregate_levels(sym)
        nearest_above, nearest_below = self._determine_nearest_levels(current_spot, all_levels)

        # 3. 创建 Plotly 图表
        fig = go.Figure()

        # 计算 X 轴起止时间供绘制水平线
        x_min = base_df.index.min()
        x_max = base_df.index.max()

        # Trace 0: 日线 K 线 (初始显示)
        has_daily = df_daily is not None and not df_daily.empty
        if has_daily:
            fig.add_trace(
                go.Candlestick(
                    x=df_daily.index,
                    open=df_daily["Open"],
                    high=df_daily["High"],
                    low=df_daily["Low"],
                    close=df_daily["Close"],
                    name="日K (1D)",
                    increasing_line_color="#26a69a",
                    decreasing_line_color="#ef5350",
                    visible=True,
                    hoverinfo="all",
                )
            )

        # Trace 1: 小时线 K 线 (初始隐藏)
        has_hourly = df_hourly is not None and not df_hourly.empty
        if has_hourly:
            fig.add_trace(
                go.Candlestick(
                    x=df_hourly.index,
                    open=df_hourly["Open"],
                    high=df_hourly["High"],
                    low=df_hourly["Low"],
                    close=df_hourly["Close"],
                    name="1小时K (1H)",
                    increasing_line_color="#26a69a",
                    decreasing_line_color="#ef5350",
                    visible=False if has_daily else True,
                    hoverinfo="all",
                )
            )

        # 点位线条配色与样式映射
        style_map = {
            "gex_king": {"color": "#ff9800", "dash": "solid", "width": 2.2, "name": "GEX KING"},
            "gex_floor": {"color": "#00e676", "dash": "solid", "width": 2.2, "name": "GEX FLOOR"},
            "gex_wall": {"color": "#00b0ff", "dash": "dash", "width": 1.5, "name": "GEX 关键墙"},
            "bodongge": {"color": "#e040fb", "dash": "dot", "width": 1.8, "name": "波动哥点位"},
            "spxl_mapped": {"color": "#ffd600", "dash": "dashdot", "width": 1.8, "name": "SPXL映射线"},
            "manual": {"color": "#90a4ae", "dash": "dash", "width": 1.5, "name": "自定义点位"},
        }

        # 4. 绘制水平点位线并标记高亮最近线
        # 为支持 HTML 原生复选框，给每个 trace 记录 meta 属性
        for lvl in all_levels:
            is_above_hit = nearest_above is not None and lvl == nearest_above
            is_below_hit = nearest_below is not None and lvl == nearest_below
            is_nearest = is_above_hit or is_below_hit

            s_cfg = style_map.get(lvl.group, {"color": "#bdbdbd", "dash": "dash", "width": 1.5})
            line_color = s_cfg["color"]
            line_dash = s_cfg["dash"]
            line_width = s_cfg["width"]

            dist_str = ""
            if is_above_hit:
                pts = lvl.price - current_spot
                pct = pts / current_spot * 100.0
                dist_str = f" [最近阻力 +{pts:.2f} / +{pct:.2f}%]"
                line_width = 3.2
                line_color = "#ff1744"
            elif is_below_hit:
                pts = lvl.price - current_spot
                pct = pts / current_spot * 100.0
                dist_str = f" [最近支撑 {pts:.2f} / {pct:.2f}%]"
                line_width = 3.2
                line_color = "#00e676"

            hover_text = f"<b>{lvl.label}</b>{dist_str}<br>价格: <b>{lvl.price:.2f}</b>"
            if lvl.amount is not None:
                hover_text += f"<br>金额: ${lvl.amount/1e6:.2f}M" if abs(lvl.amount) >= 1e6 else f"<br>金额: ${lvl.amount:.2f}"
            if lvl.expiry:
                hover_text += f"<br>到期: {lvl.expiry}"
            if lvl.published_at:
                hover_text += f"<br>发布: {lvl.published_at}"
            if lvl.note:
                hover_text += f"<br>说明: {lvl.note}"

            fig.add_trace(
                go.Scatter(
                    x=[x_min, x_max],
                    y=[lvl.price, lvl.price],
                    mode="lines",
                    name=f"{lvl.label} ({lvl.price:.2f}){dist_str}",
                    legendgroup=lvl.group,
                    line=dict(color=line_color, width=line_width, dash=line_dash),
                    hovertext=hover_text,
                    hoverinfo="text",
                    meta={"group": lvl.group, "is_nearest": is_nearest, "price": lvl.price},
                )
            )

        # 5. 现价水平基准线 (金黄色点划线)
        fig.add_trace(
            go.Scatter(
                x=[x_min, x_max],
                y=[current_spot, current_spot],
                mode="lines",
                name=f"现价基准: {current_spot:.2f}",
                legendgroup="spot",
                line=dict(color="#ffffff", width=1.5, dash="dot"),
                hovertext=f"<b>现价基准 (Spot)</b>: {current_spot:.2f}",
                hoverinfo="text",
                meta={"group": "spot"},
            )
        )

        # 6. 配置交互按钮 (日线 / 小时线切换)
        updatemenus = []
        if has_daily and has_hourly:
            # 日线激活：trace 0 显示，trace 1 隐藏
            # 小时线激活：trace 0 隐藏，trace 1 显示
            # 后续水平点位 lines 保持显示
            total_traces = len(fig.data)
            daily_vis = [True, False] + [True] * (total_traces - 2)
            hourly_vis = [False, True] + [True] * (total_traces - 2)

            updatemenus = [
                dict(
                    type="buttons",
                    direction="left",
                    x=0.01,
                    y=1.12,
                    showactive=True,
                    bgcolor="#2a2e39",
                    bordercolor="#4f5966",
                    font=dict(color="#ffffff", size=12),
                    buttons=[
                        dict(
                            label="📅 日线 (1D)",
                            method="update",
                            args=[{"visible": daily_vis}, {"xaxis.rangeslider.visible": False}],
                        ),
                        dict(
                            label="⏱ 小时线 (1H)",
                            method="update",
                            args=[{"visible": hourly_vis}, {"xaxis.rangeslider.visible": False}],
                        ),
                    ],
                )
            ]

        # 7. 布局与样式设计 (深色专业交易风格)
        fig.update_layout(
            title=dict(
                text=f"<b>{sym}</b> 关键点位与结构 K 线图 (Spot: {current_spot:.2f})",
                font=dict(size=18, color="#f0f3f6"),
                x=0.02,
                y=0.96,
            ),
            template="plotly_dark",
            paper_bgcolor="#131722",
            plot_bgcolor="#131722",
            dragmode="zoom",
            hovermode="x unified",
            xaxis=dict(
                rangeslider=dict(visible=False),
                gridcolor="#1f2430",
                showgrid=True,
                zeroline=False,
            ),
            yaxis=dict(
                side="right",
                gridcolor="#1f2430",
                showgrid=True,
                zeroline=False,
                tickformat=".2f",
            ),
            legend=dict(
                orientation="v",
                x=1.06,
                y=1.0,
                bgcolor="rgba(19, 23, 34, 0.8)",
                bordercolor="#2a2e39",
                font=dict(color="#c4cad4", size=11),
                groupclick="toggleitem",
            ),
            margin=dict(l=40, r=120, t=100, b=40),
            updatemenus=updatemenus,
        )

        # 8. 包装 HTML 页面 (注入快速下拉、复选框控制器与响应式样式)
        chart_div = fig.to_html(full_html=False, include_plotlyjs="cdn")
        html_content = self._wrap_html(sym, current_spot, nearest_above, nearest_below, chart_div)

        out_html_path = os.path.join(self.out_dir, f"{sym}.html")
        with open(out_html_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        # 9. 导出静态 PNG (若开启)
        if export_png:
            out_png_path = os.path.join(self.out_dir, f"{sym}.png")
            try:
                fig.write_image(out_png_path, width=1400, height=850, scale=1.5)
                print(f"   [PNG] 静态 PNG 已生成: {out_png_path}")
            except Exception as e:
                print(f"   [WARN] PNG 导出未执行: {e}")

        elapsed = time.time() - start_t
        print(f"   [SUCCESS] HTML 图表已生成: {out_html_path} (耗时: {elapsed:.2f}s)")
        return out_html_path

    def _wrap_html(
        self,
        symbol: str,
        spot: float,
        above: Optional[KeyLevel],
        below: Optional[KeyLevel],
        chart_div: str,
    ) -> str:
        default_symbols = self.config.get("default_symbols", [])

        # 计算上下关键距离
        above_desc = "无明显上方阻力"
        if above:
            pts = above.price - spot
            pct = pts / spot * 100.0
            above_desc = f"<b>{above.label}</b> {above.price:.2f} (<b>+{pts:.2f}</b> / <b>+{pct:.2f}%</b>)"

        below_desc = "无明显下方支撑"
        if below:
            pts = below.price - spot
            pct = pts / spot * 100.0
            below_desc = f"<b>{below.label}</b> {below.price:.2f} (<b>{pts:.2f}</b> / <b>{pct:.2f}%</b>)"

        options_html = "".join(
            f'<option value="{s}.html" {"selected" if s==symbol else ""}>{s}</option>'
            for s in default_symbols
        )

        return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{symbol} 交互式点位 K 线图</title>
  <style>
    body {{
      margin: 0;
      padding: 0;
      background-color: #0b0e14;
      color: #e0e6ed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    .header-bar {{
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: #131722;
      border-bottom: 1px solid #232733;
    }}
    .brand-section {{
      display: flex;
      align-items: center;
      gap: 16px;
    }}
    .brand-title {{
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }}
    .select-box {{
      background: #1e222d;
      color: #fff;
      border: 1px solid #363c4e;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 14px;
      outline: none;
      cursor: pointer;
    }}
    .kpi-container {{
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 8px 24px;
      background: #181c27;
      font-size: 13px;
      border-bottom: 1px solid #232733;
    }}
    .kpi-badge {{
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 4px;
      background: #232733;
    }}
    .kpi-badge.spot {{ background: #2a2e39; color: #fff; font-weight: 600; }}
    .kpi-badge.above {{ background: rgba(239, 83, 80, 0.15); color: #ef5350; border: 1px solid rgba(239, 83, 80, 0.3); }}
    .kpi-badge.below {{ background: rgba(38, 166, 154, 0.15); color: #26a69a; border: 1px solid rgba(38, 166, 154, 0.3); }}
    
    .filter-bar {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 16px;
      padding: 8px 24px;
      background: #131722;
      font-size: 13px;
      border-bottom: 1px solid #232733;
    }}
    .filter-item {{
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }}
    .filter-item input {{
      cursor: pointer;
    }}
    .chart-container {{
      width: 100vw;
      height: calc(100vh - 140px);
    }}
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="brand-section">
      <span class="brand-title">📈 交互式关键点位 K 线图</span>
      <select class="select-box" onchange="if(this.value) window.location.href=this.value;">
        <option value="">快速切换标的...</option>
        {options_html}
      </select>
      <input type="text" id="symbolInput" class="select-box" style="width: 110px;" placeholder="任意代码 (如PLTR)" onkeydown="if(event.key==='Enter') goToSymbol()">
      <button class="select-box" style="background: #2962ff; border-color: #2962ff;" onclick="goToSymbol()">直达</button>
      <a href="index.html" style="color: #2962ff; font-size: 13px; text-decoration: none; margin-left: 8px;">总索引门户 ↗</a>
    </div>
    <div style="font-size: 12px; color: #787b86;">
      数据源: yfinance (^GSPC / Spot) & GEX Snapshot
    </div>
  </div>

  <div class="kpi-container">
    <div class="kpi-badge spot">现价 Spot: {spot:.2f}</div>
    <div class="kpi-badge above">🔺 最近上方阻力: {above_desc}</div>
    <div class="kpi-badge below">🔻 最近下方支撑: {below_desc}</div>
  </div>

  <div class="filter-bar">
    <span style="color: #787b86;">点位图层过滤:</span>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('gex_king', this.checked)"> <span style="color: #ff9800;">■</span> GEX KING</label>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('gex_floor', this.checked)"> <span style="color: #00e676;">■</span> GEX FLOOR</label>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('gex_wall', this.checked)"> <span style="color: #00b0ff;">■</span> GEX 前3正/负墙</label>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('bodongge', this.checked)"> <span style="color: #e040fb;">■</span> 波动哥点位</label>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('spxl_mapped', this.checked)"> <span style="color: #ffd600;">■</span> SPXL映射线</label>
    <label class="filter-item"><input type="checkbox" checked onchange="toggleGroup('manual', this.checked)"> <span style="color: #90a4ae;">■</span> 手动点位</label>
  </div>

  <div class="chart-container">
    {chart_div}
  </div>

  <script>
    function goToSymbol() {{
      const sym = document.getElementById('symbolInput').value.trim().toUpperCase();
      if (!sym) return;
      window.location.href = sym + '.html';
    }}

    function toggleGroup(groupName, isVisible) {{
      const plotEl = document.querySelector('.plotly-graph-div');
      if (!plotEl || !plotEl.data) return;

      const updateIndices = [];
      const visibilities = [];

      plotEl.data.forEach((trace, idx) => {{
        if (trace.meta && trace.meta.group === groupName) {{
          updateIndices.push(idx);
          visibilities.push(isVisible ? true : false);
        }}
      }});

      if (updateIndices.length > 0) {{
        Plotly.restyle(plotEl, {{ visible: isVisible }}, updateIndices);
      }}
    }}
  </script>
</body>
</html>
"""

    def generate_index_page(self, generated_symbols: List[str]) -> str:
        """生成总导航页面 index.html"""
        cards_html = ""
        for sym in generated_symbols:
            cards_html += f"""
            <a href="{sym}.html" class="symbol-card">
              <div class="card-title">{sym}</div>
              <div class="card-desc">交互式点位 K 线图与结构分析</div>
              <div class="card-link">进入图表 →</div>
            </a>
            """

        all_syms = self.config.get("default_symbols", [])
        not_generated = [s for s in all_syms if s not in generated_symbols]
        other_list_html = ", ".join(
            f'<a href="{s}.html" style="color: #787b86; text-decoration: none;">{s}</a>'
            for s in not_generated
        )

        content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>交互式点位 K 线看板导航门户</title>
  <style>
    body {{
      margin: 0;
      padding: 32px 48px;
      background-color: #0b0e14;
      color: #e0e6ed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    .header {{
      margin-bottom: 32px;
    }}
    h1 {{
      font-size: 28px;
      color: #fff;
      margin-bottom: 8px;
    }}
    .subtitle {{
      color: #787b86;
      font-size: 14px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }}
    .symbol-card {{
      display: block;
      padding: 24px;
      background: #131722;
      border: 1px solid #232733;
      border-radius: 8px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s ease;
    }}
    .symbol-card:hover {{
      transform: translateY(-2px);
      border-color: #2962ff;
      box-shadow: 0 4px 16px rgba(41, 98, 255, 0.2);
    }}
    .card-title {{
      font-size: 22px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 8px;
    }}
    .card-desc {{
      font-size: 13px;
      color: #787b86;
      margin-bottom: 16px;
    }}
    .card-link {{
      font-size: 13px;
      color: #2962ff;
      font-weight: 600;
    }}
    .cli-box {{
      background: #131722;
      border: 1px solid #232733;
      border-radius: 8px;
      padding: 20px;
      margin-top: 24px;
    }}
    code {{
      background: #1e222d;
      padding: 2px 6px;
      border-radius: 4px;
      color: #00e676;
    }}
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 交互式点位 K 线图看板总览</h1>
    <div class="subtitle">集成 GEX KING / FLOOR / 正负墙、波动哥点位、SPXL 3x 非线性映射及手动自定义点位</div>
  </div>

  <h2>已就绪标的</h2>
  <div class="grid">
    {cards_html}
  </div>

  <div class="cli-box">
    <h3>🛠 自定义标的出图指南</h3>
    <p>输入任意美股标的代码（如 PLTR、TSLA 等），即使未在快照中，也可随时通过 CLI 独立出图：</p>
    <code>python scripts/level_chart.py --symbol PLTR --png</code>
  </div>
</body>
</html>
"""
        index_path = os.path.join(self.out_dir, "index.html")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"[SUCCESS] 总导航页面已生成: {index_path}")
        return index_path


def parse_args():
    parser = argparse.ArgumentParser(description="生成交互式点位 K 线图")
    parser.add_argument("--symbol", type=str, help="单个标的代码 (如 NVDA 或 PLTR)")
    parser.add_argument("--symbols", type=str, help="多个标的代码逗号分隔 (如 SPY,SPX,SPXL,NVDA)")
    parser.add_argument("--all", action="store_true", help="批量生成配置中所有默认标的")
    parser.add_argument("--snapshot", type=str, help="指定 GEX 快照 JSON 路径")
    parser.add_argument("--out-dir", type=str, help="输出目录路径")
    parser.add_argument("--png", action="store_true", help="同时导出静态 PNG 图表")
    parser.add_argument("--config", type=str, default=DEFAULT_CONFIG_PATH, help="指定配置文件路径")
    return parser.parse_args()


def main():
    args = parse_args()
    config = load_config(args.config)
    builder = LevelChartBuilder(config, snapshot_path=args.snapshot, out_dir=args.out_dir)

    target_symbols = []
    if args.symbol:
        target_symbols = [args.symbol.strip().upper()]
    elif args.symbols:
        target_symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    elif args.all:
        target_symbols = config.get("default_symbols", ["SPY", "SPX", "SPXL", "NVDA"])
    else:
        # 默认只生成四个核心验收标的
        target_symbols = ["SPY", "SPX", "SPXL", "NVDA"]

    generated = []
    total_start = time.time()
    for sym in target_symbols:
        try:
            builder.generate_chart(sym, export_png=args.png)
            generated.append(sym)
        except Exception as e:
            print(f"[Error] 生成 {sym} 失败: {e}")

    # 生成总导航页面
    builder.generate_index_page(generated)
    total_elapsed = time.time() - total_start
    print(f"\n[DONE] 全部任务完成！共生成 {len(generated)} 个标的，总耗时: {total_elapsed:.2f}s")


if __name__ == "__main__":
    main()
