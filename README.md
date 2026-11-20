# Image Studio - AI-bildegenerator

Node.js/Express-app for bildegenerering og bilderedigering med Gemini, GPT Image, Grok Imagine og FLUX.2.

## Funksjoner

- Egen Video-fane med sju oppgaver, modellforslag og sammenligning av pris/bruksområder
- 23 fal-modellvalg (38 endepunkter) samt eksisterende direktekoblinger for Grok og Gemini
- «Animer bildet» fra bilderesultatene

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

### Video

Video bruker ekte leverandør-API-er. Aktiv jobb vises med spinner, fase og medgått tid. Velg oppgave, modell og innstillinger, hent et
prisanslag og bekreft genereringen. Bilder fungerer fortsatt som før. Modeller uten
nøkkel vises i listen, men genereringsforsøket gir en tydelig feilmelding uten API-kall.

Ved alle oppgaver som trenger et bilde kan du velge «Lag et bilde først».
Du går da til Bilder med en forklaring og velger «Bruk i video» under et resultat.
Appen tar bildet tilbake til den opprinnelige videooppgaven uten å endre valgt modell,
prompt, varighet, oppløsning eller opplastet fremføringsvideo. Du kan også gå tilbake
uten å velge et nytt bilde. Bildet og videoen genereres i to separate, betalte steg;
å bytte fane eller velge et ferdig bilde starter ingen generering.

Velg mellom tekst til video, bildeanimering, bevegelsesoverføring, snakkende bilde,
endring av video, leppesynk på video og oppskalering. Prioriter lav pris, figurer,
lyd, lengde eller oppløsning for å få begrunnede modellforslag. Sammenligningslisten
viser flere passende valg. fal og direkteleverandørene har tydelig merket separat saldo.

[Full modellkartlegging, prisgrunnlag, begrensninger og valg som ikke er integrert](docs/video-model-guide.md).
Katalogen vedlikeholdes i `video-catalogue.js`; appen tilbyr bare servervaliderte valg.
Eksempelvis støtter LTX 2.3-valget bare 6/8/10 s, mens Veo Fast tilbyr 4/6/8 s
ved 720p og 8 s ved høyere oppløsning. Modeller kan bestemme format fra startbildet.
Kling-generert tale er dokumentert for engelsk/kinesisk; for ferdig norsk tale finnes
en egen flyt med opplastet lydfil. Norsk tale og kvalitet er ikke verifisert ved betalte tester.

Opplastet lyd/video krever `ffprobe` på serverens PATH (eller `FFPROBE_PATH`).
Faktisk varighet, dimensjoner og relevante FPS-krav kontrolleres før generering.
Alle videooppgaver støtter opplasting opptil 200 MB og automatisk klargjøring ved
behov til H.264 MP4 med AAC-lyd, under 40 MB. Varigheten kontrolleres før
komprimering. «Overfør bevegelser» bruker normalt opptil 720p / 30 fps.
Videoredigering og leppesynk beholder opptil 1080p, med modellens minstedimensjoner
og FPS-grenser; Kling Edit kan beholde 60 fps. Oppskalering beholder inputstørrelsen
og avviser video over appens grense på 1920 px langside, i stedet for å nedskalere
før oppskalering. Ingen beskjæring eller oppskalering i klargjøringen; originalen
endres ikke. Lokal FFmpeg (`FFMPEG_PATH`) bruker maks to encodertråder og 90 s
timeout. Videobilde over 8K avvises. Prisanslaget viser dimensjoner og størrelse
før og etter tilpasning. Appens øvrige varighetsgrenser gjelder fortsatt, maks 30 s.
Tale er maks 10 MB, 3–30 s (H3 Lip Sync: 5–30 s). Leppesynk krever at video
og lyd har samme varighet innen 0,25 s, eller at du velger «Trim videoen etter lydsporet».
Det valget legger til 0,5 s stillhet og klipper videoen til lydsporets nye lengde.
Når Sync-jobben startes, lastes de klargjorte filene opp til fal med lenker som
utløper etter to timer. Appen forsøker å slette filene når resultatet er lagret.
Alle med lenken kan lese filen frem til sletting eller utløp.
API-et bruker tekstfeltet `audio` for
lydvalget og filfeltet `speech` for lydfilen, slik at feltene ikke kolliderer.
Bilder begrenses til 50 MB JPG/PNG/WebP, roteres etter EXIF, forminskes til valgt
videostørrelse og komprimeres til WebP under 6 MB, uten strekk, beskjæring eller
oppskalering. Originalfilen endres ikke. Modellens minste bildestørrelse og
sideforhold kontrolleres. Videooppgavene tar ikke eksterne bruker-URL-er som input.

Videoadapterne er **ikke testet mot betalte leverandører**. Tester bruker simulerte
leverandører, datert offentlig API-skjema og DOM-tester av skjermflyten. Kontroller
saldo og automatisk påfyll hos hver leverandør. Priser bruker ordinære eller
konservative satser; tidsbegrensede kampanjer reduserer ikke appens reservasjon.

Valgfrie serverinnstillinger:

```env
VIDEO_MAX_JOB_USD=3
VIDEO_MAX_DAY_USD=10
FAL_KEY=sett_paa_serveren_for_fal
```

Grok og Google bruker eksisterende `XAI_API_KEY` og `GOOGLE_API_KEY`. At en nøkkel
finnes betyr ikke at modelltilgang eller saldo er verifisert. FLUX 3 Max er tilgjengelig
via fal, mens eksisterende BFL-bildefunksjon fortsatt bruker sin direkte nøkkel.
Ingen nye kontoer, påfyll eller hosted ressurser opprettes av koden.

Prisene er USD-estimater kontrollert 19. november 2026. Appen reserverer 25 % over
anslaget pluss $0,05; dette er et lokalt kostnadsvern, ikke en garanti for leverandørens
faktiske faktura. Inndata og prisendringer kan påvirke beløpet. Dagstaket følger UTC,
og bruker reservasjonene, ikke en avlest leverandørsaldo. Uavklarte og pågående jobber
holdes også mot senere dagers ramme. Sett gjerne lavere grenser før testing.
Automatisk påfyll og eventuell etterskuddsbetaling må kontrolleres hos leverandøren.
Ved HTTP 422 oversettes bare kjente feltnavn og feilkategorier; rå leverandørsvar,
bilde-/videodata, signerte URL-er og nøkkelverdier vises ikke. Den eksakte årsaken
til en tidligere feil kan ikke utledes av HTTP-statusen alene.

Jobbhistorikk og private MP4-filer lagres under `data/video/` (Git-ignorert). Nedlasting
går gjennom appens eksisterende innlogging og støtter HTTP Range. Midlertidige
bilde-, video- og lydreferanser fjernes etter innsending eller feil. Historikken inkluderer prompten;
det er ingen automatisk sletting av historikk eller ferdige videoer i første versjon.

Kjør **én Node-prosess** for denne lokale versjonen. Jobber med lagret leverandør-ID
fortsetter polling etter omstart. Et avbrudd under innsending kan ikke sikkert avklares
uten leverandør-ID og får «Må kontrolleres». Appen sender aldri automatisk et nytt
genereringskall. Google-kallet returnerer resultatet direkte; avbrudd under kallet krever
derfor manuell kontroll av forbruk. Reservasjonen beholdes også ved feil.

Denne første versjonen bruker lokal disk. På Railway uten volume kan historikk,
videoer og lokale kostnadsreservasjoner forsvinne ved redeploy. Last ned videoer du vil
beholde. Leverandørens egne saldo- og forbruksgrenser gjelder uavhengig av appens lokale
teller. Ingen nye lagringsressurser opprettes automatisk. Før eventuell flerbrukerdrift
må varig lagring/backup, jobbkø for flere prosesser og sletting avklares.

`railpack.json` inkluderer FFmpeg/ffprobe i Railway-runtime. Repoets hovedbranch heter
`master`; Railway kan deploye automatisk når endringer pushes til denne branchen.

API-er og prisreferanser:
- [xAI Video](https://docs.x.ai/developers/model-capabilities/video/overview)
- [Gemini Omni](https://aistudio.google.com/docs/omni)
- [Google-priser](https://aistudio.google.com/docs/pricing#gemini-omni-1.2-flash)
- [Kling V3 Motion Control](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api)

### Installer og konfigurer appen

Krever Node.js 20.9 eller nyere (Google GenAI SDK).

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
- Hver innlogging får en tilfeldig økt-ID med 12 timers utløp kontrollert på serveren
- Utlogging ugyldiggjør økten på serveren. Omstart/deploy krever ny innlogging
- Brukernavn og passord beholdes ved omstart; ingen egen økt-hemmelighet kreves
- Produksjon/Railway krever alltid credentials, selv med `ALLOW_UNAUTHENTICATED=true`
- Forespørsler fra andre nettstedsopprinnelser avvises for å hindre CSRF
- Passordgjetting begrenses per IP og samlet for innloggingsendepunktet
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
  - `LOGIN_WINDOW_SECONDS` og `LOGIN_MAX_ATTEMPTS_PER_IP` (valgfritt)
  - `LOGIN_FAILED_WINDOW_SECONDS`, `LOGIN_MAX_FAILED_ATTEMPTS_PER_IP`, `LOGIN_FAILED_LOCKOUT_SECONDS` (valgfritt)
  - `GENERATE_WINDOW_SECONDS`, `GENERATE_MAX_REQUESTS_PER_IP`, `GENERATE_MAX_REQUESTS_PER_USER` (valgfritt)
  - `GENERATE_MAX_PER_HOUR` og `GENERATE_MAX_PER_DAY` (valgfritt)

Merk: `uploads/` og `public/generated/` ligger pa lokal disk i containeren. Uten volume/storage vil filer kunne forsvinne ved restart/redeploy.


### Filnavn og søkbare bildemetadata

Etter generering analyserer AI en forhåndsvisning av det ferdige bildet og lager en kort norsk tittel, en beskrivelse av motivet og søkeord. Bildetittel som brukeren oppgir, overstyrer AI-tittelen. Filnavnene bruker tittelen, UTC-dato og en tilfeldig ID, for eksempel `webinar-om-markedsplan_2026-10-14_a81aba4c.png`. Modellnavnet ligger i metadata. Nedlastingen bruker riktig filendelse (PNG, JPG eller WebP), bestemt av det faktiske bildeformatet.

Valgfrie **Søkeord** oppgis med komma eller semikolon og legges til AI-søkeordene. Tittel, AI-beskrivelse, søkeord, modell og genereringstid lagres som XMP; EXIF inneholder også beskrivelse, søkeord og modell. Beskrivelsen gjelder det som er synlig i bildet; brukerens redigeringsprompt lagres ikke som beskrivelse. Metadata følger med ved nedlasting og deling. Tittel og beskrivelse vises under resultatbildet.

Navngivningen bruker ett ekstra Google AI-kall per ferdig bilde med eksisterende `GOOGLE_API_KEY`. Standardmodellen er [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), og kan overstyres med `IMAGE_DESCRIPTION_MODEL` til en modell som støtter bilder og strukturert JSON. Forhåndsvisningen begrenses til 1024 piksler på lengste side. AI-kallet har 20 sekunders tidsgrense og maksimalt 1024 output-tokens. Hvis det feiler eller svaret er ugyldig, beholdes nedlastingen med egen tittel eller «Generert bilde», og resultatkortet viser en melding om feilen. Det påvirker ikke oppløsningen til nedlastingen.

Støtte for å indeksere metadata i Windows-søk, Spotlight og bildeprogrammer varierer med format og program. Filnavnet gir i tillegg et vanlig søkbart navn. Eksisterende bilder blir ikke endret. PNG og WebP skrives tapsfritt. For JPEG erstattes bare EXIF/XMP i filhodet, slik at de opprinnelige komprimerte bildedataene beholdes.
