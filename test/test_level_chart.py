"""
单元测试套件: 交互式点位 K 线图与数据源协议
全部使用 test/fixtures/ 纯本地相对路径小样本，不依赖任何外部机器绝对路径。
"""
import math
import os
import sys
import pytest

# 添加 scripts 到搜索路径
PROJECT_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))

from level_sources import (
    BodonggeLevelSource,
    GexLevelSource,
    KeyLevel,
    ManualLevelSource,
    SPXLMappingLevelSource,
)


@pytest.fixture
def snapshot_fixture_path():
    p = os.path.join(PROJECT_ROOT, "test", "fixtures", "gex_snapshot_fixture.json")
    assert os.path.exists(p), f"Fixture not found: {p}"
    return p


@pytest.fixture
def bodongge_fixture_path():
    p = os.path.join(PROJECT_ROOT, "test", "fixtures", "bodongge_fixture.md")
    assert os.path.exists(p), f"Fixture not found: {p}"
    return p


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

    # 动态公式字符串检查 (非写死)
    f_str = mapper.get_formula_string()
    assert "246.75" in f_str and "7376.86" in f_str and "3.0" in f_str


def test_gex_spy_values(snapshot_fixture_path):
    """
    对照数值核验 (SPY):
    - KING 747.0 (net_gex 最负极值点); FLOOR 755.0; 到期 2026-11-11
    - 排除 KING/FLOOR 叠线后:
      正墙前 3: 757.0 / 760.0 / 756.0 (755.0 作为 FLOOR 被排除避免重合)
      负墙前 3: 745.0 / 740.0 / 746.0 (747.0 作为 KING 被排除避免重合)
    """
    # 1. 验证排除叠线模式 (生产/出图默认)
    src_clean = GexLevelSource(snapshot_fixture_path, exclude_king_floor=True)
    levels_clean = src_clean.get_levels("SPY")

    king = next(l for l in levels_clean if l.group == "gex_king")
    assert king.price == 747.0
    assert math.isclose(king.amount, -9846008.13, abs_tol=0.1)
    assert "最负 Gamma" in king.note

    floor = next(l for l in levels_clean if l.group == "gex_floor")
    assert floor.price == 755.0
    assert math.isclose(floor.amount, 61797835.06, abs_tol=0.1)

    # 验证正负墙不与 KING/FLOOR 叠线
    pos_walls = [l for l in levels_clean if l.group == "gex_wall" and "正墙" in l.label]
    assert 755.0 not in [w.price for w in pos_walls]
    assert pos_walls[0].price == 757.0
    assert pos_walls[1].price == 760.0

    neg_walls = [l for l in levels_clean if l.group == "gex_wall" and "负墙" in l.label]
    assert 747.0 not in [w.price for w in neg_walls]
    assert neg_walls[0].price == 745.0
    assert neg_walls[1].price == 740.0

    # 2. 验证原始未排除模式 (用于原始 ladder 核对)
    src_raw = GexLevelSource(snapshot_fixture_path, exclude_king_floor=False)
    raw_levels = src_raw.get_levels("SPY")
    raw_pos = [l for l in raw_levels if l.group == "gex_wall" and "正墙" in l.label]
    assert [w.price for w in raw_pos] == [755.0, 757.0, 760.0]


def test_gex_spx_values(snapshot_fixture_path):
    """
    对照数值核验 (SPX):
    - KING 7520.0 (最负 Gamma); FLOOR 7600.0; 到期 2026-11-11
    """
    src = GexLevelSource(snapshot_fixture_path, exclude_king_floor=False)
    levels = src.get_levels("SPX")

    king = next(l for l in levels if l.group == "gex_king")
    assert king.price == 7520.0
    assert math.isclose(king.amount, -146803068.27, abs_tol=0.1)

    floor = next(l for l in levels if l.group == "gex_floor")
    assert floor.price == 7600.0
    assert math.isclose(floor.amount, 8432986.72, abs_tol=0.1)

    pos_walls = [l for l in levels if l.group == "gex_wall" and "正墙" in l.label]
    assert [w.price for w in pos_walls] == [7600.0, 7575.0, 7550.0]

    neg_walls = [l for l in levels if l.group == "gex_wall" and "负墙" in l.label]
    assert [w.price for w in neg_walls] == [7520.0, 7510.0, 7525.0]


def test_gex_nvda_matrix_values(snapshot_fixture_path):
    """
    对照数值核验 (NVDA - matrix)
    """
    src = GexLevelSource(snapshot_fixture_path, exclude_king_floor=False)
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

    neg_walls = [l for l in levels if l.group == "gex_wall" and "负墙" in l.label]
    assert [w.price for w in neg_walls] == [190.0, 160.0, 165.0]


def test_bodongge_fixture(bodongge_fixture_path):
    """
    使用本地假数据 fixture 测试解析协议:
    最新时间 2026-11-11 05:00:58
    最上面：8888.50 / 上面：8850.00 / 中间：8800.00 / 下面：8750.00 / 最下面：8700.00
    """
    src = BodonggeLevelSource(bodongge_fixture_path, target_symbol="SPX")
    spx_levels = src.get_levels("SPX")
    assert len(spx_levels) == 5

    prices = [l.price for l in spx_levels]
    assert prices == [8888.50, 8850.00, 8800.00, 8750.00, 8700.00]
    assert all(l.published_at == "2026-11-11" for l in spx_levels)

    # 映射到 SPXL
    spxl_levels = src.get_levels("SPXL")
    assert len(spxl_levels) == 5
    p_spxl_top = 246.75 * (1 + 3 * (8888.50 / 7376.86 - 1))
    assert math.isclose(spxl_levels[0].price, p_spxl_top, rel_tol=1e-7)


def test_missing_symbol_graceful():
    """测试不在快照或文件缺失时的优雅降级"""
    src = GexLevelSource("non_existent_path_xyz.json")
    levels = src.get_levels("PLTR")
    assert levels == []

    bdg = BodonggeLevelSource("non_existent_file.md")
    assert bdg.get_levels("SPX") == []
