// Shared SQL keeps friendship rules identical in SQLite previews and PostgreSQL.
class FriendStore {
  constructor(accounts) { this.accounts = accounts; }
  async query(sql, args = []) {
    if (this.accounts.pool) return (await this.accounts.pool.query(sql, args)).rows;
    const ordered = [];
    const sqlite = sql.replace(/\$(\d+)/g, (_, n) => { ordered.push(args[Number(n)-1]); return '?'; });
    return this.accounts.db.prepare(sqlite).all(...ordered);
  }
  async init() {
    await this.query(`CREATE TABLE IF NOT EXISTS friendships (
      low_id INTEGER NOT NULL REFERENCES users(id), high_id INTEGER NOT NULL REFERENCES users(id),
      sender_id INTEGER NOT NULL REFERENCES users(id), accepted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (low_id, high_id), CHECK (low_id < high_id))`);
    await this.query(`CREATE TABLE IF NOT EXISTS friend_records (user_id INTEGER NOT NULL REFERENCES users(id), opponent_id INTEGER NOT NULL REFERENCES users(id), wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, opponent_id))`);
  }
  async search(id, query) {
    if (typeof query !== 'string' || !/^[a-z0-9]{1,24}$/i.test(query.trim())) return [];
    return this.query('SELECT id, username FROM users WHERE id <> $1 AND normalized_username LIKE $2 ORDER BY normalized_username LIMIT 8', [id, query.trim().toLowerCase()+'%']);
  }
  async ensureRecord(id, other) {
    const [existing] = await this.query('SELECT wins FROM friend_records WHERE user_id=$1 AND opponent_id=$2',[id,other]);
    if(existing)return;
    const [user] = await this.query('SELECT profile_json FROM users WHERE id = $1',[id]);
    const [opponent] = await this.query('SELECT username FROM users WHERE id = $1',[other]);
    if(!user || !opponent) return;
    let profile={};try {profile=JSON.parse(user.profile_json||'{}');}catch{}
    // shortcut: older results use retained history; import archived results if a complete archive becomes available.
    const games=(profile.games||[]).filter(g=>String(g.opponent).toLowerCase()===opponent.username.toLowerCase());
    await this.query('INSERT INTO friend_records (user_id, opponent_id, wins, losses) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, opponent_id) DO NOTHING', [id,other,games.filter(g=>g.won).length,games.filter(g=>!g.won).length]);
  }
  async recordGame(winner, loser) {
    await this.ensureRecord(winner,loser);await this.ensureRecord(loser,winner);
    await this.query(`UPDATE friend_records SET wins=wins+CASE WHEN user_id=$1 THEN 1 ELSE 0 END, losses=losses+CASE WHEN user_id=$2 THEN 1 ELSE 0 END WHERE (user_id=$1 AND opponent_id=$2) OR (user_id=$2 AND opponent_id=$1)`,[winner,loser]);
  }
  async list(id) {
    const rows = await this.query(`SELECT u.id, u.username, u.profile_json, f.sender_id, f.accepted FROM friendships f
      JOIN users u ON u.id = CASE WHEN f.low_id = $1 THEN f.high_id ELSE f.low_id END
      WHERE f.low_id = $1 OR f.high_id = $1 ORDER BY u.username`, [id]);
    for(const row of rows){
      let profile={};try{profile=JSON.parse(row.profile_json||'{}');}catch{}
      row.rating=Number(profile.elo)||1200;delete row.profile_json;
      if(Number(row.accepted)){await this.ensureRecord(id,row.id);const [record]=await this.query('SELECT wins, losses FROM friend_records WHERE user_id=$1 AND opponent_id=$2',[id,row.id]);row.record=record;}
    }
    return rows;
  }
  async request(id, username) {
    if (typeof username !== 'string' || !/^[a-z0-9]{2,24}$/i.test(username.trim())) throw Error('Enter a valid username.');
    const [other] = await this.query('SELECT id FROM users WHERE normalized_username = $1', [username.trim().toLowerCase()]);
    if (!other) throw Error('No matching account. Check the username.');
    if (Number(other.id) === Number(id)) throw Error('You cannot add yourself.');
    const rows = await this.query(`INSERT INTO friendships (low_id, high_id, sender_id)
      VALUES ($1, $2, $3) ON CONFLICT (low_id, high_id) DO NOTHING RETURNING low_id`, [Math.min(id,other.id),Math.max(id,other.id),id]);
    if (!rows.length) throw Error('You are already friends or have a pending request.');
  }
  async act(id, other, action) {
    if (!Number.isSafeInteger(other) || other <= 0 || other === Number(id)) throw Error('Invalid account.');
    const args = [Math.min(id,other), Math.max(id,other), id];
    let rows;
    if (action === 'accept') rows = await this.query(`UPDATE friendships SET accepted = 1
      WHERE low_id = $1 AND high_id = $2 AND sender_id <> $3 AND accepted = 0 RETURNING low_id`, args);
    else if (action === 'remove') rows = await this.query('DELETE FROM friendships WHERE low_id = $1 AND high_id = $2 RETURNING low_id', args.slice(0,2));
    else throw Error('Invalid action.');
    if (!rows.length) throw Error('That request is no longer available.');
  }
  async areFriends(a,b) {
    const rows = await this.query('SELECT accepted FROM friendships WHERE low_id = $1 AND high_id = $2', [Math.min(a,b),Math.max(a,b)]);
    return Boolean(rows[0] && Number(rows[0].accepted) === 1);
  }
}
module.exports = { FriendStore };
