"""
LevelSource 抽象协议与基础数据模型
提供关键价格点位 (KeyLevel) 的统一接口规范，支持不同数据源提供者 (Providers) 即插即用。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class KeyLevel:
    """
    统一关键点位数据结构
    """
    symbol: str             # 标的代码 (如 SPX, SPY, NVDA, SPXL)
    price: float            # 价格点位
    label: str              # 点位标签 (如 KING, FLOOR, 正墙1, 波动哥-最上面, 手动阻力)
    published_at: str       # 发布日期或时间 (如 2026-11-11 或 2026-11-11 05:00:58)
    group: str              # 分组归类 (gex_king, gex_floor, gex_wall, bodongge, spxl_mapped, manual)
    amount: Optional[float] = None  # GEX 金额 / 净暴露量 (若适用)
    expiry: Optional[str] = None    # 到期日 (若适用)
    note: Optional[str] = None      # 补充说明/计算公式

    def get_display_name(self) -> str:
        """生成悬停与标签展示文本"""
        parts = [f"{self.label}: {self.price:.2f}"]
        if self.amount is not None:
            # 格式化金额，如 $61.80M 或 -$9.85M
            if abs(self.amount) >= 1e6:
                amt_str = f"${self.amount/1e6:.2f}M"
            elif abs(self.amount) >= 1e3:
                amt_str = f"${self.amount/1e3:.2f}K"
            else:
                amt_str = f"${self.amount:.2f}"
            parts.append(f"金额: {amt_str}")
        if self.expiry:
            parts.append(f"到期: {self.expiry}")
        if self.published_at:
            parts.append(f"发布: {self.published_at}")
        if self.note:
            parts.append(f"({self.note})")
        return " | ".join(parts)


class LevelSource(ABC):
    """
    点位数据源抽象基类 (LevelSource Protocol)
    支持未来通过 API、数据库、文件或消息队列无缝扩展。
    """
    @abstractmethod
    def get_levels(self, symbol: str) -> List[KeyLevel]:
        """
        获取指定标的的所有关键点位
        :param symbol: 标的代码 (大写)
        :return: 包含该标的的所有点位列表
        """
        pass
