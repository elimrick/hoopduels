const fs = require('fs');
const path = require('path');

function getCurrentSeasonYear(date, seasonStartMonth = 10, seasonStartDay = 1) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  if (month > seasonStartMonth || (month === seasonStartMonth && day >= seasonStartDay)) {
    return year;
  }
  return year - 1;
}

function ensureStateDir(statePath) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readState(statePath) {
  try {
    if (!fs.existsSync(statePath)) {
      return {
        lastCompletedSeason: null,
        lastRunAt: null
      };
    }
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastCompletedSeason:
        typeof parsed.lastCompletedSeason === 'number' ? parsed.lastCompletedSeason : null,
      lastRunAt: parsed.lastRunAt || null
    };
  } catch (_) {
    return {
      lastCompletedSeason: null,
      lastRunAt: null
    };
  }
}

function writeState(statePath, state) {
  ensureStateDir(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function runSeasonSyncIfDue(options) {
  const {
    statePath,
    seasonStartMonth = 10,
    seasonStartDay = 1,
    force = false,
    syncFn
  } = options;

  if (typeof syncFn !== 'function') {
    throw new Error('runSeasonSyncIfDue requires a syncFn callback.');
  }

  const now = new Date();
  const seasonYear = getCurrentSeasonYear(now, seasonStartMonth, seasonStartDay);
  const state = readState(statePath);

  if (!force && state.lastCompletedSeason === seasonYear) {
    return {
      ran: false,
      seasonYear,
      reason: 'already_synced_for_season',
      state
    };
  }

  syncFn();

  const nextState = {
    lastCompletedSeason: seasonYear,
    lastRunAt: now.toISOString()
  };
  writeState(statePath, nextState);

  return {
    ran: true,
    seasonYear,
    reason: force ? 'forced' : 'due',
    state: nextState
  };
}

function startSeasonSyncScheduler(options) {
  const {
    intervalMs = 24 * 60 * 60 * 1000,
    logger = console,
    ...rest
  } = options;

  const runSafely = () => {
    try {
      const result = runSeasonSyncIfDue(rest);
      if (result.ran) {
        logger.log(`[season-sync] Completed sync for season ${result.seasonYear}`);
      } else {
        logger.log(`[season-sync] No sync needed for season ${result.seasonYear}`);
      }
      return result;
    } catch (error) {
      logger.error('[season-sync] Sync failed:', error.message);
      return null;
    }
  };

  runSafely();
  const timer = setInterval(runSafely, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer),
    runNow: runSafely
  };
}

module.exports = {
  getCurrentSeasonYear,
  readState,
  writeState,
  runSeasonSyncIfDue,
  startSeasonSyncScheduler
};
