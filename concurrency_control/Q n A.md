# Questions and Answers

### Scenario 1: The Strict Accountant (Isolation Levels)

**Context:** We have an `accounts` table. User A's account currently has a `balance` of $100.

**The Timeline:**

Plaintext

```
Time | Txn 1 (RR)             | Txn 2 (RC)
-----|------------------------|---------------------
  T1 | BEGIN ISOLATION LEVEL  |
     | REPEATABLE READ;       |
  T2 | SELECT balance FROM    |
     |   accounts WHERE id=1; |
     | -- sees $100           |
  T3 |                        | BEGIN;
  T4 |                        | UPDATE accounts
     |                        |   SET balance=$50
     |                        |   WHERE id=1;
  T5 |                        | COMMIT;
  T6 | UPDATE accounts        |
     |   SET balance=$150     |
     |   WHERE id=1;          |
     | -> ???                 |
```

**Question:** What exactly happens at `T6` for Transaction 1, and why?

**Answer:** Transaction 1 instantly throws an **ERROR** (`could not serialize access due to concurrent update`) and must be rolled back. **Explanation:** Because Transaction 1 is set to Repeatable Read (the strict, optimistic isolation level), it took a snapshot at T2. When it attempts the `UPDATE` at T6, Postgres checks the row and sees that Transaction 2 changed it after Transaction 1's snapshot started. Instead of evaluating the new data, Repeatable Read instantly aborts to protect data integrity. If Transaction 1 had been Read Committed, it would have succeeded and updated the balance to $150.

### Scenario 2: The Eager Shipper (Lock Conflicts)

**Context:** We have an `orders` table.

**The Timeline:**

Plaintext

```
Time | Txn A (Audit)          | Txn B (Shipping)
-----|------------------------|---------------------
  T1 | BEGIN;                 |
  T2 | SELECT * FROM orders   |
     |   WHERE id=42          |
     |   FOR SHARE;           |
     | -- lock acquired       |
  T3 |                        | BEGIN;
  T4 |                        | UPDATE orders
     |                        |   SET status='Shipped'
     |                        |   WHERE id=42;
     |                        | -> ???
```

**Question:** What happens to Transaction B at `T4`? Does it succeed immediately, fail, or wait? Which specific internal locks are interacting here?

**Answer:** Transaction B is blocked and **waits**. **Explanation:** Transaction A acquired a `FOR SHARE` lock (Strict Reader). Transaction B's `UPDATE` command automatically tries to acquire a `FOR NO KEY UPDATE` lock. These two specific locks conflict. Transaction B must wait patiently until Transaction A commits or rolls back before it can change the status.

### Scenario 3: The Race for Tickets (NOWAIT)

**Context:** A highly anticipated concert just went on sale. There is only 1 VIP ticket left (Seat 1A). Two users click "Buy" at almost the exact same millisecond.

**The Timeline:**

Plaintext

```
Time | User 1               | User 2
-----|----------------------|---------------------
  T1 | BEGIN;               | BEGIN;
  T2 | SELECT ...           |
     |   FOR UPDATE NOWAIT; |
     | -- locks Seat 1A     |
  T3 |                      | SELECT ...
     |                      |   FOR UPDATE NOWAIT;
     |                      | -> ???
```

**Question:** What happens to User 2's transaction at `T3`? How does this differ from what would happen if they just used `FOR UPDATE` without the `NOWAIT` clause?

**Answer:** User 2's transaction instantly throws an **ERROR** (`could not obtain lock on row`). **Explanation:** Because of the `NOWAIT` clause, the database immediately rejects User 2's request instead of putting it in a queue to wait for User 1. This is useful for failing fast so your application can instantly tell User 2 that the seat is taken. Without `NOWAIT`, User 2 would hang indefinitely until User 1 finished.

### Scenario 4: The Parallel Processors (SKIP LOCKED)

**Context:** We have a `jobs` table used as a queue. There are currently three jobs with `status = 'pending'` (IDs 1, 2, and 3).

**The Timeline:**

Plaintext

```
Time | Worker 1             | Worker 2
-----|----------------------|---------------------
  T1 | BEGIN;               |
  T2 | SELECT id FROM jobs  |
     |   WHERE status=      |
     |   'pending'          |
     |   LIMIT 1            |
     |   FOR UPDATE         |
     |   SKIP LOCKED;       |
     | -- locks id=1        |
  T3 |                      | BEGIN;
  T4 |                      | SELECT id FROM jobs
     |                      |   WHERE status=
     |                      |   'pending' LIMIT 1
     |                      |   FOR UPDATE
     |                      |   SKIP LOCKED;
     |                      | -> ???
```

**Question:** At `T4`, what exactly does Worker 2's query return? Does it wait for Worker 1, fail with an error, or succeed immediately?

**Answer:** Worker 2 **succeeds immediately, locks row 2, and returns ID 2**. **Explanation:** By using `SKIP LOCKED`, Worker 2 sees that row 1 is locked by Worker 1, completely ignores it, and moves to the next available row matching the query. This prevents workers from bottlenecking each other and allows high-scale parallel processing.

### Scenario 5: The Foreign Key Clash

**Context:** We have two tables: `users` and `posts`. The `posts` table has a foreign key referencing `users.id`. User #99 currently exists.

**The Timeline:**

Plaintext

```
Time | Txn A (Admin)          | Txn B (User)
-----|------------------------|---------------------
  T1 | BEGIN;                 |
  T2 | DELETE FROM users      |
     |   WHERE id=99;         |
     | -- locks user 99       |
  T3 |                        | BEGIN;
  T4 |                        | INSERT INTO posts
     |                        |   (user_id, content)
     |                        |   VALUES (99,'Hi');
     |                        | -> ???
```

**Question:** What happens to Transaction B at `T4`? Explain which internal lock it is trying to acquire and why it interacts with Transaction A this way.

**Answer:** Transaction B **waits**, regardless of the isolation level. **Explanation:** Transaction A's `DELETE` acquired the strongest lock: `FOR UPDATE`. When Transaction B inserts a post, Postgres automatically tries to acquire a `FOR KEY SHARE` lock on User #99 to ensure the user isn't deleted mid-insert. Because `FOR UPDATE` blocks `FOR KEY SHARE`, Transaction B is blocked and waits. If the Admin commits the delete, Transaction B wakes up and throws a Foreign Key Violation error.

### Scenario 6: The Deadly Embrace (Deadlock)

**Context:** We have an `accounts` table. Transaction A wants to transfer money from Account 1 to Account 2. Transaction B wants to transfer money from Account 2 to Account 1.

**The Timeline:**

Plaintext

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  T1 | BEGIN;               | BEGIN;
  T2 | SELECT * FROM        |
     |   accounts WHERE     |
     |   id=1 FOR UPDATE;   |
     | -- locks account 1   |
  T3 |                      | SELECT * FROM
     |                      |   accounts WHERE
     |                      |   id=2 FOR UPDATE;
     |                      | -- locks account 2
  T4 | SELECT * FROM        |
     |   accounts WHERE     |
     |   id=2 FOR UPDATE;   |
     | -- WAIT (Txn B holds)|
  T5 |                      | SELECT * FROM
     |                      |   accounts WHERE
     |                      |   id=1 FOR UPDATE;
     |                      | -> ???
```

**Question:** What happens to Transaction B at `T5`, and what will PostgreSQL ultimately do to resolve this situation?

**Answer:** This causes a **Deadlock**. PostgreSQL will detect this and **terminate one of the transactions** with an error. **Explanation:** Transaction A has Account 1 and is waiting for Account 2. Transaction B has Account 2 and is waiting for Account 1. They are stuck in an infinite loop waiting for each other. Postgres runs a background Deadlock Detector. After a short timeout (usually 1 second), it detects the cycle and ruthlessly kills one of the transactions (throwing a `deadlock detected` error) so the other can proceed.

### Scenario 7: The Vanishing Target (WHERE Re-evaluation)

**Context:** We have a `t(id, val)` table. Row id=1 has val=500.

**The Timeline:**

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  T1 | BEGIN;               | BEGIN;
  T2 | UPDATE t SET val=50  |
     |   WHERE id=1;        |
     | -- locked, val=50    |
     | -- uncommitted       |
  T3 |                      | UPDATE t
     |                      |   SET val=val-10
     |                      |   WHERE val>100;
     |                      | -- id=1: 500>100
     |                      | -- locked -> WAIT
  T4 | COMMIT; (val=50)     |
  T5 |                      | -- wakes up
     |                      | -- now what?
```

**Question:** Transaction B is running under **Read Committed**. It identified row 1 as a candidate because `500 > 100`. After Transaction A commits and val becomes 50, what does Transaction B do with row 1?

**Answer:** Transaction B **skips row 1** and does not update it. **Explanation:** After the lock is released, Postgres does not blindly apply the update. It re-evaluates the `WHERE` clause against the new committed value — a process called `EvalPlanQual`. The new val is 50, and `50 > 100` is false, so row 1 no longer matches. Postgres silently skips it. The final update only affects rows that still satisfy the `WHERE` clause after the wait. Under **Repeatable Read**, Postgres would not re-evaluate — it would immediately abort with `ERROR: could not serialize access due to concurrent update`.

---

### Scenario 8: The Ghost Reader (MVCC)

**Context:** We have a `t(id, val)` table. Row id=1 has val=100.

**The Timeline:**

```
Time | Txn A                | Txn B (SELECT)
-----|----------------------|---------------------
  T1 | BEGIN;               |
  T2 | UPDATE t SET val=999 |
     |   WHERE id=1;        |
     | -- locked, val=999   |
     | -- uncommitted       |
  T3 |                      | SELECT val FROM t
     |                      |   WHERE id=1;
     |                      | -> ???
```

**Question:** Transaction B runs a plain `SELECT` at T3 while Transaction A holds an exclusive lock on row 1 with an uncommitted change. Does Transaction B wait, error, or return a value? What does it see?

**Answer:** Transaction B **succeeds immediately and returns val=100** — the last committed value. **Explanation:** A plain `SELECT` in Postgres never acquires any lock and never waits for locks held by others. Instead, it reads through MVCC — each row has multiple versions, and a `SELECT` reads the version that was committed before the query started. Transaction A's uncommitted change (val=999) lives in a newer, invisible version. Transaction B sees the old committed version (val=100) without touching the lock at all. This is the core of MVCC: readers never block writers, writers never block readers.

---

### Scenario 9: The Peaceful Coexistence (Lock Compatibility)

**Context:** We have a `users` table with `id` as primary key and a `posts` table with `user_id` as a foreign key referencing `users.id`. User id=5 exists.

**The Timeline:**

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  T1 | BEGIN;               | BEGIN;
  T2 | UPDATE users         |
     |   SET bio='Engineer' |
     |   WHERE id=5;        |
     | -- FOR NO KEY UPDATE |
  T3 |                      | INSERT INTO posts
     |                      |   (user_id, content)
     |                      |   VALUES (5,'Hi');
     |                      | -- FK check:
     |                      | -- FOR KEY SHARE
     |                      |    on user 5
     |                      | -> ???
```

**Question:** Does Transaction B block at T3, or does it proceed immediately?

**Answer:** Transaction B **proceeds immediately** — no wait. **Explanation:** `FOR NO KEY UPDATE` and `FOR KEY SHARE` are the one pair of locks in Postgres that do not conflict with each other. `FOR NO KEY UPDATE` signals "I am changing non-key columns — the row's identity is unchanged." `FOR KEY SHARE` signals "I just need this row to continue existing." Since neither threatens what the other cares about, they are compatible. This is intentional design: Postgres allows non-key updates and FK checks to run concurrently on the same parent row. If `UPDATE` on non-key columns used `FOR UPDATE` instead, every FK check during inserts would be blocked.

---

### Scenario 10: The Silent Anomaly (Serializable vs Repeatable Read)

**Context:** We have a `doctors` table with an `on_call` boolean. Business rule: at least one doctor must be on call at all times. Currently both Dr. A and Dr. B are on call.

**The Timeline:**

```
Time | Txn A (Dr. A)        | Txn B (Dr. B)
-----|----------------------|---------------------
  T1 | BEGIN ISOLATION      | BEGIN ISOLATION
     | LEVEL RR;            | LEVEL RR;
  T2 | SELECT COUNT(*) FROM |
     |   doctors WHERE      |
     |   on_call=true;      |
     | -- sees 2, safe      |
  T3 |                      | SELECT COUNT(*) FROM
     |                      |   doctors WHERE
     |                      |   on_call=true;
     |                      | -- sees 2, safe
  T4 | UPDATE doctors       |
     |   SET on_call=false  |
     |   WHERE id='Dr. A';  |
     | COMMIT; -- ok        |
  T5 |                      | UPDATE doctors
     |                      |   SET on_call=false
     |                      |   WHERE id='Dr. B';
     |                      | COMMIT; -- ???
```

**Question:** Under **Repeatable Read**, does Transaction B's commit at T5 succeed or fail? What about under **Serializable**? Why is there a difference?

**Answer:** Under **Repeatable Read, both commits succeed** — leaving zero doctors on call, violating the business rule. Under **Serializable, Transaction B is aborted** with `ERROR: could not serialize access due to concurrent update`. **Explanation:** This anomaly is called a *write skew*. Neither transaction modified a row the other had read — Txn A read the count and updated Dr. A; Txn B read the count and updated Dr. B. They touched different rows, so there is no lost update and Repeatable Read sees nothing wrong. But the combined effect violates the invariant. Serializable tracks *read-write dependencies* across transactions and detects that the outcome is impossible under any serial order of execution. It aborts one transaction, forcing a retry that will see the updated count (1) and correctly refuse to proceed.

---

### Scenario 11: Fresh Eyes Every Statement (RC Snapshot Timing)

**Context:** `t(id, val)`, row id=1 val=100. Txn B is Read Committed.

```
Time | Txn A                | Txn B (RC)
-----|----------------------|---------------------
  1  |                      | BEGIN;
  2  |                      | SELECT val FROM t
     |                      |   WHERE id=1;
     |                      | -- sees 100
  3  | BEGIN;               |
     | UPDATE t SET val=999 |
     |   WHERE id=1;        |
     | COMMIT;              |
  4  |                      | SELECT val FROM t
     |                      |   WHERE id=1;
     |                      | -- sees ???
```

**Question:** Txn B runs two identical SELECTs. Txn A commits between them. What does the second SELECT return?

**Answer:** **999**. Under Read Committed each statement gets a fresh snapshot taken at statement start. The second SELECT starts after Txn A has committed, so it sees the new value. This is called a *non-repeatable read* and is expected (and accepted) under RC.

---

### Scenario 12: Frozen in Time (RR Snapshot Timing)

**Context:** Same setup as Scenario 11 — `t(id, val)`, row id=1 val=100. Txn B is Repeatable Read.

```
Time | Txn A                | Txn B (RR)
-----|----------------------|---------------------
  1  |                      | BEGIN ISOLATION LEVEL
     |                      | REPEATABLE READ;
  2  |                      | SELECT val FROM t
     |                      |   WHERE id=1;
     |                      | -- sees 100
  3  | BEGIN;               |
     | UPDATE t SET val=999 |
     |   WHERE id=1;        |
     | COMMIT;              |
  4  |                      | SELECT val FROM t
     |                      |   WHERE id=1;
     |                      | -- sees ???
```

**Question:** Same scenario, but Txn B is Repeatable Read. What does the second SELECT return?

**Answer:** **100** — the original value. Under Repeatable Read the snapshot is fixed at the start of the first statement in the transaction. All subsequent reads in the same transaction use that same snapshot, regardless of commits from other transactions. Non-repeatable reads are prevented by design.

---

### Scenario 13: The Generous Rollback

**Context:** `t(id, val)`, row id=1. Txn A locks it. Txn B is waiting.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | UPDATE t SET val=50  |
     |   WHERE id=1;        |
     | -- row 1 locked      |
  3  |                      | SELECT * FROM t
     |                      |   WHERE id=1
     |                      |   FOR UPDATE;
     |                      | -- locked -> WAIT
  4  | ROLLBACK;            |
  5  |                      | -- wakes up. What does
     |                      |    Txn B see and do?
```

**Question:** Txn A rolls back at T4. What happens to Txn B? What value does it see for row 1?

**Answer:** Txn B **wakes up, acquires the lock, and sees the original value** (before Txn A's change). A rollback discards all changes — the row reverts to its pre-Txn-A state. Txn B re-evaluates the WHERE clause against this reverted version. Since it was already a candidate, it matches and the lock is granted. This behavior is the same across all isolation levels.

---

### Scenario 14: Peaceful Neighbors (Different Rows)

**Context:** `t(id, val)` with rows id=1, id=2.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | UPDATE t SET val=10  | UPDATE t SET val=20
     |   WHERE id=1;        |   WHERE id=2;
     | -- locks row 1       | -- locks row 2
  3  | COMMIT;              | COMMIT;
     | -- success           | -- success
```

**Question:** Txn A and Txn B update different rows simultaneously. Do they conflict?

**Answer:** **No conflict — both proceed immediately.** Row-level locking means each transaction only locks the specific rows it touches. Txn A's lock on row 1 has no effect on Txn B's ability to lock row 2. This is why PostgreSQL's row-level locking provides far more concurrency than table-level locking would.

---

### Scenario 15: PK vs Non-PK Update

**Context:** `users(id, name, email)`. Two concurrent updates on the same row.

```
Time | Txn A (update email) | Txn B (update id)
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | UPDATE users         |
     |   SET email='new@x'  |
     |   WHERE id=5;        |
     | -- acquires ???      |
  3  |                      | UPDATE users
     |                      |   SET id=99
     |                      |   WHERE id=5;
     |                      | -- acquires ???
     |                      | -- conflicts? -> ???
```

**Question:** What lock does each UPDATE acquire, and does Txn B block?

**Answer:** Txn A acquires **FOR NO KEY UPDATE** (only non-key columns changed). Txn B acquires **FOR UPDATE** (changing the primary key). `FOR UPDATE` conflicts with `FOR NO KEY UPDATE`, so **Txn B blocks and waits** for Txn A to finish. Postgres always uses the weakest safe lock — updating email doesn't need FOR UPDATE, but changing a PK does because it threatens referential integrity of any FK pointing at this row.

---

### Scenario 16: Two Ghosts Insert (No Row Lock on INSERT)

**Context:** Empty `t(id, val)` table.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | INSERT INTO t        | INSERT INTO t
     |   VALUES (1, 100);   |   VALUES (2, 200);
     | -- no conflict?      | -- no conflict?
  3  | COMMIT;              | COMMIT;
```

**Question:** Two transactions insert different rows simultaneously. Do they block each other?

**Answer:** **No — both proceed immediately.** INSERTs on different rows acquire no conflicting locks. Each transaction independently creates a new row version visible only to itself until commit. Row-level locks on inserts only come into play for FK checks (FOR KEY SHARE on the parent) or unique constraint enforcement — not for unrelated rows.

---

### Scenario 17: Phantom Read (RC)

**Context:** `t(id, val)`. Rows: id=1(val=50), id=2(val=150). Txn B is Read Committed.

```
Time | Txn A                | Txn B (RC)
-----|----------------------|---------------------
  1  |                      | BEGIN;
  2  |                      | SELECT COUNT(*) FROM t
     |                      |   WHERE val > 100;
     |                      | -- returns 1 (id=2)
  3  | BEGIN;               |
     | INSERT INTO t        |
     |   VALUES (3, 200);   |
     | COMMIT;              |
  4  |                      | SELECT COUNT(*) FROM t
     |                      |   WHERE val > 100;
     |                      | -- returns ???
```

**Question:** Txn A inserts a new matching row between Txn B's two queries. What does the second COUNT return under Read Committed?

**Answer:** **2** — Txn B sees the newly inserted row. Under Read Committed, each statement uses a fresh snapshot, so the second SELECT sees Txn A's committed insert. This is called a *phantom read* — a row that wasn't there before has appeared. Under Repeatable Read or Serializable, the second SELECT would still return 1 because the snapshot is fixed at transaction start.

---

### Scenario 18: No Phantoms (RR)

**Context:** Same as Scenario 17. Txn B is now Repeatable Read.

```
Time | Txn A                | Txn B (RR)
-----|----------------------|---------------------
  1  |                      | BEGIN ISOLATION LEVEL
     |                      | REPEATABLE READ;
  2  |                      | SELECT COUNT(*) FROM t
     |                      |   WHERE val > 100;
     |                      | -- returns 1
  3  | BEGIN;               |
     | INSERT INTO t        |
     |   VALUES (3, 200);   |
     | COMMIT;              |
  4  |                      | SELECT COUNT(*) FROM t
     |                      |   WHERE val > 100;
     |                      | -- returns ???
```

**Question:** Same scenario but Txn B is Repeatable Read. What does the second COUNT return?

**Answer:** **1** — the phantom row is invisible. Txn B's snapshot was fixed at the start of the transaction (before Txn A's insert). Repeatable Read prevents phantom reads by design. This makes RR suitable for multi-query reports where you need a stable view of the data throughout the transaction.

---

### Scenario 19: The Empty Queue (SKIP LOCKED Exhaustion)

**Context:** `jobs(id, status)` with one pending row: id=1.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               |
  2  | SELECT id FROM jobs  |
     |   WHERE status=      |
     |   'pending'          |
     |   FOR UPDATE         |
     |   SKIP LOCKED;       |
     | -- grabs id=1        |
  3  |                      | BEGIN;
     |                      | SELECT id FROM jobs
     |                      |   WHERE status=
     |                      |   'pending'
     |                      |   FOR UPDATE
     |                      |   SKIP LOCKED;
     |                      | -- returns ???
```

**Question:** Txn B runs the same query while Txn A holds the only pending job. What does Txn B get?

**Answer:** **An empty result set** — no rows, no error, no wait. `SKIP LOCKED` skips all locked rows. If every matching row is locked, the query returns nothing. The application must handle this gracefully (e.g. sleep briefly and retry, or exit the worker loop). This is correct behavior — Txn B should not process the same job as Txn A.

---

### Scenario 20: Seeing Your Own Work

**Context:** `t(id, val)`, row id=1 val=100.

```
Time | Txn A (single txn)
-----|---------------------------------------
  1  | BEGIN;
  2  | UPDATE t SET val=999 WHERE id=1;
     | -- not yet committed
  3  | SELECT val FROM t WHERE id=1;
     | -- sees ???
```

**Question:** A transaction updates a row and immediately SELECTs it — before committing. What does the SELECT return?

**Answer:** **999** — the transaction's own uncommitted change. A transaction always sees the effects of its own prior statements, regardless of isolation level. MVCC gives each transaction a view that includes its own writes on top of the external snapshot. Other transactions still see the old committed value (100) until this transaction commits.

---

### Scenario 21: Locks Live Until COMMIT

**Context:** `t(id, val)`, row id=1.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               |
  2  | UPDATE t SET val=50  |
     |   WHERE id=1;        |
     | -- row locked        |
  3  | -- do other work...  |
  4  | UPDATE t SET val=75  | SELECT * FROM t
     |   WHERE id=1;        |   WHERE id=1
     |                      |   FOR UPDATE;
     |                      | -- locked -> WAIT
  5  | COMMIT;              |
  6  |                      | -- wakes up, proceeds
```

**Question:** Txn B tries to lock row 1 after Txn A's first UPDATE but before its COMMIT. Does Txn B get the lock after Txn A's second UPDATE completes (at T4), or only after COMMIT (T5)?

**Answer:** **Only after COMMIT (T5).** Row-level locks are held for the entire duration of the transaction — they are released atomically when the transaction commits or rolls back, not when the individual statement that acquired them finishes. A long-running transaction holds all its locks until the very end, which is why keeping transactions short matters.

---

### Scenario 22: Shared Readers Club (FOR SHARE)

**Context:** `t(id, val)`, row id=1 val=500.

```
Time | Txn A         | Txn B         | Txn C
-----|---------------|---------------|---------------
  1  | BEGIN;        | BEGIN;        | BEGIN;
  2  | SELECT * FROM | SELECT * FROM |
     |   t WHERE     |   t WHERE     |
     |   id=1        |   id=1        |
     |   FOR SHARE;  |   FOR SHARE;  |
     | -- acquired   | -- acquired   |
     |               |               | UPDATE t
     |               |               |   SET val=1
     |               |               |   WHERE id=1;
     |               |               | -- ???
```

**Question:** Txn A and Txn B both hold FOR SHARE on row 1. Txn C tries to UPDATE. What happens?

**Answer:** Txn C **blocks and waits** until both Txn A and Txn B commit. FOR SHARE locks are compatible with each other — any number of transactions can hold FOR SHARE on the same row simultaneously. But a write (FOR NO KEY UPDATE from UPDATE) conflicts with FOR SHARE. Txn C must wait for all share-holders to release before it can proceed. This is the classic readers-writer lock pattern.

---

### Scenario 23: Row Deleted Mid-Wait

**Context:** `t(id, val)`, row id=1 val=200.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | SELECT * FROM t      |
     |   WHERE id=1         |
     |   FOR UPDATE;        |
     | -- row locked        |
  3  |                      | UPDATE t SET val=0
     |                      |   WHERE val > 100;
     |                      | -- row 1 matches
     |                      | -- locked -> WAIT
  4  | DELETE FROM t        |
     |   WHERE id=1;        |
     | COMMIT;              |
  5  |                      | -- wakes up. Row is gone.
     |                      |    What happens?
```

**Question:** Txn B was waiting to update row 1. Txn A deletes it and commits. What does Txn B do with row 1?

**Answer:** Txn B **silently skips row 1** — no error. When Txn B wakes up after the wait, it checks the current state of the row. The row no longer exists in any live version, so there is nothing to lock or update. Postgres skips it and continues processing other candidate rows. This behavior is the same under all isolation levels.

---

### Scenario 24: The Unique Collision

**Context:** `t(id, val)` with a UNIQUE constraint on `val`. No row with val=100 exists yet.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | INSERT INTO t        |
     |   VALUES (1, 100);   |
     | -- not yet committed |
  3  |                      | INSERT INTO t
     |                      |   VALUES (2, 100);
     |                      | -- same val -> ???
```

**Question:** Txn B inserts a row with val=100 while Txn A has an uncommitted insert with the same val. What happens?

**Answer:** Txn B **blocks and waits**. Postgres cannot immediately tell whether Txn A's insert will commit (creating a real conflict) or rollback (making the value available). So Txn B waits. If Txn A commits, Txn B wakes up and gets a **UNIQUE CONSTRAINT VIOLATION** error. If Txn A rolls back, Txn B proceeds and its insert succeeds.

---

### Scenario 25: NOWAIT on a Multi-Row Scan

**Context:** `t(id, val)`: id=1(val=50), id=2(val=200), id=3(val=300). Row 2 is locked by another transaction.

```
Time | Other Txn            | Txn A (NOWAIT)
-----|----------------------|---------------------
  1  | Locks row id=2       |
  2  |                      | BEGIN;
     |                      | SELECT * FROM t
     |                      |   WHERE val > 100
     |                      |   FOR UPDATE NOWAIT;
     |                      | -- id=2 (val=200): locked
     |                      | -- id=3 (val=300): free
     |                      | -- what happens?
```

**Question:** Txn A scans rows where val > 100. Row 2 is locked, row 3 is free. With NOWAIT, does Txn A lock row 3 and skip row 2, or does it error immediately?

**Answer:** Txn A **errors immediately** — it does not lock row 3. `NOWAIT` means "if any row cannot be locked instantly, abort." Unlike `SKIP LOCKED` which moves past locked rows, `NOWAIT` treats a locked row as a hard failure and aborts the entire statement with `ERROR: could not obtain lock on row`. The application must catch this error and retry.

---

### Scenario 26: Advisory Lock — Try vs Block

**Context:** A cron job that should only run one instance at a time. Key = 42.

```
Time | Process 1                  | Process 2
-----|----------------------------|---------------------------
  1  | SELECT pg_try_advisory_    | SELECT pg_try_advisory_
     |   lock(42);                |   lock(42);
     | -- returns true            | -- returns ???
  2  | -- runs job                | -- what should app do?
  3  | SELECT pg_advisory_        |
     |   unlock(42);              |
```

**Question:** Process 1 acquires the advisory lock. Process 2 calls `pg_try_advisory_lock(42)` at the same time. What does it return, and what should the application do?

**Answer:** Process 2 gets **false** — immediately, with no wait. `pg_try_advisory_lock` is the non-blocking variant: it returns true if the lock was acquired, false if it was already held. The application should check the return value and skip the job if false. If you want Process 2 to wait instead, use `pg_advisory_lock(42)` (blocking). Use try-variant for cron jobs where skipping is fine; use blocking variant where the second process must eventually run.

---

### Scenario 27: Session vs Transaction Advisory Lock

**Context:** Advisory lock key = 99.

```
Time | Txn A (session-level)      | Txn B
-----|----------------------------|---------------------------
  1  | BEGIN;                     |
  2  | SELECT pg_advisory_lock    |
     |   (99);                    |
     | -- acquired                |
  3  | ROLLBACK;                  |
  4  |                            | SELECT pg_try_advisory_
     |                            |   lock(99);
     |                            | -- returns ???
```

**Question:** Txn A acquires a session-level advisory lock and then rolls back the transaction. Can Txn B acquire the lock?

**Answer:** **No — Txn B returns false.** Session-level advisory locks (`pg_advisory_lock`) survive transaction rollbacks. They are tied to the database session (connection), not the transaction. The lock persists until explicitly released with `pg_advisory_unlock(99)` or until the session disconnects. If you want the lock to release automatically on commit/rollback, use `pg_advisory_xact_lock(99)` — the transaction-level variant — which behaves like a row lock.

---

### Scenario 28: RC — Two Sequential Updates

**Context:** `t(id, val)`, row id=1 val=100. Both transactions are Read Committed.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | SELECT val FROM t    |
     |   WHERE id=1;        |
     | -- sees 100          |
  3  |                      | UPDATE t SET val=200
     |                      |   WHERE id=1;
     |                      | COMMIT; -- val=200
  4  | UPDATE t             |
     |   SET val = val + 10 |
     |   WHERE id=1;        |
     | -- sees val=??? and
     |    computes val+10=?
     | COMMIT;
```

**Question:** Txn A reads val=100 at T2, then updates `val = val + 10` at T4 — after Txn B has set val to 200. What is the final val?

**Answer:** **210**. Under Read Committed, the UPDATE re-fetches the latest committed version of the row after acquiring the lock. Even though Txn A read 100 earlier, the `val + 10` expression is evaluated against the current committed value (200). The result is 210. This is EvalPlanQual in action — the expression is applied to the row as it exists at lock time, not as it existed at scan time.

---

### Scenario 29: Serializable Read-Only — Never Aborts

**Context:** A financial report reading from multiple tables. Isolation level: Serializable.

```
Time | Report Txn (Serializable RO) | Write Txn
-----|------------------------------|---------------------
  1  | BEGIN ISOLATION LEVEL        |
     | SERIALIZABLE READ ONLY;      |
  2  | SELECT SUM(amount)           |
     |   FROM orders;               |
  3  |                              | UPDATE orders
     |                              |   SET amount=999
     |                              |   WHERE id=1;
     |                              | COMMIT;
  4  | SELECT SUM(salary)           |
     |   FROM payroll;              |
  5  | COMMIT;                      |
     | -- ERROR? or success?
```

**Question:** The report transaction is Serializable but read-only. A write commits during its execution. Will the report be aborted with a serialization error?

**Answer:** **No — it completes successfully.** Read-only transactions under Serializable are never aborted with serialization errors. They take a snapshot and read consistently from it, but since they introduce no writes, they cannot be part of a read-write dependency cycle. Postgres knows this and exempts them. This makes Serializable + READ ONLY the ideal choice for reports and audits that need a fully consistent view without any risk of retry.

---

### Scenario 30: Upgrade Attempt — FOR SHARE to FOR UPDATE

**Context:** `t(id, val)`, row id=1. Two transactions both hold FOR SHARE.

```
Time | Txn A                | Txn B
-----|----------------------|---------------------
  1  | BEGIN;               | BEGIN;
  2  | SELECT * FROM t      | SELECT * FROM t
     |   WHERE id=1         |   WHERE id=1
     |   FOR SHARE;         |   FOR SHARE;
     | -- shared lock       | -- shared lock
  3  | SELECT * FROM t      |
     |   WHERE id=1         |
     |   FOR UPDATE;        |
     | -- tries to upgrade
     |    to exclusive ???
```

**Question:** Txn A already holds FOR SHARE on row 1 and now tries to acquire FOR UPDATE on the same row (within the same transaction). Txn B also holds FOR SHARE. What happens?

**Answer:** Txn A **deadlocks with Txn B**. Upgrading from a shared lock to an exclusive lock requires that no other transaction holds a conflicting lock. Txn B's FOR SHARE conflicts with Txn A's FOR UPDATE request. So Txn A waits for Txn B's share lock. But if Txn B tries the same upgrade (or holds any other lock Txn A needs), a cycle forms and Postgres detects a deadlock. The fix is to acquire the strongest lock you will need upfront — start with FOR UPDATE if you know you will write.


---

## Related

[[5. Best Practices]]  [[3. Transactions]]
