"""Run a .sql file against Snowflake, one statement at a time.

Usage: python snowflake/run_sql.py snowflake/ai_enrichment.sql
"""
import sys
import time
from pathlib import Path

from load_csvs import connect


def statements(text):
    # Split on semicolons that end a line, skipping comment-only chunks.
    for chunk in text.split(";\n"):
        body = "\n".join(l for l in chunk.splitlines() if not l.strip().startswith("--")).strip()
        if body:
            yield body


def main():
    conn = connect()
    cur = conn.cursor()
    for stmt in statements(Path(sys.argv[1]).read_text()):
        t = time.time()
        print(stmt.splitlines()[0][:90], "...", flush=True)
        cur.execute(stmt)
        print(f"   done in {time.time() - t:.1f}s", flush=True)
    conn.close()


if __name__ == "__main__":
    main()
