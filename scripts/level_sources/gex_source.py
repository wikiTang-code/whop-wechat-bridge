"""
GEX (Gamma Exposure) 数据源实现
负责从快照 JSON 解析 zero_dte 和 matrix 中的 KING、FLOOR、前 3 大正墙与负墙。
"""
import json
import os
from typing import Dict, List, Optional
from .base import KeyLevel, LevelSource


class GexLevelSource(LevelSource):
    def __init__(self, snapshot_path: str, fallback_paths: Optional[List[str]] = None):
        self.snapshot_path = snapshot_path
        self.fallback_paths = fallback_paths or []
        self.data: Dict = {}
        self.generated_at: str = ""
        self.published_date: str = ""
        self._load_snapshot()

    def _resolve_path(self) -> Optional[str]:
        candidates = [self.snapshot_path] + self.fallback_paths
        for p in candidates:
            if not p:
                continue
            if os.path.isabs(p) and os.path.exists(p):
                return p
            # 相对当前工作目录或仓库根目录
            if os.path.exists(p):
                return p
            # 兼容绝对路径和相对路径
            alt_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", p))
            if os.path.exists(alt_path):
                return alt_path
        return None

    def _load_snapshot(self):
        resolved = self._resolve_path()
        if not resolved:
            print(f"[GexLevelSource] 警告: 未找到 GEX 快照文件 (路径: {self.snapshot_path})")
            return

        try:
            with open(resolved, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            self.generated_at = self.data.get("generated_at", "")
            if self.generated_at:
                self.published_date = self.generated_at.split("T")[0]
            print(f"[GexLevelSource] 成功载入 GEX 快照: {resolved} (生成时间: {self.generated_at})")
        except Exception as e:
            print(f"[GexLevelSource] 载入快照失败: {e}")

    def get_levels(self, symbol: str) -> List[KeyLevel]:
        if not self.data:
            return []

        sym = symbol.upper()
        zero_dte = self.data.get("zero_dte", {})
        matrix = self.data.get("matrix", {})

        levels: List[KeyLevel] = []

        # 1. 优先检查 zero_dte
        if sym in zero_dte:
            item = zero_dte[sym]
            parent_expiry = item.get("expiry", self.published_date)

            # KING
            king = item.get("king")
            if king and king.get("strike") is not None:
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(king["strike"]),
                    label="GEX KING",
                    published_at=self.published_date,
                    group="gex_king",
                    amount=king.get("net_gex"),
                    expiry=parent_expiry,
                    note="0DTE 最大绝对净Gamma点位"
                ))

            # FLOOR
            floor = item.get("floor")
            if floor and floor.get("strike") is not None:
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(floor["strike"]),
                    label="GEX FLOOR",
                    published_at=self.published_date,
                    group="gex_floor",
                    amount=floor.get("net_gex"),
                    expiry=parent_expiry,
                    note="0DTE 正Gamma底部/地板"
                ))

            # 正墙与负墙 (ladder)
            ladder = item.get("ladder", [])
            pos_walls = sorted([w for w in ladder if w.get("net_gex", 0) > 0],
                               key=lambda x: x["net_gex"], reverse=True)[:3]
            neg_walls = sorted([w for w in ladder if w.get("net_gex", 0) < 0],
                               key=lambda x: x["net_gex"])[:3]

            for idx, w in enumerate(pos_walls, 1):
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(w["strike"]),
                    label=f"GEX 正墙 #{idx}",
                    published_at=self.published_date,
                    group="gex_wall",
                    amount=w.get("net_gex"),
                    expiry=parent_expiry,
                    note="正 Gamma 阻力墙"
                ))

            for idx, w in enumerate(neg_walls, 1):
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(w["strike"]),
                    label=f"GEX 负墙 #{idx}",
                    published_at=self.published_date,
                    group="gex_wall",
                    amount=w.get("net_gex"),
                    expiry=parent_expiry,
                    note="负 Gamma 磁吸/加速墙"
                ))

            return levels

        # 2. 检查 matrix
        if sym in matrix:
            item = matrix[sym]

            # KING
            king = item.get("king")
            if king and king.get("strike") is not None:
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(king["strike"]),
                    label="GEX KING",
                    published_at=self.published_date,
                    group="gex_king",
                    amount=king.get("net_gex"),
                    expiry=king.get("expiry"),
                    note="Matrix 全到期日净 Gamma 极值"
                ))

            # FLOOR
            floor = item.get("floor")
            if floor and floor.get("strike") is not None:
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(floor["strike"]),
                    label="GEX FLOOR",
                    published_at=self.published_date,
                    group="gex_floor",
                    amount=floor.get("net_gex"),
                    expiry=floor.get("expiry"),
                    note="Matrix 全到期日正 Gamma 极值"
                ))

            # 正墙与负墙 (按单元格 (strike, expiry) 排序)
            cells = []
            for row in item.get("matrix", []):
                st = row.get("strike")
                by_exp = row.get("by_expiry", {})
                for exp, gex in by_exp.items():
                    if gex is not None:
                        cells.append({"strike": st, "expiry": exp, "net_gex": gex})

            pos_cells = sorted([c for c in cells if c["net_gex"] > 0],
                               key=lambda x: x["net_gex"], reverse=True)[:3]
            neg_cells = sorted([c for c in cells if c["net_gex"] < 0],
                               key=lambda x: x["net_gex"])[:3]

            for idx, c in enumerate(pos_cells, 1):
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(c["strike"]),
                    label=f"GEX 正墙 #{idx}",
                    published_at=self.published_date,
                    group="gex_wall",
                    amount=c.get("net_gex"),
                    expiry=c.get("expiry"),
                    note="Matrix 单元格正 Gamma 阻力"
                ))

            for idx, c in enumerate(neg_cells, 1):
                levels.append(KeyLevel(
                    symbol=sym,
                    price=float(c["strike"]),
                    label=f"GEX 负墙 #{idx}",
                    published_at=self.published_date,
                    group="gex_wall",
                    amount=c.get("net_gex"),
                    expiry=c.get("expiry"),
                    note="Matrix 单元格负 Gamma 支撑/磁吸"
                ))

            return levels

        return []
