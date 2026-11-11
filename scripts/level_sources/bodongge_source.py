"""
外部日内点位 (波动哥) 数据源实现
通过 LevelSource 协议解析 Markdown 或 JSON，提取日内关键点位。
支持 SPX 原生点位提取，并在查询 SPXL 时自动按 3 倍杠杆公式换算映射。
"""
import os
import re
from typing import Dict, List, Optional
from .base import KeyLevel, LevelSource


class BodonggeLevelSource(LevelSource):
    """
    波动哥点位数据源 Provider (支持环境变量/文件路径与未来 API 扩展)
    """
    def __init__(
        self,
        file_path: Optional[str] = None,
        fallback_paths: Optional[List[str]] = None,
        env_var: str = "BODONGGE_PATH",
        target_symbol: str = "SPX",
        spxl_base_spxl: float = 246.75,
        spxl_base_spx: float = 7376.86,
        spxl_factor: float = 3.0
    ):
        self.env_var = env_var
        self.file_path = file_path or os.getenv(env_var, "")
        self.fallback_paths = fallback_paths or []
        self.target_symbol = target_symbol.upper()
        self.spxl_base_spxl = spxl_base_spxl
        self.spxl_base_spx = spxl_base_spx
        self.spxl_factor = spxl_factor
        self.latest_levels: List[KeyLevel] = []
        self._parse_source()

    def _get_project_root(self) -> str:
        return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

    def _resolve_path(self) -> Optional[str]:
        # 1. 优先尝试环境变量指定的路径
        env_val = os.getenv(self.env_var)
        if env_val and os.path.isfile(env_val):
            return os.path.normpath(env_val)

        root = self._get_project_root()
        candidates = [self.file_path] + self.fallback_paths
        for p in candidates:
            if not p:
                continue
            if os.path.isabs(p) and os.path.isfile(p):
                return os.path.normpath(p)
            rel = os.path.join(root, p)
            if os.path.isfile(rel):
                return os.path.normpath(rel)
            if os.path.isfile(p):
                return os.path.normpath(p)
        return None

    def _parse_source(self):
        resolved = self._resolve_path()
        if not resolved:
            return

        try:
            with open(resolved, "r", encoding="utf-8") as f:
                content = f.read()
            self._extract_from_text(content)
            if self.latest_levels:
                print(f"[BodonggeLevelSource] 成功解析日内点位: 共 {len(self.latest_levels)} 个点位 (文件: {resolved})")
        except Exception as e:
            print(f"[BodonggeLevelSource] 解析点位文件失败: {e}")

    def _extract_from_text(self, text: str):
        """
        匹配形如:
        - [2026-11-11 05:00:58] Bot: 最上面：7615 / 上面：7575 / 中间：7535 / 下面：7490 / 最下面：7430
        """
        pattern = re.compile(
            r"(?:\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\])?[^\[]*?"
            r"最上面[：:]\s*([0-9.]+)\s*/\s*上面[：:]\s*([0-9.]+)\s*/\s*中间[：:]\s*([0-9.]+)\s*/\s*下面[：:]\s*([0-9.]+)\s*/\s*最下面[：:]\s*([0-9.]+)"
        )

        matches = list(pattern.finditer(text))
        if not matches:
            return

        # 取最后一个匹配项 (最新时间点)
        last_match = matches[-1]
        ts_str = last_match.group(1) or ""
        pub_date = ts_str.split()[0] if (" " in ts_str) else ts_str

        p_top_max = float(last_match.group(2))
        p_top = float(last_match.group(3))
        p_mid = float(last_match.group(4))
        p_bot = float(last_match.group(5))
        p_bot_min = float(last_match.group(6))

        configs = [
            ("波动哥-最上面(极限强阻)", p_top_max),
            ("波动哥-上面(第一阻力)", p_top),
            ("波动哥-中间(多空中轴)", p_mid),
            ("波动哥-下面(第一支撑)", p_bot),
            ("波动哥-最下面(极限支撑)", p_bot_min),
        ]

        time_desc = f" ({ts_str})" if ts_str else ""
        self.latest_levels = [
            KeyLevel(
                symbol=self.target_symbol,
                price=price,
                label=name,
                published_at=pub_date,
                group="bodongge",
                note=f"日内关键点位{time_desc}"
            )
            for name, price in configs
        ]

    def map_spx_to_spxl(self, spx_price: float) -> float:
        """
        SPXL 换算公式:
        SPXL = base_spxl * (1 + factor * (SPX / base_spx - 1))
        """
        return self.spxl_base_spxl * (1.0 + self.spxl_factor * (spx_price / self.spxl_base_spx - 1.0))

    def get_formula_string(self) -> str:
        return f"SPXL = {self.spxl_base_spxl} * (1 + {self.spxl_factor} * (SPX / {self.spxl_base_spx} - 1))"

    def get_levels(self, symbol: str) -> List[KeyLevel]:
        sym = symbol.upper()

        if sym == self.target_symbol:
            return self.latest_levels

        if sym == "SPXL" and self.target_symbol == "SPX":
            mapped_levels = []
            formula_str = self.get_formula_string()
            for lvl in self.latest_levels:
                mapped_price = self.map_spx_to_spxl(lvl.price)
                mapped_levels.append(KeyLevel(
                    symbol="SPXL",
                    price=mapped_price,
                    label=f"{lvl.label} [映射自SPX {lvl.price:g}]",
                    published_at=lvl.published_at,
                    group="bodongge",
                    note=f"{formula_str} (SPX={lvl.price:g})"
                ))
            return mapped_levels

        return []
