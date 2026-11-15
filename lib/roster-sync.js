const fs = require('node:fs');
const path = require('node:path');
const {canonicalizeSourceName} = require('./player-store');
const {MOVEMENT_URL, transactionIntervals, addTransactionOverlaps} = require('./roster-transactions');

const SOURCES = ['https://www.nba.com/players', 'https://cdn-uat.nba.com/players'];

function identity(name) {
  return canonicalizeSourceName(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseRosters(html, now = new Date()) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('NBA roster data is missing.');
  const rows = JSON.parse(match[1]).props?.pageProps?.players;
  if (!Array.isArray(rows)) throw new Error('NBA roster rows are missing.');
  const season = now.getUTCFullYear() - (now.getUTCMonth() < 9 ? 1 : 0);
  const teams = new Map();
  const ids = new Set();
  const playerIds = new Map();
  for (const row of rows) {
    if (Number(row.ROSTER_STATUS) !== 1 || !Number(row.TEAM_ID) || Number(row.IS_DEFUNCT) === 1) continue;
    const name = `${row.PLAYER_FIRST_NAME || ''} ${row.PLAYER_LAST_NAME || ''}`.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!name || !Number(row.PERSON_ID) || ids.has(row.PERSON_ID) || !Number.isFinite(Number(row.TO_YEAR)) || Number(row.TO_YEAR) < season) {
      throw new Error('Invalid, duplicate, or outdated NBA roster player.');
    }
    ids.add(row.PERSON_ID);
    playerIds.set(name, row.PERSON_ID);
    if (!teams.has(row.TEAM_ID)) teams.set(row.TEAM_ID, []);
    teams.get(row.TEAM_ID).push(name);
  }
  if (teams.size !== 30 || ids.size < 400 || ids.size > 750) throw new Error('NBA roster coverage is incomplete.');
  for (const names of teams.values()) {
    if (names.length < 12 || names.length > 25) throw new Error('NBA team roster size is unexpected.');
  }
  return [...teams].map(([teamId, players]) => ({teamId, players, playerIds:players.map(name => playerIds.get(name))}));
}

function addSnapshot(additions, rosters, baseline) {
  const names = new Map();
  for (const name of [...Object.keys(baseline), ...Object.keys(additions)]) {
    const key = identity(name);
    if (!names.has(key) || !name.includes("'")) names.set(key, canonicalizeSourceName(name));
  }
  for (const roster of rosters) {
    const players = roster.players.map(name => names.get(identity(name)) || canonicalizeSourceName(name));
    for (const name of players) {
      const peers = new Set(additions[name] || []);
      for (const peer of players) if (peer !== name) peers.add(peer);
      additions[name] = [...peers].sort();
    }
  }
}

function mergeAdditions(baseline, additions) {
  const result = structuredClone(baseline);
  for (const name of Object.keys(additions)) result[name] ||= {allStar:false, teammates:[]};
  for (const [name, peers] of Object.entries(additions)) {
    if (!Array.isArray(peers)) throw new Error('Invalid saved roster connections.');
    const teammates = new Set(result[name].teammates);
    for (const peer of peers) {
      if (!result[peer] || name === peer) throw new Error('Invalid saved roster connection.');
      teammates.add(peer);
    }
    result[name].teammates = [...teammates].sort();
  }
  for (const [name, peers] of Object.entries(additions)) {
    for (const peer of peers) {
      if (!additions[peer]?.includes(name)) throw new Error('Asymmetric saved roster connection.');
    }
  }
  return result;
}

async function fetchRosters(fetcher = fetch) {
  for (const source of SOURCES) {
    try {
      const response = await fetcher(source, {signal:AbortSignal.timeout(30000)});
      if (!response.ok) throw new Error(`NBA returned ${response.status}`);
      return {rosters:parseRosters(await response.text()), source};
    } catch (error) {
      if (source === SOURCES.at(-1)) throw error;
    }
  }
}

class RosterSync {
  constructor({playerStore, pool, statePath, fetcher = fetch}) {
    this.playerStore = playerStore;
    this.pool = pool;
    this.statePath = statePath;
    this.fetcher = fetcher;
    this.baseline = JSON.parse(fs.readFileSync(playerStore.seedJsonPath, 'utf8'));
    this.state = {updatedAt:null, additions:{}};
    this.running = null;
    this.lastAttempt = 0;
    this.lastError = null;
  }

  async init() {
    if (this.pool) {
      await this.pool.query('CREATE TABLE IF NOT EXISTS nba_roster_sync (id INTEGER PRIMARY KEY CHECK (id = 1), state JSONB NOT NULL)');
      const result = await this.pool.query('SELECT state FROM nba_roster_sync WHERE id = 1');
      if (result.rows.length) this.state = result.rows[0].state;
    } else if (fs.existsSync(this.statePath)) {
      this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    }
    this.playerStore.replaceFromData(mergeAdditions(this.baseline, this.state.additions));
  }

  status() {
    return {updatedAt:this.state.updatedAt, source:this.state.source || null,
      teams:this.state.rosters?.length || 0, running:Boolean(this.running), lastError:this.lastError};
  }

  async persist(state) {
    if (this.pool) {
      await this.pool.query('INSERT INTO nba_roster_sync (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state', [JSON.stringify(state)]);
    } else {
      fs.mkdirSync(path.dirname(this.statePath), {recursive:true});
      fs.writeFileSync(this.statePath + '.tmp', JSON.stringify(state));
      fs.renameSync(this.statePath + '.tmp', this.statePath);
    }
  }

  async refresh() {
    if (this.running) return this.running;
    const now = Date.now();
    if (String(this.state.updatedAt).slice(0,10) === new Date(now).toISOString().slice(0,10) || now - this.lastAttempt < 60 * 60 * 1000) return this.status();
    this.lastAttempt = now;
    this.running = this.update();
    try {
      return await this.running;
    } catch (error) {
      this.lastError = error.message;
      throw error;
    } finally {
      this.running = null;
    }
  }

  async update() {
    const client = this.pool ? await this.pool.connect() : null;
    try {
      if (client) {
        await client.query('SELECT pg_advisory_lock(1468301453)');
        const result = await client.query('SELECT state FROM nba_roster_sync WHERE id = 1');
        if (result.rows.length) {
          const saved = result.rows[0].state;
          this.playerStore.replaceFromData(mergeAdditions(this.baseline, saved.additions));
          this.state = saved;
          this.lastError = null;
          if (String(saved.updatedAt).slice(0,10) === new Date().toISOString().slice(0,10)) return this.status();
        }
      }
      return await this.updateRosters();
    } finally {
      if (client) {
        try {await client.query('SELECT pg_advisory_unlock(1468301453)');}
        finally {client.release();}
      }
    }
  }

  async updateRosters() {
    try {
      const {rosters, source} = await fetchRosters(this.fetcher);
      const next = structuredClone(this.state);
      const movementResponse = await this.fetcher(MOVEMENT_URL, {signal:AbortSignal.timeout(30000)});
      if (!movementResponse.ok) throw new Error(`NBA transactions returned ${movementResponse.status}`);
      const intervals = transactionIntervals(await movementResponse.json(), Date.now(), rosters);
      addTransactionOverlaps(next.additions, intervals, this.baseline, addSnapshot);
      addSnapshot(next.additions, rosters, this.baseline);
      const players = mergeAdditions(this.baseline, next.additions);
      next.updatedAt = new Date().toISOString();
      next.source = source;
      next.rosters = rosters;
      await this.persist(next);
      this.playerStore.replaceFromData(players);
      this.state = next;
      this.lastError = null;
      console.log(`[roster-sync] Updated ${rosters.length} NBA rosters at ${next.updatedAt}`);
      return this.status();
    } catch (error) {
      this.lastError = error.message;
      console.error('[roster-sync] Retaining previous player data:', error.message);
      throw error;
    }
  }
}

module.exports = {RosterSync, parseRosters, fetchRosters, addSnapshot, mergeAdditions};
