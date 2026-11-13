"""DPC退院患者調査ダッシュボード（kntw-blip/dpc-taiin-dashboard）の公開データ core.json から、
自院検索用の病院マスタ site/data/hosp.json を作る。
  python scripts/build_hosp.py RAW_DIR/dpc/core.json OUT_DIR
医療経済実態調査の区分（開設者・病床規模・入院基本料・機能）に対応づけるための属性だけを残す。
"""
import json, re, sys, pathlib, collections

def owner_class(corp, name=""):
    """開設者名 → 医療経済実態調査の開設者区分（第25回報告書の注の定義による）。判別できないものは None。"""
    if not corp: return None
    c = corp.split("|")[0]
    if re.search(r"国立病院機構|^国立大学法人|労働者健康安全機構|国立研究開発法人国立|国立健康危機管理研究機構|地域医療機能推進機構|大臣$|^国$|^(厚生労働省|防衛省|法務省|宮内庁|財務省)", c): return "国立"
    if re.search(r"日本赤十字社|済生会|北海道社会事業協会|厚生農業協同組合連合会|国民健康保険団体連合会", c): return "公的"
    if re.search(r"健康保険組合|共済組合|国民健康保険組合", c): return "社会保険関係法人"
    if re.search(r"協同組合|生協", c): return "その他"
    if re.search(r"^地方独立行政法人|公立大学法人|企業団|広域連合|事務組合|組合長|組合$|病院事業|病院局|組合立|(都|道|府|県|市|町|村|区)$", c): return "公立"
    if re.search(r"社会医療法人", c): return "その他"
    if re.search(r"医療法人", c): return "医療法人"
    if re.search(r"法人|株式会社|会社|財団|社団|学園|大学|協会|連合会|事業団|公社|機構", c): return "その他"
    if re.search(r"(都|道|府|県|市|町|村)立|公立|市民病院|町民病院|国保|国民健康保険", name): return "公立"   # 開設者欄が首長名のとき
    if re.fullmatch(r"[\u3040-\u30ff\u3400-\u9fff\ue000-\uf8ff々・ 　]{2,8}", c): return "個人"            # 開設者欄が個人名
    return None

def kihon_group(kihon):
    """DPC施設概要表の入院基本料 → 入院基本料別集計の (算定病院の種類, 区分)"""
    if not kihon: return None
    m = re.match(r"急性期一般(\d)", kihon)
    if m:
        n = int(m.group(1)); g = "急性期一般入院料1" if n == 1 else "急性期一般入院料2〜3" if n <= 3 else "急性期一般入院料4〜6"
        return ["一般病棟入院基本料算定病院", g]
    m = re.match(r"地域一般(\d)", kihon)
    if m: return ["一般病棟入院基本料算定病院", "地域一般入院料1〜2" if int(m.group(1)) <= 2 else "地域一般入院料3"]
    m = re.match(r"特定機能(\d+)対1", kihon)
    if m: return ["特定機能病院入院基本料算定病院(一般病棟)", f"{m.group(1)}対1"]
    m = re.match(r"専門(\d+)対1", kihon)
    if m: return ["専門病院入院基本料算定病院", f"{m.group(1)}対1"]
    return None

if __name__ == "__main__":
    src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    d = json.loads(src.read_text(encoding="utf-8")); C = d["cols"]
    rows, cnt, unk = [], collections.Counter(), collections.Counter()
    for r in d["rows"]:
        h = dict(zip(C, r)); oc = owner_class(h["corp"], h["name"]); cnt[oc] += 1
        if oc is None and h["corp"]: unk[h["corp"]] += 1
        rows.append([h["id"], h["name"], h["pref"], h["type"], h["kihon"], h["b_total"], h["b_ryoyo"], h["b_seishin"], h["corp"], oc, kihon_group(h["kihon"])])
    out.mkdir(parents=True, exist_ok=True)
    (out / "hosp.json").write_text(json.dumps({"cols": ["id", "name", "pref", "type", "kihon", "beds", "b_ryoyo", "b_seishin", "corp", "owner", "nyuin"], "rows": rows},
                                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("hosp", len(rows), dict(cnt), "bytes", (out / "hosp.json").stat().st_size)
    print("owner unknown (corp あり):", len(unk), list(unk)[:40])
