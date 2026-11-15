# HoopDuels MVP

Online 1v1 NBA teammate-chain game.

## Rules Implemented

- Matchmaking: two players are paired live via Socket.IO.
- Game starts from a random **All-Star** player only.
- Player pool is limited to **2000-present** (curated in `data/players-2000-present.json`).
- Turn timer: **60 seconds** per turn.
- Invalid teammate, unknown player, or repeated player => strike.
- Timeout => automatic loss.
- First player to **3 strikes loses**.

## Run

```bash
npm install
npm run db:seed
npm start
```

Public tunnel (share with friends):

```bash
npm run tunnel
```

This opens an internet URL via `localhost.run` that forwards to your local `http://localhost:3000`.

Update the saved player graph from verified current NBA rosters and dated transactions.

```bash
npm run data:build:strict
npm run db:seed
```

The updater preserves historical connections and adds connections supported by simultaneous roster membership. It no longer builds teammate connections from season-wide team lists. Dated signings, waivers, trades, and 10-day expirations also supply overlap evidence, including players who never appeared in a game. Draft-rights trades alone do not establish roster membership.

Production refreshes automatically each UTC day, retries failures hourly, and keeps its last successful additions in PostgreSQL. The daily GitHub Actions workflow wakes the Render service and checks `/api/players/data-status`, including while the free service is sleeping. Scheduled Actions can run late. A failed check is visible in GitHub Actions.

Local previews use the bundled graph. Set `NBA_ROSTER_SYNC=1` to enable fetching locally. Local additions persist in ignored `data/roster-sync-state.json`.

The historical audit is still incomplete. The NBA transaction feed starts in July 2015, and its dates have day-level precision. Existing legacy connections have not all been reconstructed from roster intervals. Current snapshots establish additional overlap, and known corrections are recorded in `data/player-data-audit.json`.

Open `http://localhost:3000/game.html` in two browser tabs/windows to test a live duel locally.

## Notes

- UI is styled from the provided homepage concept, and the same visual system is applied to all pages.
- Home/profile/leaderboard/history pages are wired to local persisted profile state.
- Player data is stored in SQLite at `data/players.db` and seeded from `data/players-2000-present.json`.
- Roster updates replace the local player tables atomically and refresh in-memory connections without restarting live games.
