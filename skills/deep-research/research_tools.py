"""Deterministic layer under the deep-research skill (2026-10-20).

Why: an Odoo market report came back built on 3-4 pages, its headline claim ("Odoo has no official Turkish
localization") was false - the model looked at the wrong URL and searched a truncated page - and SearXNG answered
from one engine only. The model is the language layer; this script counts, logs and checks:

  python research_tools.py start  <slug>                 search health + work folder
  python research_tools.py search <slug> "<query>" [--lang tr|en|all] [--n 10]
  python research_tools.py fetch  <slug> <url> [--from 0] [--chars 8000]
  python research_tools.py check  <slug> <report.md> [--final]
  python research_tools.py send   <report.md>             Telegram: the report file + a short caption

Every search and every page read is logged under Documents/Research/.work/<slug>/. `check` fails a report whose
cited URLs were never fetched, that has too few searches/pages/sources/domains, numbers without a citation or not
found in the cited page, or a "does not exist" claim with fewer than 2 sources. `check --final` appends the issues
it still finds to the report as a visible warning section instead of failing (surface, never hide).
"""
import argparse
import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

# --- config -----------------------------------------------------------------
SEARXNG = "http://127.0.0.1:8890"
RESEARCH_DIR = Path.home() / "Documents" / "Research"
MIN_ENGINES = 2               # health: fewer answering web engines = research would be one-sided
MIN_SEARCHES = 25             # a deep research, not a lookup
MIN_FETCHED = 15              # pages actually read
MIN_CITED = 10                # sources in the report
MIN_DOMAINS = 5               # distinct sites among the cited sources
FETCH_TIMEOUT_S = 30
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"
TELEGRAM_TARGET = os.environ.get("HYBRID_NOTIFY_TELEGRAM", "")    # your paired Telegram chat id
# node + entry script (openclaw.cmd re-parses arguments through cmd.exe and mangles them)
OPENCLAW_ENTRY = os.environ.get("OPENCLAW_ENTRY") or str(
    Path(shutil.which("openclaw") or "openclaw").resolve().parent / "node_modules" / "openclaw"
    / "openclaw.mjs")
OPENCLAW_MEDIA_DIR = Path.home() / ".openclaw" / "media" / "research"     # OpenClaw only sends from its media roots
GEMINI_MODEL = os.environ.get("RESEARCH_GEMINI_MODEL", "gemini-3.8-flash")   # Search grounding; 2.5 closed to new users
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TAVILY_URL = "https://api.tavily.com/search"
NEGATIVE = re.compile(r"\b(yok|yoktur|bulunmuyor|bulunmamaktadır|mevcut değil|desteklemiyor|sunmuyor|geçmiyor|"
                      r"does not|doesn't|not available|no official|not supported|404)\b", re.I)
ADMITTED = re.compile(r"bulunamadı|doğrulanamadı|doğrulanmadı|tek kaynak|\(hesap\)|not found|unverified|"
                      r"single source|\(calc\)", re.I)
WARN_HEADING = {"tr": "## Kalite kontrol uyarıları (otomatik)", "en": "## Quality check warnings (automatic)"}
# -----------------------------------------------------------------------------


def work(slug: str) -> Path:
    d = RESEARCH_DIR / ".work" / slug
    (d / "pages").mkdir(parents=True, exist_ok=True)
    return d


def log(slug: str, kind: str, rec: dict) -> None:
    rec = {"t": dt.datetime.now().isoformat(timespec="seconds"), **rec}
    with open(work(slug) / f"{kind}.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def read_log(slug: str, kind: str) -> list[dict]:
    f = work(slug) / f"{kind}.jsonl"
    return [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()] if f.exists() else []


def norm_url(u: str) -> str:
    p = urllib.parse.urlsplit(u.strip().rstrip(").,;>"))
    return urllib.parse.urlunsplit((p.scheme.lower(), p.netloc.lower().removeprefix("www."), p.path.rstrip("/"),
                                    p.query, ""))


def searx(query: str, lang: str = "all") -> dict:
    q = urllib.parse.urlencode({"q": query, "format": "json", "language": lang})
    with urllib.request.urlopen(f"{SEARXNG}/search?{q}", timeout=60) as r:
        return json.loads(r.read())


def env(name: str) -> str:
    """A key from the environment, else from the user's saved variables (HKCU\\Environment): the OpenClaw gateway
    runs as a scheduled task and only sees variables that existed when it started."""
    if os.environ.get(name):
        return os.environ[name]
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return winreg.QueryValueEx(k, name)[0]
    except Exception:  # noqa: BLE001 - not on Windows or not set
        return ""


def tavily_search(query: str, n: int) -> list[dict]:
    """Tavily (TAVILY_API_KEY, free 1,000 credits a month, basic search = 1 credit). Public queries only."""
    key = env("TAVILY_API_KEY")
    if not key:
        return []
    body = {"query": query, "max_results": min(n, 20), "search_depth": "basic"}
    req = urllib.request.Request(TAVILY_URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read())
    return [{"title": x.get("title", ""), "url": x["url"], "content": x.get("content", ""), "engines": ["tavily"]}
            for x in d.get("results", []) if x.get("url")]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def real_url(uri: str) -> str:
    """Grounding links are Google redirects (vertexaisearch.cloud.google.com/grounding-api-redirect/...): the page
    itself is in the Location header."""
    try:
        urllib.request.build_opener(NoRedirect).open(urllib.request.Request(uri, method="HEAD"), timeout=15)
    except urllib.error.HTTPError as e:
        if e.headers.get("Location"):
            return e.headers["Location"]
    except Exception:  # noqa: BLE001 - keep the redirect, fetch follows it
        pass
    return uri


def gemini_search(query: str) -> list[dict]:
    """Google results through Gemini's Search grounding (GEMINI_API_KEY). Only the source links are used - the
    model's own answer text is thrown away; every page is still read with `fetch` before it can be cited.
    The query goes to Google's cloud: never put private, customer or ERP data in it."""
    key = env("GEMINI_API_KEY")
    if not key:
        return []
    body = {"contents": [{"parts": [{"text": f"Search the web and list the most relevant, most authoritative sources "
                                              f"for: {query}"}]}],
            "tools": [{"google_search": {}}]}
    req = urllib.request.Request(GEMINI_URL.format(model=GEMINI_MODEL), data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read())
    meta = (d.get("candidates") or [{}])[0].get("groundingMetadata", {})
    out = []
    for c in meta.get("groundingChunks", []):
        web = c.get("web") or {}
        if web.get("uri"):
            out.append({"title": web.get("title", ""), "url": real_url(web["uri"]), "content": "",
                        "engines": ["google (gemini)"]})
    return out


# --- start / search ---------------------------------------------------------------
def cmd_start(a) -> int:
    work(a.slug)
    engines, dead = set(), {}
    for q in ("open source ERP software", "Türkiye e-Fatura entegratör"):
        try:
            d = searx(q)
        except Exception as e:  # noqa: BLE001
            print(f"SEARCH DOWN: SearXNG did not answer ({e}). Start it: "
                  r"C:\Users\PC\Documents\GitHub\local-agent-stack\scripts\start-searxng.ps1")
            return 2
        engines |= {e for r in d["results"] for e in r.get("engines", [])}
        dead.update({e: why for e, why in d.get("unresponsive_engines", [])})
        for name, fn in (("tavily", lambda: tavily_search(q, 3)), ("google (gemini)", lambda: gemini_search(q))):
            try:
                if fn():
                    engines.add(name)
            except Exception as e:  # noqa: BLE001
                dead[name] = f"{getattr(e, 'code', '')} {str(e)[:100]}"
    print(f"work folder: {work(a.slug)}")
    print(f"answering engines: {sorted(engines) or 'NONE'}")
    if dead:
        print(f"blocked engines: {dead}")
    if len(engines) < MIN_ENGINES:
        print(f"SEARCH WEAK: only {len(engines)} engine(s) answer. Tell the user before researching - a report from "
              f"one engine is one-sided. Continue only if they say so, and say it in the report.")
        return 1
    print(f"ok - minimums for the report: {MIN_SEARCHES} searches, {MIN_FETCHED} pages read, {MIN_CITED} sources, "
          f"{MIN_DOMAINS} sites")
    return 0


def cmd_search(a) -> int:
    results, errors = [], []
    try:
        results = searx(a.query, a.lang)["results"][: a.n]
    except Exception as e:  # noqa: BLE001
        errors.append(f"searxng: {e}")
    # API engines first (SearXNG's own Google/DDG/Brave are blocked from this IP); any of them may fail on quota
    # or network and the others still answer.
    api = []
    for name, fn in (("tavily", lambda: tavily_search(a.query, a.n)), ("gemini", lambda: gemini_search(a.query))):
        try:
            api += fn()
        except Exception as e:  # noqa: BLE001
            errors.append(f"{name}: {getattr(e, 'code', '')} {str(e)[:120]}")
    merged, seen = [], set()
    for r in api + results:
        if norm_url(r["url"]) not in seen:
            seen.add(norm_url(r["url"]))
            merged.append(r)
    results = merged[: a.n * 2]
    if not results:
        print(f"SEARCH FAILED: {'; '.join(errors) or 'no results'}")
        return 2
    if errors:
        print(f"(partial: {'; '.join(errors)})")
    log(a.slug, "searches", {"q": a.query, "lang": a.lang, "n": len(results),
                             "urls": [r["url"] for r in results]})
    n = len(read_log(a.slug, "searches"))
    print(f"search #{n}: {len(results)} results for {a.query!r}")
    for i, r in enumerate(results, 1):
        snippet = re.sub(r"\s+", " ", r.get("content", ""))[:220]
        print(f"{i}. {r.get('title', '')[:120]}\n   {r['url']}\n   {snippet}")
    return 0


# --- fetch ------------------------------------------------------------------------
class TextOnly(HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head"}

    def __init__(self):
        super().__init__()
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in ("p", "br", "li", "tr", "h1", "h2", "h3", "h4", "div", "td", "th"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_text(raw: str) -> str:
    p = TextOnly()
    p.feed(raw)
    text = html.unescape("".join(p.out))
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def fetch_plain(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "tr,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as r:
        raw = r.read().decode(r.headers.get_content_charset() or "utf-8", errors="replace")
        ctype = r.headers.get_content_type()
        return r.status, raw if ctype in ("text/plain", "application/json") else html_text(raw)


def fetch_browser(url: str) -> tuple[int, str]:
    """Pages that need JavaScript: installed Edge, headless (Playwright, no browser download)."""
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="msedge", headless=True)
        try:
            page = b.new_page(user_agent=USER_AGENT, locale="tr-TR")
            resp = page.goto(url, timeout=FETCH_TIMEOUT_S * 1000, wait_until="networkidle")
            return (resp.status if resp else 0), page.inner_text("body")
        finally:
            b.close()


def cmd_fetch(a) -> int:
    status, text, how = 0, "", "http"
    if not a.browser:
        try:
            status, text = fetch_plain(a.url)
        except Exception as e:  # noqa: BLE001 - try the browser next
            status, text = getattr(e, "code", 0) or 0, ""
    if a.browser or len(text) < 500:          # asked for, blocked, error page or a JS app shell
        try:
            how = "browser"
            status, text = fetch_browser(a.url)
        except Exception as e:  # noqa: BLE001
            print(f"COULD NOT READ {a.url}: {type(e).__name__}: {str(e)[:200]} - do not cite it")
            log(a.slug, "fetches", {"url": a.url, "status": status, "chars": 0, "ok": False})
            return 2
    ok = 200 <= status < 400 and len(text) >= 200
    name = re.sub(r"[^a-zA-Z0-9]+", "_", norm_url(a.url))[:120] + ".txt"
    (work(a.slug) / "pages" / name).write_text(f"URL: {a.url}\n\n{text}", encoding="utf-8")
    log(a.slug, "fetches", {"url": a.url, "status": status, "chars": len(text), "ok": ok, "file": name, "how": how})
    n = sum(1 for f in read_log(a.slug, "fetches") if f["ok"])
    end = a.start + a.chars
    print(f"page #{n}: HTTP {status}, {len(text)} chars ({how}){'' if ok else ' - NOT USABLE, do not cite'}")
    print(text[a.start:end])
    if len(text) > end:
        print(f"\n[... {len(text) - end} more chars - read on with --from {end}. Never conclude that something is "
              f"missing from a page you have not read to the end.]")
    return 0 if ok else 1


# --- check ------------------------------------------------------------------------
def forms(num: str) -> set[str]:
    """A number written as on a page or in the report -> the digit strings it can match: "490,00" and "490" are the
    same price, "14,80" is also "14,8"; separators differ between TR and EN pages."""
    num = num.strip(".,")
    out = {re.sub(r"[.,]", "", num)}
    m = re.match(r"^(.*?)[.,](\d{1,2})$", num)
    if m:                                       # a decimal part: 490,00 = 490 and 14,80 = 14,8 (never 22,90 = 22)
        whole = re.sub(r"[.,]", "", m[1])
        dec = m[2].rstrip("0")
        out.add(whole + dec)
    return {f for f in out if f}


def page_digits(slug: str) -> dict[str, set[str]]:
    """normalized url -> every number on that page, in all its forms"""
    out = {}
    for f in read_log(slug, "fetches"):
        if f.get("ok") and f.get("file"):
            p = work(slug) / "pages" / f["file"]
            if p.exists():
                found = set()
                for m in re.findall(r"\d[\d.,]*", p.read_text(encoding="utf-8")):
                    found |= forms(m)
                out.setdefault(norm_url(f["url"]), set()).update(found)
    return out


def numbers_in(line: str) -> list[str]:
    line = re.sub(r"\[\d+\]", " ", line)                                 # citation marks are not data
    line = re.sub(r"\b\d{1,2}[./]\d{1,2}[./](19|20)\d\d\b", " ", line)   # dates 20.10.2026
    line = re.sub(r"\b(19|20)\d\d\b", " ", line)                         # years
    nums = re.findall(r"\d[\d.,]*\d|\d", line)
    return [n for n in nums if len(re.sub(r"[.,]", "", n)) >= 2]


def blocks(body: str) -> list[str]:
    """Bullets, numbered items, table rows and paragraphs as single strings: markdown wraps a sentence over several
    lines and its citation may sit on the last one."""
    out: list[str] = []
    for line in body.splitlines():
        s = line.strip()
        if not s:
            out.append("")
        elif s.startswith(("- ", "* ", "|", "#", ">")) or re.match(r"\d+\. ", s) or not out or not out[-1]:
            out.append(s)
        else:
            out[-1] += " " + s
    return [b for b in out if b]


def split_sources(text: str) -> tuple[str, str, str]:
    """(body, sources, heading). The report is written in the user's language, headings included, so the sources
    section is found by its content: the last `## ` section whose lines are mostly `[n] ...`."""
    parts = re.split(r"(?m)^(## .*)$", text)
    for i in range(len(parts) - 2, 0, -2):              # walk the sections from the end
        lines = [l for l in parts[i + 1].splitlines() if l.strip()]
        refs = [l for l in lines if re.match(r"^\s*\[\d+\]", l)]
        if refs and len(refs) * 2 >= len(lines):
            return "".join(parts[:i]), parts[i + 1], parts[i].strip()
    return text, "", ""


METHOD = re.compile(r"yöntem|method|methodik|metodo|méthode", re.I)
SUMMARY = re.compile(r"özet|summary|zusammenfassung|resumen|résumé|riassunto", re.I)


def sections(text: str) -> list[tuple[str, str]]:
    parts = re.split(r"(?m)^(## .*)$", text)
    return [(parts[i].strip(), parts[i + 1]) for i in range(1, len(parts) - 1, 2)]


def without_method_note(body: str) -> str:
    """The method note's counts come from this tool's own logs, not from a page - checking them for citations only
    taught the model to write "otuz" instead of "30"."""
    parts = re.split(r"(?m)^(## .*)$", body)
    out = [parts[0]]
    for i in range(1, len(parts) - 1, 2):
        if not METHOD.search(parts[i]):
            out += [parts[i], parts[i + 1]]
    return "".join(out)


def report_lang(heading: str) -> str:
    return "tr" if re.search(r"kaynak", heading, re.I) else "en"


def check_report(slug: str, report: Path) -> list[str]:
    text = report.read_text(encoding="utf-8")
    issues = []
    searches = read_log(slug, "searches")
    fetched = {norm_url(f["url"]) for f in read_log(slug, "fetches") if f.get("ok")}
    if len(searches) < MIN_SEARCHES:
        issues.append(f"only {len(searches)} searches logged (min {MIN_SEARCHES}) - search more, TR and EN, "
                      f"differently worded")
    if len(fetched) < MIN_FETCHED:
        issues.append(f"only {len(fetched)} pages read (min {MIN_FETCHED}) - read more primary sources")

    body, refs, _ = split_sources(text)
    if not refs:
        issues.append("no sources section found - end the report with a `## ` section of `[n] title - URL - date` lines")
    sources = {}
    for m in re.finditer(r"^\s*\[(\d+)\](.*)$", refs, re.M):
        url = re.search(r"https?://\S+", m[2])
        sources[m[1]] = norm_url(url[0]) if url else None
    if len(sources) < MIN_CITED:
        issues.append(f"only {len(sources)} sources (min {MIN_CITED})")
    domains = {urllib.parse.urlsplit("https://" + u.split("://", 1)[-1]).netloc for u in sources.values() if u}
    if len(domains) < MIN_DOMAINS:
        issues.append(f"sources come from {len(domains)} site(s) {sorted(domains)} (min {MIN_DOMAINS}) - "
                      f"independent sources needed")
    for n, url in sources.items():
        if not url:
            issues.append(f"[{n}] has no URL - every source needs the exact page it came from")
        elif url not in fetched:
            issues.append(f"[{n}] {url} was never read with `fetch` - read it or remove the citation")

    digits = page_digits(slug)
    above: list[str] = []                     # a table row without marks is covered by the line just above the table
    for s in blocks(without_method_note(body)):
        if not s.startswith("|"):
            above = sorted(set(re.findall(r"\[(\d+)\]", s)))
        if not s or s.startswith(("#", ">", "|---", "| ---", "**Tarih", "**Soru")) or ADMITTED.search(s):
            continue
        cites = sorted(set(re.findall(r"\[(\d+)\]", s))) or (above if s.startswith("|") else [])
        if NEGATIVE.search(s) and len(cites) < 2:
            issues.append(f"'does not exist / not available' claim with {len(cites)} source(s) - search for the "
                          f"thing itself, read 2 independent sources, or mark it '(tek kaynak)': {s[:140]}")
        nums = numbers_in(s)
        if nums and not cites:
            issues.append(f"numbers without a citation (cite the page, or mark a computed value '(hesap)'): {s[:140]}")
        elif nums:
            read = [digits[sources[c]] for c in cites if sources.get(c) in digits]   # unread ones are flagged above
            pool = set().union(*read) if read else set()
            missing = [n for n in nums if read and not forms(n) & pool]
            if missing:
                issues.append(f"number(s) {missing} not in the text of the cited page(s) {cites}: take them from the "
                              f"page, or re-read it with `fetch --browser` if it loads prices with JavaScript: {s[:120]}")
    return issues


def cmd_check(a) -> int:
    report = Path(a.report)
    issues = check_report(a.slug, report)
    s, f = len(read_log(a.slug, "searches")), sum(1 for x in read_log(a.slug, "fetches") if x.get("ok"))
    stats = f"{s} arama, {f} okunan sayfa"
    # A finished report goes to Telegram from here, not as a last step the model may not reach (the first v2 run hit
    # the agent timeout after writing the report and before sending it).
    if not issues:
        print(f"PASSED ({stats})")
        return cmd_send(a)
    if a.final:
        lang = report_lang(split_sources(report.read_text(encoding="utf-8"))[2])
        intro = (f"Bu rapor kalite kontrolünü tam geçemedi ({stats}). Açık kalan noktalar:" if lang == "tr" else
                 f"This report did not fully pass the quality check ({s} searches, {f} pages read). Open points:")
        block = f"\n\n---\n\n{WARN_HEADING[lang]}\n\n{intro}\n\n" + "\n".join(f"- {i}" for i in issues) + "\n"
        report.write_text(report.read_text(encoding="utf-8").rstrip("\n") + block, encoding="utf-8")
        print(f"FINAL: {len(issues)} issue(s) appended to the report as warnings")
        return cmd_send(a)
    print(f"FAILED ({stats}) - {len(issues)} issue(s); fix them and run check again:")
    for i in issues[:40]:
        print("- " + i)
    return 1


# --- send -------------------------------------------------------------------------
def cmd_send(a) -> int:
    report = Path(a.report)
    text = report.read_text(encoding="utf-8")
    title = next((l.lstrip("# ").strip() for l in text.splitlines() if l.startswith("# ")), report.stem)
    # The summary section by its name in the report's language, else the first bulleted one that is not the method note.
    secs = sections(text)
    summary = next((b.strip() for h, b in secs if SUMMARY.search(h)), "") or \
        next((b.strip() for h, b in secs if not METHOD.search(h) and re.search(r"(?m)^\s*[-*] ", b)), "")
    lang = report_lang(split_sources(text)[2])
    warn = ("\n⚠️ Kalite uyarıları var (raporun sonunda)." if lang == "tr" else
            "\n⚠️ Quality warnings at the end of the report.") if WARN_HEADING[lang] in text else ""
    if not TELEGRAM_TARGET:
        print("SEND SKIPPED: set HYBRID_NOTIFY_TELEGRAM to your paired Telegram chat id")
        return 1
    caption = f"🔎 {title}\n\n{summary}"[:900] + warn
    OPENCLAW_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    media = Path(shutil.copy(report, OPENCLAW_MEDIA_DIR / report.name))
    node = shutil.which("node")
    if not node or not Path(OPENCLAW_ENTRY).exists():
        print("SEND FAILED: node or openclaw not found")
        return 2
    r = subprocess.run([node, OPENCLAW_ENTRY, "message", "send", "--channel", "telegram", "--target", TELEGRAM_TARGET,
                        "--message", caption, "--media", str(media)], stdin=subprocess.DEVNULL, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=120)
    if r.returncode != 0:
        print(f"SEND FAILED: {(r.stderr or r.stdout).strip()[-300:]}")
        return 1
    print(f"sent to Telegram: {report.name}")
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("start"); p.add_argument("slug")
    p = sub.add_parser("search"); p.add_argument("slug"); p.add_argument("query")
    p.add_argument("--lang", default="all"); p.add_argument("--n", type=int, default=10)
    p = sub.add_parser("fetch"); p.add_argument("slug"); p.add_argument("url")
    p.add_argument("--from", dest="start", type=int, default=0); p.add_argument("--chars", type=int, default=8000)
    p.add_argument("--browser", action="store_true", help="read with headless Edge (pages that load data with JS)")
    p = sub.add_parser("check"); p.add_argument("slug"); p.add_argument("report")
    p.add_argument("--final", action="store_true")
    p = sub.add_parser("send"); p.add_argument("report")
    a = ap.parse_args()
    return {"start": cmd_start, "search": cmd_search, "fetch": cmd_fetch, "check": cmd_check, "send": cmd_send}[a.cmd](a)


if __name__ == "__main__":
    sys.exit(main())
