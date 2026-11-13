"""医療経済実態調査 全体版Excel から、病院の損益表（1施設当たり損益）のパネルを機械的に読み取る。

各シートは「タイトル行 → 区分名の行 → 『金額／構成比率／金額の伸び率』の見出し行 → 項目行 … 施設数・平均病床数」
というパネルが縦に並ぶ。区分1つは5列（金額2年・構成比率2年・伸び率）で、第19〜25回で共通。
"""
import re, unicodedata
from python_calamine import CalamineWorkbook

def norm(v):
    """空白・改行を除き、全角英数を半角にそろえた文字列。"""
    if v is None: return ""
    s = unicodedata.normalize("NFKC", str(v))
    return re.sub(r"\s+", "", s)

def num(v):
    if isinstance(v, bool): return None
    if isinstance(v, (int, float)): return float(v)
    return None

def flag(v):
    """数値以外のセルの意味: '*'=秘匿（施設数が少ない）, '-'=該当なし。"""
    s = norm(v)
    if s in ("*", "＊"): return "*"
    if s in ("-", "－", "―", "ー", "‐"): return "-"
    return ""

def hospital_sheets(names):
    """病院の損益表が入りうるシート（グラフ・dataシートは除く）。"""
    out = []
    for n in names:
        k = norm(n)
        if "グラフ" in k or "data" in k or "青色" in k: continue
        if "病院" in k or k.endswith("病") or re.search(r"病\d*$", k) or "病(" in k or "病院のみ" in k:
            out.append(n)
    return out

def parse_sheet(rows):
    """シート1枚 → パネルのリスト。"""
    panels, title, sheet_title = [], "", ""
    for i, r in enumerate(rows[:3]):
        for v in r:
            if norm(v): sheet_title = sheet_title or str(v).strip()
    h = 0
    while h < len(rows):
        r = rows[h]
        cols = [j for j, v in enumerate(r) if norm(v) == "金額"]
        if not cols:
            # タイトル候補: 左端付近の文字列で「集計」「①」等を含む行
            for j in range(0, min(4, len(r))):
                s = norm(r[j])
                if s and ("集計" in s or re.match(r"^[①-⑳]", s) or "1施設当たり" in s) and not any(num(v) is not None for v in r):
                    title = str(r[j]).strip(); break
            h += 1; continue
        # 区分名: 見出し行の上（最大4行）で、その列にある文字列。さらに上・左にあるものは上位見出し。
        groups = []
        for c in cols:
            name, name_row = "", None
            for k in range(1, 5):
                if h - k < 0: break
                s = norm(rows[h - k][c]) if c < len(rows[h - k]) else ""
                if s and "1施設当たり" not in s: name, name_row = str(rows[h - k][c]).strip(), h - k; break
            sup = ""
            if name_row is not None:
                for k in range(1, 4):
                    rr = name_row - k
                    if rr < 0: break
                    cand = [(j, v) for j, v in enumerate(rows[rr][:c + 1]) if j >= 3 and norm(v) and "1施設当たり" not in norm(v)]
                    if cand and not any(norm(v) == "金額" for v in rows[rr]):
                        if any(num(v) is not None for v in rows[rr]): break
                        sup = str(cand[-1][1]).strip(); break
            groups.append({"col": c, "name": name, "super": sup, "items": [], "n": None, "beds": None})
        # 項目行: 単位行の次から、次のタイトル/見出し/（注）まで
        i = h + 1
        while i < len(rows):
            rr = rows[i]
            if any(norm(v) == "金額" for v in rr): break
            label = ""
            for j in range(0, min(cols[0], len(rr))):
                if norm(rr[j]): label = str(rr[j]).strip(); break
            ln = norm(label)
            if ln.startswith("(注") or (("集計" in ln or re.match(r"^[①-⑳]", ln)) and i > h + 3): break
            if label and not ln.startswith(("前々年", "前年", "千円")):
                for g in groups:
                    c = g["col"]
                    cells = [rr[c + d] if c + d < len(rr) else None for d in range(5)]
                    vals = [num(v) for v in cells]
                    fl = flag(cells[0]) or flag(cells[1])
                    if ln == "施設数": g["n"] = vals[0] if vals[0] is not None else vals[1]; g["nflag"] = fl
                    elif ln == "平均病床数": g["beds"] = [vals[0], vals[1]]
                    elif any(v is not None for v in vals) or fl: g["items"].append((label, vals, fl))
            i += 1
        for g in groups:
            if g["items"] or g["n"] is not None:
                panels.append({"title": title, "sheet_title": sheet_title, "row": h, **g})
        h = i
    return panels

def parse_workbook(path, sheets=None):
    wb = CalamineWorkbook.from_path(path)
    out = {}
    for name in (sheets or hospital_sheets(wb.sheet_names)):
        rows = wb.get_sheet_by_name(name).to_python(skip_empty_area=False)
        ps = parse_sheet(rows)
        if ps: out[name] = ps
    return out
