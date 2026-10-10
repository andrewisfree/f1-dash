# Log modifiche

Storico degli interventi su deploy e infrastruttura di f1-dash. Voce più recente in alto.

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
- Modifiche non committate di questo intervento: `compose.proxmox.yaml`, `dashboard/.dockerignore`, `CLAUDE.md`,
  `LOG.md`. (Nella cartella di lavoro ci sono anche i file della pagina Qualifying e `recordings/`, di un altro lavoro.)
- Se la pagina Qualifying cambia ancora, Proxmox va riaggiornato con la procedura in `CLAUDE.md`.
- Spegnere il 108 a fine weekend di gara per liberare memoria all'host.
- Quando il nuovo stack è confermato, si può eliminare il vecchio (`/opt/f1-dash`, immagini `ghcr.io/slowlydev/*`
  e `timescale/timescaledb`, build cache): libera circa 2,5 GB sul disco del container.
