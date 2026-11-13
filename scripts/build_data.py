"""raw ブランチの全体版Excel（第19回〜）→ site/data/mes.json
  python scripts/build_data.py RAW_DIR OUT_DIR
系列（series）= 表の種類 × 病院種別 × 集計1/2 × 国公立を含む/除く × 区分。回ごとに前々年度・前年度の2時点を持つ。
"""
import json, re, sys, pathlib, datetime, collections
import mes_parse as M
N = M.norm

RAW, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
log = []

# ---- 表の種類 ----
TOPICS = [  # (key, シート見出しに含まれる語, 表示名)
    ("func",   r"病院機能別",            "病院機能別"),
    ("nyuin",  r"入院基本料別",          "入院基本料別"),
    ("beds",   r"病床規模別",            "病床規模別"),
    ("ryo60",  r"療養病床60%以上",       "療養病床60％以上の一般病院"),
    ("ryo0",   r"療養病床を有しない",    "療養病床を有しない一般病院"),
    ("zaishi", r"在宅療養支援病院",      "在宅療養支援病院"),
    ("region", r"地域別",                "地域別"),
]
TOPIC_LABEL = {"owner": "開設者別", **{k: lab for k, _, lab in TOPICS}}

def sheet_no(name):
    m = re.match(r"^\((\d+)\)", N(name)); return int(m.group(1)) if m else None

# ---- 損益項目 ----
ITEMS = [  # key, 表示名, 階層, 種別(rev/cost/pl/other)
    ("rev", "Ⅰ 医業収益", 0, "rev"), ("rev_in", "入院診療収益", 1, "rev"), ("rev_in_ins", "入院：保険診療収益", 2, "rev"),
    ("rev_in_kogai", "入院：公害等診療収益", 2, "rev"), ("rev_in_other", "入院：その他の診療収益", 2, "rev"),
    ("rev_room", "特別の療養環境収益", 1, "rev"), ("rev_out", "外来診療収益", 1, "rev"), ("rev_out_ins", "外来：保険診療収益", 2, "rev"),
    ("rev_out_kogai", "外来：公害等診療収益", 2, "rev"), ("rev_out_other", "外来：その他の診療収益", 2, "rev"),
    ("rev_other", "その他の医業収益", 1, "rev"),
    ("care", "Ⅱ 介護収益", 0, "rev"), ("care_fac", "施設サービス収益", 1, "rev"), ("care_home", "居宅サービス収益", 1, "rev"),
    ("care_short", "（再掲）短期入所療養介護分", 2, "rev"), ("care_other", "その他の介護収益", 1, "rev"),
    ("cost", "Ⅲ 医業・介護費用", 0, "cost"), ("c_salary", "給与費", 1, "cost"), ("c_drug", "医薬品費", 1, "cost"),
    ("c_food", "給食用材料費", 1, "cost"), ("c_material", "診療材料費・医療消耗器具備品費", 1, "cost"),
    ("c_outsource", "委託費", 1, "cost"), ("c_out_food", "（再掲）給食委託費", 2, "cost"), ("c_out_staff", "（再掲）人材委託費", 2, "cost"),
    ("c_out_fee", "（再掲）紹介手数料", 2, "cost"),
    ("c_dep", "減価償却費", 1, "cost"), ("c_dep_bldg", "（再掲）建物減価償却費", 2, "cost"), ("c_dep_equip", "（再掲）医療機器減価償却費", 2, "cost"),
    ("c_fac", "設備関係費", 1, "cost"), ("c_fac_lease", "（再掲）設備機器賃借料", 2, "cost"), ("c_fac_medlease", "（再掲）医療機器賃借料", 2, "cost"),
    ("c_exp", "経費", 1, "cost"), ("c_exp_util", "（再掲）水道光熱費", 2, "cost"), ("c_other", "その他の医業・介護費用", 1, "cost"),
    ("pl", "Ⅳ 損益差額（Ⅰ＋Ⅱ－Ⅲ）", 0, "pl"), ("pl_covid", "（参考）コロナ関連補助金を含めた損益差額", 1, "pl"),
    ("orev", "Ⅴ その他の医業・介護関連収益", 0, "other"), ("orev_covid", "（再掲）コロナ関連補助金", 1, "other"),
    ("orev_shogu", "（再掲）看護職員等処遇改善事業補助金", 1, "other"),
    ("ocost", "Ⅵ その他の医業・介護関連費用", 0, "other"),
    ("tpl", "Ⅶ 総損益差額（Ⅳ＋Ⅴ－Ⅵ）", 0, "pl"), ("tpl_excovid", "（参考）コロナ関連補助金を除いた総損益差額", 1, "pl"),
    ("tax", "Ⅷ 税金", 0, "other"), ("npl", "Ⅸ 税引後の総損益差額（Ⅶ－Ⅷ）", 0, "pl"),
]
def item_key(label, state):
    """項目名 → key。「保険診療収益」等は直前の入院/外来で判別する（state を更新）。"""
    s = N(label)
    s = re.sub(r"^\d+\.", "", s)
    def st(v): state["sec"] = v
    if s.startswith("I医業収益"): st(""); return "rev"
    if s == "入院診療収益": st("in"); return "rev_in"
    if s == "外来診療収益": st("out"); return "rev_out"
    if s in ("保険診療収益", "公害等診療収益", "その他の診療収益") and state.get("sec") in ("in", "out"):
        return f'rev_{state["sec"]}_' + {"保険診療収益": "ins", "公害等診療収益": "kogai", "その他の診療収益": "other"}[s]
    if s == "特別の療養環境収益": st(""); return "rev_room"
    if s == "その他の医業収益": st(""); return "rev_other"
    if s.startswith("II介護収益"): return "care"
    if s == "施設サービス収益": return "care_fac"
    if s == "居宅サービス収益": return "care_home"
    if s == "(再掲)短期入所療養介護分": return "care_short"
    if s == "その他の介護収益": return "care_other"
    if s.startswith("III医業・介護費用"): return "cost"
    T = {"給与費": "c_salary", "医薬品費": "c_drug", "給食用材料費": "c_food", "委託費": "c_outsource",
         "(再掲)給食委託費": "c_out_food", "(再掲)人材委託費": "c_out_staff", "(再掲)紹介手数料": "c_out_fee",
         "減価償却費": "c_dep", "(再掲)建物減価償却費": "c_dep_bldg", "(再掲)医療機器減価償却費": "c_dep_equip",
         "設備関係費": "c_fac", "(再掲)設備機器賃借料": "c_fac_lease", "(再掲)医療機器賃借料": "c_fac_medlease",
         "経費": "c_exp", "(再掲)水道光熱費": "c_exp_util", "その他の医業費用": "c_other", "その他の医業・介護費用": "c_other"}
    if s in T: return T[s]
    if s.startswith("診療材料費"): return "c_material"
    if s.startswith("IV損益差額"): return "pl"
    if s.startswith("(参考)") and "含めた損益差" in s: return "pl_covid"
    if s.startswith("Vその他の医業・介護関連収益"): return "orev"
    if s.startswith("V'") and "新型コロナ" in s: return "orev_covid"
    if s.startswith("V''") or "処遇改善事業補助金" in s: return "orev_shogu"
    if s.startswith("VIその他の医業・介護関連費用"): return "ocost"
    if s.startswith("VII総損益差額"): return "tpl"
    if s.startswith("(参考)") and "除いた総損益" in s: return "tpl_excovid"
    if s.startswith("VIII税金"): return "tax"
    if s.startswith("IX税引後"): return "npl"
    return None

# ---- 区分名の正規化 ----
def clean(s):
    s = N(s).replace("~", "〜")
    s = re.sub(r"^[①-⑳]|^\d+(?=[^\d対床級%〜])", "", s)
    return s
def strip_shukei(s): return re.sub(r"\(集計[12]\)", "", s)
# 診療報酬改定による名称変更をつなぐ（内容が連続するものだけ）
NYUIN_ALIAS = {"療養病棟入院基本料1": "療養病棟入院料1", "療養病棟入院基本料2": "療養病棟入院料2",
               "急性期一般入院料4〜7": "急性期一般入院料4〜6"}
REF_EX = re.compile(r"\(参考\)国公立を除く")

def classify(sheet, topic_of_no, p):
    """パネル → (topic, htype, shukei, scope, sub, group) / None"""
    sn, no = N(sheet), sheet_no(sheet)
    title, sup, name = clean(p["title"]), clean(p["super"]), clean(p["name"])
    m = re.search(r"集計([12])", title) or re.search(r"集計([12])", sn)
    shukei = int(m.group(1)) if m else 1
    if no is None:
        if "公立病院のみ" in sn or "集計" not in sn: return None
        topic = "owner"
    else:
        topic = topic_of_no.get(no)
        if not topic: return None
    t = strip_shukei(title)
    htype = "精神科病院" if t.startswith("精神科病院") else "一般病院"
    scope = "ex" if (REF_EX.search(t) or REF_EX.search(sup)) else "all"
    sub = ""
    if topic in ("owner", "ryo60", "ryo0", "zaishi"):
        group = {"(参考)国公立を除く": "国公立を除く", "(参考)国公立": "国公立"}.get(name, name)
    elif topic == "beds":
        group = name
    elif topic == "func":
        sub = re.sub(r"\(小児総合医療施設\)", "", t)
        if REF_EX.search(name): scope, group = "ex", sub
        elif name == sub: group = sub
        else: group = f"{sub}：{name}"
        sub = ""
    elif topic == "nyuin":
        sub = REF_EX.sub("", t)
        group = NYUIN_ALIAS.get(name, name); htype = ""
    elif topic == "region":
        if "地域加算" not in t: return None      # 生活保護・介護保険の級地別は第19回のみのため対象外
        group = name
    return topic, htype, shukei, scope, sub, group

def build():
    man = json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))
    series, rounds = {}, []
    for ent in sorted(man, key=lambda e: e["round"]):
        rnd, year = ent["round"], ent["year"]
        wb = M.parse_workbook(str(RAW / ent["path"]))
        topic_of_no = {}
        for sheet, ps in wb.items():
            no = sheet_no(sheet); st = N(ps[0]["sheet_title"])
            if no is None or no in topic_of_no or not st.startswith(f"({no})"): continue
            for key, pat, _ in TOPICS:
                if re.search(pat, st): topic_of_no[no] = key; break
        rounds.append({"round": rnd, "year": year, "fy": [year - 2, year - 1], "url": ent["url"]})
        cnt, unknown = collections.Counter(), collections.Counter()
        for sheet, ps in wb.items():
            for p in ps:
                c = classify(sheet, topic_of_no, p)
                if not c: continue
                state, v = {}, {}
                for label, vals, fl in p["items"]:
                    k = item_key(label, state)
                    if k is None: unknown[N(label)] += 1; continue
                    if k in v: unknown["DUP:" + k] += 1; continue
                    if any(x is not None for x in vals[:4]): v[k] = [vals[0], vals[1], vals[2], vals[3]]
                sid = "|".join(str(x) for x in c)
                s = series.setdefault(sid, {"topic": c[0], "htype": c[1], "shukei": c[2], "scope": c[3], "sub": c[4], "group": c[5], "r": {}})
                if str(rnd) in s["r"]: unknown["DUPSERIES:" + sid] += 1; continue
                supp = (not v) and any(fl == "*" for _, _, fl in p["items"])
                if not v and not supp: continue      # 該当施設なし
                s["r"][str(rnd)] = {"n": p["n"], "beds": p["beds"], "v": v, **({"supp": 1} if supp else {})}
                s["ord"] = sum(cnt.values())      # 最新の回での掲載順（表示順に使う）
                cnt[c[0]] += 1
        log.append(f"round {rnd}: topics {dict(topic_of_no)} panels {dict(cnt)} unknown {dict(unknown)}")
    series = {k: s for k, s in series.items() if any(x["v"] for x in s["r"].values())}
    return rounds, series

if __name__ == "__main__":
    rounds, series = build()
    OUT.mkdir(parents=True, exist_ok=True)
    out = {"meta": {"rounds": rounds, "items": [{"key": k, "label": l, "level": lv, "kind": kd} for k, l, lv, kd in ITEMS],
                    "topics": TOPIC_LABEL, "built": datetime.date.today().isoformat()},
           "series": list(series.values())}
    (OUT / "mes.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.append(f"series {len(series)}, bytes {(OUT / 'mes.json').stat().st_size}")
    print("\n".join(log))
