# LED Screen Controller

Node.js ArtNet server + browser VJ interface for a 60×15 WS2812B LED panel. Effects, live text, image/GIF upload, scene cues, kick flash, and per-effect controls — controlled from a phone over the local network.

Deployment to the Raspberry Pi defaults to SCP/SSH over its `NOOLS-HOSTAPD`
Wi-Fi network, without Internet access on the Pi. See the
[deployment procedure in section 9](RASPBERRY_PI_RUNBOOK.md#9-mise-à-jour-par-scp-et-ssh-méthode-par-défaut).

---

## Hardware setup

```
Phone (hotspot) ──── Computer ──── Router ──── LED Panel
                    (Node.js)    (ArtNet UDP broadcast)
```

- **Panel**: 60×15 pixels, WS2812B (GRB byte order), serpentine wiring
- **Protocol**: ArtNet over UDP broadcast (`255.255.255.255:6454`)
- **Universes**: 6–11 (6 universes × 170 pixels = 900 px + spare)
- **Framerate**: 30 FPS

---

## Stack

| Layer | Tech |
|---|---|
| Server | Node.js + Express |
| Transport | ArtNet UDP (raw `dgram` socket, no library) |
| UI | Vanilla JS + plain HTML/CSS, served statically |
| Persistence | `effects.json`, `text.json`, `scene.json`, `media.json`, `messages.json` |

---

## Architecture

### `server.js`
Single-file server. Handles:
- Loading effect modules from `effects/` at startup
- ArtNet packetizing and broadcast
- Effect scheduler (weighted random, duration-based, respects `done` flag for scroll)
- Multi-scene mode (ordered timed cues, manual next/previous, looping, then return to AUTO)
- Kick flash override (full-panel color burst)
- Global brightness scaling
- REST API for the browser UI

### `effects/`
Each file exports `{ name, init, frame }`:
- `init(W, H, config, shared) → state` — called once when the effect starts
- `frame(state, t, dt, config, shared) → Uint8Array(H×W×3)` — called at 30 FPS, returns RGB pixel buffer

`font.js` provides bitmap font rendering (`buildTape`, `buildAutoMask`), `hexToRgb`, `hsvToRgb`.

### `public/`
Static UI — single page, polls `/api/state` every 500ms. No framework.

---

## Effects

| Effect | Description |
|---|---|
| `nools` | Custom logo animation |
| `fete_trouble` | Party-mode strobing fills |
| `scroll_text` | Scrolling text from pool, waits for full pass before advancing |
| `static_text` | Centered text with safe margins, compact wrapping and automatic pagination |
| `public_messages` | One approved public message from the FIFO queue, selected by the AUTO scheduler |
| `media` | Uploaded image or animated GIF, converted to 60×15 in the control browser |
| `simple_firework` | Expanding burst particles |
| `fading_pixel` | Random pixels fade in/out |
| `bouncing_balls` | Physics balls with gravity and bounce |
| `pumping_circle` | Expanding/contracting circle pulse |
| `simple_snake` | Classic snake on the grid |
| `simple_color_scroll` | Rainbow columns scrolling left |
| `c64_loadscreen` | Commodore 64 loading screen aesthetic |
| `fillscreen_snakewise` | Screen fill following serpentine path |
| `moving_tile_puzzle` | Sliding tile puzzle animation |
| `fire` | Cellular automaton fire |
| `rain` | Falling rain drops with trails |
| `starfield` | Zoom-out starfield |
| `raindrops` | Ripple rings from random impact points |

---

## API

```
GET  /api/state                        → full server state + effect list
POST /api/effects/:id/config           → { freq, duration, brightness, enabled, color, rainbow, speed }
POST /api/effects/:id/play             → force-play an effect
POST /api/next                         → skip to next
POST /api/blackout                     → toggle blackout
POST /api/brightness                   → { value: 0..1 }
POST /api/text                         → { scrollPool: [{text, color, rainbow}], staticPool: [...] }
POST /api/text/:type/:index/play       → play one exact scroll/static pool entry
GET  /api/public/messages/config       → public submission mode and limits
GET  /api/public/messages/:id/status   → private receipt-based position/status
POST /api/public/message               → submit a public message
POST /api/public/gif                   → submit { gif: base64, name, clientId } for mandatory review
GET  /api/public-messages/:id/gif       → admin-only original GIF (add ?download=1 to download)
POST /api/public-messages/mode         → select automatic or moderated intake
POST /api/public-messages/settings     → change the persistent per-IP submission limit
POST /api/public-messages/:id/approve  → approve one pending message
POST /api/public-messages/:id/reject   → reject/remove one pending or queued message
POST /api/public-messages/next         → play the next approved message immediately
POST /api/event                        → { type:'kick', on:bool, color:'#rrggbb', brightness:0..1 }
POST /api/media                        → prepared RGB frames from the admin upload UI
POST /api/media/:id/play               → play one exact image/GIF
DELETE /api/media/:id                  → remove an unused image/GIF
POST /api/scene                        → save { name, loop, cues }
POST /api/scenes                       → create and select an empty scene
POST /api/scenes/:id/select            → select the scene to edit/play
DELETE /api/scenes/:id                 → delete a scene that is not playing
POST /api/scene/play                   → play the scene from cue 1
POST /api/scene/previous               → replay the previous cue
POST /api/scene/next                   → advance immediately
POST /api/scene/stop                   → stop the scene and return to AUTO
```

---

## Config

**`effects.json`** — per-effect settings persisted across restarts:
```json
{
  "bouncing_balls": { "duration": 10, "freq": 5, "brightness": 1, "enabled": true, "rainbow": true, "color": "#00a3f5" }
}
```

**`text.json`** — scroll/static text pools:
```json
{
  "scrollPool": [{ "text": "NOOLS", "color": "#ffffff", "rainbow": false }],
  "staticPool":  [{ "text": "NOOLS", "color": "#ff8800", "rainbow": false }]
}
```

**`media.json`** is generated after an upload and is intentionally ignored by Git. It stores a library of up to 30 media entries. The browser accepts PNG, JPEG, WebP and GIF files up to 8 MB, scales them to the panel, and sends at most 180 RGB frames per entry. GIF decoding is bundled locally, so it also works when the Raspberry Pi access point has no Internet connection.

**`scene.json`** stores up to 30 named scenes and remembers the selected one. Existing single-scene files are migrated automatically. Each cue has an effect and its own minimum duration. Color-capable effects snapshot their AUTO color/rainbow settings when added, and those values can then be edited independently. Text cues snapshot the chosen message look, while media cues reference one exact library entry. At the end, the scene either loops or returns to the weighted AUTO scheduler. In AUTO mode, scene cues and their private settings are ignored completely.

**`messages.json`** is generated at runtime and ignored by Git. It stores the
public-message mode (`automatic` or `moderated`), pending approvals, the FIFO
display queue and a short history. The `public_messages` effect becomes eligible
for weighted AUTO selection only while an approved message is waiting, and shows
one message per selection. Its `duration` is a minimum: short messages loop until
that duration expires, while long messages always finish at least one complete
pass. A message interrupted before its first complete pass is returned to the
front of the queue.

## GIF du public

Depuis `/message`, l’onglet **Créer / importer un GIF** ouvre un éditeur inspiré
de [Piskel](https://www.piskelapp.com/p/create/sprite/), avec une grille fixe de
**60 × 15 pixels** : crayon, gomme, remplissage, palette, annulation, zoom,
images vides ou dupliquées, suppression et vitesse de lecture. L’aperçu tourne
sur fond noir comme le panneau. Le GIF peut être téléchargé avant son envoi.
L’éditeur fonctionne également sans Internet et au toucher. Les flèches du
clavier déplacent le curseur et espace dessine.

L’import accepte uniquement les vrais GIF de **60 × 15**, **512 Ko** au maximum,
**120 images** et **15 secondes par boucle**. Il ne redimensionne pas les fichiers.
Les mêmes contrôles sont effectués dans le navigateur et sur le serveur, y
compris les blocs, les pixels décompressés et les limites de chaque image.
Les images partielles, les palettes locales, l’entrelacement, la transparence
et les méthodes de disposition 0–3 sont pris en charge. Le fond est noir ;
les délais absents/nuls deviennent 100 ms, les délais inférieurs à 20 ms sont
portés à 20 ms. Les extensions texte et les GIF attendant une interaction sont
refusés. L’export de l’éditeur conserve jusqu’à 256 couleurs exactes par image ;
un import non modifié est téléchargé et transmis dans son format original.
Changer la vitesse remplace les délais individuels de toutes les images.

Dans `/admin/`, **Messages et GIF publics** affiche le nom, les dimensions,
le nombre d’images et la durée. **Aperçu** ouvre un lecteur avec pause et
avance/recul image par image, ainsi que **Télécharger**, **Valider** et **Refuser**.
Cet aperçu ne diffuse rien sur le panneau. Les GIF attendent **toujours** une
validation, même lorsque les messages texte sont automatiques ou que ce mode
est réactivé. Une fois approuvés, ils partagent la file FIFO et l’effet
`public_messages` avec les textes. Ils bouclent pendant la durée minimale de
l’effet et terminent au moins une boucle complète ; une interruption avant
cette première boucle les remet dans la file. Le reçu privé suit les mêmes
états que les textes. Les limites d’envoi et de file sont communes aux deux.

Les GIF sont conservés dans **`public-gifs/`** (ignoré par Git), sous des noms
calculés par SHA-256. `messages.json` ne contient que leurs métadonnées : le
rafraîchissement de la console ne transporte pas les images. Les fichiers
restent accessibles aux admins pendant leur présence dans la file/l’historique,
puis sont supprimés quand plus aucun envoi conservé ne les référence. Sauvegarder
`messages.json` **et** `public-gifs/` ensemble pour conserver les contributions.
Un fichier manquant ou corrompu ne peut pas être approuvé ; s’il devient
illisible après validation, il est écarté au moment de la lecture.

Le codec partagé `public/panel-gif.js` suit la
[structure GIF89a](https://www.w3.org/Graphics/GIF/spec-gif89a.txt). Les fixtures
de `test/fixtures/public-gifs.json` ont été générées avec **omggif 1.0.10**,
indépendamment de ce codec (compression LZW, entrelacement, transparence et
disposition). Aucune nouvelle dépendance de production n’est nécessaire.
`npm test` couvre ces cas, les rejets, la modération, la reprise de lecture et
le parcours HTTP réel avec redémarrage. Les tests HTTP utilisent un dossier
temporaire et envoient ArtNet uniquement vers `127.0.0.1`.

## Microphone et audio réactif

La console **Audio réactif** permet d’activer le microphone USB du Pi, de
choisir son périphérique ALSA et de régler le gain, le seuil de bruit et le
seuil de détection du kick. Tout est désactivé par défaut. Les réglages sont
conservés localement dans `audio.json` (à préserver lors des déploiements).

- **Démo sans micro** produit un signal de test à 120 BPM, utilisable aussi
  sous Windows ; il faut cocher **Activer l’audio**, puis **Appliquer**.
- L’effet **audio spectrum** (`audio_spectrum`) affiche 15 barres à fréquences
  logarithmiques, avec un dégradé vert/orange/rouge, des segments et des crêtes descendantes sur les 60 × 15
  pixels. Le lancer depuis sa carte, ou l’activer pour la rotation AUTO.
  L’option **Balle rebondissante**, activée par défaut, ajoute un petit point
  carré de 2 × 2 pixels dont la couleur évolue, soumis à la gravité : il traverse les barres et rebondit sur leur
  sommet. La montée de la barre qui le porte renforce son saut. Les barres
  réservent alors trois lignes en haut pour rendre les sauts visibles. La balle
  se pose en bas dans le silence et dérive lentement, puis reprend ses rebonds
  depuis sa position quand le son revient ; décocher restitue le spectre seul.
- L’effet **audio scope** (`audio_scope`) trace une courbe instantanée du signal,
  jaune-vert avec une courte rémanence, dans l’esprit des anciens lecteurs
  multimédias. Le tracé se cale sur un passage par zéro et montre environ
  30 ms du signal, résumé sur les 60 colonnes. Il est désactivé par défaut
  dans la rotation AUTO, comme le spectre.
  Les traces trop faibles pour quitter le pixel central sont masquées et les
  passages par zéro restent atténués, avec une rémanence plus courte au centre,
  pour éviter une ligne horizontale permanente.
- Chaque carte de visuel audio possède un curseur **Sensibilité ×0,5 à ×8**,
  conservé dans `effects.json`. Il amplifie uniquement ce visuel, sans modifier
  le gain de capture ni les seuils du kick. La courbe démarre à ×2, les barres
  et le miroir à ×1 ; essayer ×4 pour une courbe peu mobile. L’aperçu admin
  reprend la sensibilité du spectre ou de la courbe selon la vue choisie.
- **Miroir audio** (`audio_mirror`) ouvre des ailes symétriques cyan/violet
  autour de la ligne centrale : basses au centre, aigus vers les extrémités.
  Il suit les bandes du spectre en continu, sans dépendre des kicks.
  Spectre, courbe et miroir sont regroupés dans **Visuels audio réactifs** :
  ils deviennent le visuel courant quand ils sont lancés et peuvent participer
  à la rotation AUTO (désactivés par défaut).
- **Audio pumping circle** (`audio_pumping_circle`) reprend les trois disques
  de `pumping_circle` dans un effet séparé : gauche pour les basses (~45–242 Hz),
  centre pour les médiums (~242–1300 Hz), droite pour les aigus (~1,3–7 kHz).
  Leur taille et leur intensité suivent chaque groupe de bandes, avec une
  plage adaptative indépendante par groupe, une attaque rapide et une retombée
  vive. Les pixels de bord varient progressivement en luminosité pour rendre
  visibles les variations inférieures à un pixel. Un seuil évite d’amplifier
  le quasi-silence. Le curseur Sensibilité amplifie ce
  visuel uniquement. Couleurs animées ou couleur fixe, lecture manuelle et
  inclusion facultative en AUTO ; désactivé en AUTO par défaut. L’effet
  original `pumping_circle` reste inchangé. Il s’agit d’un visuel continu,
  compatible avec les surcouches KICK, sans dépendre de la détection de kicks.
- Le voyant **KICK DÉTECTÉ** et son compteur fonctionnent indépendamment de
  **Audio → KICK**. La jauge compare l’énergie des basses au seuil adaptatif :
  dépasser 1× est nécessaire, mais il faut aussi une attaque, un signal au-dessus
  du seuil de bruit et le délai minimum choisi depuis la dernière détection.
  Le détecteur suit la montée et la retombée de l’énergie des basses, sans
  exiger une hausse de 15 % sur une seule analyse. Une courte phase de
  calibration suit l’activation. Les délais sont calculés sur les échantillons
  audio, pas sur les arrivées parfois groupées des paquets USB.
- **Afficher le retour audio** ouvre un aperçu au choix en barres ou en courbe.
  Il est masqué par défaut et ce choix est mémorisé dans le navigateur. Le
  voyant reste visible. Le suivi utilise une petite requête audio dédiée,
  environ 10 fois/s sans aperçu et jusqu’à 20 fois/s avec aperçu, sans requêtes
  simultanées ; le dessin est interpolé au rythme d’affichage du navigateur.
- L’espace **KICK — bouton et déclenchement audio** est distinct des visuels continus. Choisir
  **Flash plein panneau** ou **Onde de choc** : la réaction se superpose au
  visuel courant, sans changer la scène ou l’effet sélectionné. Le fond
  continue d’être calculé, y compris pendant le flash opaque ; les messages
  et GIF continuent donc leur progression même quand le flash les masque.
  L’onde est additive : un anneau lumineux s’étend du centre vers les bords
  en laissant le fond visible. Plusieurs ondes peuvent coexister, avec une
  limite de six. Sa durée est réglable de 150 à 1200 ms (500 par défaut).
  L’onde ne figure pas dans la rotation AUTO ni dans les choix de scènes.
  **Opacité de la surcouche** règle le mélange de 0 à 100 % (100 par défaut) :
  à 0 le fond reste intact, à 50 le flash est mélangé à parts égales avec le
  fond, à 100 le comportement précédent est conservé. Pour l’onde, l’opacité
  atténue son apport lumineux. Ce réglage est indépendant de la luminosité,
  persiste dans `audio.json` et s’applique aussi au bouton KICK manuel.
  Le flash a une durée de
  40 à 300 ms (120 par défaut), délai minimum de 80 à 500 ms (160 par défaut)
  et seuil relatif de 0,5 à 4. Les basses 47–172 Hz sont comparées à leur
  propre moyenne adaptative ; le niveau global sert seulement au seuil de bruit.
  Une seule configuration est partagée par le bouton manuel et la détection :
  visuel, couleur, mode couleur aléatoire, luminosité, opacité et durée.
  **Audio → KICK** active seulement le déclenchement automatique. Le bouton
  fonctionne même si le microphone est désactivé. Un appui produit une seule
  réaction de la durée choisie, sans maintien obligatoire ni flash forcé.
  Les réglages KICK s’enregistrent automatiquement dès modification (avec un
  court délai pendant le déplacement d’un curseur). Un statut indique
  l’application ou son échec ; le résumé et la couleur affichent les valeurs
  réellement appliquées. Les requêtes sont sérialisées pour éviter qu’une
  ancienne valeur écrase la dernière. Le bouton **Appliquer** reste utile pour
  la capture microphone ; appuyer sur **KICK** attend aussi l’enregistrement
  des valeurs visibles avant de déclencher. Modifier uniquement les réglages du kick
  ne redémarre pas la capture audio.
  Les paramètres sont regroupés dans `audio.json`. À la première utilisation,
  les anciennes couleurs/luminosités liées au bouton sont reprises depuis
  `effects.json` / `_kick` ; les anciennes couleurs audio dédiées sont conservées
  si elles étaient actives. Le marqueur `kickUnified` évite une nouvelle migration
  après sauvegarde. Il n’existe plus de second réglage de couleur dans le bloc VJ.
  L’aperçu indique la couleur enregistrée et signale les causes d’un rendu noir.
  Le bouton **KICK** vérifie la sortie sans dépendre du détecteur et joue une
  onde si **Onde de choc** est sélectionné. Le blackout
  coupe tout et efface les ondes en cours. Changer les réglages audio efface
  également les anciennes ondes. Un seuil plus bas
  détecte davantage d’attaques. Ce détecteur ne sépare pas les instruments :
  bruit ambiant et impacts peuvent déclencher des faux positifs.
  Pour les clients API, `/api/event` avec `{ "type": "kick" }` utilise la même
  configuration sauvegardée ; `on: true` signifie aussi une impulsion, et
  `on: false` annule les surcouches en cours. Les anciens paramètres de couleur
  dans cet événement ne créent plus de configuration temporaire : passer par
  `/api/kick/settings` (alias couleur/luminosité) ou `/api/audio/settings`.
- L’analyse utilise du PCM mono 16 kHz, fenêtres FFT de 1024 échantillons
  renouvelées tous les 512 échantillons (32 ms, environ 31 analyses/s).
  Le panneau reste à 30 images/s. Les tables FFT sont précalculées pour
  limiter le coût du doublement de la cadence d’analyse sur le Pi.
  Les enregistrements ne sont ni sauvegardés ni transmis au navigateur ; seuls
  les indicateurs, les bandes du spectre et une courbe résumée de 60 points
  sont exposés à l’administration. Quand l’aperçu est masqué, la requête
  audio dédiée omet les bandes et la courbe.
- Un micro absent, occupé ou débranché produit un statut explicite et une
  nouvelle tentative toutes les cinq secondes. Les autres effets continuent.

### Préparation du Pi et branchement du microphone

Depuis SSH sur le réseau du Pi :

```bash
command -v arecord
arecord -l
arecord -L
id alois
```

`arecord` est fourni par `alsa-utils` ; aucune nouvelle dépendance npm n’est
requise. S’il manque, préparer l’installation de ce paquet et de ses
dépendances pour la version Debian et l’architecture du Pi. Le transfert
SCP du code ne fournit pas ce programme système et ne nécessite pas de
changer la configuration réseau du Pi.

Après branchement, utiliser de préférence le nom stable indiqué par
`arecord -L`, par exemple `plughw:CARD=Device,DEV=0` (remplacer `Device` par
le nom réel). `default` peut sélectionner une autre entrée. Pour tester
10 secondes sans créer de fichier audio :

```bash
arecord -D plughw:CARD=Device,DEV=0 -t raw -f S16_LE -r 16000 -c 1 -d 10 /dev/null
```

Désactiver d’abord l’audio dans l’interface pour libérer le périphérique.
Si l’utilisateur du service n’a pas accès à `/dev/snd`, ajouter `alois` au
groupe `audio`, puis redémarrer le service :

```bash
sudo usermod -aG audio alois
sudo systemctl restart led-screen.service
```

Sélectionner **Microphone du Pi**, saisir le périphérique, activer l’audio et
appliquer. Vérifier le spectre, ajuster le gain et le seuil de bruit, puis
activer **Audio → KICK** si souhaité. En cas de saturation matérielle, régler
le niveau de capture avec `alsamixer` : le gain logiciel ne corrige pas un
signal déjà écrêté. La démo valide le logiciel ; latence réelle, qualité et
seuils doivent encore être vérifiés avec le microphone physique.

Référence : [manuel officiel ALSA arecord/aplay](https://github.com/alsa-project/alsa-utils/blob/master/aplay/aplay.1).

## Submission settings

Dans la console admin, les contributions terminées restent visibles dans la
file d’affichage avec l’état **Joué**. **Relancer** les remet en fin de file,
sans interrompre la lecture courante.
La croix à côté de **Relancer** retire l’élément joué de la colonne et le
range dans **Éléments refusés**, sans supprimer sa copie dans la bibliothèque.
Les 100 dernières contributions terminées/refusées sont conservées ;
enregistrer les GIF à garder durablement.

Sur un GIF validé ou joué, **Enregistrer dans nos GIF** copie l’animation dans
la bibliothèque permanente (`media.json`) et active l’effet `media` pour sa
rotation en mode AUTO. Cette action ne lance pas immédiatement le GIF et ne
change pas le mode de lecture courant. La bibliothèque choisit ses médias
aléatoirement lors des passages de cet effet. Un même GIF n’est enregistré
qu’une fois, et sa copie reste disponible après suppression de l’historique
public. La bibliothèque conserve sa limite de 30 médias.

`EFFECT_DEFAULTS` in `server.js` provides fallback values so the server works correctly even if `effects.json` reverts (Google Drive sync issue).

Public submission protection defaults to a 20-second cooldown, 3 submissions
per IP in 5 minutes, 30 globally per minute and 50 active messages in total.
The per-IP limit is persistent and editable from the admin UI; it controls both
the rolling submission limit and the number of active messages for that IP. The
initial value and other limits can also be adjusted before startup with:

```ini
PUBLIC_COOLDOWN_SECONDS=20
PUBLIC_RATE_LIMIT=3
PUBLIC_RATE_WINDOW_SECONDS=300
PUBLIC_GLOBAL_RATE_LIMIT=30
```

---

## Running

Admin login allows five failed attempts per source IP within five minutes.
Successful logins do not consume that limit and clear earlier failures for that
IP. The login page checks `/admin/login/status` and shows the remaining delay;
an old `?error=rate` URL does not keep displaying an expired block. Different
source IPs have independent counters, while clients sharing an IP share its
limit. `127.0.0.1` always remains the same source when testing locally, regardless
of Wi-Fi or Internet IP changes. Forwarded IP headers are not trusted by default.

```bash
npm install
node server.js
```

On startup the console prints all network IPs. Open the administration page using the computer or hotspot IP:
```
http://192.168.x.x:3000/admin/
```

If the phone can't connect, allow the port through Windows Firewall:
```powershell
netsh advfirewall firewall add rule name="Panel Controller" dir=in action=allow protocol=TCP localport=3000
```

- **Kick flash** (`audio_kick_only`, identifiant historique conservé) et **Kick choc**
  (`audio_kick_shockwave`) : fond noir avec déclenchement audio temporairement
  forcé, respectivement en flash ou en onde de choc, pendant leur lecture.
  La capture audio doit être activée. En quittant le visuel, les réglages habituels
  reprennent sans aucune écriture de configuration. Couleur, opacité et durées
  restent partagées avec KICK. Les deux visuels sont désactivés en AUTO par défaut.
- **Seuil adaptatif** : option désactivée par défaut, remplace le multiplicateur
  manuel par un seuil fondé sur la médiane et la dispersion des basses des
  64 fenêtres précédentes (environ 2 secondes), avec lissage. La frappe courante
  ne participe pas à son propre seuil. Le seuil de bruit, l’attaque, le réarmement
  et l’intervalle minimum restent appliqués. Le seuil calculé apparaît dans la
  console ; cette détection reste une heuristique de transitoires graves,
  à tester avec le microphone et la musique sur place.

### Enveloppe et boost de luminosité au kick

La luminosité par effet × globale est appliquée à une copie du rendu, jamais au
tableau interne conservé par un effet. Les pixels persistants (`fading_pixel`,
etc.) gardent ainsi leur fondu normal : 20 % de luminosité donne 20 % de chaque
image, sans accélérer leur disparition par atténuations cumulées. La conversion
RGB 8 bits arrondit au plus proche ; à très faible intensité, les valeurs sous
un demi-pas restent nécessairement nulles.

**Activer l’audio** se sauvegarde immédiatement, sans bouton Appliquer. Quand
la case est décochée, la capture est arrêtée et tous les effets `audio_*` sont
exclus du tirage AUTO et de la lecture manuelle (Play grisé). Les étapes audio
des scènes sont sautées ; une scène entièrement audio s’arrête. Un effet audio
en cours cède immédiatement la place à un effet disponible. Les choix AUTO
enregistrés sont conservés et redeviennent éligibles à la réactivation de l’audio.
Les autres réglages de capture, comme le périphérique, gardent le bouton Appliquer.

La courbe `audio_scope` et son moniteur appliquent désormais un gain de base
quatre fois plus élevé, après suppression de l’offset moyen de la forme d’onde.
La sensibilité ×2 correspond à l’ancienne excursion à ×8 pour un signal centré.
Les réglages sauvegardés sont conservés : revenir à ×2 après mise à jour si le
curseur était à ×8. Le seuil de visibilité et le filtrage du silence restent actifs.

Chaque effet ordinaire possède une case **Désactiver les surcouches KICK**,
enregistrée dans `effects.json`. Elle bloque flash et onde de choc pendant sa
lecture, pour le bouton comme pour l’audio, et retire les surcouches déjà actives.
Le boost de luminosité reste autorisé, seul ou associé à une réaction. La détection
audio et son voyant continuent de fonctionner. Les visuels dédiés Kick flash et
Kick choc sont exclus de cette option. Pour media, le réglage concerne tous ses GIF.

Chaque média enregistré dispose d’une case **AUTO** dans la bibliothèque.
Décocher conserve le fichier mais l’exclut des prochains tirages automatiques ;
la lecture manuelle et les scènes explicitement programmées restent possibles.
Le média déjà en lecture peut terminer son passage. La sélection est sauvegardée
dans `media.json` et restaurée au redémarrage. Les anciens et nouveaux médias
sont cochés par défaut. Si aucun n’est coché, l’effet media est exclu de la rotation
AUTO. L’interrupteur général de l’effet media reste nécessaire pour cette rotation.

Le repère blanc du spectre représente un maximum qui retombe plus lentement que
les barres : sa descente est maintenant de 0,65 pleine hauteur par seconde
(environ 1,5 s du sommet au sol), sur le panneau comme dans le moniteur.

Trois visuels rave supplémentaires sont disponibles dans les effets généraux,
désactivés en AUTO par défaut : `pharmacy_tunnel` (trois tunnels de croix
imbriquées, expansion et déplacement, vert pharmacie par défaut), `nool_scatter`
(mots NOOL en traits d’un pixel, apparitions aléatoires et fondu), et `nol_chaos`
(lettres N/O/L qui tournent et dérivent indépendamment). Ils disposent des
réglages de vitesse, couleur fixe / arc-en-ciel et luminosité habituels. Ils
fonctionnent sans microphone et acceptent les réactions KICK par-dessus.

Le spectre propose aussi **Deux balles rebondissantes** : deux carrés 2×2 aux
trajectoires indépendantes et aux teintes complémentaires qui évoluent ensemble.
Leur contact affiche **ULTRA NOOL** en haut du panneau, en vert–orange–rouge, pendant
1,2 seconde avec une disparition progressive. Le fond est atténué pour la
lisibilité, mais continue de tourner. Un délai de 2 secondes évite les répétitions
rapides. Sans son, les deux carrés dérivent au sol ; décocher l’option retire
les deux balles et leur texte.

La réaction **Boost luminosité seul** éclaire le visuel courant sans ajouter de
flash coloré. La case **Booster aussi la luminosité globale** ajoute ce boost
aux autres réactions. Cible par défaut : 100 %, attaque : 0 s, descente : 0,3 s.
Par exemple, une luminosité globale de 70 % monte à 100 % puis revient à 70 % ;
le réglage global enregistré reste inchangé. Une cible plus basse ne réduit pas
la luminosité. La luminosité propre à chaque effet et le blackout restent respectés.
Sur le fond noir de Kick only, le boost seul n’éclaire aucun pixel.

Le flash utilise la même attaque et descente, avec son maintien au sommet entre
les deux. L’opacité suit l’enveloppe pour révéler progressivement le fond animé.
Un nouveau kick repart du niveau atteint, sans chute à zéro ; une attaque nulle
remonte immédiatement au sommet. L’onde de choc garde sa durée de propagation.
Les réglages sont communs au bouton manuel et au déclenchement audio et se
sauvegardent automatiquement. Le boost est désactivé par défaut.
