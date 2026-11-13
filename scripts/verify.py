"""加工後データの検証（失敗したらビルドを止める）。
  1. 損益差額 = 医業収益 + 介護収益 - 医業・介護費用（千円単位の丸め ±3 まで）
  2. 損益率 = 損益差額 ÷（医業収益 + 介護収益）が報告書の構成比率と一致（±0.06）
  3. 全ての回に「一般病院 全体」があり、損益項目が欠けていない
"""
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
bad, tot = [], 0
for s in d["series"]:
    for rnd, e in s["r"].items():
        v = e["v"]
        for i in (0, 1):
            if not all(k in v for k in ("rev", "cost", "pl")): continue
            rev, care, cost, pl = v["rev"][i], (v.get("care") or [0, 0])[i] or 0, v["cost"][i], v["pl"][i]
            if None in (rev, cost, pl): continue
            tot += 1
            if abs(rev + care - cost - pl) > 3: bad.append(("pl", s["topic"], s["group"], rnd, i))
            r = v["pl"][2 + i]
            if r is not None and rev + care and abs(pl / (rev + care) * 100 - r) > 0.06: bad.append(("ratio", s["topic"], s["group"], rnd, i))
for r in d["meta"]["rounds"]:
    for sh in (1, 2):
        s = next((x for x in d["series"] if x["topic"] == "owner" and x["htype"] == "一般病院" and x["group"] == "全体" and x["shukei"] == sh), None)
        e = s and s["r"].get(str(r["round"]))
        if not e or len(e["v"]) < 28 or not e["n"]: bad.append(("missing", r["round"], sh))
print(f"verify: {tot} checks, {len(bad)} problems", bad[:10])
sys.exit(1 if bad else 0)
