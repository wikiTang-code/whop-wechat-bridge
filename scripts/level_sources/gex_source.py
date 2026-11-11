"""
GEX (Gamma Exposure) 数据源实现
负责从快照 JSON 解析 zero_dte 和 matrix 中的 KING、FLOOR、前 3 大正墙与负墙。
"""
import glob
import json
import os
from typing import Dict, List, Optional
from .base import KeyLevel, LevelSource


class GexLevelSource(LevelSource):
    def __init__(
        self,
        snapshot_path: Optional[str] = None,
        fallback_patterns: Optional[List[str]] = None,
        exclude_king_floor: bool = True
    ):
        self.snapshot_path = snapshot_path or "data/gex/latest.json"
        self.fallback_patterns = fallback_patterns or [
            "data/gex/*/latest.json",
            "data/gex/*/snapshot_*.json",
            "data/gex/snapshot_*.json"
        ]
        self.exclude_king_floor = exclude_king_floor
        self.data: Dict = {}
        self.generated_at: str = ""
        self.published_date: str = ""
        self._load_snapshot()

    def _get_project_root(self) -> str:
        # scripts/level_sources -> scripts -> root
        return os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

    def _resolve_path(self) -> Optional[str]:
        root = self._get_project_root()

        # 1. 尝试直接给出的路径
        if self.snapshot_path:
            candidates = [
                self.snapshot_path,
                os.path.join(root, self.snapshot_path),
            ]
            for p in candidates:
                if os.path.isfile(p):
                    return os.path.normpath(p)

        # 2. 尝试 fallback patterns 找最新快照
        matched_files = []
        for pat in self.fallback_patterns:
            full_pat = pat if os.path.isabs(pat) else os.path.join(root, pat)
            found = glob.glob(full_pat)
            matched_files.extend(found)

        if matched_files:
            # 按文件修改时间取最新的
            matched_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            return os.path.normpath(matched_files[0])

        return None

    def _load_snapshot(self):
        resolved = self._resolve_path()
        if not resolved:
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
            parent_expiry = item.get("expiry") or self.published_date

            king_strike = None
            floor_strike = None

            # KING: net_gex 最小 (最负 Gamma) 那格
            king = item.get("king")
            if king and king.get("strike") is not None:
                king_strike = float(king["strike"])
                levels.append(KeyLevel(
                    symbol=sym,
                    price=king_strike,
                    label="GEX KING",
                    published_at=self.published_date,
                    group="gex_king",
                    amount=king.get("net_gex"),
                    expiry=parent_expiry,
                    note="0DTE net_gex 最小(最负 Gamma) 磁吸点位"
                ))

            # FLOOR: net_gex 最大 (正 Gamma 最高) 那格
            floor = item.get("floor")
            if floor and floor.get("strike") is not None:
                floor_strike = float(floor["strike"])
                levels.append(KeyLevel(
                    symbol=sym,
                    price=floor_strike,
                    label="GEX FLOOR",
                    published_at=self.published_date,
                    group="gex_floor",
                    amount=floor.get("net_gex"),
                    expiry=parent_expiry,
                    note="0DTE 正 Gamma 顶部/阻尼地板"
                ))

            # 正墙与负墙 (ladder)
            ladder = item.get("ladder", [])
            pos_candidates = [w for w in ladder if w.get("net_gex", 0) > 0]
            neg_candidates = [w for w in ladder if w.get("net_gex", 0) < 0]

            if self.exclude_king_floor:
                if floor_strike is not None:
                    pos_candidates = [w for w in pos_candidates if float(w.get("strike", 0)) != floor_strike]
                if king_strike is not None:
                    neg_candidates = [w for w in neg_candidates if float(w.get("strike", 0)) != king_strike]

            pos_walls = sorted(pos_candidates, key=lambda x: x["net_gex"], reverse=True)[:3]
            neg_walls = sorted(neg_candidates, key=lambda x: x["net_gex"])[:3]

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

            king_strike = None
            floor_strike = None

            # KING: net_gex 最小那格
            king = item.get("king")
            if king and king.get("strike") is not None:
                king_strike = float(king["strike"])
                levels.append(KeyLevel(
                    symbol=sym,
                    price=king_strike,
                    label="GEX KING",
                    published_at=self.published_date,
                    group="gex_king",
                    amount=king.get("net_gex"),
                    expiry=king.get("expiry"),
                    note="Matrix 全到期日 net_gex 最小(最负 Gamma) 极值"
                ))

            # FLOOR
            floor = item.get("floor")
            if floor and floor.get("strike") is not None:
                floor_strike = float(floor["strike"])
                levels.append(KeyLevel(
                    symbol=sym,
                    price=floor_strike,
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
                        cells.append({"strike": float(st), "expiry": exp, "net_gex": gex})

            pos_candidates = [c for c in cells if c["net_gex"] > 0]
            neg_candidates = [c for c in cells if c["net_gex"] < 0]

            if self.exclude_king_floor:
                if floor_strike is not None:
                    pos_candidates = [c for c in pos_candidates if c["strike"] != floor_strike]
                if king_strike is not None:
                    neg_candidates = [c for c in neg_candidates if c["strike"] != king_strike]

            pos_cells = sorted(pos_candidates, key=lambda x: x["net_gex"], reverse=True)[:3]
            neg_cells = sorted(neg_candidates, key=lambda x: x["net_gex"])[:3]

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
