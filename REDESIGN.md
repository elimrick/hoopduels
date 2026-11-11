# HoopDuels redesign

Isolated branch: redesign/light-interface. Production remains on main.

Run npm ci, then npm run preview. Open http://127.0.0.1:3101.
The preview command forcibly uses its own local SQLite accounts database, binds only to loopback, and never connects to the production database. Browser accounts are separate from hoopduels.com. Advertisements are omitted in this design branch.

Scope: shared navigation, homepage, practice and live game interfaces, autocomplete, leaderboard, history, profiles, authentication, rules, and the existing auxiliary routes. No production push or deployment is part of this redesign.

## Review and checks

Open /design-review.html for working phone/tablet previews. Run npm run preview:check while the preview server is running. It checks all 11 routes, DOM behavior hooks, player data, valid/invalid practice turns, account creation/sign-in, multiplayer matching and completed-game persistence. The checks use only loopback and create PreviewOne and PreviewTwo locally (password: preview123). These are test accounts, not production players.

The UI has been reviewed in Safari at desktop and phone widths, including autocomplete keyboard selection and the leaderboard fitting without scrolling.

## Friends
Friend requests persist in the account database. Both players open Friends to send/accept a direct challenge; challenges expire after 60 seconds. These games use the existing duel rules, appear in history, and do not change rating or win/loss record. One active game tab per browser identity.

Run `node scripts/check-friends.js` with the preview running to check requests, permissions, presence, challenges and unranked results. SQLite is verified locally; PostgreSQL uses the same parameterized SQL but needs staging verification before deployment. Challenges and games remain process-local, matching existing matchmaking; multiple server instances would need shared coordination.

## Latest refinements

Friends uses the shared NBA-player autocomplete, displays rating and head-to-head record, and reports site-wide online presence. Direct challenges still require both players to have Friends open. Friendly rematches require both players to agree within two minutes. Friendly results leave ranked ratings and records unchanged.

Head-to-head counts persist separately from the rolling game history. Older results are seeded from retained history only. Profile Game History supports opponent username filtering.

Additional checks are `node scripts/check-autocomplete.js`, `node scripts/check-friendly-display.js`, and `node scripts/check-history-search.js`. All passed alongside the gameplay, friends, and 10,003-player leaderboard checks. Safari confirmed shared suggestions and full-width vertical example-chain cards at smaller widths.
