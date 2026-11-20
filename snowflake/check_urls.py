"""Check every AI-suggested resource URL and record the result in CISC.CORE.RESOURCES.URL_OK.

The API hides resources where URL_OK = FALSE. Run after ai_enrichment.sql, from a machine
with normal internet access:  python snowflake/check_urls.py
"""
from concurrent.futures import ThreadPoolExecutor

import requests

from load_csvs import connect

HEADERS = {"User-Agent": "Mozilla/5.0 (Future-Study link checker)"}


def ok(url):
    if not url or not url.startswith(("http://", "https://")):
        return url, False
    try:
        r = requests.head(url, headers=HEADERS, timeout=10, allow_redirects=True)
        if r.status_code in (403, 405) or r.status_code >= 500:  # many sites reject HEAD
            r = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True, stream=True)
        return url, r.status_code < 400
    except requests.RequestException:
        return url, False


def main():
    conn = connect()
    cur = conn.cursor()
    urls = [u for (u,) in cur.execute("SELECT DISTINCT URL FROM CISC.CORE.RESOURCES").fetchall()]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(ok, urls))
    cur.execute("CREATE OR REPLACE TEMPORARY TABLE URL_CHECK (URL STRING, OK BOOLEAN)")
    cur.executemany("INSERT INTO URL_CHECK VALUES (%s, %s)", results)
    cur.execute("UPDATE CISC.CORE.RESOURCES r SET URL_OK = c.OK FROM URL_CHECK c WHERE r.URL = c.URL")
    bad = sum(1 for _, good in results if not good)
    print(f"checked {len(results)} urls, {bad} broken (hidden from the app)")
    conn.close()


if __name__ == "__main__":
    main()
