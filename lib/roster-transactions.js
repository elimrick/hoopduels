const {canonicalizeSourceName} = require('./player-store');

const MOVEMENT_URL = 'https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json';
const DAY_MS = 86400000;

function transactionDay(value) {
  return Date.parse(String(value).slice(0, 10) + 'T00:00:00Z');
}

function transactionIntervals(payload, now = Date.now(), rosters = []) {
  const rows = payload?.NBA_Player_Movement?.rows;
  if (!Array.isArray(rows) || rows.length < 1000) throw new Error('NBA transaction history is incomplete.');
  const byPlayer = new Map();
  for (const row of rows) {
    if (Number(row.PLAYER_ID) === 0 && row.Transaction_Type === 'Trade') continue;
    if (!Number(row.PLAYER_ID) || !Number(row.TEAM_ID) || !Number.isFinite(transactionDay(row.TRANSACTION_DATE))) {
      throw new Error('Invalid NBA transaction record.');
    }
    if (!byPlayer.has(row.PLAYER_ID)) byPlayer.set(row.PLAYER_ID, []);
    byPlayer.get(row.PLAYER_ID).push(row);
  }
  const intervals = [];
  for (const moves of byPlayer.values()) {
    moves.sort((a,b)=>transactionDay(a.TRANSACTION_DATE)-transactionDay(b.TRANSACTION_DATE));
    for (const move of moves) {
      if (!['Signing','AwardOnWaivers','Trade'].includes(move.Transaction_Type)) continue;
      const text = move.TRANSACTION_DESCRIPTION;
      const match = text.match(/(?:signed|claimed|received) (?:guard|forward|center)(?:[-/](?:guard|forward|center))? (.+?)(?: to | off waivers| from )/i);
      if (!match) throw new Error('Unrecognized NBA roster transaction description.');
      const start = transactionDay(move.TRANSACTION_DATE);
      if (start > now) continue;
      if (move.Transaction_Type === 'Trade' && !intervals.some(interval =>
        interval.playerId === move.PLAYER_ID && interval.teamId === Number(move.Additional_Sort) &&
        interval.start < start && interval.end === start && interval.contractEnd >= start)) continue;
      const date = new Date(start);
      const endYear = date.getUTCFullYear() + (date.getUTCMonth() >= 6 ? 1 : 0);
      // Only the current contract season is inferred. Renewals need their own evidence.
      let end = Math.min(Date.UTC(endYear,6,1),now + 1);
      if (/10-Day/i.test(text)) end = Math.min(end,start + 10*DAY_MS);
      const contractEnd = end;
      for (const departure of moves) {
        const at = transactionDay(departure.TRANSACTION_DATE);
        if (at < start) continue;
        const waived = departure.Transaction_Type === 'Waive' && departure.TEAM_ID === move.TEAM_ID;
        const traded = departure.Transaction_Type === 'Trade' && Number(departure.Additional_Sort) === Number(move.TEAM_ID);
        if (waived || traded) end = Math.min(end,at);
      }
      if (end > start) intervals.push({name:canonicalizeSourceName(match[1]),teamId:move.TEAM_ID,playerId:move.PLAYER_ID,start,end,contractEnd});
    }
  }
  for (const roster of rosters) {
    roster.players.forEach((name, index) => {
      const moves = byPlayer.get(roster.playerIds?.[index]);
      if (!moves?.length) return;
      const last = moves.at(-1);
      if (Number(last.TEAM_ID) !== Number(roster.teamId) || last.Transaction_Type === 'Waive') {
        return;
      }
      const start = transactionDay(last.TRANSACTION_DATE);
      if (/10-Day/i.test(last.TRANSACTION_DESCRIPTION) && start + 10*DAY_MS <= now) return;
      if (start <= now) intervals.push({name:canonicalizeSourceName(name),teamId:roster.teamId,start,end:now+1});
    });
  }
  return intervals;
}

function addTransactionOverlaps(additions, intervals, baseline, addSnapshot, after = 0, seasonWindows = null) {
  const teams = new Map();
  for (const interval of intervals) {
    if (!teams.has(interval.teamId)) teams.set(interval.teamId, []);
    teams.get(interval.teamId).push(interval);
  }
  const overlaps = [];
  for (const group of teams.values()) {
    group.sort((a,b)=>a.start-b.start);
    for (let i=0;i<group.length;i++) {
      const a=group[i];
      for (let j=i+1;j<group.length && group[j].start<a.end;j++) {
        const b=group[j];
        if (a.name !== b.name && a.start < b.end && Math.min(a.end, b.end) > after) {
          const start = Math.max(a.start, b.start, after);
          const end = Math.min(a.end, b.end);
          if (!seasonWindows || seasonWindows.some(window => window.teamId === a.teamId && Math.max(start, window.start) < Math.min(end, window.end))) {
            overlaps.push({teamId:a.teamId,players:[a.name,b.name]});
          }
        }
      }
    }
  }
  addSnapshot(additions,overlaps,baseline);
}

module.exports = {MOVEMENT_URL, transactionIntervals, addTransactionOverlaps};
