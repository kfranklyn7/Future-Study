"""Load every CSV in data/csv/ into Snowflake as CISC.CORE.<FILE_NAME_UPPER>.

Connection comes from environment variables (never commit credentials):
  SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD (or SNOWFLAKE_TOKEN_FILE_PATH for OAuth),
  SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE

Usage: python snowflake/load_csvs.py [--database CISC] [--schema CORE]
"""
import argparse
import os
from pathlib import Path

import pandas as pd
import snowflake.connector
from snowflake.connector.pandas_tools import write_pandas

CSV_DIR = Path(__file__).resolve().parent.parent / "data" / "csv"


def connect():
    params = dict(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
        role=os.environ.get("SNOWFLAKE_ROLE"),
    )
    token_path = os.environ.get("SNOWFLAKE_TOKEN_FILE_PATH")
    if token_path and Path(token_path).exists():
        params.update(authenticator="oauth", token=Path(token_path).read_text().strip(),
                      host=os.environ.get("SNOWFLAKE_HOST"))
    else:
        params.update(user=os.environ["SNOWFLAKE_USER"], password=os.environ["SNOWFLAKE_PASSWORD"])
    return snowflake.connector.connect(**{k: v for k, v in params.items() if v})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--database", default="CISC")
    ap.add_argument("--schema", default="CORE")
    args = ap.parse_args()

    conn = connect()
    cur = conn.cursor()
    cur.execute(f"CREATE SCHEMA IF NOT EXISTS {args.database}.{args.schema}")
    cur.execute(f"USE SCHEMA {args.database}.{args.schema}")

    for csv in sorted(CSV_DIR.glob("*.csv")):
        df = pd.read_csv(csv, dtype=str, keep_default_na=False)
        # ROWS is reserved in Snowflake (manifest.csv uses it).
        df.columns = ["ROW_COUNT" if c.upper() == "ROWS" else c.upper() for c in df.columns]
        table = csv.stem.upper()
        ok, _, rows, _ = write_pandas(conn, df, table, auto_create_table=True, overwrite=True,
                                      quote_identifiers=False)
        print(f"{table:28s} {rows:5d} rows {'ok' if ok else 'FAILED'}")
    conn.close()


if __name__ == "__main__":
    main()
