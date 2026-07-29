const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOBILE = window.matchMedia('(max-width: 700px)');

function installAuroraStyles() {
  if (document.getElementById('aurora-clinica-styles')) return;
  const style = document.createElement('style');
  style.id = 'aurora-clinica-styles';
  style.textContent = `
    html { background: #f8fcfb; }
    body { position: relative; background: transparent !important; }
    .neat-aurora {
      position: fixed;
      z-index: 0;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: .34;
      pointer-events: none;
    }
    html.aurora-static .neat-aurora {
      background:
        radial-gradient(circle at 82% 13%, rgba(141,221,210,.55), transparent 36%),
        radial-gradient(circle at 18% 72%, rgba(189,235,201,.62), transparent 38%),
        linear-gradient(145deg, #f8fcfb, #c5e3de);
    }
    body > :not(.neat-aurora) { position: relative; z-index: 1; }
    main { background: rgba(255,255,255,.48); }
    .hero { background: linear-gradient(135deg,rgba(242,250,245,.76),rgba(250,255,248,.68) 48%,rgba(238,247,242,.76)) !important; }
    .soft-section { background: rgba(246,248,242,.88) !important; }
    .dark-section, .nav-wrap { isolation: isolate; }
    footer { background: rgba(243,246,242,.92) !important; }
    .neat-attribution {
      display: block;
      width: max-content;
      margin: 20px auto 0;
      color: #58737d;
      font-size: 9px;
      opacity: .72;
    }
    @media (max-width: 700px) {
      .neat-aurora { opacity: .20; }
      main { background: rgba(255,255,255,.68); }
    }
    @media (prefers-reduced-motion: reduce) {
      .neat-aurora { opacity: .18; }
    }
  `;
  document.head.append(style);
}

function createAuroraCanvas() {
  if (document.querySelector('.neat-aurora')) return null;
  const canvas = document.createElement('canvas');
  canvas.className = 'neat-aurora';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.tabIndex = -1;
  document.body.prepend(canvas);
  document.documentElement.classList.add('aurora-ready');
  return canvas;
}

function addAttribution() {
  const footer = document.querySelector('footer');
  if (!footer || footer.querySelector('.neat-attribution')) return;
  const link = document.createElement('a');
  link.className = 'neat-attribution';
  link.href = 'https://neat.firecms.co/';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = 'Fondo animado con NEAT';
  footer.append(link);
}

async function startAurora() {
  installAuroraStyles();
  const canvas = createAuroraCanvas();
  if (!canvas) return;
  addAttribution();

  if (REDUCED_MOTION.matches) {
    document.documentElement.classList.add('aurora-static');
    return;
  }

  try {
    const { NeatGradient } = await import('https://cdn.jsdelivr.net/npm/@firecms/neat@1.0.2/+esm');
    const mobile = MOBILE.matches;
    const gradient = new NeatGradient({
      ref: canvas,
      colors: [
        { color: '#F8FCFB', enabled: true, influence: 1 },
        { color: '#C5E3DE', enabled: true, influence: 0.72 },
        { color: '#8DDDD2', enabled: true, influence: 0.48 },
        { color: '#BDEBC9', enabled: true, influence: 0.58 },
        { color: '#13A797', enabled: true, influence: 0.16 },
      ],
      backgroundColor: '#F8FCFB',
      backgroundAlpha: 1,
      speed: mobile ? 0.28 : 0.55,
      waveAmplitude: mobile ? 0.65 : 1.15,
      waveFrequencyX: 1.4,
      waveFrequencyY: 1.1,
      colorBlending: 8,
      colorBrightness: 1.05,
      colorSaturation: -2,
      horizontalPressure: 2.8,
      verticalPressure: 2.2,
      shadows: 0,
      highlights: 1,
      grainIntensity: 0,
      vignetteIntensity: 0,
      bloomIntensity: 0,
      chromaticAberration: 0,
      cameraLock: true,
      flowEnabled: true,
      flowDistortionA: 0.12,
      flowDistortionB: 0.08,
      flowScale: 0.7,
      flowEase: 0.65,
      resolution: mobile ? 0.42 : 0.68,
      yOffsetWaveMultiplier: 0.35,
      yOffsetColorMultiplier: 0.25,
      yOffsetFlowMultiplier: 0.25,
    });

    document.addEventListener('visibilitychange', () => {
      canvas.style.visibility = document.hidden ? 'hidden' : 'visible';
    });
    window.addEventListener('pagehide', () => gradient.destroy(), { once: true });
  } catch (error) {
    document.documentElement.classList.add('aurora-static');
    console.info('Aurora clínica en modo estático.', error);
  }
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', startAurora, { once: true })
  : startAurora();
