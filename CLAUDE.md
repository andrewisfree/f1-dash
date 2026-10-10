# f1-dash (fork personale)

Fork di [slowlydev/f1-dash](https://github.com/slowlydev/f1-dash) con funzioni aggiunte nella dashboard:
Vertical of Doom (`/dashboard/vertical`), pagina pilota (`/dashboard/driver/[nr]`) e modalità qualifica
(`/dashboard/qualifying`).

## Repository

| Cosa | Valore |
|---|---|
| `origin` | `andrewisfree/f1-dash` (fork) |
| `upstream` | `slowlydev/f1-dash` |
| Branch di lavoro | `codex/vertical-of-doom-final` |
| `dashboard/` | Next.js + TypeScript, yarn 4 |
| `api/`, `realtime/`, `shared/`, `signalr/`, `simulator/` | Rust (workspace Cargo) |

Le modifiche del fork sono **solo in `dashboard/`**: il backend Rust è identico a `upstream/main`.
Le variabili `NEXT_PUBLIC_LIVE_URL` e `API_URL` sono lette a runtime (`dashboard/src/env-script.tsx`),
quindi la stessa immagine web funziona su qualsiasi host.

## Due installazioni

| | PC di sviluppo (Windows) | Proxmox |
|---|---|---|
| Indirizzo | `192.168.188.150` | `192.168.188.161` (DHCP) |
| Compose | `compose.yaml` + `compose.override.yaml` | `compose.yaml` + `compose.proxmox.yaml` |
| Porte | web 3000, realtime 4000, api 4010 | uguali |
| Accesso da fuori casa | — | Twingate (connector = LXC 109) |

### PC di sviluppo

- `start-f1dash.cmd`: avvia `api` e `realtime` in Docker, ferma il container `web` e lancia `next dev` sulla 3000.
- Immagini locali: `f1-dash-web-local`, `f1-dash-api-local`, `f1-dash-realtime-local`.
- Ricostruire la web dopo modifiche alla dashboard: `docker build -t f1-dash-web-local ./dashboard`.
- Il backend va ricostruito solo se cambia il codice Rust (`dockerfile` in radice, target `api` e `realtime`).

### Proxmox

- Host Proxmox: `192.168.188.88`, nodo **`bahlbee`**, UI su `:8006`.
- f1-dash è il **container LXC 108** (`f1-dash`, Debian, 2 core, 4096 MB, disco 8 GB, `nesting=1`, `onboot=0`).
- Resta **spento** e viene acceso a mano nei weekend di gara: se `.161` non risponde, è spento.
- ⚠️ L'host ha solo ~3,3 GB di RAM, quasi sempre satura (ci gira anche la VM Home Assistant, id 103, che in passato
  si è congelata per memoria esaurita). Controllare la memoria libera prima di accendere il 108 e spegnerlo a fine gara.
- SSH nel container: `ssh root@192.168.188.161` (le chiavi di questo PC sono accettate).
- Stack attuale in **`/opt/f1-dash-v4`**: `compose.yaml` (copia di quello del repo) + `compose.override.yaml`
  (copia di `compose.proxmox.yaml`). Lì basta `docker compose up -d`. I servizi hanno `restart: unless-stopped`,
  quindi ripartono da soli quando si accende il container.
- In `/opt/f1-dash` c'è il vecchio stack upstream (frontend, live, api, timescaledb, importer, analytics):
  è **fermato, non cancellato**. Non avviarlo insieme al nuovo (stesse porte 3000 e 4000).
- Disco quasi pieno (8 GB, ~0,9 GB liberi): controllare `df -h /` prima di caricare immagini.
- Compilare sul container non è praticabile (CPU dual-core lenta, poca RAM): le immagini si costruiscono sul PC.

### Aggiornare Proxmox alla versione del PC

Da Git Bash, nella radice del repo (verificato 2026-10-10, circa 2 minuti):

```bash
docker build -t f1-dash-web-local ./dashboard
docker save f1-dash-web-local | gzip -1 | ssh root@192.168.188.161 'gunzip | docker load'
scp compose.yaml root@192.168.188.161:/opt/f1-dash-v4/compose.yaml
scp compose.proxmox.yaml root@192.168.188.161:/opt/f1-dash-v4/compose.override.yaml
ssh root@192.168.188.161 'cd /opt/f1-dash-v4 && docker compose up -d'
```

Aggiungere `f1-dash-api-local f1-dash-realtime-local` al `docker save` solo se è cambiato il codice Rust.
`docker build` impacchetta la **cartella di lavoro**, modifiche non committate comprese: controllare `git status` prima.

Controllo: la pagina `http://192.168.188.161:3000/dashboard` deve contenere
`NEXT_PUBLIC_LIVE_URL":"http://192.168.188.161:4000"`.

⚠️ `dashboard/.env.local` **non deve entrare nell'immagine**: Next.js incorpora le variabili `NEXT_PUBLIC_*`
durante la build e a quel punto il valore a runtime viene ignorato (la dashboard su Proxmox puntava al realtime
del PC). Per questo `.env.local` è in `dashboard/.dockerignore`.

## Registrazioni del feed

`recordings/` contiene gli strumenti per registrare e riprodurre una sessione reale (i file `.tsv` non sono in git):

- `node recordings/record.js <file.tsv> <minuti>` registra `localhost:4000/api/realtime`, un evento per riga.
- `node recordings/make-replay.js <file.tsv> <out.json> <da_secondi|-1> <durata_secondi>` estrae lo stato a un
  certo punto più gli eventi successivi, da riprodurre nel browser per provare le pagine senza una sessione live.

Lo storico degli interventi è in [LOG.md](LOG.md): aggiungere una voce a ogni modifica di deploy o infrastruttura.

## Accesso a Proxmox

SSH come `root` sull'host `.88` con le chiavi di questo PC è **rifiutato**. Si usa la REST API:

- URL: `https://192.168.188.88:8006/api2/json/`
- Token: `C:\Users\bahlbee\Desktop\home-assistant\.proxmox_token\claude_api_proxmox.txt`
  (fuori da questo repo, mai copiarlo qui). Il file contiene già il prefisso `PVEAPIToken=...`.
- Da PowerShell:

```powershell
$tok = (Get-Content "$HOME\Desktop\home-assistant\.proxmox_token\claude_api_proxmox.txt" -Raw).Trim()
Invoke-RestMethod 'https://192.168.188.88:8006/api2/json/cluster/resources?type=vm' `
  -Headers @{ Authorization = $tok } -SkipCertificateCheck -SkipHeaderValidation -TimeoutSec 35
```

- L'handshake SSL è lento e a volte risponde `596 Broken pipe`: ritentare.
- Endpoint utili: `/nodes/bahlbee/status` (RAM host), `/nodes/bahlbee/lxc/108/config`,
  `/nodes/bahlbee/lxc/108/status/current`, `POST /nodes/bahlbee/lxc/108/status/start|shutdown`.
- L'API non esegue comandi dentro un LXC: per lavorare nel container serve SSH verso `192.168.188.161`.

Altri dettagli sull'host Proxmox sono nel `CLAUDE.md` del repo `C:\Users\bahlbee\Desktop\home-assistant`.
