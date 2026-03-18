(function attachPlayerAutocomplete() {
  let playerNamesPromise = null;

  function normalizeSearch(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getPlayerNames() {
    if (!playerNamesPromise) {
      playerNamesPromise = fetch('/api/players')
        .then((res) => res.json())
        .then((payload) => Array.isArray(payload && payload.players) ? payload.players : [])
        .catch(() => []);
    }
    return playerNamesPromise;
  }

  function scoreCandidate(name, query) {
    const normalizedName = normalizeSearch(name);
    if (!query || !normalizedName) return Infinity;
    if (normalizedName === query) return 0;
    if (normalizedName.startsWith(query)) return 1;

    const words = normalizedName.split(' ');
    if (words.some((word) => word.startsWith(query))) return 2;

    const idx = normalizedName.indexOf(query);
    if (idx >= 0) return 10 + idx;

    return Infinity;
  }

  function createSuggestionItem(name, isActive, onSelect) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `player-suggestion${isActive ? ' active' : ''}`;
    button.tabIndex = -1;
    button.textContent = name;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      onSelect(name);
    });
    return button;
  }

  function getFieldValue(field) {
    if (!field) return '';
    return 'value' in field ? field.value : (field.textContent || '');
  }

  function setFieldValue(field, value) {
    if (!field) return;
    if ('value' in field) {
      field.value = value;
      return;
    }
    field.textContent = value || '';
  }

  window.HoopAutocomplete = {
    async attach(input, options = {}) {
      if (!input) return null;

      const names = await getPlayerNames();
      const root = document.createElement('div');
      root.className = 'player-autocomplete';
      input.parentNode.insertBefore(root, input);
      root.appendChild(input);

      const dropdown = document.createElement('div');
      dropdown.className = 'player-suggestions';
      dropdown.hidden = true;
      root.appendChild(dropdown);

      let items = [];
      let activeIndex = -1;
      let hasFocus = false;

      function getExcludedKeys() {
        return typeof options.getExcludedNames === 'function'
          ? new Set((options.getExcludedNames() || []).map(normalizeSearch))
          : new Set();
      }

      function choose(name) {
        setFieldValue(input, name);
        close();
        if (typeof options.onSelect === 'function') {
          options.onSelect(name);
        }
      }

      function close() {
        dropdown.hidden = true;
        dropdown.innerHTML = '';
        activeIndex = -1;
        items = [];
      }

      function render(list) {
        dropdown.innerHTML = '';
        items = list;
        activeIndex = -1;

        if (!list.length) {
          close();
          return;
        }

        list.forEach((name, index) => {
          dropdown.appendChild(createSuggestionItem(name, index === activeIndex, choose));
        });
        dropdown.hidden = false;
      }

      function updateActive(nextIndex) {
        if (!items.length) return;
        const startIndex = activeIndex < 0 ? (nextIndex > activeIndex ? 0 : items.length - 1) : nextIndex;
        activeIndex = (startIndex + items.length) % items.length;
        [...dropdown.children].forEach((child, index) => {
          child.classList.toggle('active', index === activeIndex);
        });
      }

      function refresh() {
        if (!hasFocus) {
          close();
          return;
        }
        const query = normalizeSearch(getFieldValue(input));
        if (!query) {
          close();
          return;
        }

        const excluded = getExcludedKeys();
        const suggestions = names
          .filter((name) => !excluded.has(normalizeSearch(name)))
          .map((name) => ({ name, score: scoreCandidate(name, query) }))
          .filter((item) => Number.isFinite(item.score))
          .sort((a, b) => {
            if (a.score !== b.score) return a.score - b.score;
            return a.name.localeCompare(b.name);
          })
          .slice(0, 8)
          .map((item) => item.name);

        render(suggestions);
      }

      input.addEventListener('input', refresh);
      input.addEventListener('focus', () => {
        hasFocus = true;
        activeIndex = -1;
        refresh();
      });
      input.addEventListener('keydown', (event) => {
        if (dropdown.hidden || !items.length) return;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          updateActive(activeIndex + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          updateActive(activeIndex - 1);
        } else if (event.key === 'Enter') {
          event.preventDefault();
        } else if (event.key === 'Escape') {
          close();
        }
      });

      input.addEventListener('blur', () => {
        hasFocus = false;
        setTimeout(close, 120);
      });

      dropdown.addEventListener('touchstart', () => {
        activeIndex = -1;
        [...dropdown.children].forEach((child) => {
          child.classList.remove('active');
        });
      }, { passive: true });

      return {
        refresh,
        close
      };
    }
  };
})();
