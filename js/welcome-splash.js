(() => {
  'use strict';

  if (window.__vfWelcomeBoot) return;
  window.__vfWelcomeBoot = true;

  const KEY = 'vishfind:welcome:seen:v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HOLD = 'linear';
  const SOFT = 'cubic-bezier(0.42, 0, 0.2, 1)';

  function reduced() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function replayRequested() {
    try {
      return new URLSearchParams(window.location.search).get('welcome') === 'replay';
    } catch (_) {
      return false;
    }
  }

  function seen() {
    try {
      if (replayRequested()) {
        sessionStorage.removeItem(KEY);
        return false;
      }
      return sessionStorage.getItem(KEY) === '1';
    } catch (_) {
      return true;
    }
  }

  function markSeen() {
    try {
      sessionStorage.setItem(KEY, '1');
    } catch (_) {
      /* storage unavailable */
    }
  }

  function clearReplayParam() {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('welcome') !== 'replay') return;
      url.searchParams.delete('welcome');
      const next = url.pathname + (url.search || '') + url.hash;
      window.history.replaceState(null, '', next);
    } catch (_) {
      /* ignore */
    }
  }

  function releasePage(overlay) {
    const root = document.documentElement;
    root.classList.remove('is-intro', 'is-intro-lock', 'is-intro-reveal', 'vf-boot');
    root.classList.add('is-intro-done');
    root.style.backgroundColor = '';
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        if (attrs[key] != null) node.setAttribute(key, String(attrs[key]));
      });
    }
    return node;
  }

  function track(anims, animation) {
    if (animation) anims.push(animation);
    return animation;
  }

  function playKeys(target, duration, keys, apply, easingFor) {
    if (!keys.length || !target.animate) return null;
    const frames = keys.map((key, index) => {
      const frame = { offset: Math.max(0, Math.min(1, key[0] / duration)) };
      apply(frame, key[1]);
      if (index > 0) frame.easing = easingFor(keys[index - 1], key);
      return frame;
    });
    const last = keys[keys.length - 1];
    if (last[0] < duration - 1) {
      const hold = { offset: 1, easing: HOLD };
      apply(hold, last[1]);
      frames[frames.length - 1].easing = HOLD;
      frames.push(hold);
    }
    return target.animate(frames, { duration, fill: 'forwards', easing: HOLD });
  }

  function pathSegments(d) {
    const cmds = d.match(/[MLC][^MLC]*/g) || [];
    const segs = [];
    let cur = null;
    cmds.forEach((cmd) => {
      const nums = cmd.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const pts = [];
      for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      if (cmd[0] === 'M') {
        cur = pts[0];
      } else if (cmd[0] === 'C' && pts.length === 3) {
        segs.push({ a: cur, c1: pts[0], c2: pts[1], b: pts[2] });
        cur = pts[2];
      } else if (cmd[0] === 'L' && pts.length === 1) {
        segs.push({ a: cur, line: true, b: pts[0] });
        cur = pts[0];
      }
    });
    return segs;
  }

  function fmt(v) {
    return String(Math.round(v * 100) / 100);
  }

  function segmentsToPath(segs) {
    if (!segs.length) return '';
    let d = 'M' + fmt(segs[0].a[0]) + ' ' + fmt(segs[0].a[1]);
    segs.forEach((seg) => {
      if (seg.line) d += 'L' + fmt(seg.b[0]) + ' ' + fmt(seg.b[1]);
      else d += 'C' + fmt(seg.c1[0]) + ' ' + fmt(seg.c1[1]) + ' ' + fmt(seg.c2[0]) + ' ' + fmt(seg.c2[1]) + ' ' + fmt(seg.b[0]) + ' ' + fmt(seg.b[1]);
    });
    return d;
  }

  function reverseSegments(segs) {
    return segs.slice().reverse().map((seg) => {
      if (seg.line) return { a: seg.b, line: true, b: seg.a };
      return { a: seg.b, c1: seg.c2, c2: seg.c1, b: seg.a };
    });
  }

  function joinDownThenUp(down, up) {
    const downSegs = pathSegments(down.d);
    const rawUp = pathSegments(up.d);
    const end = downSegs[downSegs.length - 1].b;
    const dist = (pt) => Math.hypot(end[0] - pt[0], end[1] - pt[1]);
    const upSegs = dist(rawUp[rawUp.length - 1].b) < dist(rawUp[0].a) ? reverseSegments(rawUp) : rawUp;
    const start = upSegs[0].a;
    const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const segs = downSegs.slice();
    if (gap > 0.4) segs.push({ a: end, line: true, b: start });
    upSegs.forEach((seg) => {
      segs.push(gap > 0.4 ? seg : Object.assign({}, seg, { a: segs[segs.length - 1].b }));
    });
    return {
      id: down.id.replace(/-short$|-left$/, ''),
      d: segmentsToPath(segs),
      width: Math.max(down.width, up.width),
      from: 1,
      to: 0,
      t0: 0,
      t1: 1,
      ease: 'linear',
    };
  }

  function strokesFor(group) {
    const byId = {};
    group.strokes.forEach((stroke) => { byId[stroke.id] = stroke; });
    if (byId['draw-check-short'] && byId['draw-check-long']) {
      return [joinDownThenUp(byId['draw-check-short'], byId['draw-check-long'])];
    }
    if (byId['draw-V-left'] && byId['draw-V-right']) {
      return [joinDownThenUp(byId['draw-V-left'], byId['draw-V-right'])];
    }
    return group.strokes;
  }

  function build(scene) {
    const svg = svgEl('svg', {
      class: 'welcome-splash__svg',
      viewBox: '0 0 ' + scene.viewBox[0] + ' ' + scene.viewBox[1],
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': scene.welcome.title.text,
      focusable: 'false',
    });

    const stage = svgEl('g', { id: 'vf-w-intro' });
    const logo = svgEl('g', {
      id: 'vf-w-logo',
      transform: 'translate(' + scene.logo[0] + ' ' + scene.logo[1] + ')',
    });
    const defs = svgEl('defs');
    logo.appendChild(defs);

    scene.masks.forEach((group) => {
      const maskId = 'vf-w-mask-' + group.id;
      const mask = svgEl('mask', {
        id: maskId,
        maskUnits: 'userSpaceOnUse',
        maskContentUnits: 'userSpaceOnUse',
        x: '-160',
        y: '-160',
        width: '1500',
        height: '1000',
      });
      strokesFor(group).forEach((stroke) => {
        const path = svgEl('path', {
          id: 'vf-w-' + stroke.id,
          d: stroke.d,
          fill: 'none',
          stroke: '#fff',
          'stroke-width': stroke.width,
          'stroke-linecap': 'butt',
          'stroke-linejoin': 'miter',
          'stroke-dasharray': '0 1',
          'stroke-dashoffset': '0',
          'data-t0': stroke.t0,
          'data-t1': stroke.t1,
          'data-from': stroke.from,
          'data-to': stroke.to,
          'data-ease': stroke.ease,
        });
        mask.appendChild(path);
      });
      group.holes.forEach((hole) => {
        mask.appendChild(svgEl('path', {
          id: 'vf-w-' + hole.id,
          d: hole.d,
          fill: '#000',
          stroke: 'none',
        }));
      });
      defs.appendChild(mask);

      const painted = svgEl('g', { id: 'vf-w-' + group.id, mask: 'url(#' + maskId + ')' });
      group.fills.forEach((fill) => {
        painted.appendChild(svgEl('path', {
          id: 'vf-w-' + fill.id,
          d: fill.d,
          class: fill.role === 'accent' ? 'vf-accent' : 'vf-neutral',
        }));
      });
      logo.appendChild(painted);
    });
    stage.appendChild(logo);

    const dots = svgEl('g', { id: 'vf-w-loading-dots' });
    scene.dots.forEach((dot) => {
      const node = svgEl('circle', {
        id: 'vf-w-' + dot.id,
        cx: dot.cx,
        cy: dot.cy,
        r: dot.r,
        class: 'vf-accent',
        opacity: '0',
      });
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin = 'center';
      dots.appendChild(node);
    });
    stage.appendChild(dots);

    svg.appendChild(stage);
    return svg;
  }

  const DRAW_MS = 1937.5;
  const SHIFT_MS = 162.5;
  const TOTAL_MS = 4137.5;
  const GREET_IN = 2137.5;
  const GREET_ON = 2437.5;
  const FADE_AT = 3537.5;
  // Fast phase 0.9375s to 89%. Slow phase stays 1.00s.
  function drawProgress(u) {
    const fastEnd = 0.9375 / 1.9375;
    const accelEnd = 0.21875 / 1.9375;
    const pFast = 0.89;
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < fastEnd) {
      const speed = pFast / (fastEnd - accelEnd / 2);
      if (u < accelEnd) return speed * u * u / (2 * accelEnd);
      return speed * (accelEnd / 2 + (u - accelEnd));
    }
    const s = (u - fastEnd) / (1 - fastEnd);
    return pFast + (1 - pFast) * (1 - Math.pow(1 - s, 1.2));
  }

  function placeBrand(logo, dots, copy, scene) {
    const box = logo.getBBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const tx = scene.logo[0];
    const ty = scene.logo[1];
    logo.setAttribute('transform',
      'translate(' + tx + ' ' + ty + ') translate(' + cx + ' ' + cy + ') scale(0.5) translate(' + (-cx) + ' ' + (-cy) + ')');
    const rise = box.height / 4;
    const viewH = scene.viewBox[1];
    const bottom = ty + box.y + box.height * 0.75;
    const currentTop = (73.5 / 100) * viewH - rise;
    const gap = Math.max(0, currentTop - bottom);
    const nextTop = bottom + gap * 0.72;
    copy.style.top = (nextTop / viewH * 100) + '%';
    dots.setAttribute('transform', 'translate(0 ' + (-(rise + (currentTop - nextTop))) + ')');
    return { width: box.width, height: box.height, rise: rise, gap: gap, nextGap: gap * 0.72 };
  }

  function concealStrokes(svg) {
    svg.querySelectorAll('mask path[data-from]').forEach((path) => {
      const length = path.getTotalLength();
      if (!(length > 0)) throw new Error('stroke length');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('stroke-dasharray', length + ' ' + length);
      path.setAttribute('stroke-dashoffset', String(length));
      path.dataset.length = String(length);
    });
  }

  const LETTER_ORDER = {
    'letter-i-vish': ['draw-i-vish-stem', 'draw-i-vish-dot'],
    'letter-h': ['draw-h-stem', 'draw-h-arch'],
    'letter-F': ['draw-F-stem', 'draw-F-top', 'draw-F-mid'],
    'letter-i-find': ['draw-i-find-stem', 'draw-i-find-dot'],
    'letter-n': ['draw-n-stem', 'draw-n-arch'],
    'letter-d': ['draw-d-bowl', 'draw-d-stem'],
  };

  function sequenceLetters(svg) {
    const byMask = new Map();
    svg.querySelectorAll('mask path[data-length]').forEach((path) => {
      const mask = path.parentNode;
      if (!byMask.has(mask)) byMask.set(mask, []);
      byMask.get(mask).push(path);
    });
    byMask.forEach((paths) => {
      const maskId = paths[0].parentNode.id.replace('vf-w-mask-', '');
      const order = LETTER_ORDER[maskId];
      paths.forEach((path) => {
        path.dataset.a = '0';
        path.dataset.b = '1';
      });
      if (!order) return;
      const sorted = order.map((id) => paths.find((path) => path.id === 'vf-w-' + id)).filter(Boolean);
      const total = sorted.reduce((sum, path) => sum + Number(path.dataset.length), 0);
      let cursor = 0;
      sorted.forEach((path) => {
        const span = Number(path.dataset.length) / total;
        path.dataset.a = String(cursor);
        cursor += span;
        path.dataset.b = String(cursor);
      });
    });
  }

  function playStroke(path) {
    const length = Number(path.dataset.length);
    const a = Number(path.dataset.a);
    const b = Number(path.dataset.b);
    const frames = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const progress = drawProgress(u);
      let local = (progress - a) / (b - a);
      if (local < 0) local = 0;
      if (local > 1) local = 1;
      frames.push({ strokeDashoffset: length * (1 - local), offset: u, easing: 'linear' });
    }
    return path.animate(frames, { duration: DRAW_MS, fill: 'forwards', easing: 'linear' });
  }

  function shiftKeys(keys) {
    const out = [];
    keys.forEach(([time, value]) => {
      const next = Math.max(0, time - SHIFT_MS);
      if (out.length && out[out.length - 1][0] === next) out[out.length - 1][1] = value;
      else out.push([next, value]);
    });
    return out;
  }

  function startMotion(svg, scene, frame, anims) {
    const duration = TOTAL_MS;
    const fade = (prev, next) => (prev[1] === next[1] ? HOLD : SOFT);
    svg.querySelectorAll('mask path[data-from]').forEach((path) => {
      track(anims, playStroke(path));
    });
    scene.dots.forEach((dot) => {
      const node = svg.getElementById('vf-w-' + dot.id);
      track(anims, playKeys(node, duration, shiftKeys(dot.opacity), (item, value) => {
        item.opacity = value;
      }, fade));
      track(anims, playKeys(node, duration, shiftKeys(dot.scale), (item, value) => {
        item.transform = 'scale(' + value + ')';
      }, fade));
    });
    const copy = frame.querySelector('.welcome-splash__copy');
    if (copy) {
      track(anims, copy.animate([
        { opacity: 0, transform: 'translateY(0) scale(0.985)', offset: 0, easing: HOLD },
        { opacity: 0, transform: 'translateY(0) scale(0.985)', offset: GREET_IN / duration, easing: 'cubic-bezier(0.22, 0.6, 0.2, 1)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: GREET_ON / duration, easing: HOLD },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 1 },
      ], { duration, fill: 'forwards', easing: HOLD }));
    }
    track(anims, frame.animate([
      { opacity: 1, offset: 0, easing: HOLD },
      { opacity: 1, offset: FADE_AT / duration, easing: 'cubic-bezier(0.33, 0, 0.2, 1)' },
      { opacity: 0, offset: 1 },
    ], { duration, fill: 'forwards', easing: HOLD }));
    track(anims, frame.animate([
      { filter: 'blur(0px)' },
      { filter: 'blur(5px)' },
    ], { duration: 600, delay: FADE_AT, fill: 'forwards', easing: 'cubic-bezier(0.33, 0, 0.2, 1)' }));
  }

  function boot() {
    const root = document.documentElement;
    if (reduced()) {
      markSeen();
      releasePage(null);
      return;
    }
    if (seen()) {
      releasePage(null);
      return;
    }

    const anims = [];
    const timers = [];
    let overlay = null;
    let closed = false;

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      timers.forEach((id) => window.clearTimeout(id));
      anims.forEach((animation) => {
        try {
          animation.cancel();
        } catch (_) {
          /* already finished */
        }
      });
      window.removeEventListener('keydown', onKey);
      markSeen();
      clearReplayParam();
      releasePage(overlay);
    }

    try {
      const scene = window.VF_WELCOME_SCENE;
      if (!scene || scene.duration !== 4300 || !scene.masks || !scene.masks.length) {
        throw new Error('welcome scene missing');
      }
      if (document.fonts && document.fonts.load) {
        document.fonts.load('700 28px Manrope').catch(() => {});
        document.fonts.load('400 18px Manrope').catch(() => {});
      }
      overlay = document.createElement('div');
      overlay.className = 'welcome-splash';
      overlay.style.backgroundColor = root.getAttribute('data-theme') === 'dark' ? '#101110' : '#f7fff9';
      const frame = document.createElement('div');
      frame.className = 'welcome-splash__stage';
      const svg = build(scene);
      const copy = document.createElement('div');
      copy.className = 'welcome-splash__copy';
      const title = document.createElement('p');
      title.className = 'welcome-splash__title';
      title.textContent = scene.welcome.title.text;
      const subtitle = document.createElement('p');
      subtitle.className = 'welcome-splash__sub';
      subtitle.textContent = scene.welcome.subtitle.text;
      copy.appendChild(title);
      copy.appendChild(subtitle);
      frame.appendChild(svg);
      frame.appendChild(copy);
      overlay.appendChild(frame);
      document.body.appendChild(overlay);
      placeBrand(svg.getElementById('vf-w-logo'), svg.getElementById('vf-w-loading-dots'), copy, scene);
      concealStrokes(svg);
      sequenceLetters(svg);
      overlay.classList.add('is-ready');
      window.addEventListener('keydown', onKey);
      timers.push(window.setTimeout(close, 5600));
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (closed) return;
          try {
            startMotion(svg, scene, frame, anims);
            timers.push(window.setTimeout(() => {
              root.classList.add('is-intro-reveal');
            }, FADE_AT));
            timers.push(window.setTimeout(close, TOTAL_MS + 30));
          } catch (_) {
            close();
          }
        });
      });
    } catch (_) {
      close();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
