"""Apply SQL migrations from supabase/migrations/ to the configured database.

Usage (from backend/):
    uv run python -m app.db.migrate            # apply pending migrations
    uv run python -m app.db.migrate --status   # show applied/pending, change nothing

Connects with DATABASE_URL from backend/.env. History lives in
supabase_migrations.schema_migrations — the same table the Supabase CLI
uses, so adopting `supabase db push` later needs no re-baselining.
"""

import argparse
import sys
from pathlib import Path

import psycopg

from app.core.config import get_settings

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "supabase" / "migrations"

_HISTORY_DDL = """
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    statements text[],
    name text
);
"""


def _discover() -> list[tuple[str, str, Path]]:
    """Return (version, name, path) for each migration file, oldest first."""
    migrations = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        version, _, name = path.stem.partition("_")
        if not version.isdigit():
            sys.exit(f"Bad migration filename (want <version>_<name>.sql): {path.name}")
        migrations.append((version, name, path))
    return migrations


def _applied_versions(conn: psycopg.Connection) -> set[str]:
    rows = conn.execute("select version from supabase_migrations.schema_migrations").fetchall()
    return {row[0] for row in rows}


def main() -> None:
    parser = argparse.ArgumentParser(description="SplitPocket database migrations")
    parser.add_argument(
        "--status", action="store_true", help="list applied/pending migrations without applying"
    )
    args = parser.parse_args()

    settings = get_settings()
    if not settings.database_url:
        sys.exit(
            "DATABASE_URL is not configured. Set it in backend/.env "
            "(Supabase dashboard → Connect → Connection string)."
        )

    migrations = _discover()
    if not migrations:
        sys.exit(f"No migrations found in {MIGRATIONS_DIR}")

    try:
        conn = psycopg.connect(settings.database_url, connect_timeout=15)
    except psycopg.OperationalError as exc:
        sys.exit(
            f"Could not connect to the database: {exc}\n"
            "Hint: Supabase 'direct' connections are IPv6-only on some plans — "
            "if this host lacks IPv6, use the Session Pooler string instead."
        )

    with conn:
        with conn.transaction():
            conn.execute(_HISTORY_DDL)
        applied = _applied_versions(conn)

        pending = [m for m in migrations if m[0] not in applied]

        if args.status:
            for version, name, _ in migrations:
                marker = "applied" if version in applied else "pending"
                print(f"  [{marker}] {version} {name}")
            print(f"{len(applied)} applied, {len(pending)} pending.")
            return

        if not pending:
            print(f"Up to date — {len(applied)} migration(s) already applied.")
            return

        for version, name, path in pending:
            sql = path.read_text(encoding="utf-8")
            print(f"Applying {version} {name} ... ", end="", flush=True)
            # One transaction per migration: the file's DDL and its history
            # row commit (or roll back) together.
            with conn.transaction():
                conn.execute(sql)
                conn.execute(
                    "insert into supabase_migrations.schema_migrations"
                    " (version, name, statements) values (%s, %s, %s)",
                    (version, name, [sql]),
                )
            print("done")

        print(f"Applied {len(pending)} migration(s).")


if __name__ == "__main__":
    main()
