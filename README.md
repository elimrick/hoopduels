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

Build full 2000-present player graph (NBA stats API):

```bash
npm run data:build
npm run db:seed
```

Or one command:

```bash
npm run data:refresh-full
```

If the build is interrupted, rerun `npm run data:build` and it will resume from the last completed season.

Season sync commands:

```bash
npm run season:sync
npm run season:sync:force
```

Open `http://localhost:3000/game.html` in two browser tabs/windows to test a live duel locally.

## Notes

- UI is styled from the provided homepage concept, and the same visual system is applied to all pages.
- Home/profile/leaderboard/history pages are wired to local persisted profile state.
- Player data is stored in SQLite at `data/players.db` and seeded from `data/players-2000-present.json`.
- Season refresh is checked on server startup and can run at most once per season (default boundary: October 1), tracked in `data/season-sync-state.json`.
