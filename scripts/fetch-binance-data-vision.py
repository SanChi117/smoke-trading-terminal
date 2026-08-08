from __future__ import annotations

import csv
import io
import json
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

SYMBOLS = [
    "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","ADAUSDT","AVAXUSDT","SUIUSDT","APTUSDT","NEARUSDT",
    "LINKUSDT","AAVEUSDT","ARBUSDT","OPUSDT","DOGEUSDT","TAOUSDT","ONDOUSDT","INJUSDT","SEIUSDT",
]
LOOKBACK_DAYS = {"5m": 34, "15m": 34, "4h": 105, "1d": 620}
BASE = "https://data.binance.vision/data/futures/um"
OUT = Path("portfolio-30d-input.json")

now = datetime.now(timezone.utc)
# Data Vision daily archives are complete only after the UTC day closes.
end_day = (now - timedelta(days=1)).date()
end_ms = int(datetime.combine(end_day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000) - 1


def month_iter(start, end):
    cursor = start.replace(day=1)
    end_month = end.replace(day=1)
    while cursor <= end_month:
        yield cursor
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)


def daily_iter(start, end):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


def archive_urls(symbol: str, interval: str, start_day, end_day):
    urls = []
    current_month = end_day.replace(day=1)
    for month in month_iter(start_day, end_day):
        if month < current_month:
            ym = month.strftime("%Y-%m")
            urls.append(f"{BASE}/monthly/klines/{symbol}/{interval}/{symbol}-{interval}-{ym}.zip")
    daily_start = max(start_day, current_month)
    for day in daily_iter(daily_start, end_day):
        ymd = day.strftime("%Y-%m-%d")
        urls.append(f"{BASE}/daily/klines/{symbol}/{interval}/{symbol}-{interval}-{ymd}.zip")
    return urls


def normalize_time(value: str) -> int:
    raw = int(float(value))
    while raw > 10_000_000_000_000:
        raw //= 1000
    return raw


def fetch_archive(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "smoke-research-backtest/1.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return []
        raise
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        name = archive.namelist()[0]
        text = archive.read(name).decode("utf-8")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if not row or not row[0] or not row[0][0].isdigit():
            continue
        try:
            candle = {
                "time": normalize_time(row[0]),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
        except (ValueError, IndexError):
            continue
        rows.append(candle)
    return rows


def fetch_series(symbol: str, interval: str):
    start_day = end_day - timedelta(days=LOOKBACK_DAYS[interval])
    urls = archive_urls(symbol, interval, start_day, end_day)
    candles = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch_archive, url): url for url in urls}
        for future in as_completed(futures):
            candles.extend(future.result())
    start_ms = int(datetime.combine(start_day, datetime.min.time(), tzinfo=timezone.utc).timestamp() * 1000)
    unique = {c["time"]: c for c in candles if start_ms <= c["time"] <= end_ms}
    return [unique[key] for key in sorted(unique)]


def weekly_from_daily(daily):
    buckets = {}
    for candle in daily:
        dt = datetime.fromtimestamp(candle["time"] / 1000, tz=timezone.utc)
        monday = (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        key = int(monday.timestamp() * 1000)
        bucket = buckets.get(key)
        if bucket is None:
            buckets[key] = {
                "time": key,
                "open": candle["open"],
                "high": candle["high"],
                "low": candle["low"],
                "close": candle["close"],
                "volume": candle["volume"],
            }
        else:
            bucket["high"] = max(bucket["high"], candle["high"])
            bucket["low"] = min(bucket["low"], candle["low"])
            bucket["close"] = candle["close"]
            bucket["volume"] += candle["volume"]
    # Only keep fully closed UTC weeks; the current partial week must not enter causal history.
    current_monday = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    current_monday_ms = int(current_monday.timestamp() * 1000)
    return [buckets[key] for key in sorted(buckets) if key < current_monday_ms]


def main():
    payload = {
        "source": "Binance Data Vision / futures/um; weekly derived from closed 1D candles",
        "generatedAt": now.isoformat(),
        "endDayUtc": end_day.isoformat(),
        "endMs": end_ms,
        "symbols": {},
    }
    for index, symbol in enumerate(SYMBOLS, 1):
        print(f"DATA_START {index}/{len(SYMBOLS)} {symbol}", flush=True)
        daily = fetch_series(symbol, "1d")
        bundle = {
            "1w": weekly_from_daily(daily),
            "1d": daily,
            "4h": fetch_series(symbol, "4h"),
            "15m": fetch_series(symbol, "15m"),
            "5m": fetch_series(symbol, "5m"),
        }
        for interval in ["1w", "1d", "4h", "15m", "5m"]:
            print(f"DATA {symbol} {interval} candles={len(bundle[interval])}", flush=True)
        payload["symbols"][symbol] = bundle
        print(f"DATA_DONE {symbol}", flush=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"WROTE {OUT} bytes={OUT.stat().st_size}", flush=True)


if __name__ == "__main__":
    main()
