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

## Déploiement

Chaque push sur `main` déclenche `.github/workflows/deploy.yml`, qui publie `dist/` sur GitHub Pages.
Prérequis : dans le dépôt GitHub, Settings › Pages › Source = « GitHub Actions ».
