# Image Studio - Gemini AI-bildegenerator

Node.js/Express-app for bildegenerering og bilderedigering med Gemini.

## Funksjoner

- Tekst-til-bilde generering
- Redigering med opptil 14 referansebilder
- Valg av aspektforhold og opplosning
- Valgfri Google-sok-grounding for oppdatert kontekst
- Nedlasting av genererte bilder fra webgrensesnittet

## Oppsett lokalt

1. Installer avhengigheter:
   ```bash
   npm install
   ```
2. Kopier miljovariabler:
   ```bash
   cp .env.example .env
   ```
3. Sett verdier i `.env`:
   ```env
   GOOGLE_API_KEY=din_google_api_nokkel
   PORT=3001
   NODE_ENV=development
   USERNAME=valgfritt_i_dev
   PASSWORD=valgfritt_i_dev
   BASIC_AUTH_USERNAME=
   BASIC_AUTH_PASSWORD=
   AUTH_SESSION_SECRET=
   ALLOW_UNAUTHENTICATED=false
   LOGIN_WINDOW_SECONDS=600
   LOGIN_MAX_ATTEMPTS_PER_IP=15
   GENERATE_WINDOW_SECONDS=600
   GENERATE_MAX_REQUESTS_PER_IP=40
   GENERATE_MAX_REQUESTS_PER_USER=120
   GENERATE_MAX_PER_HOUR=300
   GENERATE_MAX_PER_DAY=1200
   ```

## Kjoring

- Utvikling:
  ```bash
  npm run dev
  ```
- Produksjon:
  ```bash
  npm start
  ```

## Autentisering

Innlogging via `/login` kreves for alle endepunkter unntatt `/health`.

- Brukernavn hentes fra `BASIC_AUTH_USERNAME` eller `USERNAME`
- Passord hentes fra `BASIC_AUTH_PASSWORD` eller `PASSWORD`
- Etter vellykket innlogging settes en `HttpOnly` cookie
- `AUTH_SESSION_SECRET` er valgfri, men anbefalt i produksjon
- Hvis credentials mangler stopper appen oppstart (fail-closed)
- `ALLOW_UNAUTHENTICATED=true` kan brukes kun for lokal testing

## Misbruksvern

Appen har innebygde grenser for a redusere risiko for dyre API-kall:

- Rate-limit pa `POST /login` per IP
- Rate-limit pa `POST /generate` per IP og per bruker
- Budsjettvern pa `POST /generate` per time og per dogn

Alle grenser kan justeres via miljo-variabler i `.env`/Railway.

## API

- `POST /generate`
  - `multipart/form-data`
  - Felter:
    - `prompt` (pakrevd)
    - `images` (valgfritt, opptil 14 filer)
    - `aspectRatio` (valgfritt, standard `16:9`)
    - `resolution` (valgfritt, standard `2K`)
    - `useGoogleSearch` (`true`/`false`)
- `GET /health`
  - Returnerer `200` og `{ "status": "ok" }`

## Railway-klart oppsett

Appen er klar for Railway med standard Node deploy:

- `npm install` ved build
- `npm start` ved runtime
- `PORT` leses fra miljoet
- Sett disse variablene i Railway:
  - `GOOGLE_API_KEY`
  - `BASIC_AUTH_USERNAME` (anbefalt) eller `USERNAME`
  - `BASIC_AUTH_PASSWORD` (anbefalt) eller `PASSWORD`
  - `AUTH_SESSION_SECRET` (anbefalt)
  - `LOGIN_WINDOW_SECONDS` og `LOGIN_MAX_ATTEMPTS_PER_IP` (valgfritt)
  - `GENERATE_WINDOW_SECONDS`, `GENERATE_MAX_REQUESTS_PER_IP`, `GENERATE_MAX_REQUESTS_PER_USER` (valgfritt)
  - `GENERATE_MAX_PER_HOUR` og `GENERATE_MAX_PER_DAY` (valgfritt)

Merk: `uploads/` og `public/generated/` ligger pa lokal disk i containeren. Uten volume/storage vil filer kunne forsvinne ved restart/redeploy.
