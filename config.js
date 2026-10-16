// Configuration de l'application.
//
// firebase: null  → mode local : les données restent sur le téléphone (export/import de fichiers).
// firebase: {...} → mode partagé : arbre commun en ligne, avec connexion et droits par personne.
//                   Collez ici l'objet « firebaseConfig » donné par la console Firebase
//                   (Paramètres du projet → Vos applications → Application Web).
//                   Ces valeurs ne sont pas secrètes : la protection vient des règles (firestore.rules).
window.APP_CONFIG = {
  firebase: null,
};
