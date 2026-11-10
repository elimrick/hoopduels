# Friends and interface refinements
Keep all changes in the isolated redesign. Preserve current game rules and solo practice.
1. Replace shared logo with supplied SVG; simplify headings and captions throughout desktop/mobile navigation. Verify routes and markup.
2. Persist mutual friendship requests in SQLite and PostgreSQL using one SQL-backed module. Authenticate all actions; reject self/duplicate requests and unauthorized acceptance/removal. Verify with isolated database tests.
3. Add online friends and expiring direct challenges through existing sockets and game engine. Friend games never alter rating or ranked record. Verify two-account challenge, decline, busy/offline, expiry and completion.
4. Build Friends page with add, accept, decline, cancel, remove and challenge actions; keep pending challenges inline. Verify responsive UI and full existing functional checks.
No production deployment or production database changes.
