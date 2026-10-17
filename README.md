# Arbre familial

Application web d'arbre généalogique pensée pour le **smartphone** : une page HTML,
du JavaScript sans aucune dépendance, utilisable **hors ligne** et installable
sur l'écran d'accueil (PWA).

## Deux modes

| | **Mode local** (par défaut) | **Mode partagé** |
|---|---|---|
| Données | Sur le téléphone seulement | Dans une base en ligne commune (Firebase) |
| Partage | Export / import de fichiers | Tout le monde voit le même arbre, mis à jour en direct |
| Connexion | Aucune | Compte Google **ou** lien reçu par e-mail |
| Droits | — | Lecture seule, Peut modifier, Administrateur |
| Historique | — | Qui a modifié quoi et quand, avec annulation |

Le mode est choisi dans `config.js` : `firebase: null` = local ; une configuration Firebase = partagé.

## Fonctionnalités

- Fiche par personne : prénom, nom, sexe, date et lieu de naissance, date de décès, notes.
- Dates partielles acceptées : `24/05/1952`, `05/1952` ou `1952` (les dates impossibles comme 31/02 sont refusées).
- Parenté : père, mère, conjoint(s). Enfants et frères/sœurs sont **déduits automatiquement**.
  Les liens impossibles (être son propre ancêtre) sont bloqués.
- Liste avec recherche (insensible aux accents).
- **Arbre interactif** : on le déplace au doigt, on zoome à deux doigts (ou avec les boutons + / − / ⤢).
  Toucher une personne la **centre** (animation) ; la toucher à nouveau ouvre sa fiche.
- **Boîte à outils** (bouton « Affichage ») :
  - *Entourage*, *Ancêtres* ou *Descendants* ;
  - curseur **Niveaux** : 0 = la personne seule ; 1 = conjoints, parents, frères et sœurs, enfants ;
    2 = on ajoute les personnes à deux liens (grands-parents, oncles et tantes, neveux, petits-enfants, beaux-parents…), etc.
    En mode Ancêtres / Descendants, le niveau compte les générations ;
  - informations affichées sur les cartes : photo, années, date et lieu de naissance, âge.
  Ces réglages sont mémorisés sur chaque téléphone.
- **Photos** : sur la fiche d'une personne, « Ajouter une photo » (galerie ou appareil photo).
  La photo est recadrée en carré et réduite (≈ 20–40 Ko) pour rester légère.
- Export **JSON** et **GEDCOM 5.5.1** (format standard des logiciels de généalogie), import JSON avec fusion.
- Fonctionne hors connexion et s'installe sur l'écran d'accueil (« Ajouter à l'écran d'accueil »).

Mode partagé en plus :
- **Droits** : chaque membre est ajouté par son adresse e-mail. Par défaut on le met en *Lecture seule* ;
  l'administrateur peut passer quelqu'un en *Peut modifier* (menu ⋮ → Membres et droits d'accès).
  Une personne connectée mais pas encore ajoutée voit « Accès en attente », et l'arbre s'ouvre tout seul dès qu'elle est ajoutée.
- **Historique** (menu ⋮ → Historique) : chaque action (ajout, modification, suppression, import) est
  enregistrée avec son auteur, sa date et l'état avant/après. « Annuler cette modification » remet les fiches dans leur état d'avant
  (et devient elle-même une ligne de l'historique). L'historique ne peut être ni modifié ni effacé depuis l'application.
- Ces droits sont vérifiés **par le serveur** (`firestore.rules`), pas seulement par l'affichage :
  un membre en lecture seule ne peut pas écrire même en bricolant la page.
- Hors connexion : on peut consulter et modifier, la synchronisation se fait au retour du réseau.

## Mettre en place le mode partagé (≈ 15 minutes, une seule fois)

Les noms des menus de la console Firebase peuvent varier légèrement selon les versions.

1. **Créer le projet** : aller sur <https://console.firebase.google.com>, « Créer un projet »
   (Google Analytics n'est pas nécessaire). Le forfait gratuit *Spark* suffit.
2. **Déclarer l'application web** : sur la page du projet, bouton `</>` (Web), donner un nom,
   puis copier l'objet `firebaseConfig` affiché dans `config.js` à la place de `null` :
   ```js
   window.APP_CONFIG = {
     firebase: { apiKey: "…", authDomain: "….firebaseapp.com", projectId: "…", appId: "…" },
   };
   ```
   Ces valeurs ne sont pas secrètes (elles sont visibles dans toute page web Firebase) ; la protection vient des règles.
3. **Connexion** : *Authentication* → *Commencer* → *Sign-in method* :
   - activer **Google** ;
   - activer **Adresse e-mail/Mot de passe**, puis dans ce même fournisseur cocher **Lien envoyé par e-mail (connexion sans mot de passe)**.
   - *Authentication* → *Paramètres* → *Domaines autorisés* : ajouter l'adresse du site, par ex. `moncompte.github.io`.
4. **Base de données** : *Firestore Database* → *Créer une base de données* → choisir un emplacement en Europe
   → mode **production**. Onglet *Règles* : remplacer tout par le contenu de `firestore.rules`, puis *Publier*.
5. **Se déclarer administrateur** : *Firestore Database* → *Données* → *Commencer une collection*
   - ID de la collection : `members`
   - ID du document : votre adresse e-mail **en minuscules**
   - champ `role` (type chaîne) = `admin`
6. **Publier le site** : pousser `config.js` sur GitHub et activer GitHub Pages (voir plus bas).
7. Ouvrir le site, se connecter, puis menu ⋮ → **Membres et droits d'accès** pour ajouter la famille.
   Leur envoyer ensuite l'adresse du site.

### Limites du forfait gratuit à connaître

- **Liens de connexion par e-mail : 5 par jour pour tout le projet** sur le forfait gratuit
  (25 000 avec le forfait *Blaze*, qui demande une carte bancaire mais reste gratuit à ce niveau d'usage).
  Chaque personne n'en a besoin qu'une fois par appareil (la connexion est ensuite mémorisée) :
  pour inviter beaucoup de monde le même jour, privilégier Google pour ceux qui ont un compte, ou étaler les invitations.
  Source : [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits).
- Firestore gratuit : 50 000 lectures, 20 000 écritures par jour, 1 Go stocké
  ([tarifs Firestore](https://firebase.google.com/docs/firestore/pricing)). Ouvrir l'application lit environ une fois chaque fiche :
  avec 500 personnes, cela laisse de l'ordre de 100 ouvertures par jour.
- Le lien e-mail doit être ouvert **sur l'appareil où il a été demandé** ; sinon l'application redemande l'adresse.

### Vie privée

En mode partagé, l'arbre est stocké chez Google (Firebase), accessible seulement aux adresses autorisées.
Il contient des dates de naissance de personnes vivantes : il est prudent de prévenir les personnes concernées.
Sur un téléphone partagé, se déconnecter ne supprime pas la copie hors ligne déjà téléchargée par le navigateur.

## Lancer l'application en local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

### Mettre le site en ligne (gratuit)

**GitHub Pages** : Settings → Pages → branche `main`, dossier `/`. Adresse : `https://<compte>.github.io/family-tree/`.
Sur le téléphone : ouvrir le lien puis « Ajouter à l'écran d'accueil ».

GitHub Pages publie le **code** publiquement (et demande un abonnement payant pour un dépôt privé).
Les données de la famille, elles, ne sont jamais dans le dépôt.

### Tests

Les règles de sécurité sont testées sur l'émulateur Firebase (nécessite Node.js et Java 21) :

```sh
npm install
npm test
```

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, formulaires |
| `style.css` | Mise en page mobile, mode sombre, arbre en CSS pur |
| `app.js` | Données, parenté, rendu, export/import, GEDCOM, écrans du mode partagé |
| `config.js` | Choix du mode (local ou partagé) et configuration Firebase |
| `tree.js` | Arbre interactif : calcul de l'entourage, placement des cartes, déplacement et zoom |
| `cloud.js` | Mode partagé : connexion, synchronisation, historique, membres, photos |
| `firestore.rules` | Règles de sécurité de la base (droits, historique non modifiable) |
| `tests/` | Tests des règles sur l'émulateur Firebase |
| `manifest.webmanifest`, `icon.svg` | Installation sur l'écran d'accueil |
| `sw.js` | Service worker (fonctionnement hors ligne) |

Format d'une personne (JSON) :

```json
{ "id": "p…", "firstName": "Jean", "lastName": "Martin", "sex": "M",
  "birthDate": "1930-04-12", "birthPlace": "Lyon", "deathDate": "",
  "fatherId": "", "motherId": "", "spouseIds": ["p…"], "notes": "" }
```

## Références

- [family-chart (donatso)](https://github.com/donatso/family-chart) — bibliothèque D3 open source (MIT) pour des arbres interactifs ; candidate si l'on veut un affichage plus riche (zoom, édition dans l'arbre).
- [js-family-tree](https://github.com/c2-mrinal/js-family-tree) — alternative plus légère.
- [GEDCOM (Wikipédia)](https://en.wikipedia.org/wiki/GEDCOM) et [errata GEDCOM 5.5.1 (gedcom.io)](https://gedcom.io/gedcom551-errata/) — format d'échange : les liens passent par des enregistrements `FAM` (HUSB / WIFE / CHIL).
- [webtrees](https://webtrees.net/) et [Gramps](https://gramps-project.org/) — logiciels open source de référence, à envisager si le projet grandit (webtrees = site familial partagé avec comptes, mais nécessite un hébergement PHP).
- [Firebase Authentication – lien par e-mail](https://firebase.google.com/docs/auth/web/email-link-auth) et [connexion avec redirection sur les navigateurs bloquant le stockage tiers](https://firebase.google.com/docs/auth/web/redirect-best-practices).
- PWA : manifeste + service worker + HTTPS sont nécessaires pour l'installation et le mode hors ligne ([MDN – Progressive web apps](https://developer.mozilla.org/fr/docs/Web/Progressive_web_apps)).
