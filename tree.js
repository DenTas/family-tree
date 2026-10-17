'use strict';

/* =========================================================================
 * Vue « arbre » interactive : l'entourage d'une personne, centré sur elle.
 *
 * - Niveau n : toutes les personnes à n liens ou moins de la personne centrale
 *   (un lien = parent, enfant, conjoint ou frère/sœur). Niveau 1 = conjoints,
 *   parents, frères et sœurs, enfants ; niveau 2 = grands-parents, oncles, etc.
 * - Modes « ancêtres » et « descendants » : le niveau compte les générations.
 * - On déplace au doigt, on zoome à deux doigts (ou molette) ; toucher une
 *   personne la centre (animation), la toucher à nouveau ouvre sa fiche.
 * ========================================================================= */

function createTreeView(viewport, opts) {
  const CARD_W = 150;
  const GAP_X = 22; // entre deux familles
  const GAP_SPOUSE = 14; // entre conjoints
  const ROW_GAP = 64; // entre deux générations
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 2.5;

  const world = document.createElement('div');
  world.className = 'tree-world';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tree-links');
  world.appendChild(svg);
  viewport.appendChild(world);

  const cards = new Map(); // id -> élément de la carte (réutilisé pour animer les déplacements)
  let focusId = '';
  let layout = { nodes: new Map(), cardH: 0 };
  // Zoom de départ : un peu plus petit sur téléphone pour voir plusieurs cartes.
  const defaultScale = () => (viewport.clientWidth < 500 ? 0.8 : 1);
  let view = { x: 0, y: 0, k: defaultScale() };

  /* ----------------------------- Entourage ------------------------------ */

  function neighborhood(people, byId, depth, mode) {
    const kids = new Map();
    for (const p of people) {
      for (const pid of [p.fatherId, p.motherId]) {
        if (pid && byId.has(pid)) (kids.get(pid) || kids.set(pid, []).get(pid)).push(p.id);
      }
    }
    for (const list of kids.values()) {
      list.sort((a, b) => (byId.get(a).birthDate || '9999').localeCompare(byId.get(b).birthDate || '9999'));
    }
    const parents = (p) => [p.fatherId, p.motherId].filter((id) => id && byId.has(id));
    const spouses = (p) => p.spouseIds.filter((id) => byId.has(id));
    const siblings = (p) => {
      const out = [];
      for (const pid of parents(p)) for (const c of kids.get(pid) || []) if (c !== p.id && !out.includes(c)) out.push(c);
      return out;
    };

    // Parcours en largeur : distance (niveau) et génération relative de chaque personne.
    const info = new Map([[focusId, { gen: 0, dist: 0, order: 0 }]]);
    const queue = [focusId];
    let order = 1;
    const add = (id, gen, dist, leaf) => {
      if (info.has(id) || dist > depth) return;
      info.set(id, { gen, dist, order: order++ });
      if (!leaf) queue.push(id);
    };
    while (queue.length) {
      const id = queue.shift();
      const p = byId.get(id);
      const { gen, dist } = info.get(id);
      if (mode === 'all') {
        for (const x of spouses(p)) add(x, gen, dist + 1);
        for (const x of parents(p)) add(x, gen - 1, dist + 1);
        for (const x of siblings(p)) add(x, gen, dist + 1);
        for (const x of kids.get(id) || []) add(x, gen + 1, dist + 1);
      } else if (mode === 'anc') {
        for (const x of parents(p)) add(x, gen - 1, dist + 1);
      } else {
        // Descendants, avec les conjoints (sans compter de niveau, sans suivre leurs propres liens).
        for (const x of spouses(p)) add(x, gen, dist, true);
        for (const x of kids.get(id) || []) add(x, gen + 1, dist + 1);
      }
    }
    return { info, parents, spouses };
  }

  /* ------------------------------ Placement ------------------------------ */

  function computeLayout(people, depth, mode, cardH) {
    const byId = new Map(people.map((p) => [p.id, p]));
    if (!byId.has(focusId)) return { nodes: new Map(), cardH, links: [] };
    const { info, parents, spouses } = neighborhood(people, byId, depth, mode);

    // Une ligne par génération ; dans chaque ligne, les couples forment des « blocs ».
    const rows = new Map();
    const nodes = new Map();
    for (const [id, inf] of info) {
      nodes.set(id, { id, p: byId.get(id), gen: inf.gen, order: inf.order, x: 0 });
      if (!rows.has(inf.gen)) rows.set(inf.gen, []);
    }
    const shown = (id) => nodes.has(id);
    const sameRowSpouses = (n) => spouses(n.p).filter((s) => shown(s) && nodes.get(s).gen === n.gen);

    const seen = new Set();
    for (const n of [...nodes.values()].sort((a, b) => a.order - b.order)) {
      if (seen.has(n.id)) continue;
      // Composante « conjoints » : on la parcourt en chaîne pour garder les couples côte à côte.
      const comp = [];
      const stack = [n.id];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        comp.push(id);
        for (const s of sameRowSpouses(nodes.get(id))) stack.push(s);
      }
      const degree = (id) => sameRowSpouses(nodes.get(id)).filter((s) => comp.includes(s)).length;
      let start = comp.find((id) => degree(id) === 1) || comp[0];
      const chain = [];
      const used = new Set();
      while (start && !used.has(start)) {
        chain.push(start);
        used.add(start);
        start = sameRowSpouses(nodes.get(start)).find((s) => comp.includes(s) && !used.has(s));
      }
      for (const id of comp) if (!used.has(id)) chain.push(id);
      const unit = { members: chain.map((id) => nodes.get(id)), x: 0 };
      unit.w = chain.length * CARD_W + (chain.length - 1) * GAP_SPOUSE;
      unit.members.forEach((m) => (m.unit = unit));
      rows.get(n.gen).push(unit);
    }

    const gens = [...rows.keys()].sort((a, b) => a - b);
    const center = (u) => u.x + u.w / 2;
    const setMembers = (u) => u.members.forEach((m, i) => (m.x = u.x + i * (CARD_W + GAP_SPOUSE) + CARD_W / 2));
    const parentCenter = (n) => {
      const ps = parents(n.p).filter((id) => shown(id) && nodes.get(id).gen === n.gen - 1);
      return ps.length ? ps.reduce((s, id) => s + nodes.get(id).x, 0) / ps.length : null;
    };
    const childCenters = (n) =>
      [...nodes.values()].filter((c) => c.gen === n.gen + 1 && parents(c.p).includes(n.id)).map((c) => c.x);

    // Répartit les blocs d'une ligne au plus près de leur position souhaitée, sans chevauchement
    // (on regroupe les blocs qui se gênent et on centre chaque groupe sur la moyenne des souhaits).
    function pack(units) {
      const clusters = [];
      for (const u of units) {
        clusters.push({ units: [u], offs: [0], w: u.w, sum: u.want, n: 1, left: u.want });
        while (clusters.length > 1) {
          const a = clusters[clusters.length - 2];
          const b = clusters[clusters.length - 1];
          if (a.left + a.w + GAP_X <= b.left) break;
          const off = a.w + GAP_X;
          b.units.forEach((x, i) => { a.units.push(x); a.offs.push(off + b.offs[i]); });
          a.sum += b.sum - off * b.n;
          a.n += b.n;
          a.w = off + b.w;
          a.left = a.sum / a.n;
          clusters.pop();
        }
      }
      for (const c of clusters) c.units.forEach((u, i) => { u.x = c.left + c.offs[i]; setMembers(u); });
    }

    function placeRow(g, refs) {
      const units = rows.get(g);
      for (const u of units) {
        // Le membre qui a des parents affichés se place du côté de ses parents.
        if (u.members.length > 1 && refs !== 'children') {
          const first = parentCenter(u.members[0]);
          const last = parentCenter(u.members[u.members.length - 1]);
          if (first !== null && last !== null ? first > last : first !== null ? first > center(u) : last !== null && last < center(u)) {
            u.members.reverse();
            setMembers(u);
          }
        }
        const wanted = [];
        for (const m of u.members) {
          if (refs !== 'children') { const pc = parentCenter(m); if (pc !== null) wanted.push(pc); }
          if (refs !== 'parents') { const cc = childCenters(m); if (cc.length) wanted.push(cc.reduce((a, b) => a + b) / cc.length); }
        }
        u.desired = wanted.length ? wanted.reduce((a, b) => a + b) / wanted.length : center(u);
      }
      units.sort((a, b) => a.desired - b.desired);
      units.forEach((u) => (u.want = u.desired - u.w / 2));
      pack(units);
    }

    for (const g of gens) { rows.get(g).forEach((u) => (u.want = 0)); pack(rows.get(g)); }
    for (let i = 0; i < 6; i++) {
      for (const g of gens.slice(1)) placeRow(g, 'parents');
      for (const g of gens.slice(0, -1).reverse()) placeRow(g, 'children');
    }
    for (const g of gens) placeRow(g, 'both');

    // La personne centrale en (0, 0).
    const fx = nodes.get(focusId).x;
    const rowH = cardH + ROW_GAP;
    for (const n of nodes.values()) { n.x -= fx; n.y = n.gen * rowH; }

    // Traits : conjoints (horizontal) et parents → enfants (en « peigne »).
    const links = [];
    const done = new Set();
    for (const n of nodes.values()) {
      for (const s of sameRowSpouses(n)) {
        const key = [n.id, s].sort().join('|');
        if (done.has(key)) continue;
        done.add(key);
        const m = nodes.get(s);
        const [a, b] = n.x < m.x ? [n, m] : [m, n];
        links.push({ d: `M${a.x + CARD_W / 2},${a.y + cardH / 2}H${b.x - CARD_W / 2}`, cls: 'spouse' });
      }
    }
    const families = new Map();
    for (const c of nodes.values()) {
      const ps = parents(c.p).filter((id) => shown(id) && nodes.get(id).gen === c.gen - 1);
      if (!ps.length) continue;
      const key = ps.sort().join('|');
      if (!families.has(key)) families.set(key, { ps: ps.map((id) => nodes.get(id)), kids: [] });
      families.get(key).kids.push(c);
    }
    const perRow = new Map();
    for (const f of families.values()) {
      const [a, b] = f.ps;
      const couple = b && a.unit === b.unit;
      const top = couple ? a.y + cardH / 2 : a.y + cardH;
      const jx = couple ? (a.x + b.x) / 2 : f.ps.reduce((s, p) => s + p.x, 0) / f.ps.length;
      const childTop = f.kids[0].y;
      const k = perRow.get(childTop) || 0;
      perRow.set(childTop, k + 1);
      const busY = childTop - ROW_GAP / 2 + ((k % 3) - 1) * 12;
      const xs = f.kids.map((c) => c.x);
      let d = `M${jx},${top}V${busY}M${Math.min(jx, ...xs)},${busY}H${Math.max(jx, ...xs)}`;
      for (const x of xs) d += `M${x},${busY}V${childTop}`;
      links.push({ d, cls: 'child' });
    }
    return { nodes, cardH, links };
  }

  /* -------------------------------- Rendu -------------------------------- */

  function render() {
    const people = opts.people();
    const fields = opts.fields();
    const cardH = 16 + (fields.has('photo') ? 52 : 0) + 36 + ['years', 'birth', 'place', 'deathPlace', 'age'].filter((f) => fields.has(f)).length * 17;
    layout = computeLayout(people, opts.depth(), opts.mode(), cardH);
    world.style.setProperty('--card-w', `${CARD_W}px`);
    world.style.setProperty('--card-h', `${cardH}px`);

    const origin = { x: 0, y: 0 }; // les nouvelles cartes partent de la personne centrale
    for (const [id, el] of cards) {
      if (layout.nodes.has(id)) continue;
      el.classList.add('leaving');
      cards.delete(id);
      setTimeout(() => el.remove(), 400);
    }
    for (const n of layout.nodes.values()) {
      let el = cards.get(n.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'tree-card entering';
        el.dataset.treeId = n.id;
        el.style.transform = `translate(${origin.x - CARD_W / 2}px, ${origin.y}px)`;
        world.appendChild(el);
        cards.set(n.id, el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('entering')));
      }
      el.className = `tree-card ${n.p.sex}${n.id === focusId ? ' focus' : ''}${el.classList.contains('entering') ? ' entering' : ''}`;
      el.innerHTML = opts.cardHtml(n.p, fields);
      el.title = opts.title(n.p);
      // Double requestAnimationFrame : la carte apparaît d'abord à l'origine puis glisse à sa place.
      requestAnimationFrame(() => (el.style.transform = `translate(${n.x - CARD_W / 2}px, ${n.y}px)`));
    }
    svg.innerHTML = layout.links.map((l) => `<path class="${l.cls}" d="${l.d}"/>`).join('');
    opts.afterRender?.(world);
  }

  /* --------------------------- Déplacement / zoom --------------------------- */

  function apply(animate) {
    world.classList.toggle('animate', !!animate);
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }

  function centerOnFocus(animate = true) {
    const r = viewport.getBoundingClientRect();
    view.x = r.width / 2;
    view.y = r.height / 2 - (layout.cardH / 2) * view.k;
    apply(animate);
  }

  function fit() {
    const ns = [...layout.nodes.values()];
    if (!ns.length) return;
    const r = viewport.getBoundingClientRect();
    const minX = Math.min(...ns.map((n) => n.x)) - CARD_W / 2 - 20;
    const maxX = Math.max(...ns.map((n) => n.x)) + CARD_W / 2 + 20;
    const minY = Math.min(...ns.map((n) => n.y)) - 20;
    const maxY = Math.max(...ns.map((n) => n.y)) + layout.cardH + 20;
    view.k = Math.max(MIN_SCALE, Math.min(1.2, r.width / (maxX - minX), r.height / (maxY - minY)));
    view.x = r.width / 2 - ((minX + maxX) / 2) * view.k;
    view.y = r.height / 2 - ((minY + maxY) / 2) * view.k;
    apply(true);
  }

  function zoomAt(factor, cx, cy, animate) {
    const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, view.k * factor));
    view.x = cx - ((cx - view.x) * k) / view.k;
    view.y = cy - ((cy - view.y) * k) / view.k;
    view.k = k;
    apply(animate);
  }

  function zoom(factor) {
    const r = viewport.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2, true);
  }

  const pointers = new Map();
  let gesture = null;
  let moved = false;

  viewport.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) moved = false;
    startGesture();
  });
  window.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const r = viewport.getBoundingClientRect();
    if (pts.length === 1) {
      const dx = pts[0].x - gesture.x;
      const dy = pts[0].y - gesture.y;
      if (Math.hypot(dx, dy) > 6) moved = true;
      if (!moved) return;
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      apply(false);
    } else if (pts.length >= 2) {
      moved = true;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mx = (pts[0].x + pts[1].x) / 2 - r.left;
      const my = (pts[0].y + pts[1].y) / 2 - r.top;
      const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, gesture.vk * (dist / gesture.dist)));
      // Le point du monde sous les doigts au départ reste sous les doigts.
      view.x = mx - ((gesture.mx - gesture.vx) * k) / gesture.vk;
      view.y = my - ((gesture.my - gesture.vy) * k) / gesture.vk;
      view.k = k;
      apply(false);
    }
  });
  const end = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size) startGesture();
  };
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);

  function startGesture() {
    const pts = [...pointers.values()];
    const r = viewport.getBoundingClientRect();
    gesture = { x: pts[0].x, y: pts[0].y, vx: view.x, vy: view.y, vk: view.k };
    if (pts.length >= 2) {
      gesture.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      gesture.mx = (pts[0].x + pts[1].x) / 2 - r.left;
      gesture.my = (pts[0].y + pts[1].y) / 2 - r.top;
    }
  }

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top, false);
  }, { passive: false });

  viewport.addEventListener('click', (e) => {
    const card = e.target.closest('.tree-card');
    if (!card || moved) return;
    const id = card.dataset.treeId;
    if (id === focusId) opts.onOpen(id);
    else opts.onFocus(id);
  });

  return {
    /** Change la personne centrale (re-calcul + animation vers le centre). */
    show(id, { recenter = true } = {}) {
      const changed = id !== focusId;
      focusId = id;
      render();
      if (recenter || changed) centerOnFocus(changed || recenter);
    },
    refresh() { render(); },
    zoom,
    fit,
    center: () => { view.k = defaultScale(); centerOnFocus(true); },
    get focusId() { return focusId; },
    get count() { return layout.nodes.size; },
  };
}
