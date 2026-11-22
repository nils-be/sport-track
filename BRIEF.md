# Brief projet : app perso de suivi sportif (course + natation)

## 1. Contexte

Je fais régulièrement de la course à pied et de la natation avec une montre Garmin Forerunner. Aujourd'hui, j'envoie mes séances à un LLM pour qu'il me les débriefe, à la main, séance par séance.

Je veux une application personnelle, pour moi seul, qui remplace ce process : j'importe mes séances, l'app les analyse, un LLM les débriefe en tenant compte de mon historique, et j'ai une vue d'ensemble de mon entraînement. Elle ne remplace pas Garmin Connect, elle le complète.

Je veux vibecoder l'application, tu t'occupes de la majorité du travail technique.

## 2. Contraintes non négociables

- **Gratuit**, à l'exception de l'API du LLM. Pas de serveur payant, pas de base de données payante.
- **Aucun serveur à maintenir** en V1. Tout tourne dans le navigateur.
- **Usage strictement personnel**, un seul utilisateur.
- **Mobile d'abord** : utilisée principalement sur mon téléphone Android, installée comme PWA depuis Chrome. Elle doit aussi fonctionner correctement sur ordinateur.
- **Interface en français.**
- **Confidentialité** :
  - Seules les données de séances sont traitées. Aucune donnée de santé générale (sommeil, VFC, stress, poids…).
  - Mes clés d'API ne doivent jamais apparaître dans le code, dans le dépôt Git, dans les logs, ni dans cette conversation. Je les saisis moi-même dans l'écran de réglages de l'app. Ne me demande jamais de te les coller.
  - Mes fichiers FIT (qui contiennent mes traces GPS) ne doivent jamais être commités. Le dossier `samples/` est dans le `.gitignore`.

## 3. Périmètre de la V1

### 3.1 Import manuel des séances

- J'exporte mes séances depuis Garmin Connect (fichier « original », un `.zip` contenant un `.fit`, ou directement un `.fit`) et je les importe dans l'app.
- L'import accepte les `.fit` et les `.zip`, et plusieurs fichiers à la fois.
- Décodage des fichiers FIT dans le navigateur avec le SDK officiel de Garmin (`@garmin/fitsdk`).
- Détection des doublons : réimporter une séance déjà présente ne crée pas de doublon.
- Sports gérés : course à pied (extérieur et tapis) et natation (piscine et eau libre). Un fichier d'un autre sport est refusé avec un message clair.
- Bonus si simple : déclarer la PWA comme cible de partage Android (Web Share Target), pour pouvoir « partager » un fichier `.fit` téléchargé directement vers l'app.

### 3.2 Analyse par le code (pas par le LLM)

Pour chaque séance, le code extrait et calcule :

- **Commun** : date, durée, distance, fréquence cardiaque moyenne et max, calories, temps passé dans chaque zone cardiaque.
- **Course** : allure moyenne, allure par tour et par kilomètre, dénivelé, cadence, dérive cardiaque (évolution de la FC à allure comparable entre la première et la seconde moitié).
- **Natation** : allure au 100 m, nombre de longueurs, longueur du bassin, type de nage par longueur, SWOLF, structure des séries et des repos en piscine.

Zones cardiaques : utiliser celles contenues dans le fichier FIT si elles y sont. Sinon, utiliser celles saisies dans les réglages (FC max et bornes des zones, avec des valeurs par défaut calculées à partir de la FC max).

### 3.3 Débrief par le LLM

- Après chaque import, chaque nouvelle séance est débriefée **une seule fois**, automatiquement. Le débrief est enregistré et n'est jamais regénéré sauf si je clique sur « Regénérer ».
- **Le LLM ne reçoit jamais les données brutes seconde par seconde.** Il reçoit un JSON compact préparé par le code, contenant :
  1. la séance analysée (indicateurs ci-dessus, tours ou séries) ;
  2. le **carnet du coach** (voir 3.4) ;
  3. mes statistiques récentes calculées par le code (volume des 4 dernières semaines par sport, tendances) ;
  4. le résumé de 2 ou 3 séances passées comparables (même sport, type d'effort et distance proches).
- La taille de ce qu'on envoie doit rester à peu près constante, quel que soit le nombre de séances en base.
- Le débrief est rédigé en français, ton de coach bienveillant mais franc, structuré en : ce qui s'est bien passé, points d'attention, comparaison avec les séances similaires, conseil pour la suite. Concis : lisible en une minute sur téléphone.
- Le LLM répond en JSON structuré contenant le débrief et la nouvelle version du carnet du coach. Le parsing doit être robuste (retirer les éventuelles balises de code, gérer les erreurs proprement).
- Afficher le coût estimé de chaque appel (tokens d'entrée et de sortie × tarif du modèle) et le cumul du mois.

**Fournisseurs** : choix dans les réglages entre l'API Claude et l'API Gemini.

- Claude : appel direct depuis le navigateur avec l'en-tête `anthropic-dangerous-direct-browser-access: true`. Modèle par défaut `claude-haiku-5-5`, option `claude-sonnet-5-5`. Vérifie la documentation officielle à jour (format de requête, tarifs) avant d'implémenter.
- Gemini : vérifie dans la documentation officielle le nom du modèle et le format d'appel actuels.
- Les identifiants de modèles et les tarifs sont configurables dans un seul fichier, pour pouvoir les mettre à jour facilement.

### 3.4 Mémoire : le carnet du coach

- Un texte court (maximum environ 1 500 mots) qui résume ce que le coach sait de moi : objectifs, points forts, points faibles, tendances, ce qui a bien ou mal marché, contexte (blessure, fatigue…).
- Le LLM le met à jour après chaque débrief en intégrant ce qui est important et en retirant ce qui est périmé.
- Je peux le lire et le modifier moi-même dans l'app (par exemple pour ajouter « objectif semi-marathon en mars » ou « genou qui tire »).
- Conserver les 10 dernières versions pour pouvoir revenir en arrière.

### 3.5 Écrans

1. **Accueil / tableau de bord** : semaine en cours (volume et nombre de séances par sport), dernières séances avec un extrait du débrief, bouton d'import bien visible.
2. **Liste des séances** : filtrable par sport, triée par date.
3. **Détail d'une séance** : indicateurs clés, graphique allure et FC (course), tableau des tours ou des séries/longueurs (natation), temps par zone, débrief complet.
4. **Progression** : volume hebdomadaire par sport sur les derniers mois, évolution de l'allure moyenne, records simples (meilleur 5 km, 10 km, meilleur 100 m, etc.).
5. **Carnet du coach** : lecture, édition, historique des versions.
6. **Réglages** : fournisseur et modèle du LLM, clé API, FC max et zones, suivi des coûts, export et import d'une sauvegarde complète (JSON contenant tout sauf les clés), effacement des données.

### 3.6 Hors périmètre V1 (mais à anticiper dans l'architecture)

- **V2 : planification.** L'IA propose une semaine d'entraînement selon mes objectifs et mes séances récentes, je valide ou modifie, et l'app compare le prévu au réalisé. Les séances ne seront pas envoyées sur la montre.
- **V3 : synchronisation automatique via l'API personnelle Garmin Connect.** L'API refuse les appels depuis un navigateur (CORS), il faudra donc un relais Cloudflare Workers (gratuit) qui : stocke ma clé Garmin comme secret, échange la clé contre un jeton d'accès valable 24 h, vérifie que la requête vient bien de mon app (secret partagé), et ne transmet qu'une **liste blanche d'endpoints** (activités, téléchargement du fichier FIT, zones cardiaques). Respecter les conditions de l'API : usage personnel, sobriété des requêtes, nouvelles séances uniquement.

Concrètement, l'import d'une séance doit passer par une fonction unique qui prend un fichier FIT en entrée, pour que la V3 n'ait qu'à brancher une autre source de fichiers.

## 4. Stack technique

- Vite + React + TypeScript
- Tailwind CSS
- Recharts pour les graphiques
- Dexie (IndexedDB) pour le stockage local
- `vite-plugin-pwa` pour le manifeste et le service worker (fonctionnement hors ligne pour la consultation)
- `@garmin/fitsdk` pour décoder les fichiers FIT, `fflate` ou équivalent pour les `.zip`
- Hébergement : GitHub Pages, déploiement automatique par GitHub Actions à chaque push sur `main`

Si un de ces choix pose un vrai problème, propose une alternative et explique pourquoi avant de changer.

Design : sobre, lisible, mode sombre et clair selon le réglage du téléphone, pensé pour une utilisation au pouce.

## 5. Plan de travail

**Phase 0 : vérifications (avant toute interface)**

- Je dépose dans `samples/` au moins une séance de course et une séance de natation en piscine, exportées depuis Garmin Connect.
- Écris un petit script qui décode ces fichiers avec `@garmin/fitsdk` et affiche ce qu'ils contiennent réellement : tours, longueurs, type de nage, SWOLF, zones cardiaques, données par seconde.
- Fais-moi un compte rendu simple de ce qui est disponible et de ce qui manque, et adapte le périmètre de 3.2 si besoin.

**Phase 1 : socle**

Projet initialisé, import FIT/ZIP, décodage, analyse, stockage, liste et détail des séances
**Phase 2 : LLM**

Réglages, appel LLM, débrief automatique, carnet du coach, suivi des coûts.

**Phase 3 : vue d'ensemble et finitions**

Tableau de bord, progression, sauvegarde/restauration, PWA installable, déploiement sur GitHub Pages.

À la fin de chaque phase : vérifie toi-même que tout fonctionne (tests, et contrôle visuel de l'interface dans un navigateur avec un format d'écran mobile), puis fais-moi un court résumé de ce qui marche et de ce que je dois tester.

## 6. Définition de « terminé » pour la V1

- J'ouvre l'app sur mon téléphone depuis l'écran d'accueil.
- J'importe un fichier de course ou de natation exporté depuis Garmin Connect.
- En moins d'une minute, je vois la séance analysée et son débrief, qui fait référence à mes séances précédentes.
- Le tableau de bord et la page progression se mettent à jour.
- Je peux exporter une sauvegarde et la restaurer.
- Aucune clé ni aucun fichier personnel n'est présent dans le dépôt Git.

## 7. Ce que j'aurai à faire (à me guider pas à pas le moment venu)

- Exporter quelques séances depuis Garmin Connect et les déposer dans `samples/`.
- Créer le dépôt GitHub et activer GitHub Pages.
- Créer une clé API (Claude ou Gemini) et la saisir dans les réglages de l'app.
- Installer l'app sur mon téléphone depuis Chrome.
