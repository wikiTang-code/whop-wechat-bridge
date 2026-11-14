"""
手动点位数据源实现 (ManualLevelSource)
从配置文件中读取用户自定义或交易员临时标注的关键支撑阻力。
"""
from typing import Dict, List
from .base import KeyLevel, LevelSource


class ManualLevelSource(LevelSource):
    def __init__(self, manual_levels_dict: Dict[str, List[Dict]]):
        self.manual_levels_dict = manual_levels_dict or {}

    def get_levels(self, symbol: str) -> List[KeyLevel]:
        sym = symbol.upper()
        raw_list = self.manual_levels_dict.get(sym, [])
        levels: List[KeyLevel] = []

        for item in raw_list:
            if not isinstance(item, dict):
                continue
            price = item.get("price")
            if price is None:
                continue
            levels.append(KeyLevel(
                symbol=sym,
                price=float(price),
                label=item.get("label", "自定义点位"),
                published_at=item.get("published_at", ""),
                group="manual",
                note=item.get("note", "手动配置点位")
            ))
        return levels
