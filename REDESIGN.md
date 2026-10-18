# HoopDuels redesign

Isolated branch: redesign/light-interface. Production remains on main.

Run npm ci, then npm run preview. Open http://127.0.0.1:3101.
The preview command forcibly uses its own local SQLite accounts database, binds only to loopback, and never connects to the production database. Browser accounts are separate from hoopduels.com. Advertisements are omitted in this design branch.

Scope: shared navigation, homepage, practice and live game interfaces, autocomplete, leaderboard, history, profiles, authentication, rules, and the existing auxiliary routes. No production push or deployment is part of this redesign.

## Review and checks

Open /design-review.html for working phone/tablet previews. Run npm run preview:check while the preview server is running. It checks all 11 routes, DOM behavior hooks, player data, valid/invalid practice turns, account creation/sign-in, multiplayer matching and completed-game persistence. The checks use only loopback and create PreviewOne and PreviewTwo locally (password: preview123). These are test accounts, not production players.

The UI has been reviewed in Safari at desktop and phone widths, including autocomplete keyboard selection and the leaderboard fitting without scrolling.
