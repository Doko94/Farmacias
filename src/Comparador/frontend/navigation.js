(() => {
  const tools = [
    ['receta.html', 'Receta'],
    ['planificador.html', 'Planificador'],
    ['historial.html', 'Historial'],
    ['bioequivalentes.html', 'Bioequivalentes'],
    ['dashboard.html', 'Dashboard'],
    ['index.html#alertas', 'Alertas'],
  ];

  function initNavigation() {
    const nav = document.querySelector('.nav');
    const links = nav?.querySelector('.nav-links');
    const button = nav?.querySelector('.menu-btn');
    if (!nav || !links || !button) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    const active = (href) => {
      const target = href.split('#')[0] || 'index.html';
      return target === page;
    };
    const toolPages = tools.map(([href]) => href.split('#')[0]).filter((href) => href !== 'index.html');
    links.innerHTML = `
      <a href="index.html"${page === 'index.html' ? ' aria-current="page"' : ''}>Inicio</a>
      <a href="index.html#comparar">Comparar</a>
      <a href="carrito.html"${page === 'carrito.html' ? ' aria-current="page"' : ''}>Carrito</a>
      <span class="nav-dropdown">
        <a href="index.html#herramientas"${toolPages.includes(page) ? ' aria-current="page"' : ''}>Herramientas</a>
        <span class="nav-tool-menu" aria-label="Herramientas disponibles">
          ${tools.map(([href, label]) => `<a href="${href}"${active(href) ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </span>
      </span>
      <a class="nav-cta" href="farmacias-turno.html"${page === 'farmacias-turno.html' ? ' aria-current="page"' : ''}>Farmacias de turno</a>`;
    button.setAttribute('aria-label', 'Abrir menú');
    button.setAttribute('aria-controls', 'primary-navigation');
    button.setAttribute('aria-expanded', 'false');
    links.id = 'primary-navigation';

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
