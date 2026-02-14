const path = require('path');
const { PlayerStore } = require('../lib/player-store');

const dbPath = path.join(__dirname, '..', 'data', 'players.db');
const seedJsonPath = path.join(__dirname, '..', 'data', 'players-2000-present.json');

const store = new PlayerStore({ dbPath, seedJsonPath });
store.init();
store.reloadFromJson(seedJsonPath);

console.log(`Seeded SQLite DB at ${dbPath}`);
