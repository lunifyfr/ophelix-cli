# Journal des versions

Ce journal suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et l'outil le [versionnage sémantique](https://semver.org/lang/fr/).

## [Non publié]

## 0.1.0

Première version, sur la version `2026-11-01` de l'API.

- `ophelix login` : connexion par un terminal autorisé dans le tableau de bord, ou par une clé de test collée. Configuration en droits 600.
- `ophelix listen` : relais des événements du mode test vers un serveur local, signés par le secret du relais.
- `ophelix trigger` : les événements du cycle d'une facture, par les routes du simulateur.
- `ophelix logs tail` : les requêtes du mode test en direct.
- Un fichier pour Node 20.3 et plus, sans dépendance, et un binaire autonome par système.
