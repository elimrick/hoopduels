(function (root) {
  function paginate(rows, query = '', page = 1, pageSize = 25) {
    const key = query.trim().toLowerCase();
    const filtered = key ? rows.filter(row => row.username.toLowerCase().includes(key)) : rows;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const current = Math.max(1, Math.min(pages, Number(page) || 1));
    const start = (current - 1) * pageSize;
    return { rows: filtered.slice(start, start + pageSize), total: filtered.length, pages, page: current, start };
  }
  function mount(container, rows) {
    let query = '', page = 1;
    container.innerHTML = '<div class="leaderboard-toolbar"><label>Find a player<input type="search" placeholder="Search..." autocomplete="off" /></label><span class="my-rank">My rank</span></div><p class="leaderboard-summary" aria-live="polite"></p><div class="page-table-wrap"><table class="leaderboard-table"><caption class="sr-only">Players ranked by rating</caption><thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col">Rating</th><th scope="col">Record</th></tr></thead><tbody></tbody></table></div><p class="leaderboard-empty" hidden>No matching players. Try another username.</p><nav class="leaderboard-pagination" aria-label="Leaderboard pages"><button type="button" data-step="first" aria-label="First page">«</button><button type="button" data-step="previous">Previous</button><span aria-live="polite"></span><button type="button" data-step="next">Next</button><button type="button" data-step="last" aria-label="Last page">»</button></nav>';
    const input = container.querySelector('input');
    const mine = rows.findIndex(row => row.isYou);
    const myButton = container.querySelector('.my-rank');
    myButton.hidden = mine < 0;
    if (mine >= 0) myButton.textContent = `My rank · #${rows[mine].rank.toLocaleString()}`;
    const pagination = container.querySelector('.leaderboard-pagination');
    function paint() {
      const result = paginate(rows, query, page); page = result.page;
      const tbody = container.querySelector('tbody'); tbody.replaceChildren();
      result.rows.forEach(row => {
        const tr = document.createElement('tr');
        if(row.isYou) tr.className = 'leaderboard-row-you';
        [row.rank.toLocaleString(), row.username, Math.round(row.elo).toLocaleString(), `${row.wins}-${row.losses}`].forEach(value => { const td = document.createElement('td'); td.textContent = value; td.title = String(value); tr.appendChild(td); });
        tbody.appendChild(tr);
      });
      container.querySelector('.leaderboard-summary').textContent = result.total ? `${(result.start + 1).toLocaleString()}–${(result.start + result.rows.length).toLocaleString()} of ${result.total.toLocaleString()} ${query ? 'matching players' : 'players'}${query ? ' · Overall ranks shown' : ''}` : (rows.length ? '' : 'No players yet. Your first duel starts the story.');
      container.querySelector('.leaderboard-empty').hidden = result.total > 0 || rows.length === 0;
      container.querySelector('table').hidden = result.total === 0;
      pagination.hidden = result.pages === 1;
      pagination.querySelector('span').textContent = `Page ${page.toLocaleString()} of ${result.pages.toLocaleString()}`;
      pagination.querySelectorAll('button').forEach(button => {button.disabled = ['first','previous'].includes(button.dataset.step) ? page === 1 : page === result.pages;});
    }
    input.addEventListener('input', () => { query = input.value; page = 1; paint(); });
    pagination.addEventListener('click', event => {const step=event.target.dataset.step;if(!step)return;const total=paginate(rows,query,page).pages;page=step==='first'?1:step==='last'?total:page+(step==='next'?1:-1);paint();});
    paint();
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = {paginate};
  else root.HoopLeaderboard = {paginate, mount};
})(typeof window !== 'undefined' ? window : globalThis);
