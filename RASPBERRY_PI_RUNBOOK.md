# Raspberry Pi — installation, exploitation et restauration

Dernière mise à jour : **17 septembre 2026**

Ce document décrit l'installation du contrôleur d'écran LED NOOLS sur la
Raspberry Pi, son état actuellement validé, les commandes d'exploitation et la
procédure permettant de reconstruire le système après une corruption de carte
SD.

> Les mots de passe ne sont volontairement pas inscrits dans Git. Ils se
> trouvent dans des fichiers locaux protégés sur la Pi et dans les QR codes
> conservés par l'équipe.

## 1. Architecture

```text
Téléphones / ordinateurs
          │
          │ Wi-Fi WPA2 : NOOLS-HOSTAPD
          │ Pi : 192.168.50.1
          ▼
  Raspberry Pi 3B
  Node.js / Express : port 3000
          │
          │ Ethernet ArtNet
          │ Pi : 2.0.0.200/8
          ▼
     Panneau LED
```

- Raspberry Pi : **Raspberry Pi 3B**, carte SD annoncée 32 Go.
- Système : Raspberry Pi OS / Debian Trixie 64 bits (`aarch64`).
- Noyau observé : `6.18.39+rpt-rpi-v8`.
- Utilisateur : `alois`.
- Hostname : `raspberrypi`.
- Application : `/home/alois/led-screen-controller`.
- Node.js observé : `v20.19.2`.
- npm observé : `9.2.0`.
- Dépôt : `github.com/AloisKyrou/led_screen_controller`, branche `main`.
- Panneau : 60 x 15 pixels, ArtNet UDP port 6454, univers 6 à 11.

## 2. État actuellement validé

Le fonctionnement suivant a été testé :

- démarrage automatique du serveur Node ;
- démarrage automatique du point d'accès après reboot ;
- connexion d'un téléphone au point d'accès ;
- administration depuis le téléphone ;
- affichage des effets sur le panneau par Ethernet ;
- accès de secours SSH par Ethernet direct.

Services attendus :

```text
led-screen.service             active
nools-ap-hostapd.service       active
nools-ap-dnsmasq.service       active
nools-captive-portal.service   active
wpa_supplicant.service         inactive
```

Adresses attendues :

```text
eth0     2.0.0.200/8
wlan0    192.168.50.1/24
```

URLs :

- page publique : `http://192.168.50.1:3000/message/`
- administration : `http://192.168.50.1:3000/admin/`
- serveur : `http://192.168.50.1:3000/`

Le compte d'administration est configuré localement sur la Pi. Le nom
d'utilisateur utilisé lors des essais est `admin`; vérifier le fichier
`/etc/led-screen-controller.env` pour la valeur réellement déployée.

## 3. Réseau actuel

### 3.1 Wi-Fi : point d'accès NOOLS

- SSID : `NOOLS-HOSTAPD`.
- Sécurité : WPA2-PSK / CCMP.
- Passphrase : dans `/etc/hostapd/hostapd-nools-test.conf`, fichier root.
- Adresse Pi : `192.168.50.1/24`.
- DHCP : `192.168.50.10` à `192.168.50.200`.
- Le point d'accès ne fournit actuellement **pas Internet**.
- L'isolation entre clients Wi-Fi est activée (`ap_isolate=1`).

Un portail captif est installé et validé sur Android. Il intercepte les noms DNS
sur ce réseau isolé, répond sur le port 80 puis redirige vers `/message/`. Le
téléphone peut ainsi ouvrir la page publique sans mode avion. Le réseau ne
fournit toujours pas Internet : il faut accepter l'option **Utiliser ce réseau
quand même** si Android ou iOS la propose.

### 3.2 Ethernet : panneau LED

- Profil NetworkManager : `led-panel`.
- Adresse Pi : `2.0.0.200/8`.
- Pas de passerelle Internet sur ce profil.
- Route de broadcast ArtNet : `255.255.255.255/32` via `eth0`.
- Application : envoi vers `255.255.255.255:6454`.

Vérification :

```bash
ip -4 -br address show eth0
ip route get 255.255.255.255
cat /sys/class/net/eth0/carrier
```

Résultat attendu pour la route :

```text
broadcast 255.255.255.255 dev eth0 src 2.0.0.200
```

`carrier` doit afficher `1` quand le câble est connecté.

### 3.3 Ethernet direct de secours

Pour dépanner sans Wi-Fi, connecter directement le PC et la Pi :

- Pi : `2.0.0.200/8` ;
- PC : adresse IPv4 manuelle `2.0.0.201`, masque `255.0.0.0` ;
- passerelle et DNS laissés vides.

Depuis PowerShell :

```powershell
ssh alois@2.0.0.200
```

### 3.4 Ancien mode hotspot téléphone

Le profil NetworkManager `Alok-hot` est conservé mais son autoconnect est
désactivé. L'ancien fonctionnement utilisait par exemple l'adresse
`10.162.101.156`, attribuée par le téléphone et donc susceptible de changer.

Le profil `router-dhcp`, utilisé pendant l'installation, est également conservé
avec autoconnect désactivé. Il a notamment fourni l'adresse `192.168.1.144` lors
des essais derrière un routeur.

## 4. Pourquoi NetworkManager ne gère plus wlan0

Le point d'accès WPA2 créé directement par NetworkManager fonctionnait sous
Windows mais échouait sur Android pendant le handshake WPA. Un point d'accès
`hostapd` séparé fonctionne correctement sur les deux.

Au boot, `wpa_supplicant` prenait toutefois `wlan0` avant `hostapd`. Les services
du point d'accès restaient alors inactifs et n'avaient même aucune entrée dans
le journal. La correction validée est :

1. réserver `wlan0` à `hostapd` ;
2. désactiver `wpa_supplicant` dans le mode AP ;
3. démarrer `hostapd` et `dnsmasq` avec le serveur LED.

Fichier `/etc/NetworkManager/conf.d/90-nools-ap.conf` :

```ini
[keyfile]
unmanaged-devices=interface-name:wlan0
```

État attendu :

```bash
systemctl is-enabled wpa_supplicant.service
systemctl is-active wpa_supplicant.service
```

```text
disabled
inactive
```

## 5. Fichiers de configuration sur la Pi

### 5.1 Application

```text
/home/alois/led-screen-controller/
├── server.js
├── effects/
├── public/
├── effects.json
├── text.json
├── scene.json
├── media.json
└── messages.json
```

Les cinq fichiers JSON sont des données de fonctionnement importantes :

- `effects.json` : paramètres des effets ;
- `text.json` : messages scroll/static ;
- `scene.json` : scènes et cues ;
- `media.json` : images et GIF importés ;
- `messages.json` : file des messages publics, mode de modération et historique.

`media.json` et `messages.json` sont volontairement ignorés par Git et doivent
être sauvegardés séparément. Les autres peuvent aussi avoir été modifiés par le
serveur et doivent être sauvegardés avant un déploiement.

### 5.2 Variables privées

Fichier : `/etc/led-screen-controller.env`

Format recommandé :

```ini
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=REMPLACER_PAR_UN_MOT_DE_PASSE_FORT
```

Sécurisation :

```bash
sudo chown root:root /etc/led-screen-controller.env
sudo chmod 600 /etc/led-screen-controller.env
```

Ne pas publier ce fichier dans Git.

### 5.3 hostapd

Fichier : `/etc/hostapd/hostapd-nools-test.conf`

Configuration de référence :

```ini
interface=wlan0
driver=nl80211
ctrl_interface=/run/hostapd

ssid=NOOLS-HOSTAPD
country_code=FR
hw_mode=g
channel=6

ieee80211n=0
wmm_enabled=0
ap_isolate=1
ignore_broadcast_ssid=0

# Déconnecte les stations qui n'émettent plus aucun trafic pendant 5 minutes.
# Sans skip_inactivity_poll, un téléphone encore à portée peut être conservé.
ap_max_inactivity=300
skip_inactivity_poll=1

auth_algs=1
wpa=2
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
ieee80211w=0
eapol_version=1
wpa_passphrase=REMPLACER_PAR_LA_PASSPHRASE_WIFI
```

Permissions :

```bash
sudo chown root:root /etc/hostapd/hostapd-nools-test.conf
sudo chmod 600 /etc/hostapd/hostapd-nools-test.conf
```

La page publique interroge le serveur tant qu'un message est en attente ou en
cours d'affichage. La console admin interroge `/api/state` en continu. Ces
échanges maintiennent normalement les appareils concernés actifs ; après la fin
du suivi public, cinq minutes sans aucun autre trafic Wi-Fi provoquent la
déconnexion. Certains téléphones peuvent toutefois émettre du trafic système ou
se reconnecter automatiquement : ce comportement doit être validé sur les
modèles utilisés pendant le festival.

### 5.4 dnsmasq

Fichier : `/etc/dnsmasq-nools-test.conf`

État de référence avec portail captif :

```ini
interface=wlan0
bind-dynamic
listen-address=192.168.50.1
dhcp-authoritative
dhcp-range=192.168.50.10,192.168.50.200,255.255.255.0,12h
dhcp-option=option:router,192.168.50.1
dhcp-option=option:dns-server,192.168.50.1
no-resolv
address=/panel.nools/192.168.50.1
address=/#/192.168.50.1
local-ttl=0
log-dhcp
```

## 6. Services systemd

### 6.1 Serveur LED

Fichier : `/etc/systemd/system/led-screen.service`

Configuration de reconstruction recommandée :

```ini
[Unit]
Description=LED Screen Controller
Wants=NetworkManager.service
After=NetworkManager.service

[Service]
Type=simple
User=alois
Group=alois
WorkingDirectory=/home/alois/led-screen-controller
EnvironmentFile=/etc/led-screen-controller.env
ExecStart=/usr/bin/node /home/alois/led-screen-controller/server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 6.2 Point d'accès

Fichier : `/etc/systemd/system/nools-ap-hostapd.service`

```ini
[Unit]
Description=NOOLS Wi-Fi access point
Wants=NetworkManager.service nools-ap-dnsmasq.service
After=NetworkManager.service
Before=nools-ap-dnsmasq.service
Conflicts=wpa_supplicant.service

[Service]
Type=simple
ExecStartPre=/usr/bin/nmcli device set wlan0 managed no
ExecStartPre=-/usr/sbin/ip link set wlan0 down
ExecStartPre=-/usr/sbin/ip address flush dev wlan0
ExecStartPre=/usr/sbin/ip link set wlan0 up
ExecStartPre=/usr/sbin/ip address add 192.168.50.1/24 dev wlan0
ExecStart=/usr/sbin/hostapd /etc/hostapd/hostapd-nools-test.conf
ExecStopPost=-/usr/sbin/ip address flush dev wlan0
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 6.3 DHCP/DNS du point d'accès

Fichier : `/etc/systemd/system/nools-ap-dnsmasq.service`

```ini
[Unit]
Description=NOOLS access point DHCP
BindsTo=nools-ap-hostapd.service
After=nools-ap-hostapd.service

[Service]
Type=simple
ExecStart=/usr/sbin/dnsmasq --keep-in-foreground --conf-file=/etc/dnsmasq-nools-test.conf
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 6.4 Portail captif

Script : `/usr/local/sbin/nools-captive-portal.py`

Il écoute sur TCP 80 et redirige toute requête HTTP vers :

```text
http://192.168.50.1:3000/message/
```

Service : `/etc/systemd/system/nools-captive-portal.service`

```ini
[Unit]
Description=NOOLS captive portal redirect
BindsTo=nools-ap-hostapd.service
Wants=led-screen.service
After=nools-ap-hostapd.service nools-ap-dnsmasq.service led-screen.service

[Service]
Type=simple
User=nobody
Group=nogroup
ExecStart=/usr/bin/python3 /usr/local/sbin/nools-captive-portal.py
Restart=on-failure
RestartSec=2
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Activation :

```bash
sudo systemctl daemon-reload
sudo systemctl enable led-screen.service
sudo systemctl enable nools-ap-hostapd.service nools-ap-dnsmasq.service \
  nools-captive-portal.service
sudo systemctl add-wants led-screen.service \
  nools-ap-hostapd.service nools-ap-dnsmasq.service \
  nools-captive-portal.service
```

## 7. Commandes d'exploitation

### Vérification rapide

```bash
systemctl is-active led-screen.service
systemctl is-active nools-ap-hostapd.service
systemctl is-active nools-ap-dnsmasq.service
systemctl is-active nools-captive-portal.service
systemctl is-active wpa_supplicant.service
ip -br address
ip route
```

### Journaux

```bash
journalctl -u led-screen.service -n 100 --no-pager
sudo journalctl \
  -u nools-ap-hostapd.service \
  -u nools-ap-dnsmasq.service \
  -u nools-captive-portal.service \
  -b -n 150 --no-pager
```

Suivi en direct :

```bash
journalctl -fu led-screen.service
```

### Redémarrage de l'application uniquement

```bash
sudo systemctl restart led-screen.service
```

### Redémarrage du point d'accès uniquement

```bash
sudo systemctl restart nools-ap-hostapd.service \
  nools-ap-dnsmasq.service nools-captive-portal.service
```

`nools-ap-dnsmasq.service` est lié à `hostapd` et doit suivre automatiquement.

### Redémarrage complet

```bash
sudo reboot
```

Attendre environ une minute avant de chercher le SSID.

## 8. Pare-feu

Le but est d'autoriser depuis le Wi-Fi :

- DHCP et DNS ;
- mDNS si utilisé ;
- le serveur web sur le port 3000 ;
- SSH pour l'équipe NOOLS ;
- le portail captif sur le port 80 ;

et de bloquer le routage des visiteurs vers le réseau du panneau. La
configuration validée autorise sur `wlan0` TCP 22, 53, 80 et 3000, UDP 53, 67
et 5353, puis bloque le reste du trafic entrant et tout transfert provenant du
réseau `192.168.50.0/24`.

L'état exact doit être vérifié avant toute modification :

```bash
systemctl is-enabled nftables
systemctl is-active nftables
sudo nft list ruleset
sudo cat /etc/nftables.conf
```

Une sauvegarde doit précéder toute modification :

```bash
sudo cp /etc/nftables.conf \
  "/etc/nftables.conf.backup-$(date +%Y%m%d-%H%M%S)"
```

Tester la syntaxe avant chargement :

```bash
sudo nft -c -f /etc/nftables.conf
```

Ne jamais activer une politique restrictive sans garder l'accès Ethernet de
secours.

## 9. Mise à jour de l'application avec Git

Les fichiers JSON peuvent être modifiés par le serveur. Toujours arrêter le
service et les sauvegarder avant un `git pull`.

```bash
sudo systemctl stop led-screen.service

mkdir -p /home/alois/led-state-backups
tar -czf "/home/alois/led-state-backups/state-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C /home/alois/led-screen-controller \
  effects.json text.json scene.json media.json messages.json

cd /home/alois/led-screen-controller
git status --short
git pull --ff-only
npm ci --omit=dev

sudo systemctl start led-screen.service
journalctl -u led-screen.service -n 50 --no-pager
```

Le dépôt contient maintenant un `package-lock.json`; utiliser `npm ci
--omit=dev` pour une installation reproductible. Si `git pull` refuse à cause
de fichiers JSON modifiés, ne pas les supprimer : conserver la sauvegarde et
résoudre les fichiers explicitement.

## 10. Sauvegardes existantes

Une image complète de la carte SD a été créée avec Win32 Disk Imager :

```text
H:\rpi\led_screen_controller\raspberrypi-led-2026-09-16.img
```

Le disque `H:` doit évidemment être connecté pour y accéder.

Une sauvegarde de NetworkManager a également été créée sur la Pi :

```text
/root/nools-network-backup-YYYYMMDD-HHMMSS.tar.gz
```

Lister les sauvegardes :

```bash
sudo ls -lh /root/nools-network-backup-*.tar.gz
ls -lh /home/alois/led-state-backups/
```

### Restaurer l'image complète

1. Éteindre proprement la Pi : `sudo poweroff`.
2. Retirer la carte SD.
3. Insérer une carte de capacité au moins égale dans Windows.
4. Ouvrir Win32 Disk Imager en administrateur.
5. Sélectionner `raspberrypi-led-2026-09-16.img`.
6. Vérifier très soigneusement la lettre du lecteur SD.
7. Utiliser **Write**, et non **Read**.
8. Remettre la carte dans la Pi et démarrer.

Après restauration, changer les mots de passe si l'image a été diffusée hors de
l'équipe.

## 11. Reconstruction depuis une Raspberry Pi vierge

### 11.1 Installer le système

Avec Raspberry Pi Imager :

- Raspberry Pi OS Lite 64 bits ;
- hostname `raspberrypi` ;
- utilisateur `alois` ;
- activer SSH ;
- clavier, fuseau et pays Wi-Fi France ;
- choisir un mot de passe système fort.

La version Lite possède bien une sortie HDMI, mais ne lance pas nécessairement
une interface graphique. Toute l'administration peut se faire par SSH.

### 11.2 Installer les paquets

```bash
sudo apt update
sudo apt install -y git nodejs npm hostapd dnsmasq nftables
node --version
npm --version
```

Le service standard Debian `hostapd.service` peut être masqué : ce n'est pas un
problème, car l'installation utilise `nools-ap-hostapd.service` directement.

### 11.3 Cloner l'application

```bash
cd /home/alois
git clone https://github.com/AloisKyrou/led_screen_controller.git
cd led_screen_controller
npm ci --omit=dev
```

Attention : selon le nom donné au clone, adapter le chemin. L'installation
actuelle utilise précisément :

```text
/home/alois/led-screen-controller
```

On peut donc cloner explicitement ainsi :

```bash
git clone \
  https://github.com/AloisKyrou/led_screen_controller.git \
  /home/alois/led-screen-controller
```

Restaurer ensuite `effects.json`, `text.json`, `scene.json`, `media.json` et
`messages.json` depuis la dernière sauvegarde.

### 11.4 Recréer l'Ethernet panneau

```bash
sudo nmcli connection add \
  type ethernet \
  ifname eth0 \
  con-name led-panel \
  ipv4.method manual \
  ipv4.addresses 2.0.0.200/8 \
  ipv4.never-default yes \
  ipv6.method disabled

sudo nmcli connection modify led-panel \
  connection.autoconnect yes \
  connection.autoconnect-priority 100 \
  +ipv4.routes "255.255.255.255/32"

sudo nmcli connection up led-panel
```

Valider impérativement avec :

```bash
ip route get 255.255.255.255
```

Si nécessaire pour un test temporaire :

```bash
sudo ip route replace 255.255.255.255/32 dev eth0 src 2.0.0.200
```

### 11.5 Recréer le Wi-Fi AP

1. Recréer `/etc/hostapd/hostapd-nools-test.conf` avec la configuration de la
   section 5.3 et la passphrase actuelle.
2. Recréer `/etc/dnsmasq-nools-test.conf` avec la section 5.4.
3. Recréer `/etc/NetworkManager/conf.d/90-nools-ap.conf`.
4. Recréer les trois services réseau de la section 6, ainsi que le script du
   portail captif.
5. Désactiver le Wi-Fi client :

```bash
sudo systemctl disable --now wpa_supplicant.service
```

6. Activer les services :

```bash
sudo systemctl daemon-reload
sudo systemctl enable nools-ap-hostapd.service nools-ap-dnsmasq.service \
  nools-captive-portal.service
```

### 11.6 Recréer le serveur

1. Recréer `/etc/led-screen-controller.env`.
2. Recréer `led-screen.service`.
3. Activer la dépendance du point d'accès :

```bash
sudo systemctl daemon-reload
sudo systemctl enable led-screen.service
sudo systemctl add-wants led-screen.service \
  nools-ap-hostapd.service nools-ap-dnsmasq.service \
  nools-captive-portal.service
sudo systemctl start led-screen.service
```

4. Tester puis redémarrer complètement.

## 12. Basculer temporairement vers le hotspot du téléphone

Cette procédure est manuelle tant que les scripts `nools-ap` / `nools-hotspot`
n'ont pas été créés.

Garder de préférence l'Ethernet de secours connecté pendant le basculement.

### Passer en mode client `Alok-hot`

```bash
sudo systemctl stop nools-captive-portal.service \
  nools-ap-hostapd.service nools-ap-dnsmasq.service
sudo mv /etc/NetworkManager/conf.d/90-nools-ap.conf \
  /etc/NetworkManager/conf.d/90-nools-ap.disabled
sudo systemctl enable --now wpa_supplicant.service
sudo systemctl restart NetworkManager.service
sudo nmcli connection modify Alok-hot connection.autoconnect yes
sudo nmcli connection up Alok-hot
```

Trouver l'adresse obtenue :

```bash
ip -4 -br address show wlan0
```

### Revenir au mode AP permanent

```bash
sudo nmcli connection modify Alok-hot connection.autoconnect no
sudo nmcli connection down Alok-hot
sudo systemctl disable --now wpa_supplicant.service
sudo mv /etc/NetworkManager/conf.d/90-nools-ap.disabled \
  /etc/NetworkManager/conf.d/90-nools-ap.conf
sudo systemctl restart NetworkManager.service
sudo systemctl start nools-ap-hostapd.service \
  nools-ap-dnsmasq.service nools-captive-portal.service
```

Le prochain reboot doit également revenir au mode AP.

## 13. QR codes

Deux QR codes ont été générés sur le PC :

```text
C:\Users\alois\Downloads\NOOLS-HOSTAPD-WiFi-QR.png
C:\Users\alois\Downloads\NOOLS-Message-QR.png
```

- le premier configure le Wi-Fi WPA2 ;
- le second ouvre `http://192.168.50.1:3000/message/` une fois connecté.

Pour les régénérer sous Windows avec Node/npm :

```powershell
npx --yes qrcode `
  -o "$HOME\Downloads\NOOLS-HOSTAPD-WiFi-QR.png" `
  -w 1000 -m 4 `
  "WIFI:T:WPA;S:NOOLS-HOSTAPD;P:REMPLACER_PAR_LA_PASSPHRASE;;"

npx --yes qrcode `
  -o "$HOME\Downloads\NOOLS-Message-QR.png" `
  -w 1000 -m 4 `
  "http://192.168.50.1:3000/message/"
```

Un QR Wi-Fi standard ne peut pas à la fois connecter le téléphone et ouvrir une
URL. L'expérience « 2-en-1 » doit donc être réalisée avec un portail captif.

## 14. Portail captif — état validé

Le portail est installé et a été validé sur Android : après connexion au Wi-Fi,
le système propose la page publique sans imposer le mode avion. Les éléments
qui doivent toujours rester cohérents sont :

1. `address=/#/192.168.50.1` dans dnsmasq ;
2. le service `nools-captive-portal.service` actif sur TCP 80 ;
3. TCP 80 autorisé depuis `wlan0` dans nftables ;
4. le serveur Node actif sur TCP 3000.

Diagnostic :

```bash
systemctl is-active nools-captive-portal.service
sudo ss -ltnp | grep ':80 '
curl -I http://192.168.50.1/
```

Le `curl` doit répondre `302 Found` avec une destination vers
`http://192.168.50.1:3000/message/`. Comme le DNS générique détourne tous les
noms sur le réseau NOOLS, il ne faut pas utiliser cette configuration dans un
mode où le point d'accès serait censé fournir Internet.

## 15. File de messages publics

La version en cours de développement ajoute une file persistante :

- mode **automatique** : les messages valides rejoignent directement la file ;
- mode **modéré** : un administrateur doit approuver ou rejeter chaque message ;
- l'expéditeur voit son état et sa position grâce à un reçu privé enregistré
  dans son navigateur ;
- un seul message FIFO est joué lorsque l'effet pondéré `public_messages` est
  tiré dans le mode AUTO ;
- la durée de l'effet est minimale : un message court boucle pendant cette
  durée et un message long termine toujours au moins un passage complet ;
- les messages interrompus avant un passage complet sont remis au début de la
  file ;
- la file, son mode et son historique résident dans `messages.json`.

Les protections par défaut sont un délai de 20 secondes, 3 soumissions en 5
minutes par IP, 30 par minute au total et 50 messages actifs au total. La limite
par IP est enregistrée dans `messages.json` et peut être changée immédiatement
depuis la console d'administration. Les valeurs initiales restent configurables
avec les variables d'environnement documentées dans le README.

## 16. Checklist avant festival

1. Faire un reboot complet, pas seulement un restart de service.
2. Vérifier que `NOOLS-HOSTAPD` apparaît sans commande manuelle.
3. Tester la connexion avec au moins un Android et un iPhone.
4. Tester `/message/` et `/admin/`.
5. Vérifier que l'administration demande bien un mot de passe.
6. Jouer plusieurs effets, textes, médias et une scène.
7. Vérifier physiquement le panneau et les univers ArtNet.
8. Vérifier `ip route get 255.255.255.255`.
9. Emporter le QR Wi-Fi et le QR Message imprimés.
10. Emporter un câble Ethernet et connaître l'adresse de secours
    `2.0.0.200`.
11. Conserver une copie récente des cinq JSON.
12. Conserver l'image SD sur un autre support physique.

## 17. Diagnostic express

### Le Wi-Fi n'apparaît pas

```bash
systemctl is-active nools-ap-hostapd.service
systemctl is-active wpa_supplicant.service
sudo journalctl -u nools-ap-hostapd.service -b -n 100 --no-pager
```

`wpa_supplicant` doit être inactif en mode AP.

### Le téléphone se connecte mais la page ne s'ouvre pas

```bash
ip -4 -br address show wlan0
systemctl is-active nools-ap-dnsmasq.service
systemctl is-active nools-captive-portal.service
systemctl is-active led-screen.service
sudo ss -ltnp | grep -E ':80 |:3000 '
```

Tester d'abord `http://192.168.50.1/`, puis explicitement
`http://192.168.50.1:3000/message/`. Accepter le réseau sans Internet et
désactiver temporairement un VPN s'il intercepte encore la navigation.

### L'interface fonctionne mais pas le panneau

```bash
ip -4 -br address show eth0
cat /sys/class/net/eth0/carrier
ip route get 255.255.255.255
journalctl -u led-screen.service -n 100 --no-pager
```

### Le serveur redémarre en boucle

```bash
journalctl -u led-screen.service -n 100 --no-pager
sudo test -r /etc/led-screen-controller.env && echo OK
```

En production, `ADMIN_PASSWORD` est obligatoire. Son absence provoque une sortie
immédiate du serveur, puis systemd tente de le redémarrer.
