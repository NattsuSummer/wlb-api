#!/usr/bin/env python3
"""Convert the original life-schedule Excel into seed/seed.json.

Usage:  python3 scripts/excel-to-seed.py <file.xlsx> [--out seed/seed.json]

Each sheet named "แผน — <username>" becomes one user. Layout expected (from the original file):
  row 4 = header, rows 5–28 = hours 00–23, columns C..P = (category, description) pairs Mon..Sun,
  summary block: S = category name, V = expected share (0–1).
A category cell may list several categories joined with "+" (e.g. "พักผ่อน+project เสริม").
The output contains personal data — it is git-ignored and must not be committed.
"""
import argparse
import json
import re
import openpyxl


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--out", default="seed/seed.json")
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    users = []
    for ws in wb.worksheets:
        m = re.match(r"^แผน\s*[—-]\s*(.+)$", ws.title.strip())
        if not m:
            continue
        username = m.group(1).strip().lower()
        slots = []
        for hour in range(24):
            row = 5 + hour
            for day in range(7):
                col = 3 + day * 2  # C, E, G, ...
                cat = ws.cell(row, col).value
                desc = ws.cell(row, col + 1).value
                if not cat:
                    continue
                cats = [c.strip() for c in str(cat).split("+") if c.strip()]
                slots.append({"weekday": day, "hour": hour, "categories": cats, "description": (str(desc).strip() if desc else "")})
        targets = {}
        for row in range(5, 12):
            name = ws.cell(row, 19).value  # column S
            exp = ws.cell(row, 22).value   # column V
            if name and isinstance(exp, (int, float)) and name != "รวมทั้งสิ้น":
                targets[str(name).strip()] = round(exp * 100)
        users.append({"username": username, "displayName": username, "role": "admin", "targets": targets, "slots": slots})

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, ensure_ascii=False, indent=1)
    for u in users:
        print(f"{u['username']}: {len(u['slots'])} slots, targets={u['targets']}")


if __name__ == "__main__":
    main()
