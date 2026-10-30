# Déploiement sur le Raspberry Pi

La méthode par défaut, validée par l'utilisateur le 30 octobre 2026, est le
transfert des développements locaux par SCP/SSH via le Wi-Fi du Pi. Ne pas
chercher à connecter le Pi à Internet pour une mise à jour ordinaire.

- Réseau : `NOOLS-HOSTAPD`, Pi `192.168.50.1`, utilisateur SSH `alois`.
- Application : `/home/alois/led-screen-controller`.
- Service : `led-screen.service`.
- Procédure de référence : [RASPBERRY_PI_RUNBOOK.md, section 9](RASPBERRY_PI_RUNBOOK.md#9-mise-à-jour-par-scp-et-ssh-méthode-par-défaut).

Préparer une archive du code local (y compris les nouveaux fichiers utiles),
préserver les réglages et données du Pi, sauvegarder avant remplacement, puis
redémarrer uniquement le service applicatif. Ne pas modifier le Wi-Fi AP ou le
profil Ethernet du panneau. Ne jamais copier les `node_modules` Windows vers
le Pi. Si les dépendances changent, préparer une stratégie compatible Linux
ARM avant le déploiement. Le transfert ne constitue ni un commit ni un push.
