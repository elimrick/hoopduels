const assert = require('node:assert/strict');
const { paginate } = require('../public/leaderboard');
const rows = Array.from({ length: 10003 }, (_, i) => ({
  rank: i + 1, username: `Player${String(i + 1).padStart(5, '0')}`,
  elo: 20000 - i, isYou: i === 4321
}));
assert.equal(paginate(rows).rows.length, 25);
assert.equal(paginate(rows).pages, 401);
assert.equal(paginate(rows, '', 999).rows.length, 3);
assert.equal(paginate(rows, '', 999).rows[2].rank, 10003);
assert.equal(paginate(rows, 'PLAYER04322').rows[0].rank, 4322);
assert.equal(paginate(rows, 'notfound').total, 0);
assert.equal(paginate([], '', 5).page, 1);
assert(paginate(rows, '', Math.floor(4321 / 25) + 1).rows.some(row => row.isYou));
const ranks = Array.from({ length: 401 }, (_, i) => paginate(rows, '', i + 1).rows).flat().map(row => row.rank);
assert.equal(new Set(ranks).size, 10003);
console.log('PASS: 10,003-player pagination, boundaries, search, preserved global ranks, and own-rank navigation.');
