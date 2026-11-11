"""
SPXL 专用映射数据源
计算基于 SPX 标普500基准与 3 倍杠杆公式换算出的关键锚点映射线。
"""
from typing import Dict, List, Optional
from .base import KeyLevel, LevelSource


class SPXLMappingLevelSource(LevelSource):
    def __init__(
        self,
        base_spxl: float = 246.75,
        base_spx: float = 7376.86,
        factor: float = 3.0,
        reference_points: Optional[List[Dict]] = None,
        gex_source: Optional[LevelSource] = None
    ):
        self.base_spxl = base_spxl
        self.base_spx = base_spx
        self.factor = factor
        self.reference_points = reference_points or []
        self.gex_source = gex_source

    def map_spx_to_spxl(self, spx_price: float) -> float:
        return self.base_spxl * (1.0 + self.factor * (spx_price / self.base_spx - 1.0))

    def get_levels(self, symbol: str) -> List[KeyLevel]:
        if symbol.upper() != "SPXL":
            return []

        levels: List[KeyLevel] = []

        # 1. 静态基准参考点
        for ref in self.reference_points:
            spx_val = ref.get("spx")
            if spx_val is not None:
                spxl_val = self.map_spx_to_spxl(spx_val)
                label_desc = ref.get("label", "基准锚点")
                levels.append(KeyLevel(
                    symbol="SPXL",
                    price=spxl_val,
                    label=f"SPXL映射: {label_desc} (SPX={spx_val:g})",
                    published_at="2026-11-11",
                    group="spxl_mapped",
                    note=f"换算公式: SPXL=246.75*(1+3*(SPX/7376.86-1))"
                ))

        # 2. 如果关联了 GEX，把 SPX 的 KING 与 FLOOR 也映射并归入 spxl_mapped
        if self.gex_source:
            spx_levels = self.gex_source.get_levels("SPX")
            for sl in spx_levels:
                if sl.group in ("gex_king", "gex_floor"):
                    mapped_p = self.map_spx_to_spxl(sl.price)
                    levels.append(KeyLevel(
                        symbol="SPXL",
                        price=mapped_p,
                        label=f"SPXL映射: {sl.label} (SPX {sl.price:g})",
                        published_at=sl.published_at,
                        group="spxl_mapped",
                        amount=sl.amount,
                        expiry=sl.expiry,
                        note=f"由 SPX {sl.label} 3x映射"
                    ))

        return levels
