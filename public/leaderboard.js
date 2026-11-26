(function (root) {
  function paginate(rows, query = '', page = 1, pageSize = 25) {
    const key = query.trim().toLowerCase();
    const filtered = key ? rows.filter(row => row.username.toLowerCase().includes(key)) : rows;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const current = Math.max(1, Math.min(pages, Number(page) || 1));
    const start = (current - 1) * pageSize;
    return { rows: filtered.slice(start, start + pageSize), total: filtered.length, pages, page: current, start };
  }
  function rankRows(rows, sort) {
    if (sort === 'rating') return rows;
    return [...rows].sort((a, b) =>
      (b.practiceLongestChain || 0) - (a.practiceLongestChain || 0) || a.rank - b.rank)
      .map((row, index) => ({...row, rank: index + 1}));
  }

  function mount(container, rows) {
    let query = '', page = 1, activeSort = 'rating', rankedRows = rows;
    container.innerHTML = '<div class="leaderboard-toolbar"><label>Find a player<input type="search" placeholder="Search..." autocomplete="off" /></label><span class="my-rank">My rank</span></div><p class="leaderboard-summary" aria-live="polite"></p><div class="page-table-wrap"><table class="leaderboard-table leaderboard-table-full"><caption class="sr-only">Players ranked by rating</caption><thead><tr><th scope="col">Rank</th><th scope="col">Name</th><th scope="col"><button type="button" data-sort="rating">Rating<span aria-hidden="true" hidden>↓</span></button></th><th scope="col" title="Longest Solo Challenge chain"><button type="button" data-sort="solo">Solo<span aria-hidden="true" hidden>↓</span></button></th></tr></thead><tbody></tbody></table></div><p class="leaderboard-empty" hidden>No matching players. Try another username.</p><nav class="leaderboard-pagination" aria-label="Leaderboard pages"><button type="button" data-step="first" aria-label="First page">«</button><button type="button" data-step="previous">Previous</button><span aria-live="polite"></span><button type="button" data-step="next">Next</button><button type="button" data-step="last" aria-label="Last page">»</button></nav>';
    const input = container.querySelector('input');
    const sortButtons = container.querySelectorAll('[data-sort]');
    const myButton = container.querySelector('.my-rank');
    const pagination = container.querySelector('.leaderboard-pagination');
    function paint() {
      const result = paginate(rankedRows, query, page); page = result.page;
      const ownRank = rankedRows.find(row => row.isYou)?.rank;
      myButton.hidden = ownRank == null;
      if (ownRank != null) myButton.textContent = `My rank · #${ownRank.toLocaleString()}`;
      container.querySelector('caption').textContent = `Players ranked by ${activeSort}`;
      const tbody = container.querySelector('tbody'); tbody.replaceChildren();
      result.rows.forEach(row => {
        const tr = document.createElement('tr');
        if(row.isYou) tr.className = 'leaderboard-row-you';
        [row.rank.toLocaleString(), row.username, Math.round(row.elo).toLocaleString(), (row.practiceLongestChain || 0).toLocaleString()].forEach(value => { const td = document.createElement('td'); td.textContent = value; td.title = String(value); tr.appendChild(td); });
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
    function selectSort(sort) {
      activeSort = sort;
      rankedRows = rankRows(rows, sort);
      page = 1;
      sortButtons.forEach(button => {
        const selected = button.dataset.sort === sort;
        const heading = button.closest('th');
        if (selected) heading.setAttribute('aria-sort', 'descending');
        else heading.removeAttribute('aria-sort');
        button.querySelector('span').hidden = !selected;
      });
      paint();
    }
    sortButtons.forEach(button => {
      button.addEventListener('click', () => selectSort(button.dataset.sort));
    });
    pagination.addEventListener('click', event => {const step=event.target.dataset.step;if(!step)return;const total=paginate(rankedRows,query,page).pages;page=step==='first'?1:step==='last'?total:page+(step==='next'?1:-1);paint();});
    selectSort(activeSort);
  }
  if(typeof module !== 'undefined' && module.exports) module.exports = {paginate, rankRows};
  else root.HoopLeaderboard = {paginate, mount, rankRows};
})(typeof window !== 'undefined' ? window : globalThis);
