#!/usr/bin/env python3
"""
Birhan load test — seed a realistic multi-church dataset, measure the hot query
paths under concurrency, then tear the synthetic data back out.

The point is to PROVE the indexes (12/13) hold up as the platform grows: that a
member's announcement read stays an index seek regardless of total table size,
and that the super-admin console's platform-wide queries don't degrade into
full scans.

    python3 loadtest.py seed     --churches 2000 --members 500   # ~1M profiles
    python3 loadtest.py measure  --concurrency 50 --iterations 2000
    python3 loadtest.py teardown                                 # remove ALL synthetic rows

SAFETY: everything synthetic is tagged —
    churches  : name_en starts with 'LOADTEST '
    auth users: email ends with '@loadtest.birhan.invalid'
teardown deletes exactly and only those (cascades handle the rest). Real data is
never touched. Prefer running the big seeds against a STAGING clone, not prod.

Connection: set PGCONN to a Postgres URI, e.g. the Supabase pooler:
    export PGCONN="host=aws-0-<region>.pooler.supabase.com port=5432 \
                   user=postgres.<ref> dbname=postgres sslmode=require password=..."
"""
import argparse, os, sys, time, uuid, random, statistics, threading, queue

try:
    import psycopg
except ImportError:
    sys.exit("pip install 'psycopg[binary]' first")

TAG_EMAIL = "@loadtest.birhan.invalid"
TAG_CHURCH = "LOADTEST "
# A fixed bcrypt-shaped hash. Synthetic users never authenticate; this only
# satisfies the column — it is not a usable password.
FIXED_PW = "$2a$10$abcdefghijklmnopqrstuv0123456789ABCDEFGHIJKLMNOPQRSTU."

DENOMS = ["Kale Heywet", "Mekane Yesus", "Mulu Wongel", "Meserete Kristos", "Baptist"]
CITIES = ["Addis Ababa", "Adama", "Hawassa", "Bahir Dar", "Mekelle", "Bishoftu", "Dire Dawa"]


def conn():
    ci = os.environ.get("PGCONN")
    if not ci:
        sys.exit("Set PGCONN (see the module docstring).")
    return psycopg.connect(ci, autocommit=True)


# --------------------------------------------------------------------------- seed
def seed(args):
    n_churches, per = args.churches, args.members
    print(f"seeding ~{n_churches} churches x {per} members = ~{n_churches*per:,} profiles …")
    t0 = time.time()
    with conn() as cx:
        # Skip triggers (member_count bump) during bulk load if allowed; we set
        # the counts directly afterward. Harmless if the role can't set it.
        try:
            cx.execute("set session_replication_role = replica")
            skipped_triggers = True
        except Exception:
            skipped_triggers = False

        church_ids = [uuid.uuid4() for _ in range(n_churches)]

        with cx.cursor().copy(
            "copy churches (id, name_am, name_en, denomination, city, member_count) from stdin"
        ) as cp:
            for i, cid in enumerate(church_ids):
                cp.write_row((cid, f"ጭነት {i}", f"{TAG_CHURCH}Church {i}",
                              random.choice(DENOMS), random.choice(CITIES), per))

        # auth.users + profiles, streamed per church to bound memory.
        print("  users + profiles …")
        for ci_idx, cid in enumerate(church_ids):
            uids = [uuid.uuid4() for _ in range(per)]
            with cx.cursor().copy(
                "copy auth.users (instance_id, id, aud, role, email, "
                "encrypted_password, email_confirmed_at, created_at, updated_at) from stdin"
            ) as cp:
                for j, uid in enumerate(uids):
                    cp.write_row(("00000000-0000-0000-0000-000000000000", uid,
                                  "authenticated", "authenticated",
                                  f"lt_{ci_idx}_{j}_{uid.hex[:8]}{TAG_EMAIL}",
                                  FIXED_PW, "now()", "now()", "now()"))
            with cx.cursor().copy(
                "copy profiles (id, display_name, church_id, role, language) from stdin"
            ) as cp:
                for j, uid in enumerate(uids):
                    cp.write_row((uid, f"Member {ci_idx}-{j}", cid, "member", "am"))
            if (ci_idx + 1) % 200 == 0:
                print(f"    {ci_idx+1}/{n_churches} churches")

        # A few announcements per church, a few replies per announcement.
        print("  announcements + replies …")
        for cid in church_ids:
            author = cx.execute("select id from profiles where church_id=%s limit 1",
                                (cid,)).fetchone()[0]
            ann_ids = [uuid.uuid4() for _ in range(args.announcements)]
            with cx.cursor().copy(
                "copy announcements (id, church_id, author_id, title_am, title_en, body) from stdin"
            ) as cp:
                for k, aid in enumerate(ann_ids):
                    cp.write_row((aid, cid, author, f"ማስታወቂያ {k}", f"Notice {k}",
                                  "Load-test announcement body."))
            with cx.cursor().copy(
                "copy replies (id, announcement_id, author_id, author_name, text) from stdin"
            ) as cp:
                for aid in ann_ids:
                    for _ in range(args.replies):
                        cp.write_row((uuid.uuid4(), aid, author, "Member", "reply"))

        if skipped_triggers:
            cx.execute("set session_replication_role = default")
        print("  ANALYZE …")
        cx.execute("analyze churches; analyze profiles; analyze announcements; analyze replies")

    print(f"seeded in {time.time()-t0:.1f}s "
          f"(triggers {'skipped' if skipped_triggers else 'ran'} during load)")


# ------------------------------------------------------------------------ measure
QUERIES = {
    # member hot path: their church's recent announcements with reply counts
    "member_announcements":
        "select a.*, (select count(*) from replies r where r.announcement_id=a.id) "
        "from announcements a where a.church_id=%(church)s "
        "order by a.created_at desc limit 50",
    # member: open a thread
    "member_replies":
        "select * from replies where announcement_id=%(ann)s order by created_at limit 200",
    # admin console: verification queue (platform-wide, partial index)
    "admin_verification":
        "select * from profiles where pastor_status='pending' "
        "order by pastor_requested_at limit 100",
    # admin console: churches directory
    "admin_churches":
        "select * from churches order by member_count desc limit 500",
    # admin console: dashboard estimate (O(1) RPC)
    "admin_estimate":
        "select * from public.platform_estimated_counts()",
}


def _sample_keys(cx):
    ch = [r[0] for r in cx.execute(
        "select id from churches where name_en like %s limit 500",
        (TAG_CHURCH + "%",)).fetchall()]
    an = [r[0] for r in cx.execute(
        "select a.id from announcements a join churches c on c.id=a.church_id "
        "where c.name_en like %s limit 500", (TAG_CHURCH + "%",)).fetchall()]
    if not ch:
        sys.exit("No synthetic data found — run `seed` first.")
    return ch, an


def _explain(cx, name, params):
    """Returns (plan_kind, server_execution_ms) — the exec time is measured
    inside Postgres, so it excludes client<->DB network round-trip. This is the
    number that reflects the index, not your distance to the region."""
    rows = [r[0] for r in cx.execute(
        "explain (analyze, buffers, format text) " + QUERIES[name], params).fetchall()]
    idx = any("Index" in r for r in rows)
    seq = any("Seq Scan" in r for r in rows)
    exec_ms = None
    for r in rows:
        if "Execution Time" in r:
            exec_ms = float(r.split(":")[1].strip().split(" ")[0])
    kind = "index-seek" if idx and not seq else ("SEQ-SCAN ⚠️" if seq else "no-scan/RPC")
    return kind, exec_ms


def measure(args):
    with conn() as cx:
        churches, anns = _sample_keys(cx)
        total = cx.execute("select reltuples::bigint from pg_class where oid='profiles'::regclass").fetchone()[0]
        print(f"measuring against ~{total:,} profiles, {len(churches)} sampled churches\n")
        print("plan check — kind + SERVER-side execution time (excludes network):")
        print(f"  {'query':22} {'plan':14} {'server ms':>10}")
        for name in QUERIES:
            p = {"church": random.choice(churches), "ann": random.choice(anns) if anns else uuid.uuid4()}
            kind, ms = _explain(cx, name, p)
            print(f"  {name:22} {kind:14} {('%.2f' % ms) if ms is not None else '—':>10}")
        print("\n  NOTE: a Seq Scan on a SMALL table is Postgres correctly choosing it;")
        print("  re-check the plan at target scale (millions of rows), where it flips to")
        print("  the index. The server-ms column is the real query cost.\n")

    results = {name: [] for name in QUERIES}
    work = queue.Queue()
    for _ in range(args.iterations):
        work.put(random.choice(list(QUERIES)))

    def worker():
        with conn() as cx:
            ch, an = _sample_keys(cx)
            while True:
                try:
                    name = work.get_nowait()
                except queue.Empty:
                    return
                p = {"church": random.choice(ch), "ann": random.choice(an) if an else uuid.uuid4()}
                t = time.perf_counter()
                cx.execute(QUERIES[name], p).fetchall()
                results[name].append((time.perf_counter() - t) * 1000)

    print(f"running {args.iterations} queries across {args.concurrency} concurrent connections …")
    print("  (for concurrency > ~15, point PGCONN at the TRANSACTION pooler on port 6543,")
    print("   not session-mode 5432 — session mode caps clients at the pool size.)")
    t0 = time.time()
    threads = [threading.Thread(target=worker) for _ in range(args.concurrency)]
    for t in threads: t.start()
    for t in threads: t.join()
    elapsed = time.time() - t0

    def pct(v, p): return sorted(v)[min(len(v) - 1, int(len(v) * p))]
    print(f"\ndone in {elapsed:.1f}s — {args.iterations/elapsed:.0f} queries/sec\n")
    print(f"  {'query':22} {'n':>6} {'p50':>8} {'p95':>8} {'p99':>8}  (ms)")
    for name, v in results.items():
        if not v: continue
        print(f"  {name:22} {len(v):>6} {statistics.median(v):>8.1f} "
              f"{pct(v,0.95):>8.1f} {pct(v,0.99):>8.1f}")


# ----------------------------------------------------------------------- teardown
def teardown(args):
    with conn() as cx:
        print("deleting synthetic data (tagged only) …")
        # Order matters: announcements.author_id and replies.author_id reference
        # profiles WITHOUT on-delete-cascade, so children must go before parents.
        # Delete: announcements (cascades replies) -> profiles -> auth.users ->
        # churches. Cascading straight from auth.users hits the author FK first.
        synth = "(select id from churches where name_en like %s)"
        cx.execute(f"delete from announcements where church_id in {synth}", (TAG_CHURCH + "%",))
        cx.execute(f"delete from profiles where church_id in {synth}", (TAG_CHURCH + "%",))
        n_users = cx.execute("delete from auth.users where email like %s",
                             ("%" + TAG_EMAIL,)).rowcount
        n_ch = cx.execute("delete from churches where name_en like %s",
                          (TAG_CHURCH + "%",)).rowcount
        cx.execute("analyze churches; analyze profiles; analyze announcements; analyze replies")
        print(f"removed {n_users:,} synthetic users (+profiles) and {n_ch:,} churches. clean.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed")
    s.add_argument("--churches", type=int, default=2000)
    s.add_argument("--members", type=int, default=500)
    s.add_argument("--announcements", type=int, default=10)
    s.add_argument("--replies", type=int, default=5)
    s.set_defaults(fn=seed)
    m = sub.add_parser("measure")
    m.add_argument("--concurrency", type=int, default=50)
    m.add_argument("--iterations", type=int, default=2000)
    m.set_defaults(fn=measure)
    t = sub.add_parser("teardown"); t.set_defaults(fn=teardown)
    args = ap.parse_args()
    args.fn(args)
