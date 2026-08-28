import argparse
import datetime
import os
import sys
import time
import pandas as pd
from futu import (
    OpenQuoteContext,
    KLType,
    AuType,
    KL_FIELD,
    RET_OK
)

def fetch_all_kline(quote_ctx, code, start_date, end_date, ktype, autype=AuType.QFQ):
    """
    分页拉取全部历史 K 线
    """
    all_dfs = []
    page_req_key = None
    
    print(f"[*] 开始拉取 {code} [ktype={ktype}, autype={autype}] ({start_date} ~ {end_date})...")
    
    while True:
        ret, data, page_req_key = quote_ctx.request_history_kline(
            code=code,
            start=start_date,
            end=end_date,
            ktype=ktype,
            autype=autype,
            fields=[
                KL_FIELD.ALL
            ],
            max_count=1000,
            page_req_key=page_req_key
        )
        
        if ret != RET_OK:
            print(f"[!] 拉取出错: {data}")
            break
            
        if data is not None and not data.empty:
            all_dfs.append(data)
            total_rows = sum(len(df) for df in all_dfs)
            print(f"    - 本页拉取 {len(data)} 条，累计已获取 {total_rows} 条")
            
        if page_req_key is None:
            break
            
        time.sleep(0.3)  # 避免触发频率限制
        
    if not all_dfs:
        return pd.DataFrame()
        
    df_combined = pd.concat(all_dfs, ignore_index=True)
    
    # 统一时间列字段名: datetime
    if 'time_key' in df_combined.columns:
        df_combined = df_combined.rename(columns={'time_key': 'datetime'})
        
    required_cols = ['datetime', 'open', 'high', 'low', 'close', 'volume']
    
    for col in required_cols:
        if col not in df_combined.columns:
            raise KeyError(f"缺少必要字段: {col}，当前返回字段包含: {df_combined.columns.tolist()}")
            
    df_result = df_combined[required_cols].copy()
    # 按照时间升序排序并去重
    df_result = df_result.sort_values(by='datetime').drop_duplicates(subset=['datetime']).reset_index(drop=True)
    return df_result

def main():
    parser = argparse.ArgumentParser(description="通过富途 OpenAPI 拉取标的历史 K 线数据")
    parser.add_argument("--host", default="127.0.0.1", help="FutuOpenD 服务地址 (默认: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=11111, help="FutuOpenD 端口 (默认: 11111)")
    parser.add_argument("--code", default="US.TSLA", help="标的代码 (默认: US.TSLA)")
    parser.add_argument("--start", default="2023-01-01", help="开始日期 (默认: 2023-01-01)")
    parser.add_argument("--end", default=None, help="结束日期 (默认: 今天)")
    args = parser.parse_args()

    end_date = args.end if args.end else datetime.datetime.now().strftime('%Y-%m-%d')
    symbol_name = args.code.split('.')[-1].lower()  # 例如 tsla, qqq

    print(f"正在尝试连接 FutuOpenD 网关 [{args.host}:{args.port}]...")
    try:
        quote_ctx = OpenQuoteContext(host=args.host, port=args.port)
    except Exception as e:
        print(f"\n[错误] 无法连接到 FutuOpenD ({args.host}:{args.port}): {e}")
        print("请确认 FutuOpenD 网关客户端已经启动并成功登录。")
        sys.exit(1)

    try:
        # 1) 日线: 2023-01-01 到今天
        daily_file = f"{symbol_name}_daily.csv"
        print(f"\n==================== 1. 拉取日线 ({daily_file}) ====================")
        df_daily = fetch_all_kline(quote_ctx, args.code, args.start, end_date, KLType.K_DAY, AuType.QFQ)
        if not df_daily.empty:
            df_daily.to_csv(daily_file, index=False)
            print(f"[OK] 日线数据已成功保存至: {os.path.abspath(daily_file)}")
        else:
            print(f"[!] 未拉取到日线数据！")

        # 2) 30分钟: 2023-01-01 到今天
        m30_file = f"{symbol_name}_30m.csv"
        print(f"\n==================== 2. 拉取30分钟线 ({m30_file}) ====================")
        df_30m = fetch_all_kline(quote_ctx, args.code, args.start, end_date, KLType.K_30M, AuType.QFQ)
        if not df_30m.empty:
            df_30m.to_csv(m30_file, index=False)
            print(f"[OK] 30分钟数据已成功保存至: {os.path.abspath(m30_file)}")
        else:
            print(f"[!] 未拉取到30分钟数据！")

        # 统计汇报
        print("\n" + "="*50)
        print(f"            {args.code} 数据拉取统计汇总            ")
        print("="*50)
        
        if not df_daily.empty:
            print(f"【日线文件】: {daily_file}")
            print(f"  - 总行数: {len(df_daily)}")
            print(f"  - 起始时间: {df_daily['datetime'].iloc[0]}")
            print(f"  - 结束时间: {df_daily['datetime'].iloc[-1]}")
            print(f"  - 字段列表: {','.join(df_daily.columns.tolist())}")
        else:
            print(f"【日线文件】: {daily_file} (拉取失败或无数据)")

        print("-" * 50)

        if not df_30m.empty:
            print(f"【30分钟文件】: {m30_file}")
            print(f"  - 总行数: {len(df_30m)}")
            print(f"  - 起始时间: {df_30m['datetime'].iloc[0]}")
            print(f"  - 结束时间: {df_30m['datetime'].iloc[-1]}")
            print(f"  - 字段列表: {','.join(df_30m.columns.tolist())}")
        else:
            print(f"【30分钟文件】: {m30_file} (拉取失败或无数据)")
            
        print("="*50)

    finally:
        quote_ctx.close()

if __name__ == '__main__':
    main()
