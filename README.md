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

## Produksjonsautentisering

Nar `NODE_ENV=production` er satt, kreves Basic Auth for alle endepunkter unntatt `/health`.

- Brukernavn hentes fra `BASIC_AUTH_USERNAME` eller `USERNAME`
- Passord hentes fra `BASIC_AUTH_PASSWORD` eller `PASSWORD`

Appen starter ikke i produksjon uten disse to variablene.

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
  - `NODE_ENV=production`
  - `BASIC_AUTH_USERNAME` (anbefalt) eller `USERNAME`
  - `BASIC_AUTH_PASSWORD` (anbefalt) eller `PASSWORD`

Merk: `uploads/` og `public/generated/` ligger pa lokal disk i containeren. Uten volume/storage vil filer kunne forsvinne ved restart/redeploy.
