// Configuration de l'application.
//
// firebase: null  → mode local : les données restent sur le téléphone (export/import de fichiers).
// firebase: {...} → mode partagé : arbre commun en ligne, avec connexion et droits par personne.
//                   Valeurs données par la console Firebase
//                   (Paramètres du projet → Vos applications → Application Web).
//                   Elles ne sont pas secrètes : la protection vient des règles (firestore.rules).
window.APP_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDxqSXKng7O4KBSsixs8160VKpTrnh2bmc',
    authDomain: 'family-tree-680c0.firebaseapp.com',
    projectId: 'family-tree-680c0',
    storageBucket: 'family-tree-680c0.firebasestorage.app',
    messagingSenderId: '691822538094',
    appId: '1:691822538094:web:32cc3359f5eef342e4e57f',
  },
};
