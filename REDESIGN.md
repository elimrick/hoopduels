# HoopDuels redesign

Production deploys from main. The original live design is preserved on branch archive/original-design-2026-11-14 and tag original-design-2026-11-14, both pointing to 17642b3b510f0d0536d88ccab3e7727f9ccc49a3. To restore it, deploy that commit through Render. The added friendship tables can remain in place during rollback.

Run npm ci, then npm run preview. Open http://127.0.0.1:3101.
The preview command forcibly uses its own local SQLite accounts database, binds only to loopback, and never connects to the production database. Browser accounts are separate from hoopduels.com. Advertisements are omitted in this design branch.

Scope: shared navigation, homepage, practice and live game interfaces, autocomplete, leaderboard, history, profiles, authentication, rules, and the existing auxiliary routes. The redesign was approved for production on November 14, 2026.

## Review and checks

Open /design-review.html for working phone/tablet previews. Run npm run preview:check while the preview server is running. It checks all 11 routes, DOM behavior hooks, player data, valid/invalid practice turns, account creation/sign-in, multiplayer matching and completed-game persistence. The checks use only loopback and create PreviewOne and PreviewTwo locally (password: preview123). These are test accounts, not production players.

The UI has been reviewed in Safari at desktop and phone widths, including autocomplete keyboard selection and the leaderboard fitting without scrolling.

## Friends
Friend requests persist in the account database. Both players open Friends to send/accept a direct challenge; challenges expire after 60 seconds. These games use the existing duel rules, appear in history, and do not change rating or win/loss record. One active game tab per browser identity.

Run `node scripts/check-friends.js` with the preview running to check requests, permissions, presence, challenges and unranked results. SQLite and an isolated PostgreSQL instance were verified locally, including schema creation, friend requests, saved ratings, historical records, game results, and removal. Challenges and games remain process-local, matching existing matchmaking; multiple server instances would need shared coordination.

## Latest refinements

Friends uses the shared NBA-player autocomplete, displays rating and head-to-head record, and reports site-wide online presence. Direct challenges still require both players to have Friends open. Friendly rematches require both players to agree within two minutes. Friendly results leave ranked ratings and records unchanged.

Head-to-head counts persist separately from the rolling game history. Older results are seeded from retained history only. Profile Game History supports opponent username filtering.

Additional checks are `node scripts/check-autocomplete.js`, `node scripts/check-friendly-display.js`, and `node scripts/check-history-search.js`. All passed alongside the gameplay, friends, and 10,003-player leaderboard checks. Safari confirmed shared suggestions and full-width vertical example-chain cards at smaller widths.
