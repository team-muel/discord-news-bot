from __future__ import annotations

import os
from typing import Optional


def pick_env(*keys: str) -> Optional[str]:
    for key in keys:
        value = os.getenv(key)
        if value is not None and str(value).strip() != "":
            return value
    return None


def parse_int_env(*keys: str, default: int, min_value: Optional[int] = None) -> int:
    for key in keys:
        raw = os.getenv(key)
        if raw is None:
            continue
        try:
            value = int(raw)
            if min_value is not None:
                value = max(min_value, value)
            return value
        except Exception:
            continue
    return default


def log(message: str) -> None:
    print(f">> [LOG] {message}", flush=True)


def is_missing_table_error(err: Exception, table_name: str) -> bool:
    text = str(err)
    lowered = text.lower()
    return (
        "pgrst205" in lowered
        or f"'{table_name}'" in lowered
        or f'"{table_name}"' in lowered
        or (table_name.lower() in lowered and "schema cache" in lowered)
    )
