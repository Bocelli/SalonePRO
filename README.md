# Salone PRO

Gestionale per salone (agenda, listino, schede clienti, magazzino, privacy) più la pagina di prenotazione online per le clienti. HTML/CSS/JS senza build, API serverless su Vercel, database Postgres su Neon (piano gratuito).

| Indirizzo | Cosa c'è |
|---|---|
| `/` | Gestionale del salone, protetto da password |
| `/prenota` | Pagina pubblica di prenotazione da dare alle clienti |

## Come è fatto

```
public/            pagine statiche (index.html = gestionale, prenota.html = clienti)
  base.css         colori, font e componenti condivisi (chiaro e scuro automatici)
  common.js        funzioni condivise (date, euro, WhatsApp, informativa privacy)
  vendor/          font Geist e icone Phosphor, ospitati sul sito e ridotti ai caratteri usati
api/
  _lib.js          database, sessione admin, orari (fuso Europe/Rome)
  login.js         POST login, DELETE logout (cookie HttpOnly firmato, 30 giorni)
  data.js          API del gestionale (serve il login)
  public.js        API della pagina clienti: listino, orari occupati (senza nomi), prenotazione
test/              test delle API su un Postgres in memoria (`npm test`)
```

Tutti i dati stanno in una sola tabella `docs (col, id, data jsonb)`, creata in automatico alla prima richiesta insieme a un listino di partenza.

## WhatsApp (senza API)

Tutto passa da link `wa.me`, nessun account business o API:
- dall'agenda: conferma o promemoria alla cliente con un tocco (anche SMS);
- la cliente può inviare la richiesta di prenotazione su WhatsApp invece di prenotare online;
- dopo una prenotazione online la cliente può avvisare il salone su WhatsApp;
- "Inserisci da messaggio" trasforma un messaggio di prenotazione incollato in un appuntamento;
- "Condividi su WhatsApp" manda il link della pagina di prenotazione.

## Sicurezza

- **Password** solo come variabile d'ambiente `ADMIN_PASSWORD` (tipo Sensitive su Vercel), mai nel codice.
- **Sessione**: cookie HttpOnly, Secure, SameSite=Strict, firmato HMAC-SHA256, scade dopo 30 giorni.
- **Tentativi di login**: dopo 5 password sbagliate quell'IP è bloccato per 15 minuti.
- **Esci da tutti i dispositivi** (Impostazioni): invalida subito ogni sessione aperta, per un tablet perso o rubato. Anche cambiare `ADMIN_PASSWORD` + Redeploy scollega tutti.
- **Prenotazioni online**: massimo 10 tentativi all'ora per IP, più un campo nascosto anti-bot.
- **API pubblica**: non restituisce mai nomi o telefoni, solo gli orari occupati.
- **Header**: Content-Security-Policy (nessuno script o connessione verso altri siti), anti-clickjacking, HSTS di Vercel.
- **Dati in UE**: funzioni a Francoforte (`fra1`), database Neon a Francoforte.

Da fare sugli account (fuori dal codice): attiva la verifica in due passaggi su GitHub, Vercel e Neon, perché chi entra lì vede tutto.

## App installabile (PWA)

`manifest.webmanifest` e le icone in `public/icons/` rendono il gestionale installabile: Impostazioni > "Installa l'app" su Android e computer, oppure Safari > Condividi > "Aggiungi alla schermata Home" su iPhone e iPad. Non c'è modalità offline: i dati arrivano sempre dal database.

Dopo il login compare un banner in basso: su Android e computer ha il pulsante **Installa**, su iPhone e iPad spiega i passaggi di Safari. Si chiude con la X e non ricompare su quel dispositivo; la guida completa resta in Impostazioni > "Come si installa".

L'anteprima del link `/prenota` su WhatsApp e social usa `public/og.png` e i meta `og:` in `prenota.html`, con indirizzi assoluti su `salone-pro.vercel.app`: se colleghi un dominio tuo, aggiornali.

## Modalità offline

Il gestionale funziona anche senza internet, se su quel dispositivo è già stato fatto l'accesso almeno una volta con la rete:
- `public/sw.js` (service worker) tiene in cache pagine e risorse: prima prova la rete, poi la cache. Le API non passano mai dalla cache.
- Dopo ogni caricamento i dati vengono copiati sul dispositivo (`localStorage`, chiave `sp_cache`).
- Le modifiche fatte senza rete (o con la sessione scaduta) finiscono in una coda (`sp_outbox`) e partono in ordine al ritorno della rete: evento `online`, ritorno sulla scheda, ogni 2 minuti o con "Riprova".
- Dopo l'invio, gli appuntamenti inseriti offline che si sovrappongono ad altri (per esempio una prenotazione web arrivata nel frattempo) vengono segnalati e marcati "Sovrapposto" in agenda.
- "Esci" cancella copia e coda dal dispositivo; se la sessione è scaduta o revocata, la copia viene cancellata appena il dispositivo torna online.

Limiti: due dispositivi che modificano la stessa voce offline si sovrascrivono (vale l'ultima inviata); ripristino backup ed "Esci" richiedono la rete; la pagina `/prenota` per le clienti resta solo online.

## Novità (changelog)

Al primo accesso dopo un aggiornamento il gestionale mostra "Novità di Salone PRO", riapribile dal menu (Novità). Per annunciare un aggiornamento aggiungi una voce **in cima** all'array `NEWS` in `public/index.html` con un nuovo `v`: comparirà una volta su ogni dispositivo.

## Configurazione su Vercel

1. **Database:** progetto Vercel, tab **Storage**, **Create Database**, scegli **Neon** (piano Free), regione **Frankfurt (eu-central-1)**, collegalo al progetto. Vercel aggiunge da solo `DATABASE_URL`.
2. **Password:** in **Settings > Environment Variables** imposta `ADMIN_PASSWORD` (almeno 10 caratteri, meglio una frase lunga).
3. **Redeploy** dal tab Deployments, così le nuove variabili vengono lette.

Le funzioni girano in `fra1` (Francoforte, vedi `vercel.json`) così i dati restano in UE.

## Portare i dati dalla versione v6

La v6 salvava tutto nel browser del tablet. Apri `salone_pro_v6.html` su quel dispositivo, **Impostazioni & Dati > Scarica Backup**, poi nel nuovo gestionale **Impostazioni & dati > Ripristina da backup**. Il ripristino sostituisce tutti i dati attuali.

## Test

```bash
npm install
npm test
```

## Limiti noti

- Il gestionale ricarica i dati ogni 2 minuti e quando torni sulla scheda: una prenotazione web compare entro quel tempo.
- Le icone sono ridotte a quelle usate: se ne aggiungi una nuova (`ph-...`) va rigenerato `public/vendor/phosphor.*`.
- L'informativa privacy è un modello generico: falla verificare prima di affidartici.
