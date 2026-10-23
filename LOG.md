# Log modifiche

Storico degli interventi su deploy e infrastruttura di f1-dash. Voce più recente in alto.

## 2026-10-24 — Tempi ai decimi nella pagina Practice

**Versione installata**: commit `60fd47e`, da un `git worktree` pulito. `/dashboard/practice`, `/dashboard/pitwall`
e `/api/laps` rispondono 200, il bundle contiene il nuovo formato.

## 2026-10-24 — Passo gara corretto e giri per set nella pagina Practice

**Versione installata**: commit `a0e1786`, da un `git worktree` pulito, dopo la fine della FP2.
- `0ce1289`: i giri da long run non vengono più scambiati per giri lenti (soglia dal 7% al 12% sul best, un singolo
  giro lento non spezza una run avviata); il traffico si misura sulla linea di tendenza della run (Theil-Sen,
  oltre 0,8 s) e non più sulla mediana. Sui giri della FP2: long run per tutti i 22 piloti, prima 7 ne erano privi.
- `a0e1786`: toccando un pilota nella tabella Practice si aprono i giri di ogni set.

**Verifiche**: `/dashboard/practice` e `/api/laps` rispondono 200, il bundle contiene la nuova tabella. Il
registratore ha ritrovato i giri della FP2 dopo ogni riavvio del container (564 giri, sessione `11390`).

## 2026-10-23 — Vertical più leggibile, prima della FP2

**Versione installata**: commit `f894dc0` (righe che scorrono, fasce DRS e pit, fantasma della sosta, gruppi
sull'asse, mini-grafici dei distacchi, direzione gara colorata), installata alle 20:50 UTC, prima del via della FP2.
`/dashboard`, `/dashboard/vertical` e `/api/laps` rispondono 200; il registratore è già sulla sessione della FP2
(`11390`).

**Prove**: sul PC con la replica di Singapore come gara finta, anche a 375 px. Una gara vera non è ancora stata
vista.

## 2026-10-23 — Opzioni della Vertical nella pagina

**Versione installata**: commit `2209069` (opzioni della Vertical dietro il pulsante Options della torre, tolte da
Settings), costruita da un `git worktree` pulito; compose invariati. `/dashboard/vertical`, `/dashboard/settings` e
`/api/laps` rispondono 200, il bundle servito contiene il pannello delle opzioni.

## 2026-10-23 — Vertical con lampeggi, Muretto con minisettori su Proxmox

**Versione installata**: commit `250e2d6` (lampeggi e colori sulla Vertical, ultimo momento utile e minisettori
nel Muretto in qualifica), costruita da un `git worktree` pulito. Immagini `api` e `realtime` invariate.

**Verifiche**
- `/dashboard`, `/dashboard/vertical`, `/dashboard/pitwall`, `/dashboard/driver/16`, `/dashboard/practice`,
  `/api/laps` rispondono 200; `NEXT_PUBLIC_LIVE_URL` = `http://192.168.188.161:4000`; il bundle servito contiene
  l'animazione dei lampeggi e l'avviso dei box del Muretto.
- Prova sul PC con la replica di Singapore trasformata in gara finta (`AS_RACE=1`, `TRACK=6`): lampeggi, battaglie,
  colori e bordo della VSC funzionano. Una gara vera non è ancora stata vista.

**Carico alle 22:24**: load 0,74; web 75 MB, realtime 15 MB, api 7 MB.

## 2026-10-23 — Muretto e colori condizionali su Proxmox

**Versione installata**: commit `e3d54ef` (pagina Pit Wall, colori condizionali su pilota e Practice), costruita
da un `git worktree` pulito. Immagini `api` e `realtime` invariate.

**Verifiche**
- `/dashboard`, `/dashboard/pitwall`, `/dashboard/practice`, `/dashboard/driver/16`, `/api/laps` rispondono 200;
  `NEXT_PUBLIC_LIVE_URL` = `http://192.168.188.161:4000`; il bundle servito contiene il codice del Muretto.
- Registratore ripartito; è ancora sulla sessione della FP1 e passerà da solo alla FP2 quando inizia.

**Carico alle 22:00**: host CPU 7%, load 1,33, 162 MB liberi, swap 3,45 GB; web 73 MB, realtime 15 MB, api 7 MB.
VM Home Assistant in esecuzione.

## 2026-10-23 — Proxmox allineato a `c21ae91`

**Versione installata**: commit `c21ae91` (pagina pilota con stato gara e passo, storico giri col ritardo, mappa
meteo), costruita da un `git worktree` pulito. Immagini `api` e `realtime` invariate.

**Verifiche**
- `/dashboard`, `/dashboard/practice`, `/dashboard/driver/16`, `/dashboard/weather`, `/api/laps` rispondono 200;
  `NEXT_PUBLIC_LIVE_URL` = `http://192.168.188.161:4000`; registratore ripartito su `/data/laps.json`.

**Carico alle 21:33**
- Host: CPU ~0%, load 1,05 / 0,41 / 0,35, RAM 2433 su 3363 MB (154 MB liberi), swap 3,46 GB su 8 GB.
- LXC 108: 182 MB su 4096 (web 73 MB, realtime 15 MB, api 7 MB), disco 4,8 GB liberi.
- VM Home Assistant (103): in esecuzione, 3769 su 4096 MB, CPU 4%.

## 2026-10-23 — Registratore dei giri sul server

**Obiettivo**: non perdere i giri (e le long run) quando la pagina viene aperta tardi o il feed si interrompe.

**Versione installata**: commit `e8a1fdb`, costruita da un `git worktree` pulito (modifiche non committate escluse).

**Cosa cambia**
- Il server Next.js (`src/instrumentation.ts` → `src/server/lapRecorder.ts`) segue il realtime per tutta la sessione
  e salva un campione per pilota e per giro; li espone su `/api/laps`. La pagina li unisce al suo storico ogni 30 s.
- Variabili: `REALTIME_URL` (default `NEXT_PUBLIC_LIVE_URL`), `LAP_RECORDER_FILE` (default
  `.next/lap-recorder.json`), `LAP_RECORDER=off` per spegnerlo.
- `compose.proxmox.yaml`: `REALTIME_URL=http://realtime:80`, file in `/data/laps.json` sul volume `laps`
  (sopravvive alla ricreazione del container). `compose.override.yaml`: solo `REALTIME_URL`.

**Verifiche**
- Prova sul PC con la registrazione di Singapore riprodotta a 10x: giri e stint registrati uguali al feed; una
  pagina aperta da zero ha ricevuto subito i giri già fatti e poi è rimasta allineata.
- Proxmox: log `lap recorder: recording http://realtime:80/api/realtime into /data/laps.json`, `/api/laps`
  risponde con la sessione corrente (FP1 Austin finita, nessun giro ancora). Container web 54 MB di RAM.

**Da fare / aperto**
- Prima prova vera: FP2 di Austin. Il 108 va lasciato acceso, è lui a registrare.

## 2026-10-23 — Pagina Practice su Proxmox

**Obiettivo**: allineare Proxmox alla versione del PC con la nuova pagina Practice (`/dashboard/practice`).

**Versione installata**: commit `5d9dfdc` (PR andrewisfree/f1-dash#1), costruita da un `git worktree` pulito di
`HEAD` perché la cartella di lavoro aveva modifiche non committate (`DriverFocus.tsx`, `useLapHistory.ts`,
`race.ts`, `map.tsx`): queste **non** sono nell'immagine.

**Passi**
- Host prima dell'avvio: 111 MB liberi su 3363. LXC 108 acceso via API alle 20:17 circa.
- Sul PC Docker Desktop si era chiuso: riavviato, poi `api` e `realtime` locali rimessi su.
- Immagine web caricata con `docker save | ssh docker load`, `compose.yaml` e `compose.proxmox.yaml` copiati,
  `docker compose up -d`, `docker image prune -f` (205 MB). Immagini `api` e `realtime` invariate.

**Verifiche**
- `/dashboard/practice` risponde 200, `NEXT_PUBLIC_LIVE_URL` = `http://192.168.188.161:4000`, realtime 200.
- Il bundle servito contiene il codice nuovo (colonne "Race pace", chiave `ST` della velocità).
- Non verificata a vista: il pannello browser di Claude non apre `.161`.

**Stato finale**
- LXC 108 **acceso** (weekend di Austin), 172 MB usati. Host: 137 MB liberi, swap usata 3,4 GB. VM Home Assistant
  in esecuzione. Disco 108: 4,8 GB liberi.

**Da fare / aperto**
- Spegnere il 108 a fine weekend.

## 2026-10-10 — Eliminato il vecchio stack su Proxmox

**Obiettivo**: liberare il disco del container LXC 108 togliendo il vecchio stack upstream, fermo dal pomeriggio.

**Prima di cancellare**
- LXC 108 era spento: acceso via API alle 19:26 solo per la pulizia.
- Copia sul PC di ciò che non era rigenerabile: `D:\PyProg\f1-dash-proxmox-old-stack-20261010.tar.gz` (44 MB).
  Contiene `/opt/f1-dash` (checkout del fork a `04882a3` con modifiche locali mai committate, `.env`, cartella
  `dashboard/` e `f1-dashboard-src.tar.gz` di maggio) e i due volumi di timescaledb. Verificata: 3141 file,
  stesso numero che sul container.

**Eliminato dal container**
- Progetto compose `f1-dash`: 6 container, rete `f1-dash_default`, volume del database
  (`docker compose -p f1-dash down -v --rmi all`).
- Immagini `ghcr.io/slowlydev/f1-dash`, `-api`, `-live`, `-importer`, `-analytics` e `timescale/timescaledb`.
- Un volume orfano del database, le immagini senza nome (comprese le due web precedenti), la build cache (1,15 GB).
- La cartella `/opt/f1-dash`.

**Verifiche**
- Restano solo i 3 container di `f1-dash-v4` e le 3 immagini `f1-dash-*-local`, nessun volume.
- `/dashboard`, `/dashboard/qualifying`, `/dashboard/vertical`, `/schedule` rispondono 200; realtime e API 200.
- Disco: da 843 MB a **4,8 GB liberi** su 7,8 GB.

**Stato finale**
- Ore 19:32: LXC 108 **rispento**, com'era prima dell'intervento. Host: 665 MB liberi su 3363. VM Home Assistant
  in esecuzione e raggiungibile.

**Da fare / aperto**
- Il backup sul PC si può cancellare quando non serve più.

## 2026-10-10 — Modalità qualifica su Proxmox

**Obiettivo**: portare su Proxmox la pagina Qualifying completata (`/dashboard/qualifying`).

**Versione installata**: commit `7ef616a`, costruita con la cartella di lavoro pulita (ore 16:50 circa).

**Sul PC**
- Committata la modalità qualifica (tabellone con linea di taglio, stato dei piloti, ultima chiamata, pannello dei
  giri lanciati) e gli strumenti in `recordings/`.
- Ricostruita `f1-dash-web-local` dal commit. `api` e `realtime` non toccate.

**Su Proxmox**
- Caricata la sola immagine web con `docker save | gzip | ssh | docker load`, copiati i due file compose,
  `docker compose up -d`: ricreato solo il container `web`.
- Niente cancellato: l'immagine web precedente resta senza nome sul container.

**Verifiche**
- `/dashboard`, `/dashboard/qualifying`, `/dashboard/vertical`, `/dashboard/driver`, `/dashboard/driver/16`,
  `/schedule` rispondono 200 su `192.168.188.161:3000`.
- La pagina espone `NEXT_PUBLIC_LIVE_URL = http://192.168.188.161:4000`, nessun riferimento a `.150`.
- Realtime: `/api/drivers` 200 con CORS corretto, lo stream invia l'evento `initial`. API: `/api/schedule/next` 200.
- Non verificato: la resa a schermo con dati live su Proxmox e l'accesso via Twingate.

**Stato finale**
- LXC 108 acceso, ~230 MB di RAM usati. Disco: 843 MB liberi su 7,8 GB (erano 888).
- Ore 17:21: LXC 108 **spento** su richiesta (`POST .../lxc/108/status/shutdown`). Host: 752 MB liberi su 3363
  (erano 126). Per riaccenderlo: `POST /nodes/bahlbee/lxc/108/status/start`, lo stack riparte da solo.

**Da fare / aperto**
- I commit locali non sono ancora inviati a GitHub.
- Restano validi i punti aperti della voce precedente (spegnere il 108 a fine weekend, vecchio stack da eliminare).

## 2026-10-10 — Proxmox allineato alla versione del PC

**Obiettivo**: portare l'installazione su Proxmox (LXC 108, `192.168.188.161`) alla stessa versione del PC di
sviluppo, branch `codex/vertical-of-doom-final`.

**Versione effettivamente installata**: commit `4c9c821` **più** le modifiche non committate presenti nella
cartella di lavoro al momento della build (ore 16:01): la pagina Qualifying in sviluppo (`/dashboard/qualifying`,
voce nella sidebar, file fermi alle 15:59). `docker build` impacchetta la cartella di lavoro, non l'ultimo commit.

**Stato iniziale**
- LXC 108 spento dal 25/05/2026.
- Dentro girava il vecchio stack upstream in `/opt/f1-dash` (immagini `ghcr.io/slowlydev/*` di 4-13 mesi fa, con
  timescaledb, importer e analytics): nessuna delle modifiche del fork.

**Sul PC**
- Ricostruita l'immagine `f1-dash-web-local` dal branch attuale (quella precedente era del 09/10 e non conteneva
  i tre commit del 10/10). Immagini `api` e `realtime` lasciate com'erano: il codice Rust non è cambiato.
- `compose.proxmox.yaml`: i tre servizi usano le immagini `f1-dash-*-local` e hanno `restart: unless-stopped`.
- `dashboard/.dockerignore`: aggiunti `.env.local` e `.env.*.local`.
- Creati `CLAUDE.md` e questo `LOG.md`.
- Il container `web` locale non è stato ricreato: usa ancora l'immagine vecchia finché non si fa
  `docker compose up -d web`.

**Su Proxmox**
- Avviato LXC 108 tramite API Proxmox (`POST /nodes/bahlbee/lxc/108/status/start`).
- Caricate le tre immagini con `docker save | gzip | ssh | docker load`.
- Vecchio stack fermato con `docker compose stop` in `/opt/f1-dash`. Niente cancellato: container, volumi,
  immagini e cartella sono ancora lì.
- Nuovo stack in `/opt/f1-dash-v4` (`compose.yaml` + `compose.override.yaml`), avviato con `docker compose up -d`.

**Problema trovato e risolto**
- Dopo il primo avvio la dashboard su Proxmox puntava al realtime del PC (`192.168.188.150:4000`).
- Causa: `dashboard/.env.local` finiva nell'immagine e Next.js incorporava `NEXT_PUBLIC_LIVE_URL` durante la build.
- Fix: `.env.local` escluso via `.dockerignore`, immagine ricostruita e ricaricata.

**Verifiche**
- `/dashboard`, `/dashboard/vertical`, `/dashboard/driver/1`, `/schedule` rispondono 200 su `192.168.188.161:3000`.
- La pagina espone `NEXT_PUBLIC_LIVE_URL = http://192.168.188.161:4000`, nessun riferimento a `.150`.
- I file JS serviti da Proxmox coincidono con quelli dell'immagine costruita sul PC.
- Realtime: `/api/drivers` 200 con CORS corretto, lo stream `/api/realtime` invia l'evento `initial`.
- API: `/api/schedule/next` 200.
- Non verificato: l'accesso da fuori casa via Twingate e la resa a schermo con dati live (il browser integrato
  blocca le chiamate alla porta 4000).

**Stato finale host Proxmox**
- LXC 108 acceso, ~200 MB di RAM usati. VM Home Assistant (103) in esecuzione e raggiungibile.
- Host: 152 MB liberi su 3363, swap usata 3,5 GB (era 2,7 GB prima dell'avvio).
- Disco LXC 108: 887 MB liberi su 7,8 GB.

**Da fare / aperto**
- Le modifiche di questo intervento sono nel commit `cb67c6c` (non ancora inviato a GitHub). Restano fuori dal
  commit i file della pagina Qualifying e `recordings/`, che appartengono a un altro lavoro in corso.
- Se la pagina Qualifying cambia ancora, Proxmox va riaggiornato con la procedura in `CLAUDE.md`.
- Spegnere il 108 a fine weekend di gara per liberare memoria all'host.
- Quando il nuovo stack è confermato, si può eliminare il vecchio (`/opt/f1-dash`, immagini `ghcr.io/slowlydev/*`
  e `timescale/timescaledb`, build cache): libera circa 2,5 GB sul disco del container.
