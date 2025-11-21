# 🍌 Knarilds Nano Banan - Gemini 2.5 Flash AI-bildegenerator

En Node.js Express-applikasjon som bruker Googles Gemini 2.5 Flash Image (nano-banana) modell for AI-bildegenerering og redigering.

## Funksjoner

- **Tekst-til-bilde generering**: Lag bilder fra tekstbeskrivelser
- **Flerbilde-sammenslåing**: Bland inntil 2 inngangsbilder sammen
- **Bilderedigering**: Modifiser eksisterende bilder med naturlige språk-instruksjoner
- **Karakterkonsistens**: Behold karakterutseende på tvers av ulike instruksjoner
- **Sanntids forhåndsvisning**: Se opplastede bilder før behandling
- **Last ned genererte bilder**: Lagre resultater direkte til enheten din

## Bruksområder

Basert på Gemini 2.5 Flash Image kapabiliteter:

- **Bakgrunnsfjerning**: Fjern eller endre bildebakgrunner
- **Scene-endringer**: Plasser motiver i forskjellige miljøer  
- **Lysjusteringer**: Modifiser belysning og atmosfære
- **Flerbilde-sammenslåing**: Bland flere bilder sømløst sammen
- **Logo-design**: Lag profesjonelle logoer og grafiske elementer
- **Fantasi-kunst**: Generer kreativt og kunstnerisk innhold

## Oppsett

1. **Installer avhengigheter**:
   ```bash
   npm install
   ```

2. **Sett opp miljøvariabler**:
   ```bash
   cp .env.example .env
   ```
   Rediger `.env` og legg til din Google API-nøkkel:
   ```
   GOOGLE_API_KEY=din_google_api_nokkel_her
   PORT=3002
   ```

3. **Få Google API-nøkkel**:
   - Besøk [Google AI Studio](https://aistudio.google.com/)
   - Opprett en ny API-nøkkel for Gemini-modeller
   - Sørg for at du har tilgang til `gemini-2.5-flash-image-preview`

## Kjøre applikasjonen

**Utviklingsmodus** (med automatisk omstart):
```bash
npm run dev
```

**Produksjonsmodus**:
```bash
npm start
```

Applikasjonen vil være tilgjengelig på `http://localhost:3002`

### Passord i produksjon

Når `NODE_ENV=production` settes er appen beskyttet med enkel Basic Auth for å hindre tilfeldig bruk:
- Brukernavn: `nanobanana`
- Passord: `påskefest`

## API-bruk

### Generer bilde endpoint

**POST** `/generate`

**Content-Type**: `multipart/form-data`

**Parametere**:
- `prompt` (påkrevd): Tekstbeskrivelse av hva du vil generere eller redigere
- `images` (valgfritt): Opptil 2 bildefiler å bruke som inngang/referanse

**Respons**:
```json
{
  "text": "Generert tekstbeskrivelse (hvis noen)",
  "image": "/generated/filnavn.png"
}
```

## Eksempel instruksjoner

- `"Lag et bilde av katten min som spiser en nano-banan på en fin restaurant"`
- `"Fjern bakgrunnen fra dette bildet og gjør den gjennomsiktig"`
- `"Bland disse to bildene sammen sømløst"`
- `"Endre lyset i dette bildet til gyllen time"`
- `"Sett denne karakteren i et futuristisk bymiljø"`

## Modellinformasjon

- **Modell**: `gemini-2.5-flash-image-preview`
- **Prising**: $30.00 per 1 million output tokens (~$0.039 per bilde)
- **Funksjoner**: Bildegenerering, redigering, flerbilde-sammenslåing, karakterkonsistens
- **Vannmerking**: Alle genererte bilder inkluderer SynthID vannmerking

## Filstruktur

```
nano-banana/
├── server.js              # Express server og API endepunkter
├── package.json           # Avhengigheter og skript
├── public/
│   ├── index.html         # Webgrensesnitt
│   └── generated/         # Genererte bilder lagring
├── uploads/               # Midlertidig opplastingslagring
├── .env.example          # Miljøvariabler mal
└── README.md             # Denne filen
```

## Feilhåndtering

Applikasjonen gir spesifikke feilmeldinger for vanlige problemer:
- Ugyldig eller manglende API-nøkkel
- API-kvote overskredet
- Innhold blokkert av sikkerhetsfiltre
- Nettverkstilkoblingsproblemer

## Sikkerhetsmerknad

- Opplastede filer slettes automatisk etter behandling
- Kun bildefiler aksepteres for opplasting
- Filstørrelsesgrense: 10MB per fil
- Maksimum 2 filer per forespørsel

## Hva gjør Nano Banan bedre?

- **Kontekstforståelse**: Forstår komplekse sammenhenger og kan kombinere elementer kreativt
- **Presise endringer**: Kan gjøre målrettede modifikasjoner uten å påvirke resten av bildet
- **Naturlig blanding**: Forstår perspektiv, lys og skygger for realistisk sammenslåing
- **Atmosfærekontroll**: Kan justere stemning og følelser mens den bevarer bildets essens
- **Karakterkonsistens**: Opprettholder samme utseende på figurer på tvers av ulike scenarier
- **Verdenskunnskap**: Kombinerer faktakunnskap med kreativitet for realistiske resultater
- **Designprinsipper**: Forstår komposisjon, typografi og visuelle hierarkier
