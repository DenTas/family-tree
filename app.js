'use strict';

/* =========================================================================
 * Arbre familial — application web mobile, sans dépendance ni serveur.
 *
 * Modèle de données (une personne) :
 *   { id, firstName, middleNames, lastName, sex: 'M'|'F'|'U',
 *     birthDate, birthPlace, deathDate, deathPlace,   // dates : 'AAAA', 'AAAA-MM' ou 'AAAA-MM-JJ'
 *     fatherId, motherId, spouseIds: [], notes }
 *
 * Les frères/sœurs et les enfants ne sont pas stockés : ils sont déduits
 * des liens père/mère. Les conjoints sont toujours enregistrés des deux côtés.
 * ========================================================================= */

const STORAGE_KEY = 'arbre-familial:v1';
const FORMAT_VERSION = 1;
const CONFIG = window.APP_CONFIG || {};
const SHARED = Boolean(CONFIG.firebase);

/* ----------------------------- Stockage -------------------------------- */
// Mode local : localStorage. Mode partagé : Firestore (voir cloud.js), qui garde aussi
// une copie locale pour fonctionner hors connexion.

const PHOTO_KEY = 'arbre-familial:photos';
let people = SHARED ? [] : load();
let localPhotos = SHARED ? {} : loadJson(PHOTO_KEY, {}); // mode local : { idPhoto: image en data URL }
let cloud = null; // module cloud.js en mode partagé
let account = null; // utilisateur connecté (mode partagé)
let role = SHARED ? null : 'admin'; // en mode local, on a tous les droits
const canEdit = () => role === 'editor' || role === 'admin';

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return Array.isArray(data?.people) ? data.people.map(normalize) : [];
  } catch {
    return [];
  }
}

function save() {
  if (SHARED) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, people }));
    // On ne garde que les photos encore utilisées.
    const used = new Set(people.map((p) => p.photo).filter(Boolean));
    for (const id of Object.keys(localPhotos)) if (!used.has(id)) delete localPhotos[id];
    localStorage.setItem(PHOTO_KEY, JSON.stringify(localPhotos));
  } catch {
    toast('Impossible d’enregistrer : le stockage du téléphone est plein ou indisponible.');
  }
}

function normalize(p) {
  return {
    id: String(p.id || newId()),
    firstName: String(p.firstName || '').trim(),
    lastName: String(p.lastName || '').trim(),
    middleNames: String(p.middleNames || '').trim(), // autres prénoms (ex. « Pierre Daniel »)
    sex: ['M', 'F'].includes(p.sex) ? p.sex : 'U',
    birthDate: p.birthDate || '',
    birthPlace: String(p.birthPlace || '').trim(),
    deathPlace: String(p.deathPlace || '').trim(),
    deathDate: p.deathDate || '',
    fatherId: p.fatherId || '',
    motherId: p.motherId || '',
    spouseIds: Array.isArray(p.spouseIds) ? [...new Set(p.spouseIds.map(String))] : [],
    notes: String(p.notes || ''),
    photo: String(p.photo || ''), // identifiant de la photo ('' = pas de photo)
  };
}

function newId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const byId = (id) => people.find((p) => p.id === id);

/**
 * Applique une modification puis l'enregistre. `apply` modifie le tableau `people` ;
 * on compare avant/après pour savoir quelles fiches ont changé. En mode partagé,
 * ces changements partent dans Firestore avec une entrée d'historique (`label`).
 */
function mutate(label, apply) {
  const before = new Map(people.map((p) => [p.id, JSON.stringify(p)]));
  apply();
  const changes = [];
  const ids = new Set([...before.keys(), ...people.map((p) => p.id)]);
  for (const id of ids) {
    const b = before.get(id) || null;
    const a = byId(id) ? JSON.stringify(byId(id)) : null;
    if (a !== b) changes.push({ id, before: b && JSON.parse(b), after: a && JSON.parse(a) });
  }
  if (!changes.length) return;
  if (cloud) cloud.commit(changes, label).catch((e) => toast(e.message));
  else save();
}

/** Remet les liens en cohérence : conjoints réciproques, plus de lien vers une fiche disparue. */
function repairLinks() {
  for (const p of people) {
    if (p.fatherId && !byId(p.fatherId)) p.fatherId = '';
    if (p.motherId && !byId(p.motherId)) p.motherId = '';
    p.spouseIds = p.spouseIds.filter((sid) => sid !== p.id && byId(sid));
    for (const sid of p.spouseIds) {
      const s = byId(sid);
      if (!s.spouseIds.includes(p.id)) s.spouseIds.push(p.id);
    }
  }
}

/* ------------------------------ Parenté -------------------------------- */

const childrenOf = (id) => people.filter((p) => p.fatherId === id || p.motherId === id);
const parentsOf = (p) => [byId(p.fatherId), byId(p.motherId)].filter(Boolean);
const spousesOf = (p) => p.spouseIds.map(byId).filter(Boolean);

function siblingsOf(p) {
  return people.filter(
    (o) =>
      o.id !== p.id &&
      ((p.fatherId && o.fatherId === p.fatherId) || (p.motherId && o.motherId === p.motherId))
  );
}

/** Vrai si `ancestorId` est un ancêtre de la personne `id`. */
function isAncestor(ancestorId, id, seen = new Set()) {
  const p = byId(id);
  if (!p || seen.has(id)) return false;
  seen.add(id);
  return [p.fatherId, p.motherId].some(
    (pid) => pid && (pid === ancestorId || isAncestor(ancestorId, pid, seen))
  );
}

/* ------------------------------- Dates --------------------------------- */

/**
 * Accepte JJ/MM/AAAA, MM/AAAA, AAAA et AAAA-MM-JJ, avec / . - ou espace comme séparateur,
 * ou les chiffres seuls (28021974, 021974) car le clavier numérique des téléphones n'a pas toujours « / ».
 */
function parseDate(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  let m;
  let y, mo, d;
  if ((m = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/))) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{2})(\d{2})(\d{4})$/))) [, d, mo, y] = m;
  else if ((m = s.match(/^(\d{2})(\d{4})$/))) [, mo, y] = m;
  else if ((m = s.match(/^(\d{1,2})[/.\-\s,]+(\d{1,2})[/.\-\s,]+(\d{4})$/))) [, d, mo, y] = m;
  else if ((m = s.match(/^(\d{1,2})[/.\-\s,]+(\d{4})$/))) [, mo, y] = m;
  else return null;

  if (mo && (mo < 1 || mo > 12)) return null;
  if (d) {
    const dt = new Date(Date.UTC(+y, mo - 1, +d));
    if (dt.getUTCMonth() !== mo - 1) return null; // ex. 31/02
  }
  return [y, mo && mo.padStart(2, '0'), d && d.padStart(2, '0')].filter(Boolean).join('-');
}

function formatDate(iso) {
  if (!iso) return '';
  return iso.split('-').reverse().join('/');
}

const year = (iso) => (iso ? iso.slice(0, 4) : '');

/** Décédé·e : date ou lieu de décès renseigné. */
const isDeceased = (p) => Boolean(p.deathDate || p.deathPlace);

/** Petite croix après le nom des personnes décédées. */
const deathMark = (p) => (isDeceased(p) ? ' <span class="dagger" title="Décédé·e">†</span>' : '');

function lifespan(p) {
  const b = year(p.birthDate);
  const d = year(p.deathDate);
  if (isDeceased(p)) return b || d ? `${b || '?'} – ${d || '?'}` : '';
  return b ? `né${p.sex === 'F' ? 'e' : ''} en ${b}` : '';
}

/** Âge actuel, ou âge au décès. « ≈ » quand la date est incomplète. */
function ageText(p) {
  if (!p.birthDate) return '';
  const [by, bm, bd] = p.birthDate.split('-').map(Number);
  const end = p.deathDate || new Date().toISOString().slice(0, 10);
  const [ey, em, ed] = end.split('-').map(Number);
  let age = ey - by;
  if (bm && em && (em < bm || (em === bm && bd && ed && ed < bd))) age--;
  const approx = !bm || !em || (!bd && em === bm) ? '≈' : '';
  if (age < 0 || (!p.deathDate && (isDeceased(p) || age > 110))) return '';
  return p.deathDate ? `décédé${p.sex === 'F' ? 'e' : ''} à ${approx}${age} ans` : `${approx}${age} ans`;
}

/* ------------------------------ Utilitaires ----------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

const fullName = (p) => `${p.firstName} ${p.lastName}`.trim();
/** Nom complet avec tous les prénoms, pour la fiche et les infobulles. */
const completeName = (p) => [p.firstName, p.middleNames, p.lastName].filter(Boolean).join(' ');
const initials = (p) => ((p.firstName[0] || '') + (p.lastName[0] || '')).toUpperCase();

function sortPeople(list) {
  return [...list].sort(
    (a, b) =>
      a.lastName.localeCompare(b.lastName, 'fr') ||
      a.firstName.localeCompare(b.firstName, 'fr') ||
      (a.birthDate || '').localeCompare(b.birthDate || '')
  );
}

/** Recherche insensible à la casse et aux accents. */
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

/* -------------------------------- Photos -------------------------------- */
// Chaque photo a un identifiant ; la fiche de la personne ne garde que cet identifiant.
// Mode local : photos dans localStorage. Mode partagé : collection « photos » de Firestore,
// chargées seulement quand elles sont affichées.

const photoCache = new Map(); // idPhoto -> Promise<data URL | ''>

function loadPhoto(id) {
  if (!photoCache.has(id)) {
    photoCache.set(
      id,
      cloud ? cloud.getPhoto(id).catch(() => '') : Promise.resolve(localPhotos[id] || '')
    );
  }
  return photoCache.get(id);
}

/** Avatar rond : la photo si elle existe, sinon les initiales. */
function avatarHtml(p, cls = 'avatar') {
  const img = p.photo ? `<img data-photo="${esc(p.photo)}" alt="">` : '';
  return `<span class="${cls} ${p.sex}">${img}<span class="initials">${esc(initials(p))}</span></span>`;
}

/** Remplit les <img data-photo> d'un bloc une fois les photos chargées. */
function hydratePhotos(root) {
  for (const img of root.querySelectorAll('img[data-photo]:not([src])')) {
    loadPhoto(img.dataset.photo).then((url) => {
      if (url) img.src = url;
    });
  }
}

/** Recadre en carré et réduit la photo (≈ 20 Ko) pour qu'elle reste légère à stocker et à charger. */
function resizePhoto(file, size = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, size, size
      );
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => reject(new Error('Image illisible.'));
    img.src = URL.createObjectURL(file);
  });
}

async function setPhoto(personId, file) {
  const p = byId(personId);
  let url;
  try {
    url = await resizePhoto(file);
  } catch (e) {
    return toast(e.message);
  }
  const photoId = 'ph' + newId().slice(1);
  photoCache.set(photoId, Promise.resolve(url));
  if (cloud) cloud.savePhoto(photoId, url, personId).catch((e) => toast(e.message));
  else localPhotos[photoId] = url;
  mutate(`Photo de ${fullName(p)}`, () => (p.photo = photoId));
  toast('Photo enregistrée');
  route(true);
}

function removePhoto(personId) {
  const p = byId(personId);
  if (!confirm(`Retirer la photo de ${fullName(p)} ?`)) return;
  mutate(`Photo retirée : ${fullName(p)}`, () => (p.photo = ''));
  route(true);
}

/* ------------------------------ Navigation ------------------------------ */
// L'URL (#/liste, #/arbre, #/personne/<id>) permet au bouton « retour » du téléphone de fonctionner.

function route(keepScroll = false) {
  document.body.classList.toggle('can-edit', canEdit());
  document.body.classList.toggle('is-admin', role === 'admin');
  document.body.classList.toggle('shared', SHARED);
  // Mode partagé : tant qu'on n'est pas connecté avec un accès, on montre l'écran de connexion.
  const locked = SHARED && !role;
  document.body.classList.toggle('locked', locked);
  if (locked) return showView('login', null, keepScroll);

  const [, view, id] = location.hash.split('/');
  if (view === 'personne' && byId(id)) showView('person', id, keepScroll);
  else if (view === 'arbre') showView('tree', null, keepScroll);
  else if (view === 'historique' && SHARED) showView('history', null, keepScroll);
  else showView('list', null, keepScroll);
}

function showView(name, id, keepScroll) {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $(`#view-${name}`).classList.add('active');
  document.body.dataset.view = name;
  $$('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === (name === 'tree' ? 'tree' : 'list'))
  );
  if (name !== 'history') stopHistory();
  if (name === 'login') renderLogin();
  if (name === 'list') renderList();
  if (name === 'person') renderPerson(id);
  if (name === 'tree') renderTree();
  if (name === 'history') startHistory();
  if (!keepScroll) window.scrollTo(0, 0);
}

const go = (hash) => (location.hash = hash);

/* ------------------------------- Rendu ---------------------------------- */

function renderList() {
  const q = fold($('#search').value.trim());
  const list = sortPeople(people).filter(
    (p) => !q || fold(`${p.firstName} ${p.middleNames} ${p.lastName} ${p.birthPlace} ${p.deathPlace}`).includes(q)
  );
  $('#personList').innerHTML = list
    .map(
      (p) => `
      <li class="person-item" data-id="${esc(p.id)}">
        ${avatarHtml(p)}
        <span>
          <span class="name">${esc(fullName(p))}${deathMark(p)}</span><br>
          <span class="meta">${esc([lifespan(p), p.birthPlace].filter(Boolean).join(' · '))}</span>
        </span>
      </li>`
    )
    .join('');
  $('#emptyMsg').hidden = people.length > 0;
  $('#count').textContent = people.length
    ? `${list.length} personne${list.length > 1 ? 's' : ''}${q ? ' trouvée' + (list.length > 1 ? 's' : '') : ''}`
    : '';
  hydratePhotos($('#personList'));
}

function chips(list) {
  if (!list.length) return '<span class="muted">—</span>';
  return `<div class="chips">${sortPeople(list)
    .map((p) => `<button class="chip" data-goto="${esc(p.id)}">${esc(fullName(p))}</button>`)
    .join('')}</div>`;
}

function renderPerson(id) {
  const p = byId(id);
  const facts = [
    ['Naissance', [formatDate(p.birthDate), p.birthPlace].filter(Boolean).join(' à ')],
    ['Décès', [formatDate(p.deathDate), p.deathPlace].filter(Boolean).join(' à ')],
    ['Âge', ageText(p)],
    ['Sexe', { M: 'Homme', F: 'Femme' }[p.sex] || ''],
  ].filter(([, v]) => v);

  $('#view-person').innerHTML = `
    <button class="back" data-back>← Retour</button>
    <div class="card person-head">
      ${avatarHtml(p, 'avatar big')}
      <h2>${esc(completeName(p))}${deathMark(p)}</h2>
      <div class="photo-actions edit-only">
        <label class="btn small-btn">📷 ${p.photo ? 'Changer la photo' : 'Ajouter une photo'}
          <input type="file" accept="image/*" data-photo-input="${esc(p.id)}" hidden>
        </label>
        ${p.photo ? `<button class="btn small-btn" data-photo-remove="${esc(p.id)}">Retirer</button>` : ''}
      </div>
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${p.notes ? `<p>${esc(p.notes).replace(/\n/g, '<br>')}</p>` : ''}
    </div>
    <div class="card"><h3>Parents</h3>${chips(parentsOf(p))}</div>
    <div class="card"><h3>Conjoint(s)</h3>${chips(spousesOf(p))}</div>
    <div class="card"><h3>Enfants</h3>${chips(childrenOf(p.id))}</div>
    <div class="card"><h3>Frères et sœurs</h3>${chips(siblingsOf(p))}</div>
    <div class="actions">
      <button class="btn primary edit-only" data-edit="${esc(p.id)}">Modifier</button>
      <button class="btn edit-only" data-add-child="${esc(p.id)}">+ Ajouter un enfant</button>
      <button class="btn" data-show-tree="${esc(p.id)}">Voir dans l’arbre</button>
      <button class="btn danger edit-only" data-delete="${esc(p.id)}">Supprimer</button>
    </div>`;
  hydratePhotos($('#view-person'));
}

/* -------------------------------- Arbre --------------------------------- */

const sortByBirth = (list) =>
  [...list].sort((a, b) => (a.birthDate || '9999').localeCompare(b.birthDate || '9999'));

// Réglages d'affichage de l'arbre, mémorisés sur ce téléphone.
const PREFS_KEY = 'arbre-familial:affichage';
const FIELD_LABELS = { photo: 'Photo', years: 'Années', birth: 'Date de naissance', place: 'Lieu de naissance', deathPlace: 'Lieu de décès', age: 'Âge' };
const prefs = { depth: 2, mode: 'all', fields: ['photo', 'years'], ...loadJson(PREFS_KEY, {}) };
const savePrefs = () => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* préférence non mémorisée */ }
};

let treeRootId = '';
let treeView = null;

function treeCardHtml(p, fields) {
  const lines = [];
  if (fields.has('years')) lines.push(lifespan(p));
  if (fields.has('birth')) lines.push(p.birthDate ? `° ${formatDate(p.birthDate)}` : '');
  if (fields.has('place')) lines.push(p.birthPlace);
  if (fields.has('deathPlace')) lines.push(p.deathPlace ? `† ${p.deathPlace}` : '');
  if (fields.has('age')) lines.push(ageText(p));
  return `
    ${fields.has('photo') ? avatarHtml(p, 'avatar card-photo') : ''}
    <span class="card-first">${esc(p.firstName)}</span>
    <span class="card-last">${esc(p.lastName)}${deathMark(p)}</span>
    ${lines.map((l) => `<span class="card-line">${esc(l) || '&nbsp;'}</span>`).join('')}`;
}

function cardTitle(p) {
  return [completeName(p), lifespan(p), p.birthPlace].filter(Boolean).join(' · ');
}

function initTree() {
  treeView = createTreeView($('#treeViewport'), {
    people: () => people,
    depth: () => prefs.depth,
    mode: () => prefs.mode,
    fields: () => new Set(prefs.fields),
    cardHtml: treeCardHtml,
    title: cardTitle,
    afterRender: hydratePhotos,
    onFocus: (id) => {
      treeRootId = id;
      $('#treeRoot').value = id;
      treeView.show(id);
      updateTreeInfo();
    },
    onOpen: (id) => go(`#/personne/${id}`),
  });

  // Boîte à outils
  $('#toolsBtn').addEventListener('click', () => {
    const panel = $('#toolsPanel');
    panel.hidden = !panel.hidden;
    $('#toolsBtn').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('#depthRange').addEventListener('input', (e) => {
    prefs.depth = +e.target.value;
    savePrefs();
    renderToolbox();
    treeView.show(treeRootId, { recenter: false });
    updateTreeInfo();
  });
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    prefs.mode = b.dataset.mode;
    savePrefs();
    renderToolbox();
    treeView.show(treeRootId, { recenter: false });
    updateTreeInfo();
  });
  $('#fieldToggles').addEventListener('change', (e) => {
    const f = e.target.value;
    prefs.fields = e.target.checked ? [...new Set([...prefs.fields, f])] : prefs.fields.filter((x) => x !== f);
    savePrefs();
    treeView.refresh();
  });
  $('.tree-zoom').addEventListener('click', (e) => {
    const a = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (a === 'in') treeView.zoom(1.25);
    if (a === 'out') treeView.zoom(0.8);
    if (a === 'fit') treeView.fit();
    if (a === 'center') treeView.center();
  });
  $('#treeRoot').addEventListener('change', (e) => treeView.show((treeRootId = e.target.value)));
  // Toucher l'arbre referme la boîte à outils ; l'aide disparaît après la première utilisation.
  $('#treeViewport').addEventListener('pointerdown', () => {
    if (!$('#toolsPanel').hidden) $('#toolsBtn').click();
    $('.tree-hint').classList.add('seen');
  });
  renderToolbox();
}

const DEPTH_HELP = {
  all: ['la personne seule', 'conjoints, parents, frères et sœurs, enfants', '+ grands-parents, oncles et tantes, petits-enfants, neveux…'],
  anc: ['la personne seule', 'ses parents', 'ses grands-parents'],
  desc: ['la personne et ses conjoints', 'ses enfants', 'ses petits-enfants'],
};

function renderToolbox() {
  $('#depthRange').value = prefs.depth;
  $('#depthValue').textContent = prefs.depth;
  const help = DEPTH_HELP[prefs.mode];
  $('#depthHelp').textContent = help[prefs.depth] || `${prefs.depth} générations / liens autour de la personne`;
  $$('#modeSeg [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === prefs.mode));
  $('#fieldToggles').innerHTML = Object.entries(FIELD_LABELS)
    .map(([k, v]) => `<label class="toggle"><input type="checkbox" value="${k}"${prefs.fields.includes(k) ? ' checked' : ''}><span>${v}</span></label>`)
    .join('');
}

function updateTreeInfo() {
  const n = treeView.count;
  $('#treeInfo').textContent = n > 1 ? `${n} personnes affichées` : '';
}

function renderTree() {
  if (!treeView) initTree();
  if (!byId(treeRootId)) {
    // Par défaut : la personne la plus ancienne sans parents connus.
    const roots = sortByBirth(people.filter((p) => !parentsOf(p).length));
    treeRootId = (roots[0] || people[0] || {}).id || '';
  }
  $('#treeRoot').innerHTML = sortPeople(people)
    .map((p) => `<option value="${esc(p.id)}"${p.id === treeRootId ? ' selected' : ''}>${esc(fullName(p))}</option>`)
    .join('');
  $('#treeEmpty').hidden = Boolean(treeRootId);
  // La vue doit être visible pour mesurer l'écran : on attend l'affichage.
  requestAnimationFrame(() => {
    treeView.show(treeRootId, { recenter: treeView.focusId !== treeRootId });
    updateTreeInfo();
  });
}

/* ----------------------------- Formulaire ------------------------------- */

const dialog = $('#personDialog');
const form = $('#personForm');

function fillSelect(select, candidates, selected, emptyLabel) {
  const sel = new Set([].concat(selected || []));
  select.innerHTML =
    (emptyLabel ? `<option value="">${emptyLabel}</option>` : '') +
    sortPeople(candidates)
      .map((p) => {
        const y = year(p.birthDate);
        return `<option value="${esc(p.id)}"${sel.has(p.id) ? ' selected' : ''}>${esc(fullName(p))}${y ? ` (${y})` : ''}</option>`;
      })
      .join('');
}

function openForm(person = null, preset = {}) {
  const p = person || normalize({ id: '', ...preset });
  form.reset();
  $('#formError').hidden = true;
  $('#formTitle').textContent = person ? 'Modifier' : 'Nouvelle personne';
  form.personId.value = person ? p.id : '';
  form.firstName.value = p.firstName;
  form.middleNames.value = p.middleNames;
  form.lastName.value = p.lastName;
  form.sex.value = p.sex;
  form.birthDate.value = formatDate(p.birthDate);
  form.birthPlace.value = p.birthPlace;
  form.deathPlace.value = p.deathPlace;
  form.deathDate.value = formatDate(p.deathDate);
  form.notes.value = p.notes;

  // On n'autorise pas de lien qui créerait une boucle (ex. être son propre grand-père).
  const others = people.filter((o) => o.id !== p.id);
  const notDescendant = others.filter((o) => !person || !isAncestor(p.id, o.id));
  fillSelect(form.fatherId, notDescendant.filter((o) => o.sex !== 'F'), p.fatherId, '— inconnu —');
  fillSelect(form.motherId, notDescendant.filter((o) => o.sex !== 'M'), p.motherId, '— inconnue —');
  formSpouses = [...p.spouseIds];
  spouseCandidates = others;
  renderSpouses();
  dialog.showModal();
}

// Conjoints : une étiquette par conjoint (✕ pour le retirer) et une liste pour en ajouter.
let formSpouses = [];
let spouseCandidates = [];

function renderSpouses() {
  $('#spouseChips').innerHTML = formSpouses.length
    ? formSpouses
        .map(byId)
        .filter(Boolean)
        .map((s) => `<button type="button" class="chip removable" data-spouse-remove="${esc(s.id)}" aria-label="Retirer ${esc(fullName(s))}">${esc(fullName(s))} <span aria-hidden="true">✕</span></button>`)
        .join('')
    : '<span class="muted small">Aucun</span>';
  fillSelect($('#spouseAdd'), spouseCandidates.filter((o) => !formSpouses.includes(o.id)), [], '+ Ajouter un conjoint…');
}

$('#spouseChips').addEventListener('click', (e) => {
  const id = e.target.closest('[data-spouse-remove]')?.dataset.spouseRemove;
  if (!id) return;
  formSpouses = formSpouses.filter((x) => x !== id);
  renderSpouses();
});
$('#spouseAdd').addEventListener('change', (e) => {
  if (e.target.value) formSpouses.push(e.target.value);
  renderSpouses();
});

function formError(msg) {
  const e = $('#formError');
  e.textContent = msg;
  e.hidden = false;
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const birthDate = parseDate(form.birthDate.value);
  const deathDate = parseDate(form.deathDate.value);
  if (birthDate === null) return formError('Date de naissance invalide (ex. 24051952, 24/05/1952 ou 1952).');
  if (deathDate === null) return formError('Date de décès invalide (ex. 24051952, 24/05/1952 ou 1952).');
  if (birthDate && deathDate && deathDate < birthDate) return formError('Le décès est antérieur à la naissance.');

  const id = form.personId.value || newId();
  const fatherId = form.fatherId.value;
  const motherId = form.motherId.value;
  if (fatherId && fatherId === motherId) return formError('Le père et la mère doivent être différents.');
  const spouseIds = [...formSpouses];

  const data = normalize({
    id,
    firstName: form.firstName.value,
    middleNames: form.middleNames.value,
    lastName: form.lastName.value,
    sex: form.sex.value,
    birthDate,
    birthPlace: form.birthPlace.value,
    deathPlace: form.deathPlace.value,
    deathDate,
    fatherId,
    motherId,
    spouseIds,
    notes: form.notes.value,
  });
  if (!data.firstName || !data.lastName) return formError('Le prénom et le nom sont obligatoires.');

  const existing = byId(id);
  mutate(`${existing ? 'Modification' : 'Ajout'} de ${fullName(data)}`, () => {
    const oldSpouses = existing ? existing.spouseIds : [];
    if (existing) Object.assign(existing, data);
    else people.push(data);

    // Conjoints : on garde le lien des deux côtés.
    for (const sid of oldSpouses) if (!spouseIds.includes(sid)) {
      const s = byId(sid);
      if (s) s.spouseIds = s.spouseIds.filter((x) => x !== id);
    }
    for (const sid of spouseIds) {
      const s = byId(sid);
      if (s && !s.spouseIds.includes(id)) s.spouseIds.push(id);
    }
  });
  dialog.close();
  toast(existing ? 'Modifications enregistrées' : 'Personne ajoutée');
  if (location.hash === `#/personne/${id}`) route();
  else go(`#/personne/${id}`);
});

$('#cancelBtn').addEventListener('click', () => dialog.close());
// Affiche la date telle qu'elle a été comprise (28021974 → 28/02/1974).
for (const field of [form.birthDate, form.deathDate]) {
  field.addEventListener('blur', () => {
    const iso = parseDate(field.value);
    if (iso) field.value = formatDate(iso);
  });
}
// Des mises à jour d'autres membres ont pu arriver pendant la saisie.
dialog.addEventListener('close', () => SHARED && refresh());

function deletePerson(id) {
  const p = byId(id);
  if (!p || !confirm(`Supprimer ${fullName(p)} ? Les liens avec cette personne seront retirés.`)) return;
  mutate(`Suppression de ${fullName(p)}`, () => {
    people = people.filter((o) => o.id !== id);
    repairLinks();
  });
  toast('Personne supprimée');
  go('#/liste');
}

/* -------------------------- Export / import ----------------------------- */

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  // Sur téléphone : ouvre le menu de partage (WhatsApp, e-mail…) si possible.
  if (navigator.canShare?.({ files: [file] })) {
    // Si le partage est refusé (ex. trop de temps depuis l'appui), on télécharge le fichier.
    return navigator.share({ files: [file], title: 'Arbre familial' })
      .catch((e) => e.name !== 'AbortError' && saveFile(blob, filename));
  }
  saveFile(blob, filename);
}

function saveFile(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

async function exportJson() {
  // Les photos sont incluses pour que le fichier soit une sauvegarde complète.
  const photos = {};
  for (const id of new Set(people.map((p) => p.photo).filter(Boolean))) {
    const url = await loadPhoto(id);
    if (url) photos[id] = url;
  }
  const json = JSON.stringify({ app: 'arbre-familial', version: FORMAT_VERSION, exported: new Date().toISOString(), people, photos }, null, 2);
  download(`arbre-familial-${stamp()}.json`, json, 'application/json');
}

/** Export GEDCOM 5.5.1, le format d'échange standard entre logiciels de généalogie. */
function toGedcom() {
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const gedDate = (iso) => {
    const [y, m, d] = iso.split('-');
    return [d && String(+d), m && MONTHS[m - 1], y].filter(Boolean).join(' ');
  };
  const clean = (s) => String(s).replace(/[\r\n]+/g, ' ');
  const indi = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));

  // Une « famille » GEDCOM = un couple (ou un parent seul) et ses enfants.
  const fams = new Map();
  const famKey = (a, b) => [a || '', b || ''].join('|');
  const getFam = (husb, wife) => {
    const k = famKey(husb, wife);
    if (!fams.has(k)) fams.set(k, { id: `@F${fams.size + 1}@`, husb, wife, children: [] });
    return fams.get(k);
  };
  for (const p of people) {
    if (p.fatherId || p.motherId) getFam(byId(p.fatherId) && p.fatherId, byId(p.motherId) && p.motherId).children.push(p.id);
  }
  for (const p of people) {
    for (const sid of p.spouseIds) {
      const s = byId(sid);
      if (!s || p.id > sid) continue; // chaque couple une seule fois
      const [h, w] = p.sex === 'F' || s.sex === 'M' ? [sid, p.id] : [p.id, sid];
      if (!fams.has(famKey(h, w)) && !fams.has(famKey(w, h))) getFam(h, w);
    }
  }

  const out = ['0 HEAD', '1 SOUR ARBRE_FAMILIAL', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8'];
  for (const p of people) {
    const given = clean([p.firstName, p.middleNames].filter(Boolean).join(' '));
    out.push(`0 ${indi.get(p.id)} INDI`, `1 NAME ${given} /${clean(p.lastName)}/`);
    out.push(`2 GIVN ${given}`, `2 SURN ${clean(p.lastName)}`);
    if (p.sex !== 'U') out.push(`1 SEX ${p.sex}`);
    if (p.birthDate || p.birthPlace) {
      out.push('1 BIRT');
      if (p.birthDate) out.push(`2 DATE ${gedDate(p.birthDate)}`);
      if (p.birthPlace) out.push(`2 PLAC ${clean(p.birthPlace)}`);
    }
    if (p.deathDate || p.deathPlace) {
      out.push('1 DEAT');
      if (p.deathDate) out.push(`2 DATE ${gedDate(p.deathDate)}`);
      if (p.deathPlace) out.push(`2 PLAC ${clean(p.deathPlace)}`);
    }
    for (const f of fams.values()) {
      if (f.children.includes(p.id)) out.push(`1 FAMC ${f.id}`);
      if (f.husb === p.id || f.wife === p.id) out.push(`1 FAMS ${f.id}`);
    }
    if (p.notes) {
      const [first, ...rest] = p.notes.split(/\r?\n/);
      out.push(`1 NOTE ${first}`, ...rest.map((l) => `2 CONT ${l}`));
    }
  }
  for (const f of fams.values()) {
    out.push(`0 ${f.id} FAM`);
    if (f.husb) out.push(`1 HUSB ${indi.get(f.husb)}`);
    if (f.wife) out.push(`1 WIFE ${indi.get(f.wife)}`);
    for (const c of f.children) out.push(`1 CHIL ${indi.get(c)}`);
  }
  out.push('0 TRLR');
  return out.join('\r\n') + '\r\n';
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = (Array.isArray(data) ? data : data.people || []).map(normalize);
      if (!incoming.length) throw new Error('vide');
      for (const [id, url] of Object.entries(data.photos || {})) {
        if (typeof url !== 'string' || !url.startsWith('data:image/')) continue;
        photoCache.set(id, Promise.resolve(url));
        // Mode partagé : une photo déjà présente ne peut pas être remplacée (refus attendu, ignoré).
        if (cloud) cloud.savePhoto(id, url, '').catch(() => {});
        else localPhotos[id] = url;
      }
      // Fusion : les fiches de même identifiant sont mises à jour, les autres ajoutées.
      let added = 0;
      let updated = 0;
      mutate(`Import de ${incoming.length} personne(s)`, () => {
        for (const p of incoming) {
          const existing = byId(p.id);
          if (existing) { Object.assign(existing, p); updated++; }
          else { people.push(p); added++; }
        }
        repairLinks();
      });
      $('#menuDialog').close();
      toast(`Import : ${added} ajoutée(s), ${updated} mise(s) à jour`);
      route();
    } catch {
      toast('Fichier non reconnu.');
    }
  };
  reader.readAsText(file);
}

function loadDemo() {
  if (people.length && !confirm('Ajouter la famille d’exemple aux données existantes ?')) return;
  const d = (id, firstName, lastName, sex, birthDate, extra = {}) =>
    normalize({ id, firstName, lastName, sex, birthDate, ...extra });
  people.push(
    d('demo1', 'Jean', 'Martin', 'M', '1930-04-12', { birthPlace: 'Lyon', deathDate: '2010-01-03', spouseIds: ['demo2'] }),
    d('demo2', 'Marie', 'Dupont', 'F', '1933-09-30', { birthPlace: 'Mâcon', spouseIds: ['demo1'] }),
    d('demo3', 'Pierre', 'Martin', 'M', '1958-06-21', { fatherId: 'demo1', motherId: 'demo2', spouseIds: ['demo4'] }),
    d('demo4', 'Sophie', 'Bernard', 'F', '1960', { spouseIds: ['demo3'] }),
    d('demo5', 'Claire', 'Martin', 'F', '1962-02', { fatherId: 'demo1', motherId: 'demo2' }),
    d('demo6', 'Lucas', 'Martin', 'M', '1988-11-05', { fatherId: 'demo3', motherId: 'demo4' }),
    d('demo7', 'Emma', 'Martin', 'F', '1991-03-17', { fatherId: 'demo3', motherId: 'demo4' })
  );
  people = people.filter((p, i, a) => a.findIndex((o) => o.id === p.id) === i);
  save();
  $('#menuDialog').close();
  toast('Exemple chargé');
  route();
}

/* ------------------------------ Événements ------------------------------ */

$('#addBtn').addEventListener('click', () => openForm());
$('#search').addEventListener('input', renderList);
$$('.tab').forEach((t) =>
  t.addEventListener('click', () => go(t.dataset.view === 'tree' ? '#/arbre' : '#/liste'))
);

// Délégation : un seul écouteur pour tous les boutons générés dynamiquement.
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id],[data-goto],[data-edit],[data-add-child],[data-show-tree],[data-delete],[data-back]');
  if (!el) return;
  const ds = el.dataset;
  if (ds.id || ds.goto) go(`#/personne/${ds.id || ds.goto}`);
  else if (ds.edit) openForm(byId(ds.edit));
  else if (ds.addChild) {
    const parent = byId(ds.addChild);
    const spouse = spousesOf(parent)[0];
    const other = spouse && spousesOf(parent).length === 1 ? spouse.id : '';
    openForm(null, {
      lastName: parent.sex === 'F' && spouse ? spouse.lastName : parent.lastName,
      fatherId: parent.sex === 'F' ? other : parent.id,
      motherId: parent.sex === 'F' ? parent.id : other,
    });
  } else if (ds.showTree) { treeRootId = ds.showTree; go('#/arbre'); }
  else if (ds.delete) deletePerson(ds.delete);
  else if ('back' in ds) history.length > 1 ? history.back() : go('#/liste');
});

$('#menuBtn').addEventListener('click', () => $('#menuDialog').showModal());
$('#closeMenuBtn').addEventListener('click', () => $('#menuDialog').close());
$('#exportJsonBtn').addEventListener('click', () => (people.length ? exportJson() : toast('Rien à exporter.')));
$('#exportGedBtn').addEventListener('click', () =>
  people.length ? download(`arbre-familial-${stamp()}.ged`, toGedcom(), 'text/plain') : toast('Rien à exporter.')
);
$('#importInput').addEventListener('change', (e) => {
  if (e.target.files[0]) importJson(e.target.files[0]);
  e.target.value = '';
});
$('#demoBtn').addEventListener('click', loadDemo);
$('#clearBtn').addEventListener('click', () => {
  if (!people.length || !confirm('Effacer toutes les personnes de ce téléphone ? Pensez à exporter avant.')) return;
  people = [];
  save();
  $('#menuDialog').close();
  go('#/liste');
  route();
});

/* ---------------------- Mode partagé : connexion ------------------------ */

let authState = 'loading'; // loading | signed-out | no-access | error
let authError = '';

function renderLogin() {
  const box = $('#view-login');
  if (authState === 'loading') {
    box.innerHTML = '<p class="empty">Connexion…</p>';
    return;
  }
  if (authState === 'no-access') {
    box.innerHTML = `
      <div class="card">
        <h2>Accès en attente</h2>
        <p>Vous êtes connecté·e avec <strong>${esc(account.email)}</strong>, mais cette adresse n’a pas encore accès à l’arbre.</p>
        <p class="muted">Demandez à l’administrateur de la famille d’ajouter cette adresse. La page s’ouvrira automatiquement dès que ce sera fait.</p>
        <button class="btn" data-signout>Changer de compte</button>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="card">
      <h2>Bienvenue</h2>
      <p class="muted">Cet arbre est réservé à la famille. Connectez-vous pour le consulter.</p>
      <button class="btn primary wide" id="googleBtn">Continuer avec Google</button>
      <p class="or">ou, sans compte Google</p>
      <form id="emailForm">
        <label>Votre adresse e-mail
          <input type="email" name="email" required autocomplete="email" inputmode="email">
        </label>
        <button class="btn wide" type="submit">Recevoir un lien de connexion</button>
      </form>
      <p id="loginMsg" class="${authError ? 'error' : 'muted'}">${esc(authError)}</p>
    </div>`;
  $('#googleBtn').addEventListener('click', () =>
    cloud.signInGoogle().catch((e) => showLoginMsg(e.message, true))
  );
  $('#emailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    showLoginMsg('Envoi…');
    try {
      await cloud.sendEmailLink(email);
      showLoginMsg(`Un lien a été envoyé à ${email}. Ouvrez-le sur ce téléphone pour vous connecter (pensez à regarder dans les indésirables).`);
    } catch (err) {
      showLoginMsg(err.message, true);
    }
  });
}

function showLoginMsg(msg, isError = false) {
  authError = isError ? msg : '';
  const el = $('#loginMsg');
  if (!el) return;
  el.textContent = msg;
  el.className = isError ? 'error' : 'muted';
}

const ROLE_LABELS = { viewer: 'Lecture seule', editor: 'Peut modifier', admin: 'Administrateur' };

function renderAccount() {
  $('#accountInfo').innerHTML = account
    ? `Connecté·e : <strong>${esc(account.email)}</strong><br>${esc(ROLE_LABELS[role] || 'sans accès')}`
    : '';
}

async function startShared() {
  route();
  try {
    cloud = await import('./cloud.js');
  } catch {
    authState = 'error';
    $('#view-login').innerHTML = '<p class="empty error">Impossible de charger le module en ligne. Vérifiez la connexion Internet puis rechargez la page.</p>';
    return;
  }
  await cloud.start(CONFIG, {
    user(u) {
      account = u;
      if (!u) { role = null; people = []; authState = 'signed-out'; }
      else authState = 'loading';
      renderAccount();
      route();
    },
    role(r) {
      role = ROLE_LABELS[r] ? r : null;
      authState = role ? 'ok' : 'no-access';
      renderAccount();
      route(true);
    },
    people(list) {
      people = list.map(normalize);
      if (!dialog.open) refresh();
    },
    error(msg) {
      authError = msg;
      toast(msg);
      if (!role) route();
    },
  });
}

/** Ré-affiche la vue courante après une mise à jour venue d'un autre membre, sans remonter en haut. */
function refresh() {
  if (!$('#view-history').classList.contains('active')) route(true);
}

/* ---------------------- Mode partagé : historique ----------------------- */

let historyUnsub = null;
let historyEntries = [];

function startHistory() {
  if (historyUnsub) return renderHistory();
  $('#historyList').innerHTML = '<p class="muted">Chargement…</p>';
  historyUnsub = cloud.watchHistory(
    (entries) => { historyEntries = entries; renderHistory(); },
    (msg) => toast(msg)
  );
}

function stopHistory() {
  if (historyUnsub) historyUnsub();
  historyUnsub = null;
}

const dateTime = (d) =>
  d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function renderHistory() {
  $('#historyList').innerHTML = historyEntries.length
    ? historyEntries
        .map(
          (h) => `
      <li class="card history-item">
        <div><strong>${esc(h.label)}</strong></div>
        <div class="muted small">${esc(h.byName || h.byEmail)} · ${esc(dateTime(h.at))}</div>
        ${h.changes.length > 1 ? `<div class="muted small">${h.changes.length} fiches concernées</div>` : ''}
        <button class="btn small-btn edit-only" data-undo="${esc(h.id)}">Annuler cette modification</button>
      </li>`
        )
        .join('')
    : '<p class="empty">Aucune modification pour l’instant.</p>';
}

/** Annule une action : chaque fiche concernée reprend son état d'avant. */
function undo(entryId) {
  const h = historyEntries.find((x) => x.id === entryId);
  if (!h) return;
  const later = historyEntries.filter(
    (x) => x.at > h.at && x.changes.some((c) => h.changes.some((d) => d.id === c.id))
  );
  const warn = later.length
    ? `\n\nAttention : ${later.length} modification(s) plus récente(s) touchent les mêmes personnes et seront écrasées.`
    : '';
  if (!confirm(`Annuler « ${h.label} » ?${warn}`)) return;
  mutate(`Annulation : ${h.label}`, () => {
    for (const c of h.changes) {
      people = people.filter((p) => p.id !== c.id);
      if (c.before) people.push(normalize({ ...c.before, id: c.id }));
    }
    repairLinks();
  });
  toast('Modification annulée');
}

/* ----------------------- Mode partagé : membres ------------------------- */

let membersUnsub = null;

function openMembers() {
  $('#menuDialog').close();
  $('#membersDialog').showModal();
  $('#membersList').innerHTML = '<li class="muted">Chargement…</li>';
  membersUnsub = cloud.watchMembers(renderMembers, (msg) => toast(msg));
}

function renderMembers(list) {
  const mine = account.email.toLowerCase();
  $('#membersList').innerHTML = list
    .sort((a, b) => a.email.localeCompare(b.email))
    .map(
      (m) => `
      <li class="member">
        <span class="member-email">${esc(m.email)}</span>
        <select data-member-role="${esc(m.email)}"${m.email === mine ? ' disabled' : ''}>
          ${Object.entries(ROLE_LABELS).map(([k, v]) => `<option value="${k}"${k === m.role ? ' selected' : ''}>${v}</option>`).join('')}
        </select>
        ${m.email === mine ? '' : `<button class="icon-btn small" data-member-remove="${esc(m.email)}" aria-label="Retirer">✕</button>`}
      </li>`
    )
    .join('');
}

$('#membersDialog').addEventListener('close', () => {
  if (membersUnsub) membersUnsub();
  membersUnsub = null;
});
$('#closeMembersBtn').addEventListener('click', () => $('#membersDialog').close());
$('#addMemberForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.target.email;
  const email = input.value.trim();
  input.value = '';
  try {
    await cloud.setMember(email, e.target.role.value);
    toast(`${email} ajouté·e. Envoyez-lui l’adresse du site.`);
  } catch (err) {
    input.value = email;
    toast(err.message);
  }
});
$('#membersList').addEventListener('change', (e) => {
  const email = e.target.dataset.memberRole;
  if (email) cloud.setMember(email, e.target.value).then(() => toast('Droits modifiés'), (err) => toast(err.message));
});
$('#membersList').addEventListener('click', (e) => {
  const email = e.target.closest('[data-member-remove]')?.dataset.memberRemove;
  if (email && confirm(`Retirer l’accès de ${email} ?`)) {
    cloud.removeMember(email).then(() => toast('Accès retiré'), (err) => toast(err.message));
  }
});

$('#historyBtn').addEventListener('click', () => { $('#menuDialog').close(); go('#/historique'); });
$('#membersBtn').addEventListener('click', openMembers);
$('#signOutBtn').addEventListener('click', () => { $('#menuDialog').close(); cloud.signOut(); });
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-signout]')) cloud.signOut();
  const undoId = e.target.closest('[data-undo]')?.dataset.undo;
  if (undoId) undo(undoId);
});

document.addEventListener('change', (e) => {
  const id = e.target.dataset?.photoInput;
  if (id && e.target.files[0]) setPhoto(id, e.target.files[0]);
});
document.addEventListener('click', (e) => {
  const id = e.target.closest('[data-photo-remove]')?.dataset.photoRemove;
  if (id) removePhoto(id);
});

// Hauteur de l'en-tête + onglets : la vue arbre occupe tout l'espace en dessous.
function measureChrome() {
  const h = $('.topbar').offsetHeight + $('.tabs').offsetHeight;
  document.documentElement.style.setProperty('--chrome-h', `${h}px`);
}
measureChrome();
window.addEventListener('resize', measureChrome);

window.addEventListener('hashchange', () => route());
if (SHARED) startShared();
else route();

// Mode hors ligne / installation sur l'écran d'accueil (nécessite HTTPS ou localhost).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
