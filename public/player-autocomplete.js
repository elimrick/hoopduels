(function attachPlayerAutocomplete() {
  let playerNamesPromise = null;

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[.’']/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
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
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => onSelect(name));
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

      const names = options.search ? [] : await getPlayerNames();
      const root = document.createElement('div');
      root.className = 'player-autocomplete';
      input.parentNode.insertBefore(root, input);
      root.appendChild(input);

      const dropdown = document.createElement('div');
      dropdown.className = 'player-suggestions';
      dropdown.hidden = true;
      dropdown.id = input.id + '-results';
      dropdown.setAttribute('role', 'listbox');
      dropdown.setAttribute('aria-label', options.label || 'NBA players');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-controls', dropdown.id);
      input.setAttribute('aria-expanded', 'false');
      root.appendChild(dropdown);

      let items = [];
      let activeIndex = -1;
      let hasFocus = false;
      let requestVersion = 0;

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
        requestVersion += 1;
        dropdown.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        dropdown.innerHTML = '';
        activeIndex = -1;
        items = [];
      }

      function render(list, emptyMessage) {
        dropdown.innerHTML = '';
        items = list;
        activeIndex = -1;

        if (!list.length) {
          const empty = document.createElement('div');
          empty.className = 'search-empty';
          empty.setAttribute('role', 'status');
          empty.textContent = emptyMessage || options.emptyText || 'No matching players. Try a different name.';
          dropdown.appendChild(empty);
          dropdown.hidden = false;
          input.setAttribute('aria-expanded', 'true');
          input.removeAttribute('aria-activedescendant');
          return;
        }

        list.forEach((name, index) => {
          const item = createSuggestionItem(name, index === activeIndex, choose);
          item.id = dropdown.id + '-' + index;
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', 'false');
          item.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') updateActive(index, false);
          });
          dropdown.appendChild(item);
        });
        dropdown.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.removeAttribute('aria-activedescendant');
        if (!options.search) updateActive(0);
      }

      function updateActive(nextIndex, scroll = true) {
        if (!items.length) return;
        const startIndex = activeIndex < 0 && nextIndex < 0 ? items.length - 1 : nextIndex;
        activeIndex = (startIndex + items.length) % items.length;
        [...dropdown.children].forEach((child, index) => {
          child.classList.toggle('active', index === activeIndex);
          child.setAttribute('aria-selected', index === activeIndex ? 'true' : 'false');
          if (index === activeIndex) {
            input.setAttribute('aria-activedescendant', child.id);
            if (scroll) child.scrollIntoView({ block: 'nearest' });
          }
        });
      }

      async function refresh() {
        if (!hasFocus || input.readOnly || input.disabled || input.getAttribute('aria-disabled') === 'true') {
          close();
          return;
        }
        const query = normalizeSearch(getFieldValue(input));
        if (!query) {
          close();
          return;
        }

        if (options.search) {
          const version = ++requestVersion;
          dropdown.hidden = true;
          items = [];
          activeIndex = -1;
          input.setAttribute('aria-expanded', 'false');
          input.removeAttribute('aria-activedescendant');
          try {
            const results = await options.search(query);
            if (version === requestVersion && hasFocus) render(results.slice(0, 8));
          } catch {
            if (version === requestVersion && hasFocus) render([], 'Could not load suggestions. Try again.');
          }
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
        if (event.isComposing || event.repeat && event.key === 'Enter') return;
        if (event.key === 'Escape') { close(); return; }
        if (dropdown.hidden || !items.length) return;

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          updateActive(activeIndex + 1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          updateActive(activeIndex - 1);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (activeIndex >= 0) choose(items[activeIndex]);
        }
      });

      input.addEventListener('blur', () => {
        hasFocus = false;
        setTimeout(close, 120);
      });

      dropdown.addEventListener('touchstart', () => {
        input.removeAttribute('aria-activedescendant');
        activeIndex = -1;
        [...dropdown.children].forEach((child) => {
          child.classList.remove('active');
          child.setAttribute('aria-selected', 'false');
        });
      }, { passive: true });

      return {
        refresh,
        close
      };
    }
  };
})();
