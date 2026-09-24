# Image Studio - AI-bildegenerator

Node.js/Express-app for bildegenerering og bilderedigering med Gemini, GPT Image, Grok Imagine og FLUX.2.

## Funksjoner

- Tekst-til-bilde generering
- Redigering med opptil 14 referansebilder, avhengig av valgt modell
- Ferdig redigerbar prompt for konservativ restaurering av gamle fotografier
- Valgfri Intuvio Brand Guidelines-avhuking som legger font- og fargeregler til prompten for alle valgte modeller
- Valgfritt logovalg med fire originale Intuvio-filer som sendes som referansebilder
- Valg av aspektforhold og opplosning
- Eksakt pixelstorrelse for GPT Image-modeller nar en av dem brukes alene
- Modellvalg per request:
  - `gemini-3.1-flash-image`
  - `gemini-3.1-flash-lite-image` (kun 1K)
  - `gemini-3-pro-image`
  - `gpt-image-2.5-sunburst` (standard)
  - `gpt-image-2.5-flare`
  - `gpt-image-2`
  - `grok-imagine-image-2.0`
  - `flux-2-max`
- Side-ved-side sammenligning ved a velge flere modeller samtidig
- Nedlasting av genererte bilder fra webgrensesnittet

## Oppsett lokalt

Krever Node.js 20 eller nyere (Google GenAI SDK).

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
   GOOGLE_API_BASE_URL=
   OPENAI_API_KEY=din_openai_api_nokkel
   OPENAI_API_BASE_URL=
   XAI_API_KEY=din_xai_api_nokkel
   XAI_API_BASE_URL=
   BFL_API_KEY=din_bfl_api_nokkel
   BFL_API_BASE_URL=
   BFL_POLL_INTERVAL_MS=750
   BFL_POLL_TIMEOUT_SECONDS=120
   INPUT_IMAGE_MAX_EDGE=2048
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
   LOGIN_FAILED_WINDOW_SECONDS=900
   LOGIN_MAX_FAILED_ATTEMPTS_PER_IP=8
   LOGIN_FAILED_LOCKOUT_SECONDS=1800
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
- Egen teller for feilede innloggingsforsok per IP, med midlertidig lockout
- Rate-limit pa `POST /generate` per IP og per bruker
- Budsjettvern pa `POST /generate` per time og per dogn

Alle grenser kan justeres via miljo-variabler i `.env`/Railway.

## API

- `POST /generate`
  - `multipart/form-data`
  - Felter:
    - `prompt` (pakrevd)
    - `useIntuvioBrandGuidelines` (valgfritt, `true` eller `false`, standard `false`)
      - Nar `true` legges Inter Tight og Intuvios fargepalett til prompten som sendes til alle valgte modeller. Primar: hvit, `#211446`, `#83AEEA`; knapper: `#6C3DED`. Sekundar: `#D4A7F4`, `#A1DF83`, `#EBD16A`, `#EA9460`, `#ED6060`.
      - Bildet skal ikke inneholde tekst som ikke er uttrykkelig spesifisert i prompten eller referansebildene.
      - Ved redigering av referansefoto gjelder paletten nye grafiske elementer; originalfotoets personer, produkter og farger skal bevares. Kontroller tekst og eksakt font i resultatet.
    - `useIntuvioLogo` (valgfritt, `true` eller `false`, standard `false`)
      - Nar `true` kreves `intuvioLogo`: `wordmark-color`, `wordmark-white`, `mark-color` eller `mark-white`. Den valgte originalfilen legges sist blant referansebildene for alle valgte modeller.
      - Nar `false` ber prompten modellen om ikke a lage noen logo. Ingen logo skal konstrueres eller tegnes pa frihand.
      - Logoen teller med i leverandorens grense for referansebilder. Det gir maks 13 egne bilder generelt, 9 med FLUX.2 Max og 2 med Grok Imagine.
    - `images` (valgfritt, opptil 14 filer)
      - Bilder, inkludert HEIC/HEIF fra mobilkamera, auto-roteres og konverteres til WebP med maks 2048 px lengste kant for modellkallet
      - Gemini-bilder komprimeres til en samlet rådatabudsjett på 14 MiB, slik at inline-requesten holder seg under leverandorens totalgrense på 20 MB etter base64 og promptdata
      - Merk: GPT Image-modellene bruker OpenAI `/images/edits` nar referansebilder lastes opp. OpenAI stotter ett eller flere referansebilder, men dette er ikke helt samme modellatferd som Gemini.
      - Merk: Grok Imagine bruker xAI `/images/generations` og `/images/edits`, med opptil 3 referansebilder. Referansebildene sendes som base64-data-URL-er.
      - Merk: FLUX.2 Max bruker BFL sitt asynkrone `/flux-2-max`-endepunkt. Appen sender opptil 10 referansebilder og maks 20 MiB per ferdigbehandlet fil.
    - `aspectRatio` (valgfritt, standard `16:9`)
    - `resolution` (valgfritt, standard `1K`)
      - Gemini 3.1 Flash Lite Image stotter bare `1K`; foresporsler med `2K` eller `4K` avvises.
      - Grok Imagine stotter `1K` og `2K`; et felles `4K`-valg mappes til `2K` for Grok.
      - Aspektforhold som xAI ikke stotter direkte mappes til naermeste stottede forhold.
    - `openaiSizeMode` (valgfritt, standard `aspect`)
      - `aspect`: valgt GPT Image-modell mappes til `aspectRatio` + `resolution`
      - `auto`: tilgjengelig nar en GPT Image-modell er eneste valgte modell
      - `exact`: tilgjengelig nar en GPT Image-modell er eneste valgte modell
    - `openaiWidth` og `openaiHeight` (pakrevd ved `openaiSizeMode=exact`)
      - Maks kant: `3840px`
      - Begge kanter ma vaere delelige med `16`
      - Forhold mellom lengste og korteste kant maks `3:1`
      - Totalt antall pixler ma vaere mellom `655360` og `8294400`
    - `bflSizeMode` (valgfritt, standard `aspect`)
      - `aspect`: FLUX.2 Max mappes til valgt `aspectRatio` + `resolution`
      - `auto`: kun tilgjengelig nar bare `flux-2-max` er valgt
      - `exact`: kun tilgjengelig nar bare `flux-2-max` er valgt
    - `bflWidth` og `bflHeight` (pakrevd ved `bflSizeMode=exact`)
      - Min kant: `64px`
      - Totalt antall pixler ma vaere maks `4194304`
    - `models` (valgfritt, kan sendes flere ganger for sammenligning)
      - `gemini-3.1-flash-image`
      - `gemini-3.1-flash-lite-image`
      - `gemini-3-pro-image`
      - `gpt-image-2.5-sunburst`
      - `gpt-image-2.5-flare`
      - `gpt-image-2`
      - `grok-imagine-image-2.0`
      - `flux-2-max`
  - Returnerer:
    - `results[]` med ett resultatobjekt per modell (`model`, `label`, `text`, `image`, `error`)
    - Grok-resultater mottas som base64 (med URL-fallback), lagres lokalt og returneres som lokal bildesti.
    - FLUX.2-resultater polles via BFL sin `polling_url`, lastes ned fra den signerte resultat-URL-en og lagres lokalt under `public/generated/`
    - Backend prover fallback-forsok per modell hvis forste forsok gir tom respons:
      - uten `aspectRatio`
      - med `1K` fallback-opplosning
      - med mer tolerant safety-threshold (`BLOCK_ONLY_HIGH`)
- `GET /health`
  - Returnerer `200` og `{ "status": "ok" }`

## Railway-klart oppsett

Appen er klar for Railway med standard Node deploy:

- `npm install` ved build
- `npm start` ved runtime
- `PORT` leses fra miljoet
- Sett disse variablene i Railway:
  - `GOOGLE_API_KEY`
  - `GOOGLE_API_BASE_URL` (valgfritt, standard Google API)
  - `OPENAI_API_KEY`
  - `XAI_API_KEY`
  - `XAI_API_BASE_URL` (valgfritt, standard `https://api.x.ai/v1`)
  - `BFL_API_KEY`
  - `BFL_API_BASE_URL`, `BFL_POLL_INTERVAL_MS` og `BFL_POLL_TIMEOUT_SECONDS` (valgfritt)
  - `BASIC_AUTH_USERNAME` (anbefalt) eller `USERNAME`
  - `BASIC_AUTH_PASSWORD` (anbefalt) eller `PASSWORD`
  - `AUTH_SESSION_SECRET` (anbefalt)
  - `LOGIN_WINDOW_SECONDS` og `LOGIN_MAX_ATTEMPTS_PER_IP` (valgfritt)
  - `LOGIN_FAILED_WINDOW_SECONDS`, `LOGIN_MAX_FAILED_ATTEMPTS_PER_IP`, `LOGIN_FAILED_LOCKOUT_SECONDS` (valgfritt)
  - `GENERATE_WINDOW_SECONDS`, `GENERATE_MAX_REQUESTS_PER_IP`, `GENERATE_MAX_REQUESTS_PER_USER` (valgfritt)
  - `GENERATE_MAX_PER_HOUR` og `GENERATE_MAX_PER_DAY` (valgfritt)

Merk: `uploads/` og `public/generated/` ligger pa lokal disk i containeren. Uten volume/storage vil filer kunne forsvinne ved restart/redeploy.
