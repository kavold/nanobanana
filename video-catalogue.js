// Controlled subset of fal's public catalogue and schemas, checked 2026-11-19.
// Recommendations describe workflow fit, not an independently tested quality ranking.
const range = (min, max) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
const VIDEO_TASKS = {
  text: { label: 'Lag fra tekst', description: 'Beskriv scenen, bevegelsen og lyden.', inputs: [], promptRequired: true },
  image: { label: 'Animer et bilde', description: 'Gi et bilde bevegelse og kameraføring.', inputs: ['image'], promptRequired: true },
  motion: { label: 'Overfør bevegelser', description: 'Bilde av figuren + video med fremføringen.', inputs: ['image', 'video'], measured: 'video' },
  talk: { label: 'La et bilde snakke', description: 'Portrett eller figur + ferdig tale som lydfil.', inputs: ['image', 'audio'], measured: 'audio' },
  edit: { label: 'Endre en video', description: 'Beskriv hva som skal endres i et eksisterende klipp.', inputs: ['video'], measured: 'video', promptRequired: true },
  lipsync: { label: 'Tilpass munnen til lyd', description: 'Video av en person + ferdig tale som lydfil.', inputs: ['video', 'audio'], measured: 'audio' },
  upscale: { label: 'Gjør videoen skarpere', description: 'Oppskaler et eksisterende klipp til dobbelt størrelse.', inputs: ['video'], measured: 'video' }
};
const wide = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const fal = (id, label, family, endpoints, settings) => ({ id, label, family, provider: 'fal', key: 'FAL_KEY',
  tasks: Object.keys(endpoints), endpoints, audio: 'optional', ratios: wide, minDuration: 3, maxDuration: 15,
  defaultDuration: 5, defaultResolution: '720p', promptMax: 4000, inputAllowance: 0,
  source: `https://fal.ai/models/${Object.values(endpoints)[0]}/api`, priceDate: '2026-11-19', ...settings });
const pair = root => ({ text: `${root}/text-to-video`, image: `${root}/image-to-video` });
const klingNote = 'Kling dokumenterer engelsk og kinesisk generert tale. Andre språk kan oversettes til engelsk. Bruk ferdig norsk lyd i «La et bilde snakke» når ordene skal bevares.';
const FAL_MODELS = [
  fal('fal-h3-turbo', 'MiniMax H3 Max Turbo', 'MiniMax', pair('minimax/h3-max-turbo'), {
    minDuration: 1, maxDuration: 15, defaultResolution: '768p', rates: { '480p': .025, '768p': .04, '1080p': .08 }, audio: 'included',
    billingExtraSeconds: .7, resolutionMap: { '480p': '480P', '768p': '768P', '1080p': '1080P' }, followImage: true,
    upscaled: ['1080p'], bestFor: 'Rimelige utkast og flere forsøk på motiv og bevegelse.',
    caveat: 'Turbo prioriterer effektivitet. 1080p raffineres fra 768p; resultatet kan bli opptil ca. 0,7 s lengre. Ordinærpris brukes i anslaget.',
    recommendation: 'Rimelig start', goals: ['budget'], defaults: { prompt_expansion_mode: 'balanced', sync_mode: false } }),
  fal('fal-h3', 'MiniMax H3 Max', 'MiniMax', pair('minimax/h3-max'), {
    minDuration: 1, maxDuration: 15, defaultResolution: '768p', rates: { '480p': .05, '768p': .08, '1080p': .16 }, audio: 'included',
    billingExtraSeconds: .7, resolutionMap: { '480p': '480P', '768p': '768P', '1080p': '1080P' }, followImage: true,
    upscaled: ['1080p'], bestFor: 'Alternativ til Turbo for samme bilde- og tekstoppgaver.',
    caveat: 'Dyrere enn Turbo; kvalitetsforskjellen bør sammenlignes med dine motiver. Opptil ca. 0,7 s ekstra output.',
    goals: ['general'], defaults: { prompt_expansion_mode: 'balanced', sync_mode: false } }),
  fal('fal-kling-v3', 'Kling 3 Standard', 'Kling', pair('fal-ai/kling-video/v3/standard'), {
    rates: { auto: .084 }, audioRates: { auto: .126 }, defaultResolution: 'auto', ratios: ['16:9', '9:16', '1:1'],
    durationString: true, imageField: 'start_image_url', followImage: true, promptMax: 2500,
    imageLimits: { minEdge: 300, minRatio: .4, maxRatio: 2.5 },
    bestFor: 'Animer en figur eller lag et nytt klipp med valgfri generert lyd.', caveat: klingNote,
    recommendation: 'God start for figurer', goals: ['character', 'general'] }),
  fal('fal-kling-v3-pro', 'Kling 3 Pro', 'Kling', pair('fal-ai/kling-video/v3/pro'), {
    rates: { auto: .112 }, audioRates: { auto: .168 }, defaultResolution: 'auto', ratios: ['16:9', '9:16', '1:1'],
    durationString: true, imageField: 'start_image_url', followImage: true, promptMax: 2500,
    imageLimits: { minEdge: 300, minRatio: .4, maxRatio: 2.5 }, bestFor: 'Alternativ Pro-variant for figur- og sceneklipp.',
    caveat: klingNote, goals: ['character'] }),
  fal('fal-kling-v4', 'Kling 4', 'Kling', pair('kling/v4'), {
    maxDuration: 30, rates: { '720p': .157, '1080p': .235, '4k': .549 }, audio: 'included',
    imageField: 'start_image_url', followImage: true, imageLimits: { minEdge: 300, minRatio: .4, maxRatio: 2.5 },
    ratios: [...wide, '21:9'], bestFor: 'Lengre enkeltklipp og valg av output opptil 4K.',
    caveat: 'Appen bruker SDR og én scene. HDR og flere nøkkelbilder er ikke slått på. Høy oppløsning når raskt beløpsgrensen.', goals: ['resolution', 'long'] }),
  fal('fal-pixverse', 'PixVerse V6', 'PixVerse', pair('fal-ai/pixverse/v6'), {
    minDuration: 1, rates: { '360p': .025, '540p': .035, '720p': .045, '1080p': .09 },
    audioRates: { '360p': .035, '540p': .045, '720p': .06, '1080p': .115 }, audioField: 'generate_audio_switch',
    followImage: true, ratios: [...wide, '2:3', '3:2', '21:9'],
    bestFor: 'Korte, rimelige klipp med valgfri lyd og mange bildeformater.',
    caveat: 'Ikke bevegelsesoverføring fra opptak. Begynn med et kort klipp for å vurdere stil og detaljer.', goals: ['budget', 'general'] }),
  fal('fal-omni', 'Gemini Omni Flash · fal', 'Google', pair('google/gemini-omni-flash/v1.2'), {
    rates: { '360p': .0273, '720p': .0819, '1080p': .1229, '4k': .2457 }, audio: 'included', ratios: ['16:9', '9:16'],
    upscaled: ['1080p', '4k'], inputAllowance: .02, bestFor: 'Nye klipp eller bildeanimering med lyd inkludert.',
    caveat: 'fal har egen pris og saldo. Inputtokens kommer i tillegg; anslaget inkluderer et lite tillegg. Norsk tale er ikke kvalitetstestet.', goals: ['general', 'sound'] }),
  fal('fal-grok', 'Grok Video 1.5 · fal', 'xAI', pair('xai/grok-imagine-video/v1.5'), {
    minDuration: 1, rates: { '480p': .08, '720p': .14, '1080p': .25 }, audio: 'included', followImage: true,
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], inputAllowance: .01,
    bestFor: 'Samme Grok-familie via fal-saldo, med klipp ned til ett sekund.',
    caveat: 'fal-endepunktet har ikke egen av/på-bryter for lyd. Direkte Grok er fortsatt et eget valg.', goals: ['general'] }),
  fal('fal-wan', 'Wan 3.0', 'Wan', pair('alibaba/wan-3.0'), {
    minDuration: 2, maxDuration: 30, rates: { '480p': .05, '720p': .1, '1080p': .2 }, audioField: 'audio',
    imageField: 'start_image_url', bestFor: 'Fleksible klipp på 2–30 sekunder med lyd som kan slås av.',
    caveat: 'Lang varighet øker pris og risiko for at detaljer endrer seg. Automatisk varighet er avslått for et forutsigbart anslag.', goals: ['long', 'general'] }),
  fal('fal-wan-prime', 'Wan 3.0 Prime', 'Wan', pair('alibaba/wan-3.0-prime'), {
    minDuration: 2, maxDuration: 30, rates: { '480p': .068, '720p': .14, '1080p': .28 }, audioField: 'audio', imageField: 'start_image_url',
    bestFor: 'Alternativ Wan-variant markedsført for raskere iterasjon.', caveat: 'Høyere sekundpris enn vanlig Wan. Faktisk ventetid og kvalitet er ikke målt i appen.', goals: ['long'] }),
  fal('fal-flux', 'FLUX 3 Max', 'FLUX', pair('blackforestlabs/flux-3-max'), {
    minDuration: 5, maxDuration: 20, rates: { '720p': .17, '1080p': .29 }, followImage: false,
    ratios: [...wide, '21:9', '2:1'], upscaled: ['1080p'], bestFor: 'Tekststyrte scener og bildeanimering der du vil prøve en annen modellfamilie.',
    caveat: '720p er grunnoppløsning; 1080p er oppskalert. Anslag bruker ordinærpris, uten tidsbegrensede rabatter.', goals: ['general'] }),
  fal('fal-ltx', 'LTX 2.3 Pro', 'LTX', pair('fal-ai/ltx-2.3'), {
    minDuration: 6, maxDuration: 10, durations: [6, 8, 10], defaultDuration: 6, defaultResolution: '1080p',
    rates: { '1080p': .08, '1440p': .16, '2160p': .32 }, ratios: ['16:9', '9:16'],
    bestFor: 'Klipp med eksplisitt oppløsning fra 1080p til 2160p, i 6, 8 eller 10 sekunder.',
    caveat: 'fal-siden har motstridende pris- og varighetstekst. Appen følger API-skjemaets 6/8/10 s og det høyeste oppgitte prisnivået.',
    goals: ['resolution'], defaults: { fps: 25 } }),
  fal('fal-veo-fast', 'Veo 3.1 Fast', 'Google Veo', { text: 'fal-ai/veo3.1/fast', image: 'fal-ai/veo3.1/fast/image-to-video' }, {
    minDuration: 4, maxDuration: 8, durations: [4, 6, 8], defaultDuration: 8, ratios: ['16:9', '9:16'],
    rates: { '720p': .1, '1080p': .1, '4k': .3 }, audioRates: { '720p': .15, '1080p': .15, '4k': .35 },
    durationsByResolution: { '1080p': [8], '4k': [8] }, imageLimits: { minEdge: 720 }, exactImageRatio: true,
    bestFor: 'Korte scener med lyd og et tydelig valg mellom 4, 6 og 8 sekunder.',
    caveat: 'Startbildet må passe 16:9 eller 9:16; appen stopper før betaling hvis det ville blitt beskåret. Høy oppløsning krever 8 s i appen.', goals: ['sound'] }),
  fal('fal-seedance', 'Seedance 2.5 US', 'Seedance', pair('bytedance/seedance-2.5/us'), {
    minDuration: 4, maxDuration: 30, defaultDuration: 4, rates: { '480p': .2205, '720p': .473, '1080p': 1.164, '4k': 1.84 },
    durationString: true, ratios: [...wide, '21:9'], bestFor: 'Lengre klipp og et alternativ for sammensatte sceneinstruksjoner.',
    caveat: 'Dyrt alternativ. Faktureres etter videotokens; sekundprisene er omtrentlige. 4 s ved 480p er et forsiktig første forsøk.',
    defaultResolution: '480p', approximatePrice: true, goals: ['long'], defaults: { output_format: 'mp4' } }),
  fal('fal-happyhorse', 'Happy Horse 1.1', 'Happy Horse', pair('alibaba/happy-horse/v1.1'), {
    rates: { '720p': .14, '1080p': .18 }, audio: 'included', followImage: true,
    imageLimits: { minEdge: 300, minRatio: .4, maxRatio: 2.5 }, ratios: [...wide, '21:9', '9:21', '5:4', '4:5'],
    bestFor: 'Klipp med generert lyd og flere stående eller brede formater.',
    caveat: 'Flerspråklig tale er en leverandøropplysning; norsk uttale og ordlyd er ikke kontrollert.', goals: ['sound'] }),
  fal('kling-v3-motion', 'Kling V3 Motion Control', 'Kling Motion', { motion: 'fal-ai/kling-video/v3/standard/motion-control' }, {
    maxDuration: 30, rates: { auto: .126 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'source',
    imageLimits: { minEdge: 340, minRatio: .4, maxRatio: 2.5 }, videoLimits: { minEdge: 340, maxEdge: 3850 },
    bestFor: 'La superhelten eller figuren følge kroppsbevegelsene i opptaket ditt.',
    caveat: 'Én tydelig person, uten tildekking, er et godt utgangspunkt. Dette kopierer fremføringen, ikke bare ansiktet.',
    recommendation: 'Start her for bevegelser', goals: ['character'] }),
  fal('fal-kling-motion-pro', 'Kling V3 Motion Control Pro', 'Kling Motion', { motion: 'fal-ai/kling-video/v3/pro/motion-control' }, {
    maxDuration: 30, rates: { auto: .168 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'source',
    imageLimits: { minEdge: 340, minRatio: .4, maxRatio: 2.5 }, videoLimits: { minEdge: 340, maxEdge: 3850 },
    bestFor: 'Alternativ Pro-variant for opptaksstyrt figur.', caveat: 'Dyrere enn Standard; sammenlign med samme referanser før du velger den fast.', goals: ['character'] }),
  fal('fal-kling-avatar', 'Kling AI Avatar v2 Standard', 'Kling Avatar', { talk: 'fal-ai/kling-video/ai-avatar/v2/standard' }, {
    minDuration: 3, maxDuration: 30, rates: { auto: .0562 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'input',
    bestFor: 'La et bilde av deg eller en figur fremføre en ferdig lydfil.',
    caveat: 'Bruk ferdig norsk tale for kontroll på ordlyd. Appen begrenser lyd til 3–30 s; leppesynken er ikke kvalitetstestet.',
    recommendation: 'Rimelig start for tale', goals: ['budget'] }),
  fal('fal-omnihuman', 'OmniHuman 1.5', 'OmniHuman', { talk: 'fal-ai/bytedance/omnihuman/v1.5' }, {
    minDuration: 3, maxDuration: 30, rates: { '720p': .16, '1080p': .16 }, audio: 'input', followImage: true,
    bestFor: 'Menneskeportrett som skal følge ferdig tale og uttrykk fra lyd.',
    caveat: '720p anbefales i fal-dokumentasjonen for raskere generering. Appen begrenser begge oppløsninger til 30 s.', goals: ['character'] }),
  fal('fal-h3-lipsync', 'MiniMax H3 Max Lip Sync', 'MiniMax Tale', { talk: 'minimax/h3-max/lip-sync/image-to-video' }, {
    minDuration: 5, maxDuration: 30, rates: { '480p': .05, '768p': .08, '1080p': .16 }, defaultResolution: '768p',
    resolutionMap: { '480p': '480P', '768p': '768P', '1080p': '1080P' }, audio: 'input', followImage: true,
    imageLimits: { minRatio: .4, maxRatio: 2.5 }, longMultiplier: { after: 15, factor: 1.2 },
    bestFor: 'Synkroniser et portrett med ferdig tale uten å lage talen på nytt.',
    caveat: 'Over 15 s koster 20 % ekstra. Appen begrenser til 30 s selv om leverandøren støtter lengre lyd.', goals: ['general'] }),
  fal('fal-kling-edit', 'Kling O3 Edit Standard', 'Kling Redigering', { edit: 'fal-ai/kling-video/o3/standard/video-to-video/edit' }, {
    maxDuration: 15, rates: { auto: .126 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'source',
    videoLimits: { minEdge: 720, maxEdge: 3840, minFps: 23, maxFps: 60, mp4Only: true },
    bestFor: 'Endre innhold, miljø eller stil i et eksisterende klipp med tekst.',
    caveat: 'Krever MP4/MOV, 3–15 s og minst 720 piksler på begge sider. Appen tilbyr tekstredigering, ikke ekstra referansebilder.',
    recommendation: 'Rediger med tekst', goals: ['general'] }),
  fal('fal-sync-pro', 'Sync Lipsync v2 Pro', 'Sync', { lipsync: 'fal-ai/sync-lipsync/v2/pro' }, {
    minDuration: 3, maxDuration: 30, rates: { auto: 5 / 60 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'input',
    bestFor: 'Tilpass munnbevegelsene i en eksisterende video til ny ferdig tale.',
    caveat: 'Bruk «Trim videoen etter lydsporet» hvis videoen er lengre. Endrer munnbevegelse; erstatter ikke hele personen.',
    recommendation: 'Video + ny tale', goals: ['general'], defaults: { sync_mode: 'cut_off' } }),
  fal('fal-topaz', 'Topaz Video · 2×', 'Topaz', { upscale: 'fal-ai/topaz/upscale/video' }, {
    minDuration: 1, maxDuration: 30, rates: { auto: .08 }, defaultResolution: 'auto', ratios: ['16:9'], audio: 'source',
    videoLimits: { maxFps: 30, maxEdge: 1920 },
    bestFor: 'Oppskaler et ferdig klipp til dobbelt bredde og høyde, uten å generere en ny scene.',
    caveat: 'Appen bruker Proteus, 2× og original bildefrekvens opptil 30 fps. Anslaget bruker høyeste oppløsningspris; detaljer kan endres.',
    recommendation: 'For ferdige klipp', goals: ['resolution'], defaults: { model: 'Proteus', upscale_factor: 2, H264_output: true } })
];
function modelDurations(model, resolution) {
  return model.durationsByResolution?.[resolution] || model.durations || range(model.minDuration, model.maxDuration);
}
function estimateVideo(model, { duration, resolution, audio, imagePath, aspectRatio = '16:9' }) {
  const rates = audio && model.audioRates ? model.audioRates : model.rates;
  const extra = model.billingExtraSeconds || 0;
  const multiplier = model.longMultiplier && duration > model.longMultiplier.after ? model.longMultiplier.factor : 1;
  // Seedance bills pixels/tokens. Widescreen ratios above 16:9 use more pixels
  // at a fixed short-edge resolution than the published per-second example.
  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = Math.max(w / h, h / w);
  const tokenFactor = model.approximatePrice && Number.isFinite(ratio) ? Math.max(1, ratio / (16 / 9)) : 1;
  return Number(((duration + extra) * rates[resolution] * multiplier * tokenFactor + (model.inputAllowance || (imagePath ? .02 : 0))).toFixed(4));
}
module.exports = { FAL_MODELS, VIDEO_TASKS, modelDurations, estimateVideo };
