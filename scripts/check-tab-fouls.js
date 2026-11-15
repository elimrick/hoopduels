const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

let visibilityChanged;
const document = { hidden: false, addEventListener: (name, callback) => { visibilityChanged = callback; } };
const browser = { window: {}, document };
vm.runInNewContext(read('public/game-feedback.js'), browser);
const changes = [];
browser.window.HoopFeedback.watchVisibility((hidden) => changes.push(hidden));
for (const hidden of [false, true, true, false, false, true]) {
  document.hidden = hidden;
  visibilityChanged();
}
assert.deepEqual(changes, [true, false, true]);

const server = read('server.js');
let handler;
let ended = null;
const game = {
  id: 'test', status: 'active', hiddenTabs: {}, strikes: { a: 0, b: 0 },
  history: [], playerNames: { a: 'A', b: 'B' }, activePlayerId: 'b'
};
const context = {
  playerId: 'a', MAX_STRIKES: 3,
  getGameByPlayerId: () => game,
  emitGameState: () => {},
  scheduleTurnTimeout: () => {},
  endGame: (current, loser, reason) => { current.status = 'ended'; ended = { loser, reason }; },
  socket: { on: (event, callback) => { handler = callback; } }
};
vm.runInNewContext(server.slice(server.indexOf('function applyStrike('), server.indexOf('function createGame(')), context);
vm.runInNewContext(server.slice(server.indexOf("  socket.on('game:visibility'"), server.indexOf("  socket.on('game:guess'")), context);
for (const value of [null, {}, { gameId: 'old', hidden: true }, { gameId: 'test', hidden: 'true' }]) handler(value);
assert.equal(game.strikes.a, 0);
handler({ gameId: 'test', hidden: true, playerId: 'b' });
handler({ gameId: 'test', hidden: true });
assert.equal(game.strikes.a, 1);
assert.equal(game.strikes.b, 0);
assert.equal(game.activePlayerId, 'b');
for (let i = 0; i < 2; i++) {
  handler({ gameId: 'test', hidden: false });
  handler({ gameId: 'test', hidden: true });
}
assert.deepEqual(ended, { loser: 'a', reason: '3 strikes' });
handler({ gameId: 'test', hidden: false });
handler({ gameId: 'test', hidden: true });
assert.equal(game.strikes.a, 3);

const practice = read('public/practice.js');
const state = { yourFouls: 0, active: true, phase: 'cpu' };
const solo = {
  state, window: { HoopFeedback: { setFouls() {} } }, yourFoulsEl: {},
  flashPracticeFoul() {}, endPractice() { state.active = false; state.phase = 'ended'; },
  showInputError() {}, setTurnUi() {}, inputEl: { focus() {} },
  resizeInput() {}, refreshAutocomplete() {}
};
vm.runInNewContext(practice.slice(practice.indexOf('function applyFoul('), practice.indexOf('function startPlayerTurnTimer(')), solo);
vm.runInNewContext("applyFoul('Left the game tab.', true)", solo);
assert.equal(state.phase, 'cpu');
vm.runInNewContext("applyFoul('Left the game tab.', true); applyFoul('Left the game tab.', true);", solo);
assert.equal(state.active, false);
assert.equal(state.yourFouls, 3);
console.log('PASS: visibility edges, server validation/deduplication, off-turn fouls, three-foul loss, ended-game protection, and practice CPU turn preservation.');

(async () => {
  const practiceState = { active: true, phase: 'player', pending: false, roundId: 1, usedPlayers: ['LeBron James'] };
  let response;
  let errors = [];
  const turnContext = {
    state: practiceState, getInputValue: () => 'Dwyane Wade',
    clearInputError() {}, syncInputPlaceholder() {}, setInputValue() {}, setTurnUi() {},
    fetch: () => new Promise((resolve) => { response = resolve; }),
    applyFoul: (reason) => errors.push(reason),
    setMessage: (message) => errors.push(message),
    inputEl: { focus() {} }, resizeInput() {}
  };
  vm.runInNewContext(practice.slice(practice.indexOf('async function submitGuess()'), practice.indexOf('if (submitEl)', practice.indexOf('async function submitGuess()'))), turnContext);
  let submission = vm.runInNewContext('submitGuess()', turnContext);
  response({ ok: true, json: async () => ({ ok: false, reason: 'Not a teammate' }) });
  await submission;
  assert.deepEqual(errors, ['Not a teammate']);
  assert.equal(practiceState.pending, false);
  errors = [];
  submission = vm.runInNewContext('submitGuess()', turnContext);
  practiceState.active = false;
  response({ ok: true, json: async () => ({ ok: false, reason: 'Not a teammate' }) });
  await submission;
  assert.deepEqual(errors, []);
  practiceState.active = true;
  submission = vm.runInNewContext('submitGuess()', turnContext);
  practiceState.roundId += 1;
  response({ ok: true, json: async () => ({ ok: false, reason: 'Not a teammate' }) });
  await submission;
  assert.deepEqual(errors, []);
  assert.equal(practiceState.pending, true);
  console.log('PASS: practice guesses complete normally and stale responses cannot alter an ended or restarted round.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
