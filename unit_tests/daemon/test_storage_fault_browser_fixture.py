"""Storage fixture uses actual SQLite rejection, never forged HTTP events."""

import sqlite3

import pytest


@pytest.mark.parametrize("mode,code", [("query_only", 8), ("page_quota", 13)])
def test_sqlite_refusal_rolls_back_and_recovers_exactly_once(tmp_path, mode, code):
    db = sqlite3.connect(tmp_path / "proof.db")
    db.execute("CREATE TABLE events(seq INTEGER PRIMARY KEY, payload TEXT)")
    db.execute("CREATE TABLE cursors(seq INTEGER)")
    db.execute("INSERT INTO events VALUES (0,'hello')")
    db.execute("INSERT INTO cursors VALUES (0)")
    db.commit()
    maximum = db.execute("PRAGMA max_page_count").fetchone()[0]
    pages = db.execute("PRAGMA page_count").fetchone()[0]
    db.execute(
        "PRAGMA query_only=ON"
        if mode == "query_only"
        else f"PRAGMA max_page_count={pages}"
    )

    def ingest():
        with db:
            db.execute("INSERT INTO events VALUES (1,?)", ("x" * 60000,))
            db.execute("INSERT INTO events VALUES (2,'completed')")
            db.execute("UPDATE cursors SET seq=2")

    with pytest.raises(sqlite3.OperationalError) as caught:
        ingest()
    assert caught.value.sqlite_errorcode == code
    assert db.execute("SELECT seq FROM events").fetchall() == [(0,)]
    assert db.execute("SELECT seq FROM cursors").fetchone() == (0,)
    db.execute(
        "PRAGMA query_only=OFF"
        if mode == "query_only"
        else f"PRAGMA max_page_count={maximum}"
    )
    ingest()
    assert db.execute("SELECT seq FROM events").fetchall() == [(0,), (1,), (2,)]
    assert db.execute("SELECT seq FROM cursors").fetchone() == (2,)
    db.close()
