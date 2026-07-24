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

  function initNavigation() {
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
        <a href="/#herramientas"${toolPages.includes(page) ? ' aria-current="page"' : ''}>Herramientas</a>
        <span class="nav-tool-menu" aria-label="Herramientas disponibles">
          ${tools.map(([href, label]) => `<a href="${href}"${active(href) ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </span>
      </span>
      <a class="nav-cta" href="/farmacias-turno"${page === 'farmacias-turno' ? ' aria-current="page"' : ''}>Farmacias de turno</a>`;
    button.setAttribute('aria-label', 'Abrir menú');
    button.setAttribute('aria-controls', 'primary-navigation');
    button.setAttribute('aria-expanded', 'false');
    links.id = 'primary-navigation';

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
      if (event.target.closest('a')) close();
    });
    document.addEventListener('keydown', (event) => {
      if (!links.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
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
