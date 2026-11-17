const DAY_MS = 86400000;
const API = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons';
const TEAM_CODES = {GSW:'GS', NYK:'NY', NOP:'NO', SAS:'SA', UTA:'UTAH', WAS:'WSH'};

function nbaDay(timestamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
}

async function fetchJson(fetcher, url) {
  const response = await fetcher(url, {signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`NBA season calendar returned ${response.status}`);
  return response.json();
}

async function fetchSeasonWindows(fetcher, rosters, since, now = Date.now()) {
  if (!Number.isFinite(since) || !Number.isFinite(now)) throw new Error('Invalid roster update date.');
  const scoreboard = await fetchJson(fetcher, 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?limit=1');
  const year = scoreboard.leagues?.find(league => league.slug === 'nba')?.season?.year;
  if (!Number.isInteger(year) || Math.abs(year - new Date(now).getUTCFullYear()) > 1) {
    throw new Error('NBA season identification is missing or stale.');
  }
  const windows = [];
  const firstYear = Math.min(year, new Date(since).getUTCFullYear());
  for (let season = firstYear; season <= year; season++) {
    const calendars = await Promise.all([2,3,5].map(type => fetchJson(fetcher, `${API}/${season}/types/${type}`)));
    for (const [index, calendar] of calendars.entries()) {
      const type = [2,3,5][index];
      const start = Date.parse(String(calendar.startDate).slice(0,10) + 'T00:00:00Z');
      const end = Date.parse(String(calendar.endDate).slice(0,10) + 'T00:00:00Z');
      if (calendar.year !== season || calendar.type !== type || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error('Invalid NBA season calendar.');
      }
      if (type === 2) {
        for (const roster of rosters) windows.push({season,type,teamId:roster.teamId,start,end});
        continue;
      }
      if (end <= since || start > nbaDay(now)) continue;
      const regularEnd = Date.parse(calendars[0].endDate.slice(0,10) + 'T00:00:00Z');
      const postseason = await Promise.all(rosters.map(async roster => {
        const code = TEAM_CODES[roster.abbreviation] || roster.abbreviation;
        if (!/^[A-Z]{2,4}$/.test(code || '')) throw new Error('Missing NBA team identity for postseason schedule.');
        const schedule = await fetchJson(fetcher, `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${code}/schedule?season=${season}&seasontype=${type}`);
        if (schedule.status !== 'success' || schedule.team?.abbreviation !== code || !Array.isArray(schedule.events)) {
          throw new Error('Incomplete NBA postseason schedule.');
        }
        if (schedule.events.length && (schedule.requestedSeason?.year !== season || schedule.requestedSeason?.type !== type)) throw new Error('Unexpected NBA postseason season.');
        const games = schedule.events.filter(event => !['STATUS_CANCELED','STATUS_POSTPONED','STATUS_UNNECESSARY'].includes(event.competitions?.[0]?.status?.type?.name));
        if (!games.length) return {season,type,teamId:roster.teamId,start:regularEnd,end:regularEnd};
        for (const game of games) {
          if (game.season?.year !== season || game.seasonType?.type !== type || !Number.isFinite(Date.parse(game.date))) throw new Error('Invalid NBA postseason game.');
        }
        return {season,type,teamId:roster.teamId,start:regularEnd,end:Math.min(end, Math.max(...games.map(game => nbaDay(game.date))) + DAY_MS)};
      }));
      windows.push(...postseason.filter(Boolean));
    }
  }
  return windows;
}

function mergeSeasonWindows(previous, updated) {
  const windows = new Map(previous.map(window => [`${window.season}:${window.type}:${window.teamId}`,window]));
  for (const window of updated) windows.set(`${window.season}:${window.type}:${window.teamId}`,window);
  return [...windows.values()];
}

function inSeason(teamId, date, windows) {
  return windows.some(window => window.teamId === teamId && window.start <= date && date < window.end);
}

module.exports = {fetchSeasonWindows, mergeSeasonWindows, inSeason, nbaDay};
