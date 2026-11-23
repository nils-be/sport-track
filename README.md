# Sport Track

Application personnelle (PWA) de suivi de course à pied et de natation : import des fichiers FIT
de Garmin Connect, analyse dans le navigateur, débrief par un LLM (Claude ou Gemini) avec un
« carnet du coach » qui sert de mémoire, tableau de bord et progression.

Tout tourne dans le navigateur ; les données restent sur l'appareil (IndexedDB). Les clés API
se saisissent dans l'écran Réglages et ne sont jamais dans le code ni dans les sauvegardes.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # vérification des types + build de production dans dist/
```

Scripts utiles (fichiers FIT à déposer dans `samples/`, jamais commité) :

- `npm run inspect` : contenu brut des fichiers FIT ;
- `node scripts/check-analysis.mjs` : résultat de l'analyse de l'app ;
- `node scripts/preview-prompt.mjs` : JSON exact envoyé au LLM.

Modèles LLM et tarifs : `src/lib/llm/models.ts` (fichier unique à mettre à jour).

## Synchronisation Garmin

Le bouton ⟳ (en haut des écrans Coach et Séances) récupère les nouvelles séances de course et de natation
sur Garmin Connect, via l'**API personnelle** officielle de Garmin. Celle-ci refuse les appels depuis un
navigateur (CORS) : un petit relais Cloudflare Worker gratuit (`relay/`) s'en charge. Il garde la clé Garmin
en secret, l'échange contre un jeton de 24 h, n'accepte que les requêtes de l'app (origine + secret partagé)
et ne transmet que deux appels en lecture : la liste des séances course/natation et leur fichier FIT d'origine.

Mise en place (une fois) :

1. **Clé Garmin** : sur ordinateur, ouvrir <https://connect.garmin.com/app/settings/personalApiToken>,
   « Create Key », accepter les conditions, choisir la durée (1 an conseillé) et copier la clé (affichée une seule fois).
2. **Secret partagé** : dans l'app, Réglages › Garmin Connect › « Générer », et copier la valeur.
3. **Relais** (compte Cloudflare gratuit requis) :
   ```bash
   cd relay
   npx wrangler login
   npx wrangler deploy                       # affiche l'adresse https://sport-track-garmin.<compte>.workers.dev
   npx wrangler secret put GARMIN_API_KEY    # coller la clé Garmin
   npx wrangler secret put APP_SECRET        # coller le secret partagé
   ```
4. Dans l'app, Réglages › Garmin Connect : coller l'adresse du relais, puis « Enregistrer et tester ».

Première synchro : 30 derniers jours. Ensuite : depuis la dernière séance connue. Une séance déjà présente
(même heure de départ à 2 min près, y compris importée à la main) n'est pas retéléchargée.
Quand la clé Garmin expire, en créer une nouvelle et refaire `npx wrangler secret put GARMIN_API_KEY`.
Les origines autorisées sont dans `relay/wrangler.toml` (`ALLOWED_ORIGINS`).

## Déploiement

Chaque push sur `main` déclenche `.github/workflows/deploy.yml`, qui publie `dist/` sur GitHub Pages.
Prérequis : dans le dépôt GitHub, Settings › Pages › Source = « GitHub Actions ».
