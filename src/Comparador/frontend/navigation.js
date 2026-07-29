(() => {
  const tools = [
    ['/receta', 'Receta'],
    ['/planificador', 'Planificador'],
    ['/historial', 'Historial'],
    ['/bioequivalentes', 'Bioequivalentes'],
    ['/dashboard', 'Dashboard'],
    ['/#alertas', 'Alertas'],
  ];

  const pageFromHref = (href) => {
    const pathname = href.split('#')[0].replace(/\/+$/, '');
    return pathname.split('/').pop() || 'index';
  };

  function initAutocompleteClearButtons() {
    const selector = 'input[aria-autocomplete="list"], input[list]:not(.recipe-medicine-input)';
    const enhance = (input) => {
      if (!(input instanceof HTMLInputElement) || input.dataset.clearButtonReady === 'true') return;
      input.dataset.clearButtonReady = 'true';

      let root = input.closest('.tool-search-wrap, .cart-search-wrap, .autocomplete-clear-wrap');
      if (!root) {
        root = document.createElement('span');
        root.className = 'autocomplete-clear-wrap';
        input.before(root);
        root.appendChild(input);
      }
      root.classList.add('autocomplete-clear-root');

      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'autocomplete-clear-button';
      clear.setAttribute('aria-label', 'Borrar búsqueda');
      clear.title = 'Borrar búsqueda';
      clear.textContent = '×';
      clear.hidden = !input.value;
      input.insertAdjacentElement('afterend', clear);

      const update = () => { clear.hidden = !input.value; };
      input.addEventListener('input', update);
      input.addEventListener('change', update);
      clear.addEventListener('pointerdown', (event) => event.preventDefault());
      clear.addEventListener('click', () => {
        input.value = '';
        input.removeAttribute('aria-activedescendant');
        input.setAttribute('aria-expanded', 'false');
        const suggestionsId = input.getAttribute('aria-controls');
        const suggestions = suggestionsId ? document.getElementById(suggestionsId) : null;
        if (suggestions) {
          suggestions.hidden = true;
          suggestions.replaceChildren();
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new CustomEvent('autocomplete:clear', { bubbles: true }));
        update();
        input.focus({ preventScroll: true });
      });
    };

    const scan = (root = document) => {
      if (root instanceof Element && root.matches(selector)) enhance(root);
      root.querySelectorAll?.(selector).forEach(enhance);
    };
    scan();
    new MutationObserver((records) => {
      records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }

  function initNavigation() {
    if (!document.querySelector('.prototype-banner')) {
      const banner = document.createElement('div');
      banner.className = 'prototype-banner';
      banner.setAttribute('role', 'note');
      banner.textContent = 'Versión de prueba · Los datos y funcionalidades pueden estar incompletos.';
      document.body.prepend(banner);
    }
    initAutocompleteClearButtons();
    const legacyPage = location.pathname.match(/\/([a-z0-9-]+)\.html$/i);
    if (legacyPage) {
      const cleanPath = legacyPage[1].toLowerCase() === 'index' ? '/' : `/${legacyPage[1]}`;
      history.replaceState(null, '', `${cleanPath}${location.search}${location.hash}`);
    }
    const nav = document.querySelector('.nav');
    const links = nav?.querySelector('.nav-links');
    const button = nav?.querySelector('.menu-btn');
    if (!nav || !links || !button) return;
    const page = pageFromHref(location.pathname);
    const active = (href) => {
      return pageFromHref(href) === page;
    };
    const toolPages = tools.map(([href]) => pageFromHref(href)).filter((href) => href !== 'index');
    links.innerHTML = `
      <a href="/"${page === 'index' ? ' aria-current="page"' : ''}>Inicio</a>
      <a href="/#comparar">Comparar</a>
      <a href="/carrito"${page === 'carrito' ? ' aria-current="page"' : ''}>Carrito</a>
      <span class="nav-dropdown">
        <button class="nav-tools-trigger" type="button" aria-haspopup="true" aria-expanded="false"${toolPages.includes(page) ? ' aria-current="page"' : ''}>
          Herramientas <span aria-hidden="true">⌄</span>
        </button>
        <span class="nav-tool-menu" aria-label="Herramientas disponibles">
          ${tools.map(([href, label]) => `<a href="${href}"${active(href) ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </span>
      </span>
      <a class="nav-cta" href="/farmacias-turno"${page === 'farmacias-turno' ? ' aria-current="page"' : ''}>Farmacias de turno</a>`;
    button.setAttribute('aria-label', 'Abrir menú');
    button.setAttribute('aria-controls', 'primary-navigation');
    button.setAttribute('aria-expanded', 'false');
    links.id = 'primary-navigation';
    const toolsDropdown = links.querySelector('.nav-dropdown');
    const toolsTrigger = links.querySelector('.nav-tools-trigger');
    const closeTools = () => {
      toolsDropdown?.classList.remove('open');
      toolsTrigger?.setAttribute('aria-expanded', 'false');
    };
    toolsTrigger?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = toolsDropdown.classList.toggle('open');
      toolsTrigger.setAttribute('aria-expanded', String(expanded));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.nav-dropdown')) closeTools();
    });

    document.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      if (!href || /^(?:https?:|mailto:|tel:|#)/i.test(href)) return;
      const match = href.match(/^(?:\.\/)?([a-z0-9-]+)\.html(#[^ ]*)?$/i);
      if (!match) return;
      const route = match[1].toLowerCase() === 'index' ? '/' : `/${match[1]}`;
      link.setAttribute('href', `${route}${match[2] || ''}`);
    });

    let previousFocus = null;
    const focusables = () => [...links.querySelectorAll('a[href]')].filter((item) => item.offsetParent !== null);
    const close = (restore = false) => {
      links.classList.remove('open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Abrir menú');
      document.body.classList.remove('menu-open');
      if (restore && previousFocus) previousFocus.focus();
    };
    const open = () => {
      previousFocus = document.activeElement;
      links.classList.add('open');
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', 'Cerrar menú');
      document.body.classList.add('menu-open');
      focusables()[0]?.focus();
    };
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      links.classList.contains('open') ? close() : open();
    }, true);
    links.addEventListener('click', (event) => {
      if (event.target.closest('.nav-tool-menu a')) closeTools();
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!links.classList.contains('open') && !toolsDropdown?.classList.contains('open')) return;
        event.preventDefault();
        closeTools();
        if (links.classList.contains('open')) close(true);
        return;
      }
      if (!links.classList.contains('open')) return;
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', initNavigation)
    : initNavigation();
})();
