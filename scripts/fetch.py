"""一次データの取得（GitHub Actions 上で実行）。
医療経済実態調査（医療機関等調査）第19回〜直近の「報告 全体版」Excel を e-Stat から取得する。
  - 既知の回は ROUNDS の statInfId から直接取得
  - それ以降の回は e-Stat の一覧ページから自動検出（「第N回」「全体版」「EXCEL」）
自院検索用の病院マスタとして、DPC退院患者調査ダッシュボード（kntw-blip/dpc-taiin-dashboard）の公開データ core.json も取得する。
出力: RAW_DIR/mes/第NN回_全体版.<拡張子>、RAW_DIR/dpc/core.json、RAW_DIR/manifest.json
"""
import json, re, sys, time, pathlib
import requests
from bs4 import BeautifulSoup

RAW = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "raw")
S = requests.Session(); S.headers["User-Agent"] = "Mozilla/5.0 (iryo-keizai-dashboard data pipeline)"
BASE = "https://www.e-stat.go.jp"
TOUKEI = "00450381"   # 医療経済実態調査（医療機関等調査）
# 回: (実施年, 提供統計ID tstat, 報告 全体版の statInfId)
ROUNDS = {
    19: (2013, "000001062941", "000023603649"),
    20: (2015, "000001076713", "000031329812"),
    21: (2017, "000001108555", "000031641199"),
    22: (2019, "000001135008", "000031884795"),
    23: (2021, "000001160307", "000032144413"),
    24: (2023, "000001211580", "000040121502"),
    25: (2025, "000001235362", "000040372898"),
}
manifest = []

def get(url):
    for i in range(4):
        try:
            r = S.get(url, timeout=300); r.raise_for_status(); return r
        except Exception as e:
            print("retry", url, e, flush=True); time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def ext_of(content):
    if content[:2] == b"PK": return "xlsx"
    if content[:4] == b"\xd0\xcf\x11\xe0": return "xls"
    return "bin"

def save(rnd, year, stat_inf_id):
    url = f"{BASE}/stat-search/file-download?statInfId={stat_inf_id}&fileKind=0"
    c = get(url).content
    e = ext_of(c)
    if e == "bin":
        print("FAILED not an Excel file", rnd, url, c[:80], flush=True); return
    p = RAW / "mes" / f"第{rnd:02d}回_全体版.{e}"
    p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(c)
    manifest.append({"round": rnd, "year": year, "path": str(p.relative_to(RAW)), "bytes": len(c),
                     "url": url, "statInfId": stat_inf_id})
    print("saved", p, len(c), flush=True)

def discover():
    """ROUNDS に無い新しい回を e-Stat の提供統計一覧から探す。"""
    found = {}
    try:
        r = get(f"{BASE}/stat-search/files?page=1&toukei={TOUKEI}"); r.encoding = "utf-8"
        soup = BeautifulSoup(r.text, "html.parser")
        z2h = str.maketrans("０１２３４５６７８９", "0123456789")
        for a in soup.find_all("a", href=True):
            t = a.get_text(" ", strip=True).translate(z2h)
            m = re.search(r"第\s*(\d+)\s*回", t); k = re.search(r"tstat=(\d+)", a["href"])
            if m and k and int(m.group(1)) > max(ROUNDS): found[int(m.group(1))] = k.group(1)
        for rnd, tstat in sorted(found.items()):
            r = get(f"{BASE}/stat-search/files?page=1&toukei={TOUKEI}&tstat={tstat}&layout=dataset"); r.encoding = "utf-8"
            soup = BeautifulSoup(r.text, "html.parser")
            ids = re.findall(r"file-download\?statInfId=(\d+)&(?:amp;)?fileKind=0", r.text)
            ym = re.search(r"(20\d\d)年", soup.get_text(" "))
            print("discovered round", rnd, tstat, ids, flush=True)
            if ids: save(rnd, int(ym.group(1)) if ym else None, ids[-1])   # 報告 全体版は一覧の末尾
    except Exception as e:
        print("FAILED discover", e, flush=True)

DPC_CORE = "https://kntw-blip.github.io/dpc-taiin-dashboard/data/core.json"

def fetch_dpc_core():
    try:
        c = get(DPC_CORE).content; json.loads(c)
        p = RAW / "dpc" / "core.json"; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(c)
        print("saved", p, len(c), flush=True)
    except Exception as e:
        print("FAILED dpc core", e, flush=True)

if __name__ == "__main__":
    fetch_dpc_core()
    for rnd, (year, _, sid) in ROUNDS.items():
        try: save(rnd, year, sid)
        except Exception as e: print("FAILED", rnd, e, flush=True)
        time.sleep(2)
    discover()
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print("files", len(manifest), flush=True)
    if len(manifest) < len(ROUNDS): sys.exit(1)
