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
- Nessun limite ai tentativi di login: usa una password lunga.
- Le icone sono ridotte a quelle usate: se ne aggiungi una nuova (`ph-...`) va rigenerato `public/vendor/phosphor.*`.
- L'informativa privacy è un modello generico: falla verificare prima di affidartici.
