const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PlayerStore } = require('./lib/player-store');
const { AccountStore, normalizeUsername } = require('./lib/account-store');
const { AccountStorePg } = require('./lib/account-store-pg');
const { runSeasonSyncIfDue } = require('./lib/season-sync');

const PORT = process.env.PORT || 3000;
const TURN_DURATION_MS = 60_000;
const MAX_STRIKES = 3;
const DISCONNECT_GRACE_MS = 15_000;
const ADMIN_HEALTH_KEY = process.env.ADMIN_HEALTH_KEY || '';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const playerStore = new PlayerStore({
  dbPath: path.join(__dirname, 'data', 'players.db'),
  seedJsonPath: path.join(__dirname, 'data', 'players-2000-present.json')
});
playerStore.init();

const usePostgres = Boolean(process.env.DATABASE_URL);
const accountStore = usePostgres
  ? new AccountStorePg({
    connectionString: process.env.DATABASE_URL
  })
  : new AccountStore({
    dbPath: path.join(__dirname, 'data', 'accounts.db')
  });

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

async function readAuthUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  const profile = await accountStore.getProfileByToken(token);
  if (!profile) return null;
  return { token, profile };
}

app.post('/api/auth/signup', async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = req.body && req.body.password;
  try {
    const userId = await accountStore.createUser(username, password);
    const token = accountStore.createSession(userId);
    const profile = await accountStore.getProfileByToken(token);
    const leaderboard = await accountStore.getLeaderboardRows(userId);
    res.status(201).json({ token, profile, leaderboard });
  } catch (error) {
    const code = error && error.code;
    if (code === 'USERNAME_TAKEN') {
      res.status(409).json({ error: 'Username is already taken.' });
      return;
    }
    if (code === 'USERNAME_INVALID' || code === 'PASSWORD_INVALID') {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Could not create account.' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = req.body && req.body.password;
  const userId = await accountStore.verifyUser(username, password);
  if (!userId) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }
  const token = accountStore.createSession(userId);
  const profile = await accountStore.getProfileByToken(token);
  const leaderboard = await accountStore.getLeaderboardRows(userId);
  res.json({ token, profile, leaderboard });
});

app.post('/api/auth/signout', async (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    await accountStore.clearSession(token);
  }
  res.status(204).end();
});

app.get('/api/account/profile', async (req, res) => {
  const auth = await readAuthUser(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  res.json({ profile: auth.profile });
});

app.put('/api/account/profile', async (req, res) => {
  const auth = await readAuthUser(req);
  if (!auth) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  const next = await accountStore.saveProfileByToken(auth.token, req.body && req.body.profile);
  const leaderboard = await accountStore.getLeaderboardRows();
  res.json({ profile: next, leaderboard });
});

app.get('/api/leaderboard', async (req, res) => {
  const token = getBearerToken(req);
  let currentUserId = null;
  if (token) {
    const user = await accountStore.getUserByToken(token);
    currentUserId = user ? user.id : null;
  }
  res.json({ leaderboard: await accountStore.getLeaderboardRows(currentUserId) });
});

app.get('/api/admin/health', async (req, res) => {
  if (!ADMIN_HEALTH_KEY) {
    res.status(503).json({ error: 'Admin health key not configured.' });
    return;
  }

  const provided = req.headers['x-admin-key'];
  if (provided !== ADMIN_HEALTH_KEY) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const [userCount, leaderboardRows] = await Promise.all([
    accountStore.getUserCount(),
    accountStore.getLeaderboardRows()
  ]);

  res.json({
    ok: true,
    accountStore: usePostgres ? 'postgres' : 'sqlite',
    users: Number(userCount) || 0,
    leaderboardRows: Array.isArray(leaderboardRows) ? leaderboardRows.length : 0,
    now: new Date().toISOString()
  });
});

const seasonSyncStatePath = path.join(__dirname, 'data', 'season-sync-state.json');
runSeasonSyncIfDue({
  statePath: seasonSyncStatePath,
  seasonStartMonth: 10,
  seasonStartDay: 1,
  syncFn: () => {
    playerStore.reloadFromJson();
    const counts = playerStore.getCounts();
    console.log(`[season-sync] Player DB refreshed: ${counts.players} players, ${counts.allStars} all-stars`);
  }
});

const waitingQueue = [];
const games = new Map();
const playerToGameId = new Map();
const playerToSocketId = new Map();
const disconnectTimers = new Map();

function makeDefaultName(playerId) {
  return `Player-${String(playerId).slice(0, 4)}`;
}

function getSocketByPlayerId(playerId) {
  const socketId = playerToSocketId.get(playerId);
  if (!socketId) return null;
  return io.sockets.sockets.get(socketId) || null;
}

function getGameByPlayerId(playerId) {
  const gameId = playerToGameId.get(playerId);
  if (!gameId) return null;
  return games.get(gameId) || null;
}

function clearDisconnectTimer(playerId) {
  const timer = disconnectTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    disconnectTimers.delete(playerId);
  }
}

function getActivePlayerId(game) {
  return game.players[game.turnIndex];
}

function getOpponentPlayerId(game, playerId) {
  return game.players.find((id) => id !== playerId);
}

function formatGuessText(rawGuess) {
  const value = typeof rawGuess === 'string' ? rawGuess.trim().replace(/\s+/g, ' ') : '';
  return value ? value.slice(0, 60) : 'blank guess';
}

function buildGameState(game, message) {
  const activePlayerId = getActivePlayerId(game);
  return {
    gameId: game.id,
    players: game.players.map((playerId) => ({
      playerId,
      username: game.playerNames[playerId],
      strikes: game.strikes[playerId],
      connected: Boolean(getSocketByPlayerId(playerId))
    })),
    currentPlayer: playerStore.getName(game.currentPlayerKey),
    activePlayerId,
    activeUsername: game.playerNames[activePlayerId],
    timeRemainingMs: Math.max(0, game.turnDeadline - Date.now()),
    usedPlayers: [...game.usedPlayerKeys].map((key) => playerStore.getName(key)),
    history: game.history,
    status: game.status,
    message
  };
}

function emitGameState(game, options = {}) {
  io.to(game.id).emit(
    'game:state',
    buildGameState(game, options.includeMessage ? options.message : null)
  );
}

function attachSocketToGame(playerId, game) {
  const socket = getSocketByPlayerId(playerId);
  if (!socket) return;

  socket.data.gameId = game.id;
  socket.join(game.id);
}

function scheduleTurnTimeout(game) {
  clearTimeout(game.timer);
  if (game.status !== 'active') return;

  const waitMs = Math.max(0, game.turnDeadline - Date.now());
  game.timer = setTimeout(() => {
    const activePlayerId = getActivePlayerId(game);
    endGame(game, activePlayerId, 'time expired');
  }, waitMs);
}

function endGame(game, loserPlayerId, reason) {
  if (game.status !== 'active') return;

  clearTimeout(game.timer);
  game.timer = null;
  game.status = 'finished';

  for (const playerId of game.players) {
    clearDisconnectTimer(playerId);
  }

  const winnerPlayerId = getOpponentPlayerId(game, loserPlayerId);
  game.history.push({
    type: 'end',
    at: Date.now(),
    loserPlayerId,
    winnerPlayerId,
    reason
  });

  io.to(game.id).emit('game:ended', {
    winnerPlayerId,
    winnerUsername: game.playerNames[winnerPlayerId],
    loserPlayerId,
    loserUsername: game.playerNames[loserPlayerId],
    reason,
    gameState: buildGameState(game)
  });

  for (const playerId of game.players) {
    playerToGameId.delete(playerId);
    const socket = getSocketByPlayerId(playerId);
    if (socket) {
      socket.leave(game.id);
      socket.data.gameId = null;
    }
  }

  games.delete(game.id);
}

function applyStrike(game, playerId, reason, guessText = '') {
  game.strikes[playerId] += 1;
  game.history.push({
    type: 'strike',
    at: Date.now(),
    playerId,
    reason,
    guess: guessText || null,
    strikes: game.strikes[playerId]
  });

  if (game.strikes[playerId] >= MAX_STRIKES) {
    emitGameState(game, {
      includeMessage: true,
      message: `${game.playerNames[playerId]} guessed "${guessText || 'blank guess'}" and got strike 3/3 (${reason}).`
    });
    endGame(game, playerId, '3 strikes');
    return;
  }

  emitGameState(game, {
    includeMessage: true,
    message: `${game.playerNames[playerId]} guessed "${guessText || 'blank guess'}" and got a strike (${reason}).`
  });

  scheduleTurnTimeout(game);
}

function createGame(playerAId, playerBId) {
  const socketA = getSocketByPlayerId(playerAId);
  const socketB = getSocketByPlayerId(playerBId);
  if (!socketA || !socketB) return null;

  const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startingKey = playerStore.getRandomAllStarKey();

  const game = {
    id: gameId,
    players: [playerAId, playerBId],
    playerNames: {
      [playerAId]: socketA.data.username || makeDefaultName(playerAId),
      [playerBId]: socketB.data.username || makeDefaultName(playerBId)
    },
    currentPlayerKey: startingKey,
    usedPlayerKeys: new Set([startingKey]),
    strikes: {
      [playerAId]: 0,
      [playerBId]: 0
    },
    turnIndex: 0,
    turnDeadline: Date.now() + TURN_DURATION_MS,
    timer: null,
    status: 'active',
    history: [
      {
        type: 'start',
        player: playerStore.getName(startingKey),
        at: Date.now()
      }
    ]
  };

  games.set(gameId, game);
  playerToGameId.set(playerAId, gameId);
  playerToGameId.set(playerBId, gameId);

  attachSocketToGame(playerAId, game);
  attachSocketToGame(playerBId, game);

  emitGameState(game, {
    includeMessage: true,
    message: `Game started. Starting player: ${playerStore.getName(startingKey)}`
  });
  scheduleTurnTimeout(game);
  return game;
}

function pruneQueue() {
  for (let i = waitingQueue.length - 1; i >= 0; i -= 1) {
    const playerId = waitingQueue[i];
    if (!getSocketByPlayerId(playerId) || getGameByPlayerId(playerId)) {
      waitingQueue.splice(i, 1);
    }
  }
}

function attemptMatchmaking() {
  pruneQueue();

  while (waitingQueue.length >= 2) {
    const aId = waitingQueue.shift();
    const bId = waitingQueue.shift();

    if (aId === bId) continue;
    if (!getSocketByPlayerId(aId) || !getSocketByPlayerId(bId)) continue;
    if (getGameByPlayerId(aId) || getGameByPlayerId(bId)) continue;

    createGame(aId, bId);
  }
}

io.on('connection', (socket) => {
  const rawPlayerId = socket.handshake.auth && socket.handshake.auth.playerId;
  const playerId = typeof rawPlayerId === 'string' && rawPlayerId.trim().length
    ? rawPlayerId.trim().slice(0, 64)
    : socket.id;

  const existingSocket = getSocketByPlayerId(playerId);
  if (existingSocket && existingSocket.id !== socket.id) {
    existingSocket.disconnect(true);
  }

  playerToSocketId.set(playerId, socket.id);
  clearDisconnectTimer(playerId);

  socket.data.playerId = playerId;
  socket.data.username = makeDefaultName(playerId);
  socket.data.gameId = null;

  const existingGame = getGameByPlayerId(playerId);
  if (existingGame && existingGame.status === 'active') {
    socket.data.gameId = existingGame.id;
    if (existingGame.playerNames[playerId]) {
      socket.data.username = existingGame.playerNames[playerId];
    }
    socket.join(existingGame.id);
    emitGameState(existingGame, {
      includeMessage: true,
      message: `${existingGame.playerNames[playerId]} reconnected.`
    });
  }

  socket.on('user:set-name', (rawName, ack) => {
    const name = typeof rawName === 'string' ? rawName.trim().slice(0, 24) : '';
    if (name.length >= 2) {
      socket.data.username = name;
      const game = getGameByPlayerId(playerId);
      if (game) {
        game.playerNames[playerId] = name;
        emitGameState(game);
      }
    }
    if (typeof ack === 'function') {
      ack({ username: socket.data.username, playerId });
    }
  });

  socket.on('matchmaking:join', () => {
    if (getGameByPlayerId(playerId)) {
      socket.emit('matchmaking:error', 'You are already in a game.');
      return;
    }

    if (waitingQueue.includes(playerId)) return;

    waitingQueue.push(playerId);
    socket.emit('matchmaking:queued');
    attemptMatchmaking();
  });

  socket.on('matchmaking:leave', () => {
    const game = getGameByPlayerId(playerId);
    if (game && game.status === 'active') {
      endGame(game, playerId, 'left game');
      return;
    }

    const idx = waitingQueue.indexOf(playerId);
    if (idx !== -1) {
      waitingQueue.splice(idx, 1);
      socket.emit('matchmaking:left');
    }
  });

  socket.on('game:guess', (rawGuess) => {
    const game = getGameByPlayerId(playerId);
    if (!game || game.status !== 'active') return;

    const activePlayerId = getActivePlayerId(game);
    if (activePlayerId !== playerId) {
      socket.emit('game:error', 'Not your turn.');
      return;
    }

    if (Date.now() > game.turnDeadline) {
      endGame(game, playerId, 'time expired');
      return;
    }

    const guessText = formatGuessText(rawGuess);
    const guessKey = playerStore.toKey(typeof rawGuess === 'string' ? rawGuess : '');

    if (!guessKey || !playerStore.hasPlayer(guessKey)) {
      applyStrike(game, playerId, 'unknown player', guessText);
      return;
    }

    if (game.usedPlayerKeys.has(guessKey)) {
      applyStrike(game, playerId, 'repeat player', guessText);
      return;
    }

    const currentName = playerStore.getName(game.currentPlayerKey);
    if (!playerStore.areTeammates(game.currentPlayerKey, guessKey)) {
      applyStrike(game, playerId, `not a teammate of ${currentName}`, guessText);
      return;
    }

    game.usedPlayerKeys.add(guessKey);
    game.currentPlayerKey = guessKey;
    game.history.push({
      type: 'guess',
      at: Date.now(),
      playerId,
      player: playerStore.getName(guessKey)
    });

    game.turnIndex = game.turnIndex === 0 ? 1 : 0;
    game.turnDeadline = Date.now() + TURN_DURATION_MS;

    emitGameState(game, {
      includeMessage: true,
      message: `${game.playerNames[playerId]} played ${playerStore.getName(guessKey)}`
    });

    scheduleTurnTimeout(game);
  });

  socket.on('disconnect', () => {
    const mappedSocketId = playerToSocketId.get(playerId);
    if (mappedSocketId === socket.id) {
      playerToSocketId.delete(playerId);
    }

    const queueIndex = waitingQueue.indexOf(playerId);
    if (queueIndex !== -1) {
      waitingQueue.splice(queueIndex, 1);
    }

    const game = getGameByPlayerId(playerId);
    if (game && game.status === 'active') {
      clearDisconnectTimer(playerId);
      const timer = setTimeout(() => {
        const stillDisconnected = !getSocketByPlayerId(playerId);
        if (stillDisconnected) {
          endGame(game, playerId, 'disconnect');
        }
      }, DISCONNECT_GRACE_MS);
      disconnectTimers.set(playerId, timer);
      emitGameState(game, {
        includeMessage: true,
        message: `${game.playerNames[playerId]} disconnected.`
      });
    }
  });
});

async function boot() {
  await accountStore.init();
  server.listen(PORT, () => {
    const counts = playerStore.getCounts();
    console.log(`Players loaded from DB: ${counts.players} total, ${counts.allStars} all-stars`);
    console.log(`Account store: ${usePostgres ? 'postgres' : 'sqlite'}`);
    console.log(`HoopDuels server running on http://localhost:${PORT}`);
  });
}

boot().catch((error) => {
  console.error('Failed to boot server:', error);
  process.exit(1);
});
