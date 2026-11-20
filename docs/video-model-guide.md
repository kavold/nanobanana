# Videomodeller i Image Studio

Kontrollert 19. november 2026 mot fal sin [videokatalog](https://fal.ai/video),
[tekst-til-video-katalog](https://fal.ai/explore/text-to-video-apis),
[bilde-til-video-katalog](https://fal.ai/explore/image-to-video-apis),
modellspesifikke prissider og offentlige OpenAPI-skjemaer.

## Hva undersøkelsen kan si

Dette er en kartlegging av funksjoner, inn- og utdata, pris og praktisk oppgavevalg.
Anbefalingene er vurderinger av egnethet ut fra disse opplysningene. Vi har **ikke**
gjennomført betalte genereringer eller en uavhengig sammenligning av kvalitet, ventetid,
identitetsbevaring, norsk tale eller leppesynk. Leverandørenes kvalitets- og
hastighetspåstander er ikke testresultater fra denne appen.

fal har mange versjoner, hastighetsvarianter og endepunkter i hver familie. Appen
har et kontrollert utvalg på **23 fal-valg, knyttet til 38 konkrete API-endepunkter**,
pluss de tre eksisterende direktevalgene fra Grok og Google. Den importerer ikke
hele katalogen automatisk. Nye modellnavn blir ikke kjørbare før payload, pris og
begrensninger er kontrollert. Flere varianter med samme bruksområde gir ikke
nødvendigvis flere nyttige oppgaver.

## Velg oppgaven før modellen

| Det du vil gjøre | Oppgave | Inndata | Et begrunnet utgangspunkt |
| --- | --- | --- | --- |
| Lage en helt ny scene | Lag fra tekst | Beskrivelse | MiniMax H3 Max Turbo for rimelige forsøk; Kling 3 Standard for figur/scenearbeid |
| Få superheltbildet ditt til å bevege seg | Animer et bilde | Bilde + bevegelsesbeskrivelse | Kling 3 Standard eller MiniMax Turbo; prøv flere familier med samme bilde |
| La superhelten følge opptaket ditt | Overfør bevegelser | Figurens bilde + fremføringsvideo | Kling V3 Motion Control Standard; Pro er et dyrere sammenligningsvalg |
| Få en figur til å si nøyaktig det du har spilt inn | La et bilde snakke | Figurens bilde + ferdig lydfil | Kling Avatar Standard for lav pris; OmniHuman for et menneskeportrett |
| Endre miljø, motiv eller stil i en video | Endre en video | Video + instruksjon | Kling O3 Edit Standard |
| Få munnen i et eksisterende klipp til å følge ny tale | Tilpass munnen til lyd | Video + ferdig lydfil | Sync Lipsync v2 Pro |
| Øke oppløsningen til et ferdig klipp | Gjør videoen skarpere | Video | Topaz Proteus, fast 2× i denne appen |

Bevegelsesoverføring, ansiktsbytte, bildeanimering og leppesynk er forskjellige
oppgaver. En modell med lydgenerering er ikke automatisk et verktøy for å beholde
et norsk manus ordrett. Ved ferdig norsk tale er opplastet lyd en mer kontrollert
inngang, men også denne flyten må vurderes ved faktisk avspilling.

## Integrerte familier og priser

USD, før avgifter. Eksemplene er utregnede outputpriser for én generering, uten
appens sikkerhetsreservasjon. Inputtillegg, faktisk outputlengde og endret prising
kan gi en annen leverandørkostnad. Tabellen viser **innstillingene appen tilbyr**,
som enkelte steder er et mindre utvalg enn modellens totale funksjoner.

| Modellvalg | Best egnet til ut fra funksjonene | Varighet og output i appen | Prisgrunnlag / eksempel | Viktigste begrensning |
| --- | --- | --- | --- | --- |
| [MiniMax H3 Max Turbo](https://fal.ai/models/minimax/h3-max-turbo/text-to-video) | Mange rimelige forsøk med tekst eller startbilde | Hele sekunder 1–15; 480p/768p/1080p | $0,025/$0,04/$0,08 per sekund; 5 s ved 768p ca. $0,20 | Kan gi opptil ca. 0,7 s ekstra; dette tas med i anslaget. 1080p raffineres fra 768p. |
| [MiniMax H3 Max](https://fal.ai/models/minimax/h3-max/text-to-video) | Alternativ til Turbo med samme grunnflyt | 1–15 s; 480p/768p/1080p | $0,05/$0,08/$0,16 per sekund | Ordinære priser fra 16. november brukes; eldre kampanjepriser ignoreres. |
| [Kling 3 Standard](https://fal.ai/models/fal-ai/kling-video/v3/standard/text-to-video) / [Pro](https://fal.ai/models/fal-ai/kling-video/v3/pro/text-to-video) | Animering av figur og generelle scener | 3–15 s; modellstyrt output; format fra startbildet ved animering | Standard $0,084/s uten og $0,126/s med lyd; Pro $0,112/$0,168 | Generert tale er dokumentert for engelsk/kinesisk; andre språk kan oversettes til engelsk. Ingen voice binding eller multi-shot-kontroll i appen. |
| [Kling 4](https://fal.ai/models/kling/v4/text-to-video) | Lengre klipp og eksplisitte oppløsningsvalg | 3–30 s; 720p/1080p/4K, SDR | $0,157/$0,235/$0,549 per sekund | HDR, flere nøkkelbilder og separate shot-prompter er ikke eksponert. |
| [PixVerse V6](https://fal.ai/models/fal-ai/pixverse/v6/text-to-video) | Rimelige korte klipp og flere formater | 1–15 s; 360p/540p/720p/1080p | Ved 720p $0,045/s uten og $0,06/s med lyd; 5 s med lyd $0,30 | Ikke erstatning for opptaksstyrt motion control. Kvaliteten på eget motiv må vurderes. |
| [Gemini Omni Flash 1.2 via fal](https://fal.ai/models/google/gemini-omni-flash/v1.2/text-to-video) | Tekst/bilde og lyd i én generering | 3–15 s; 360p/720p/1080p/4K | $0,0273/$0,0819/$0,1229/$0,2457 per sekund + inputtokens | 1080p/4K er oppskalert. fal-saldo og pris er forskjellig fra direkte Google. |
| [Grok Imagine Video 1.5 via fal](https://fal.ai/models/xai/grok-imagine-video/v1.5/text-to-video) | Grok med fal-saldo, også svært korte klipp | 1–15 s; 480p/720p/1080p | $0,08/$0,14/$0,25 per sekund; bildeinput kan koste ekstra | fal-skjemaet har ikke av/på-felt for generert lyd; direkte xAI-valg beholdes separat. |
| [Wan 3.0](https://fal.ai/models/alibaba/wan-3.0/text-to-video) / [Prime](https://fal.ai/models/alibaba/wan-3.0-prime/text-to-video) | Fleksibel lengde og valgfri lyd | 2–30 s; 480p/720p/1080p | Vanlig $0,05/$0,10/$0,20; Prime $0,068/$0,14/$0,28 per sekund | Automatisk varighet er deaktivert for forutsigbart anslag. Prime har høyere pris; hastighetsforskjellen er ikke målt. |
| [FLUX 3 Max](https://fal.ai/models/blackforestlabs/flux-3-max/text-to-video) | En alternativ familie for scener og bildeanimering | 5–20 s; 720p eller oppskalert 1080p | Ordinært $0,17/$0,29 per sekund | fal oppgir en tidsbegrenset rabatt til 22. november. Appen bruker ordinærpris og blir dermed ikke avhengig av at rabatten fortsetter. 2K/4K er utelatt i første integrasjon. |
| [LTX 2.3 Pro](https://fal.ai/models/fal-ai/ltx-2.3/text-to-video) | 1080p–2160p og eksplisitte faste klipplengder | **6, 8 eller 10 s**; 1080p/1440p/2160p; 25 fps | Appen bruker $0,08/$0,16/$0,32 per sekund | Siden oppgir også lavere priser og lengre klipp i redaksjonell tekst. Skjemaets varigheter og høyeste prisopplysning brukes. |
| [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast) | Korte scener med valgfri lyd | 720p: 4/6/8 s; 1080p/4K: bare 8 s i appen | 720p/1080p $0,10/s uten og $0,15/s med lyd; 4K $0,30/$0,35 | Et bilde som ikke passer valgt 16:9/9:16 stoppes før generering for å unngå leverandørens beskjæring. Minst 720 px kortside. |
| [Seedance 2.5 US](https://fal.ai/models/bytedance/seedance-2.5/us/text-to-video) | Lengre klipp og en alternativ familie for sammensatte instrukser | 4–30 s; 480p/720p/1080p/4K | Omtrent $0,2205/$0,473/$1,164/$1,84 per sekund | Faktureres etter videotokens, ikke en garantert flat sekundpris. Standard er 4 s/480p. Multi-reference, videoinput og lydreferanser er ikke med. |
| [Happy Horse 1.1](https://fal.ai/models/alibaba/happy-horse/v1.1/text-to-video) | Scener med generert lyd og flere formater | 3–15 s; 720p/1080p | $0,14/$0,18 per sekund | Leverandøren beskriver flerspråklig tale; norsk er ikke testet. Startbildet bestemmer format ved animering. |
| [Kling V3 Motion Control Standard](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control) / [Pro](https://fal.ai/models/fal-ai/kling-video/v3/pro/motion-control) | Styre figur fra video av fremføring | 3–30 s fra videoen; video-orientering | $0,126 / $0,168 per sekund | Minst 340 px på begge sider av bilde og video. 200 MB opplasting; automatisk MP4-komprimering. Bildets sideforhold 0,4–2,5. |
| [Kling AI Avatar v2 Standard](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard) | Rimelig portrett/figur med ferdig tale | 3–30 s i appen, fra lydfil; modellstyrt output | $0,0562 per sekund; 5 s ca. $0,28 | Ikke en videostyrt fremføring. Norsk leppesynk må vurderes i resultatet. |
| [OmniHuman 1.5](https://fal.ai/models/fal-ai/bytedance/omnihuman/v1.5) | Menneskeportrett og lydstyrt fremføring | 3–30 s i appen; 720p/1080p | $0,16 per sekund | Appen begrenser også 720p til 30 s, selv om fal dokumenterer lengre lyd der. |
| [MiniMax H3 Max Lip Sync](https://fal.ai/models/minimax/h3-max/lip-sync/image-to-video) | Portrett med ferdig tale | 5–30 s i appen; 480p/768p/1080p | $0,05/$0,08/$0,16 per sekund; ×1,2 over 15 s | Lenger lyd enn 30 s er bevisst utelatt. Ikke samme oppgave som leppesynk på eksisterende video. |
| [Kling O3 Edit Standard](https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit) | Endre eksisterende video med tekst | 3–15 s; MP4/MOV; 720–3840 px begge sider; 23–60 fps | $0,126 per sekund | Ekstra bilde- og elementreferanser er ikke eksponert; bare tekst + video. |
| [Sync Lipsync v2 Pro](https://fal.ai/models/fal-ai/sync-lipsync/v2/pro) | Eksisterende personvideo med ny tale | 3–30 s i appen | $5/min, anslått forholdsmessig per sekund | Bruk like lange filer (±0,25 s), eller velg å trimme videoen til lydsporets lengde pluss 0,5 s stillhet. |
| [Topaz Video](https://fal.ai/models/fal-ai/topaz/upscale/video) | Forbedre oppløsning på ferdig klipp | 1–30 s; Proteus; 2×; maks 30 fps og 1920 px inputlangside | Appen reserverer høyeste oppløsningspris, $0,08/s | Ingen 60-fps-interpolering eller dyrere generative Starlight-varianter aktiveres. |

## Andre familier og spesialfunksjoner i kartleggingen

Disse er undersøkt som mulige utvidelser, men **vises ikke som kjørbare modeller**
i appen. Listen skiller bevisst modelltilgang fra implementert brukerflyt.

| Familie / funksjon | Hvor den passer | Status i denne endringen |
| --- | --- | --- |
| [Seedance reference-to-video](https://fal.ai/models/bytedance/seedance-2.5/us/reference-to-video) | Flere bilde-, video- og lydreferanser for identitet og sammenheng | Kartlagt, ikke implementert. Krever en egen flyt med flere referanser og en prisberegning som inkluderer videoinput. |
| [FLUX nøkkelbilder](https://fal.ai/models/blackforestlabs/flux-3/keyframes-to-video) | Bestemme flere visuelle ankerpunkter gjennom et klipp | Kartlagt, ikke implementert. Start/sluttbilde og tidslinje bør få en egen oppgave. |
| [Gemini referansevideo](https://fal.ai/models/google/gemini-omni-flash/v1.2/reference-to-video) | Samle visuelle referanser i en generering | Kartlagt, ikke implementert; vanlig tekst og startbilde er integrert. |
| [Luma](https://fal.ai/explore/luma-ai) | Bildestyrt video, endring av video og reframing | Sett i fal-katalogen; ikke integrert eller prisverifisert i denne runden. Relevant kandidat for «endre format» senere. |
| [Vidu](https://fal.ai/models/fal-ai/vidu/q3/text-to-video/api) | Alternativ tekst-/referansestyrt videogenerering | Undersøkt, ikke tatt inn som standard uten samme kontroll av pris og aktiv versjon som modellene over. |
| [Pika](https://blog.fal.ai/pika-models-now-available-on-fal/) | Bildeanimering og spesialiserte kreative endringer | Historisk dokumentert av fal. Det undersøkte v2.2-API-et returnerte 404; ikke integrert eller presentert som aktivt. |
| Hunyuan Video | Generering med egne kontroller og eventuelle modelltilpasninger | Eldre fal-API-dokumentasjon dukket opp i søk, men URL-en returnerte 404. Aktiv tilgang er ikke bekreftet; ikke integrert. |
| [Happy Oyster](https://fal.ai/happy-oyster) | Interaktiv verden og sammenhengende lyd-/videostrøm | Ikke en vanlig engangsjobb av samme type som MP4-generatoren. Ny strømme-/sesjonsarkitektur er utenfor denne endringen. |
| [Wan 2.2](https://fal.ai/models/fal-ai/wan/v2.2-a14b/text-to-video/api) | Eldre Wan-generering | Ekskludert fra nye valg: fal annonserer fjerning 4. januar 2027. Wan 3.0 brukes i stedet. |

Ingen ny konto, abonnement, ekstern lagring eller betalt test er opprettet. fal er
én serveradapter, ikke et krav i oppgaveflyten. De direkte Grok/Google-adapterne
beholdes som egne valg med tydelig separat saldo. Kling direkte kan senere legges
til med sin egen autentisering og priskatalog uten å erstatte oppgavegrensesnittet.

## Kredittvilkår og bruk

fal sitt API bruker forhåndsbetalte credits, ifølge [prisbeskrivelsen](https://fal.ai/docs/documentation/model-apis/pricing).
[De generelle vilkårene](https://fal.ai/legal/terms-of-service) oppgir 365 dagers
utløp for kjøpte credits, 90 dager for gratis-/kampanjecredits. Dette er ikke en
bekreftelse på kontospesifikke vilkår eller saldo. Appen endrer ikke automatisk påfyll.

Velg korte klipp først. Vurder om motivet holder seg gjenkjennelig, om bevegelsene
passer, om tale er norsk og ordrett, om munnen følger lyden og om forbedret
oppløsning faktisk gir bedre detaljer. Sammenlign samme prompt og referanser i få
modeller før du bruker lengre klipp og høyere oppløsning.

Appens standard er fortsatt $3 i reservasjon per jobb og $10 per UTC-dag. En
reservasjon er prisanslag ×1,25 + $0,05, og er ikke en garantert fakturagrense hos
leverandøren. Lokal historikk og reservasjoner kan forsvinne ved Railway-redeploy
uten varig volume. Denne endringen oppretter ikke noe volume eller ny infrastruktur.

## Teknisk verifikasjon

- Hvert av de 38 fal-endepunktene er kontrollert mot offentlig OpenAPI-skjema.
- En datert, redusert kontraktssnapshot ligger i `test/fixtures/fal-video-contracts.json`.
- Tester kontrollerer nødvendige felter, typer, enumvalg, varigheter og køstier.
- Alle video-input kan lastes opp til 200 MB. Lokal FFmpeg tilpasser ved behov
  til H.264/AAC MP4 under 40 MB. Motion bruker normalt 720p / 30 fps; redigering
  og leppesynk beholder opptil 1080p og modellens FPS-grense. Oppskalering beholder
  inputdimensjonene og avviser input over 1920 px langside før konvertering. Varighet beholdes
  innen 0,25 s; større avvik eller mislykket konvertering stopper før leverandørkall.
  Originalfilen endres ikke. To encodertråder og 90 s timeout begrenser ressursbruk.
- Lyd og video analyseres på serveren med ffprobe før pris og innsending. Klienten
  får ikke bestemme kostnad ved å oppgi en falsk varighet.
- Bilder roteres og skaleres uten strekk, beskjæring eller oppskalering. Modellers
  minimumsdimensjoner og formatkrav sjekkes før leverandørkall.
- DOM-tester dekker oppgave-/modellvalg, lydopplasting, prisflyt og retur fra Bilder
  til riktig videooppgave. Disse erstatter ikke en visuell nettlesertest.
- HTTP 422 oversettes til trygge felt- og kategoriopplysninger. Rå leverandørtekst
  og reflekterte filer/URL-er sendes ikke tilbake til nettleseren. En generell
  422-feil alene beviser ikke hvilken fil eller egenskap som ble avvist.
- Alle tester bruker simulerte leverandører. Ingen nøkkelverdi ligger i nettleseren,
  dokumentasjonen eller kontraktssnapshoten. Innlogging og serverens beløpskontroll
  beskytter de samme API-rutene som før.
