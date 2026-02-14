const path = require('path');
const { PlayerStore } = require('../lib/player-store');
const { runSeasonSyncIfDue } = require('../lib/season-sync');

const statePath = path.join(__dirname, '..', 'data', 'season-sync-state.json');
const playerStore = new PlayerStore({
  dbPath: path.join(__dirname, '..', 'data', 'players.db'),
  seedJsonPath: path.join(__dirname, '..', 'data', 'players-2000-present.json')
});
playerStore.init();

const force = process.argv.includes('--force');

const result = runSeasonSyncIfDue({
  statePath,
  seasonStartMonth: 10,
  seasonStartDay: 1,
  force,
  syncFn: () => {
    playerStore.reloadFromJson();
  }
});

console.log(result);
