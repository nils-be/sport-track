# Phase 0 — Contenu réel des fichiers FIT

Fichiers analysés (script `npm run inspect`, SDK `@garmin/fitsdk` 21.222) :

| Fichier | Montre | Sport | Contenu |
|---|---|---|---|
| `cap_ex.fit` | Forerunner 170 | `running / generic` | Fractionné 12×300 m + 4×1 km, 11,6 km, 67 min |
| `nat_ex.fit` | Forerunner 55 | `swimming / lapSwimming` | Piscine de 50 m, 1 600 m, 52 min |

Les deux fichiers sont intègres (CRC OK) et décodés sans erreur. Fréquence d'enregistrement : 1 point par seconde.

## Course — disponible

- **Session** : date, durées (chrono et écoulée), distance, FC moy/max, calories, D+/D-, vitesse moy/max, vitesse ajustée à la pente (`avgGradeAdjustedSpeed`), cadence, puissance (moy/max/normalisée), dynamiques de course (temps de contact au sol, oscillation, ratio vertical, longueur de pas), Training Effect aérobie/anaérobie, charge d'entraînement, température.
- **Tours** (`lapMesgs`) : mêmes indicateurs pour chaque tour, plus `lapTrigger` (manuel/distance/fin). Le champ `intensity` vaut `interval` pour tous les tours, il n'apporte donc rien.
- **Structure du fractionné** : `splitMesgs` / `splitSummaryMesgs` avec `splitType` = `intervalWarmup`, `intervalActive`, `intervalRecovery`, `intervalRest`, et une détection course/marche/arrêt (`rwdRun`, `rwdWalk`, `rwdStand`). C'est exploitable pour distinguer effort et récupération.
- **Par seconde** : distance, vitesse, altitude, FC (100 %), cadence, puissance, dynamiques de course, GPS.
- **Zones FC** : `timeInZoneMesgs` donne les zones de la session, de chaque tour et de chaque fraction (`hrZoneHighBoundary` = [97, 116, 135, 154, 174, 193], FC max 193, calcul en % de FC max).

## Course — à calculer ou à adapter

- **Cadence** : le FIT donne des cycles par minute (une jambe). Pas par minute = (`avgRunningCadence` + `avgFractionalCadence`) × 2, soit ≈ 138 pas/min ici.
- **Allure par km** : absente quand les tours sont manuels. On la calcule à partir de la distance par seconde.
- **Dérive cardiaque** : sans signification sur un fractionné. On la calcule seulement sur une séance ou un bloc continu (≥ 20 min, allure stable, à partir de la vitesse ajustée à la pente), sinon « non applicable ».

## Natation piscine — disponible

- **Session** : longueur du bassin (`poolLength` 50, `metric`), longueurs actives (32), SWOLF moyen (89), mouvements par longueur, cadence de nage, temps actif (`activeTime`, hors repos), FC moy/max, calories.
- **Longueurs** (`lengthMesgs`) : type `active`/`idle` (repos), nage (`freestyle`, `breaststroke`…), durée, nombre de mouvements, cadence.
- **Tours** : alternance série nagée / repos (repos = tour à 0 m). Les séries mélangeant deux nages ont la nage `mixed`.
- **FC par seconde** : présente (100 % des points).
- **Zones FC** : un message par tour, plus un message de session placé en dernier. Il faut le repérer par `referenceMesg`, pas par sa position.

## Natation — absent ou à calculer

- **Pas de distance ni de vitesse seconde par seconde.** Le graphique d'allure se fait par longueur.
- **SWOLF par longueur** : non fourni. Calcul : durée + mouvements. La moyenne recalculée (88,7) correspond à celle de Garmin (89).
- **FC par longueur** : absente. On la reconstitue à partir des timestamps de la FC par seconde.
- **Allure au 100 m** : à calculer sur le temps actif, sans les repos.
- **Nage au niveau de la session** : absente. On la reconstitue à partir des longueurs.
- **Tours parasites** de 0 à 2 s en fin de séance : à filtrer.

## Points d'attention généraux

- **Deux montres avec des réglages de FC différents** : FR170 (FC max 193) et FR55 (FC max 198). Les zones lues dans chaque fichier sont donc cohérentes avec la montre, mais pas entre les deux sports. À garder en tête pour la page Progression.
- **Données de profil** : `userProfileMesgs` contient poids, taille, sexe, FC de repos, heures de sommeil. **Ces champs ne seront jamais lus ni stockés par l'app** (contrainte de confidentialité).
- **Puissance, dynamiques de course, Training Effect** : disponibles mais hors brief. On les stocke en bonus, avec un affichage discret.
- **Sans fichier d'eau libre ni de tapis**, ces cas n'ont pas été vérifiés : ils seront traités de façon défensive (pas de longueurs en eau libre, pas de GPS sur tapis).
