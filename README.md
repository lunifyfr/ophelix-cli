# Ophelix en ligne de commande

L'outil en ligne de commande de l'[API Ophelix](https://docs.ophelix.fr), pour développer une intégration en mode test :

- se connecter à son organisation depuis le terminal ;
- recevoir les webhooks sur son poste, sans tunnel ni port ouvert ;
- déclencher les scénarios du simulateur ;
- suivre ses requêtes en direct.

Il ne travaille qu'en mode test : une clé de production est refusée.

## Installation

Un binaire autonome par système, ou le paquet npm pour Node 20.3 et plus :

```bash
npm install --global @ophelix/cli
```

## Se connecter

```bash
ophelix login
```

Le terminal affiche un code et ouvre le tableau de bord. Vérifiez que le code est le même, puis autorisez. Le terminal reçoit une clé restreinte de test, valable 90 jours, nommée « Ligne de commande » avec le nom de la machine, et révocable dans **Développeurs › Clés API**.

Pour se connecter avec une clé de test existante : `ophelix login --api-key sk_test_…`.

La connexion se garde dans `~/.config/ophelix/config.json` (ou `$XDG_CONFIG_HOME/ophelix`, ou `$OPHELIX_CONFIG_DIR`), en droits 600. `ophelix logout` l'oublie, et révoque la clé si le terminal l'a reçue du tableau de bord.

## Recevoir les webhooks

```bash
ophelix listen --forward-to localhost:3000/hooks
```

L'outil relève les événements du mode test toutes les deux secondes et les rejoue vers votre serveur local, avec le corps exact d'une livraison et l'en-tête `Ophelix-Signature`. Le secret de signature du relais s'affiche au démarrage, et `ophelix listen --print-secret` le donne seul. Il n'est celui d'aucun point de terminaison : votre serveur local le garde à part.

`--events claim.*,batch.failed` ne garde que certains types. `--forward-to` ne vise que ce poste : `localhost`, `127.0.0.1` ou `[::1]`.

## Déclencher un scénario

```bash
ophelix trigger claim.paid
ophelix trigger --list
ophelix trigger coverage.retrieved --vitale vitale_rights_closed
```

Chaque déclenchement passe par les routes publiques du simulateur : il crée des objets de test, que le tableau de bord montre, et dont `ophelix listen` relaie les événements. `ophelix scenarios` liste les cartes de test.

## Suivre les requêtes

```bash
ophelix logs tail --status 4xx
```

## Options communes

| Option | Variable | Sens |
| --- | --- | --- |
| `--api-key` | `OPHELIX_API_KEY` | Une clé de test, à la place de la connexion gardée |
| `--api-url` | `OPHELIX_API_URL` | Une autre API, `https://api.ophelix.fr` par défaut |
| | `OPHELIX_CONFIG_DIR` | Le dossier de la configuration |
| | `NO_COLOR` | Sans couleur |

Le guide complet : [Ligne de commande](https://docs.ophelix.fr/guides/ligne-de-commande).
