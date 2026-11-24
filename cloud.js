// Mode partagé : synchronisation avec Firebase (connexion + base Firestore).
// Chargé uniquement si config.js contient une configuration Firebase.

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

const { initializeApp } = await import(`${SDK}/firebase-app.js`);
const {
  getAuth, connectAuthEmulator, onAuthStateChanged, signOut: fbSignOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink,
} = await import(`${SDK}/firebase-auth.js`);
const {
  initializeFirestore, connectFirestoreEmulator, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, setDoc, getDoc, deleteDoc, updateDoc, serverTimestamp, query, orderBy, limit,
} = await import(`${SDK}/firebase-firestore.js`);

const EMAIL_KEY = 'arbre-familial:email-connexion';
const BATCH_SIZE = 200; // personnes modifiées par écriture groupée (limite Firestore : 500 opérations)

let auth;
let db;
let user = null;
const unsubs = [];

/**
 * Démarre la connexion. Les fonctions de `on` sont appelées à chaque changement :
 *   on.user(user|null), on.role(role|null, personId, fromCache), on.people(list), on.error(message)
 * personId = « ma fiche » enregistrée sur le compte ('' si aucune).
 */
export async function start(config, on) {
  const app = initializeApp(config.firebase);
  auth = getAuth(app);
  auth.languageCode = 'fr';
  // Cache local : l'arbre reste consultable et modifiable sans réseau, puis se synchronise.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  if (config.emulator) {
    connectAuthEmulator(auth, `http://${config.emulator.auth}`, { disableWarnings: true });
    const [host, port] = config.emulator.firestore.split(':');
    connectFirestoreEmulator(db, host, +port);
  }

  await finishEmailLink(on);
  getRedirectResult(auth).catch((e) => on.error(authMessage(e)));

  onAuthStateChanged(auth, (u) => {
    user = u;
    unsubs.splice(0).forEach((f) => f());
    on.user(u);
    if (!u) return;
    // Rôle de l'utilisateur : fiche members/<email>, créée par l'administrateur.
    unsubs.push(
      onSnapshot(
        doc(db, 'members', u.email.toLowerCase()),
        // includeMetadataChanges : être prévenu aussi quand le serveur confirme une fiche déjà
        // en cache (sinon, avec le cache hors ligne, on ne sait jamais qu'elle vient du serveur).
        { includeMetadataChanges: true },
        (snap) => {
          const role = snap.exists() ? snap.data().role : null;
          on.role(role, (snap.exists() && snap.data().personId) || '', snap.metadata.fromCache);
          // Pas encore membre (réponse du serveur, pas du cache) : on laisse une demande d'accès
          // que l'administrateur verra dans « Membres et droits d'accès ».
          if (!role && !snap.metadata.fromCache) requestAccess(u);
          if (role && unsubs.length === 1) {
            unsubs.push(
              onSnapshot(
                collection(db, 'people'),
                (s) => on.people(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
                (e) => on.error(dbMessage(e))
              )
            );
          }
        },
        () => on.role(null)
      )
    );
  });
}

/* ------------------------------ Connexion ------------------------------- */

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Fenêtre bloquée (certains navigateurs mobiles) : on passe par une redirection.
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      return signInWithRedirect(auth, provider);
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    throw new Error(authMessage(e));
  }
}

export async function sendEmailLink(email) {
  try {
    await sendSignInLinkToEmail(auth, email, {
      url: location.origin + location.pathname,
      handleCodeInApp: true,
    });
    localStorage.setItem(EMAIL_KEY, email);
  } catch (e) {
    throw new Error(authMessage(e));
  }
}

async function finishEmailLink(on) {
  if (!isSignInWithEmailLink(auth, location.href)) return;
  // Si le lien est ouvert sur un autre appareil, l'adresse n'est pas mémorisée : on la redemande.
  const email = localStorage.getItem(EMAIL_KEY) || prompt('Pour terminer la connexion, confirmez votre adresse e-mail :');
  try {
    if (email) await signInWithEmailLink(auth, email.trim(), location.href);
    localStorage.removeItem(EMAIL_KEY);
  } catch (e) {
    on.error(authMessage(e));
  }
  history.replaceState(null, '', location.pathname);
}

export async function signOut() {
  await stopPresence();
  return fbSignOut(auth);
}

function authMessage(e) {
  const messages = {
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/invalid-action-code': 'Ce lien de connexion a expiré ou a déjà servi. Demandez-en un nouveau.',
    'auth/expired-action-code': 'Ce lien de connexion a expiré. Demandez-en un nouveau.',
    'auth/quota-exceeded': 'Trop de liens envoyés aujourd’hui. Réessayez demain ou utilisez un compte Google.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    'auth/unauthorized-domain': 'Ce site n’est pas autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés).',
    'auth/network-request-failed': 'Pas de connexion Internet.',
  };
  return messages[e.code] || `Erreur de connexion (${e.code || e.message}).`;
}

function dbMessage(e) {
  return e.code === 'permission-denied'
    ? 'Action refusée : vous n’avez pas les droits nécessaires.'
    : `Erreur de synchronisation (${e.code || e.message}).`;
}

/* ------------------------------ Écriture -------------------------------- */

// Champs ajoutés après coup (photo, lieu de décès, autres prénoms, décédé, nationalité, séparations, métier) omis quand ils sont vides : une fiche qui ne les
// utilise pas reste acceptée par des règles Firestore plus anciennes. set() remplace le document,
// donc vider un de ces champs le retire bien.
const OPTIONAL = ['photo', 'deathPlace', 'middleNames', 'deceased', 'birthCountry', 'separatedIds', 'occupation'];
const personData = ({ id, ...rest }) => {
  for (const k of OPTIONAL) if (!rest[k] || (Array.isArray(rest[k]) && !rest[k].length)) delete rest[k];
  return rest;
};

/**
 * Enregistre une action (ex. « Ajout de Jean Martin ») : les fiches modifiées
 * et une entrée d'historique avec l'état avant/après, dans une même écriture groupée.
 * `changes` = [{ id, before: personne|null, after: personne|null }]
 */
export async function commit(changes, label) {
  const parts = Math.ceil(changes.length / BATCH_SIZE);
  for (let i = 0; i < parts; i++) {
    const chunk = changes.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batch = writeBatch(db);
    for (const c of chunk) {
      const ref = doc(db, 'people', c.id);
      if (c.after) batch.set(ref, { ...personData(c.after), updatedBy: user.uid, updatedAt: serverTimestamp() });
      else batch.delete(ref);
    }
    batch.set(doc(collection(db, 'history')), {
      label: parts > 1 ? `${label} (${i + 1}/${parts})` : label,
      changes: chunk.map((c) => ({ id: c.id, before: c.before && personData(c.before), after: c.after && personData(c.after) })),
      byUid: user.uid,
      byEmail: user.email,
      byName: user.displayName || '',
      at: serverTimestamp(),
    });
    // Sans réseau, la promesse n'aboutit qu'au retour de la connexion : on ne l'attend
    // pas pour les parties suivantes, le cache local est déjà à jour.
    const done = batch.commit().catch((e) => { throw new Error(dbMessage(e)); });
    if (i === parts - 1) return done;
    done.catch(() => {});
  }
}

/* -------------------------------- Photos -------------------------------- */
// Une photo n'est jamais modifiée : changer de photo en crée une nouvelle. Ainsi l'historique
// (et l'annulation) de la fiche, qui ne garde que l'identifiant, retrouve toujours la bonne image.

export async function savePhoto(id, data, personId) {
  try {
    await setDoc(doc(db, 'photos', id), { data, personId, by: user.uid, at: serverTimestamp() });
  } catch (e) {
    throw new Error(dbMessage(e));
  }
}

export async function getPhoto(id) {
  const snap = await getDoc(doc(db, 'photos', id));
  return snap.exists() ? snap.data().data : '';
}

/* ------------------------- Historique et membres ------------------------ */

export function watchHistory(cb, onError) {
  return onSnapshot(
    query(collection(db, 'history'), orderBy('at', 'desc'), limit(200)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data(), at: d.data().at?.toDate() || new Date() }))),
    (e) => onError(dbMessage(e))
  );
}

/* --------------------------- Demandes d'accès --------------------------- */

function requestAccess(u) {
  setDoc(doc(db, 'requests', u.email.toLowerCase()), {
    name: u.displayName || '',
    uid: u.uid,
    at: serverTimestamp(),
  }).catch(() => {}); // règles pas encore à jour : sans gravité, l'admin peut ajouter l'adresse à la main
}

export function watchRequests(cb, onError) {
  return onSnapshot(
    collection(db, 'requests'),
    (s) => cb(s.docs.map((d) => ({ email: d.id, ...d.data(), at: d.data().at?.toDate() || new Date() }))),
    (e) => onError(dbMessage(e))
  );
}

export const removeRequest = (email) => deleteDoc(doc(db, 'requests', email)).catch(() => {});

export function watchMembers(cb, onError) {
  return onSnapshot(
    collection(db, 'members'),
    (s) => cb(s.docs.map((d) => ({ email: d.id, ...d.data() }))),
    (e) => onError(dbMessage(e))
  );
}

export async function setMember(email, role) {
  try {
    const id = email.trim().toLowerCase();
    // merge : on garde la fiche que le membre a choisie (« c'est moi »).
    await setDoc(doc(db, 'members', id), { role, addedBy: user.email }, { merge: true });
    removeRequest(id); // la demande éventuelle est traitée
  } catch (e) {
    throw new Error(dbMessage(e));
  }
}

/** « Ma fiche » : chaque membre peut indiquer quelle fiche de l'arbre le représente. */
export async function setMyPerson(personId) {
  try {
    await updateDoc(doc(db, 'members', user.email.toLowerCase()), { personId });
  } catch (e) {
    throw new Error(dbMessage(e));
  }
}

/** Administrateur : efface la fiche choisie par un membre (il la choisira à nouveau). */
export async function resetMemberPerson(email) {
  try {
    await setDoc(doc(db, 'members', email), { personId: '' }, { merge: true });
  } catch (e) {
    throw new Error(dbMessage(e));
  }
}

export async function removeMember(email) {
  try {
    await deleteDoc(doc(db, 'members', email));
  } catch (e) {
    throw new Error(dbMessage(e));
  }
}

/* ------------------------- Personnes connectées ------------------------- */
// Firestore ne signale pas les déconnexions : chaque appareil connecté met à jour sa ligne
// presence/<uid> toutes les minutes tant que la page est visible. Est « en ligne » celui dont
// la dernière mise à jour date de moins de PRESENCE_TTL. Aucune adresse e-mail n'y est stockée.

const PRESENCE_EVERY = 60 * 1000;
export const PRESENCE_TTL = 150 * 1000;
let presenceInfo = null; // { name, personId } tant que la présence est active
let presenceTimer = null;

function beat() {
  if (!presenceInfo || !user || document.visibilityState !== 'visible') return;
  setDoc(doc(db, 'presence', user.uid), { ...presenceInfo, at: serverTimestamp() }).catch(() => {});
}

function onVisibility() {
  if (document.visibilityState === 'visible') beat();
  else if (user) deleteDoc(doc(db, 'presence', user.uid)).catch(() => {}); // départ : au mieux
}

/** Signale sa présence (à rappeler quand « ma fiche » change). */
export function startPresence(info) {
  const changed = JSON.stringify(info) !== JSON.stringify(presenceInfo);
  presenceInfo = info;
  if (!presenceTimer) {
    presenceTimer = setInterval(beat, PRESENCE_EVERY);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    beat();
  } else if (changed) beat();
}

export async function stopPresence() {
  if (presenceTimer) {
    clearInterval(presenceTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onVisibility);
  }
  presenceTimer = null;
  presenceInfo = null;
  if (user) await deleteDoc(doc(db, 'presence', user.uid)).catch(() => {});
}

/** Liste des présences : [{ uid, name, personId, at: Date }] (les anciennes sont filtrées par l'appelant). */
export function watchPresence(cb) {
  return onSnapshot(collection(db, 'presence'), (s) =>
    cb(s.docs.map((d) => {
      const data = d.data({ serverTimestamps: 'estimate' });
      return { uid: d.id, name: data.name || '', personId: data.personId || '', at: data.at?.toDate() || new Date(0), me: d.id === user?.uid };
    })),
  () => cb([]));
}
