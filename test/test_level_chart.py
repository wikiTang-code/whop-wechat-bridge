"""
单元测试套件: 交互式点位 K 线图与数据源协议
验证 GEX 快照数值精准匹配、SPXL 3点映射换算、波动哥解析与 LevelSource 协议。
"""
import math
import os
import sys
import pytest

# 添加 scripts 到路径
sys.path.insert(0, os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "scripts")))

from level_sources import (
    BodonggeLevelSource,
    GexLevelSource,
    KeyLevel,
    ManualLevelSource,
    SPXLMappingLevelSource,
)


@pytest.fixture
def snapshot_path():
    p = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "data", "gex", "20261111", "snapshot_20261111_081039.json")
    )
    if not os.path.exists(p):
        p = r"C:\Users\86597\.gemini\antigravity\scratch\level-chart-20261111\snapshot_20261111_081039.json"
    return p


@pytest.fixture
def bodongge_path():
    return r"C:\Users\86597\.gemini\antigravity\scratch\level-chart-20261111\stockrocks-波动哥.md"


def test_spxl_three_point_mapping():
    """
    验收项 3: SPXL 换算抽查 3 个点都对
    1. SPX 7376.86 -> SPXL 246.75
    2. SPX 7520.93 -> SPXL 261.2070748937
    3. SPX 7600 -> SPXL 269.1415575191
    """
    mapper = SPXLMappingLevelSource(base_spxl=246.75, base_spx=7376.86, factor=3.0)

    val1 = mapper.map_spx_to_spxl(7376.86)
    assert math.isclose(val1, 246.75, rel_tol=1e-7), f"Expected 246.75, got {val1}"

    val2 = mapper.map_spx_to_spxl(7520.93)
    assert math.isclose(val2, 261.2070748937, rel_tol=1e-7), f"Expected 261.2070748937, got {val2}"

    val3 = mapper.map_spx_to_spxl(7600.0)
    assert math.isclose(val3, 269.1415575191, rel_tol=1e-7), f"Expected 269.1415575191, got {val3}"


def test_gex_spy_values(snapshot_path):
    """
    验收项 2: 对照数值核验 (SPY)
    - SPY spot 749.92；KING 747.0 / -9846008.13；FLOOR 755.0 / 61797835.06；到期 2026-11-11。
      正墙：755.0 / 61797835.06，757.0 / 58410423.63，760.0 / 55567183.64。
      负墙：747.0 / -9846008.13，745.0 / -7472742.16，740.0 / -4945986.89。
    """
    src = GexLevelSource(snapshot_path)
    levels = src.get_levels("SPY")
    assert len(levels) > 0, "SPY 点位不应为空"

    king = next(l for l in levels if l.group == "gex_king")
    assert king.price == 747.0
    assert math.isclose(king.amount, -9846008.13, abs_tol=0.1)
    assert king.expiry == "2026-11-11"

    floor = next(l for l in levels if l.group == "gex_floor")
    assert floor.price == 755.0
    assert math.isclose(floor.amount, 61797835.06, abs_tol=0.1)
    assert floor.expiry == "2026-11-11"

    pos_walls = [l for l in levels if l.group == "gex_wall" and "正墙" in l.label]
    assert [w.price for w in pos_walls] == [755.0, 757.0, 760.0]
    assert math.isclose(pos_walls[0].amount, 61797835.06, abs_tol=0.1)
    assert math.isclose(pos_walls[1].amount, 58410423.63, abs_tol=0.1)
    assert math.isclose(pos_walls[2].amount, 55567183.64, abs_tol=0.1)

    neg_walls = [l for l in levels if l.group == "gex_wall" and "负墙" in l.label]
    assert [w.price for w in neg_walls] == [747.0, 745.0, 740.0]
    assert math.isclose(neg_walls[0].amount, -9846008.13, abs_tol=0.1)
    assert math.isclose(neg_walls[1].amount, -7472742.16, abs_tol=0.1)
    assert math.isclose(neg_walls[2].amount, -4945986.89, abs_tol=0.1)


def test_gex_spx_values(snapshot_path):
    """
    验收项 2: 对照数值核验 (SPX)
    - SPX spot 7520.93；KING 7520.0 / -146803068.27；FLOOR 7600.0 / 8432986.72；到期 2026-11-11。
      正墙：7600.0 / 8432986.72，7575.0 / 8180599.84，7550.0 / 7825137.57。
      负墙：7520.0 / -146803068.27，7510.0 / -81651125.79，7525.0 / -46366400.43。
    """
    src = GexLevelSource(snapshot_path)
    levels = src.get_levels("SPX")

    king = next(l for l in levels if l.group == "gex_king")
    assert king.price == 7520.0
    assert math.isclose(king.amount, -146803068.27, abs_tol=0.1)

    floor = next(l for l in levels if l.group == "gex_floor")
    assert floor.price == 7600.0
    assert math.isclose(floor.amount, 8432986.72, abs_tol=0.1)

    pos_walls = [l for l in levels if l.group == "gex_wall" and "正墙" in l.label]
    assert [w.price for w in pos_walls] == [7600.0, 7575.0, 7550.0]
    assert math.isclose(pos_walls[0].amount, 8432986.72, abs_tol=0.1)
    assert math.isclose(pos_walls[1].amount, 8180599.84, abs_tol=0.1)
    assert math.isclose(pos_walls[2].amount, 7825137.57, abs_tol=0.1)

    neg_walls = [l for l in levels if l.group == "gex_wall" and "负墙" in l.label]
    assert [w.price for w in neg_walls] == [7520.0, 7510.0, 7525.0]
    assert math.isclose(neg_walls[0].amount, -146803068.27, abs_tol=0.1)
    assert math.isclose(neg_walls[1].amount, -81651125.79, abs_tol=0.1)
    assert math.isclose(neg_walls[2].amount, -46366400.43, abs_tol=0.1)


def test_gex_nvda_matrix_values(snapshot_path):
    """
    验收项 2: 对照数值核验 (NVDA - matrix)
    - NVDA spot 168.89；KING 190.0 / 2026-11-20 / -16957348.09；FLOOR 180.0 / 2026-11-11 / 18642964.07。
      正墙单元格：180.0 @ 2026-11-11 / 18642964.07；175.0 @ 2026-11-11 / 17198230.48；172.5 @ 2026-11-11 / 10191964.41。
      负墙单元格：190.0 @ 2026-11-20 / -16957348.09；160.0 @ 2026-11-20 / -7547742.59；165.0 @ 2026-11-11 / -6903682.33。
    """
    src = GexLevelSource(snapshot_path)
    levels = src.get_levels("NVDA")

    king = next(l for l in levels if l.group == "gex_king")
    assert king.price == 190.0
    assert king.expiry == "2026-11-20"
    assert math.isclose(king.amount, -16957348.09, abs_tol=0.1)

    floor = next(l for l in levels if l.group == "gex_floor")
    assert floor.price == 180.0
    assert floor.expiry == "2026-11-11"
    assert math.isclose(floor.amount, 18642964.07, abs_tol=0.1)

    pos_walls = [l for l in levels if l.group == "gex_wall" and "正墙" in l.label]
    assert [w.price for w in pos_walls] == [180.0, 175.0, 172.5]
    assert [w.expiry for w in pos_walls] == ["2026-11-11", "2026-11-11", "2026-11-11"]
    assert math.isclose(pos_walls[0].amount, 18642964.07, abs_tol=0.1)
    assert math.isclose(pos_walls[1].amount, 17198230.48, abs_tol=0.1)
    assert math.isclose(pos_walls[2].amount, 10191964.41, abs_tol=0.1)

    neg_walls = [l for l in levels if l.group == "gex_wall" and "负墙" in l.label]
    assert [w.price for w in neg_walls] == [190.0, 160.0, 165.0]
    assert [w.expiry for w in neg_walls] == ["2026-11-20", "2026-11-20", "2026-11-11"]
    assert math.isclose(neg_walls[0].amount, -16957348.09, abs_tol=0.1)
    assert math.isclose(neg_walls[1].amount, -7547742.59, abs_tol=0.1)
    assert math.isclose(neg_walls[2].amount, -6903682.33, abs_tol=0.1)


def test_bodongge_source(bodongge_path):
    """
    测试波动哥点位解析 (2026-11-11 05:00:58):
    最上面：7615 / 上面：7575 / 中间：7535 / 下面：7490 / 最下面：7430
    """
    src = BodonggeLevelSource(bodongge_path, target_symbol="SPX")
    spx_levels = src.get_levels("SPX")
    assert len(spx_levels) == 5
    prices = [l.price for l in spx_levels]
    assert prices == [7615.0, 7575.0, 7535.0, 7490.0, 7430.0]
    assert all(l.published_at == "2026-11-11" for l in spx_levels)

    # 映射到 SPXL
    spxl_levels = src.get_levels("SPXL")
    assert len(spxl_levels) == 5
    # 最上面 7615 映射到 SPXL
    p_spxl_top = 246.75 * (1 + 3 * (7615.0 / 7376.86 - 1))
    assert math.isclose(spxl_levels[0].price, p_spxl_top, rel_tol=1e-7)


def test_missing_symbol_graceful():
    """测试不在快照里的代码 (如 PLTR) 优雅处理不报错"""
    src = GexLevelSource("non_existent_file.json")
    levels = src.get_levels("PLTR")
    assert levels == []
