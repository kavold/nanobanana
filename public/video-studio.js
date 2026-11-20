(() => {
  const $ = id => document.getElementById(id);
  const nok = new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK' });
  let exchangeRate;
  function money(value) {
    const usd = Number(value);
    const dollars = `$${usd.toFixed(2)}`;
    return exchangeRate ? `ca. ${nok.format(usd * exchangeRate.nokPerUsd)} (${dollars})` : dollars;
  }
  const states = { queued: 'I kø', submitting: 'Sender til leverandøren', running: 'Genereres', downloading: 'Lagrer video', completed: 'Ferdig', attention: 'Må kontrolleres' };
  let config; let imageFile; let requestId = crypto.randomUUID(); let sending = false; let previewUrl;
  let activeJob = null;
  let imageReturnTask = null;
  let quoteBlocked = true;
  let quoteRevision = 0;
  function showVideo(show) {
    $('imagesPanel').hidden = show; $('videoPanel').hidden = !show;
    $('imagesTab').setAttribute('aria-pressed', String(!show));
    $('videoTab').setAttribute('aria-pressed', String(show));
    if (show) refresh();
  }
  $('imagesTab').addEventListener('click', () => showVideo(false));
  $('videoTab').addEventListener('click', () => {
    imageReturnTask = null; $('videoImageBridge').hidden = true; showVideo(true);
  });
  $('videoCreateImage').addEventListener('click', () => {
    imageReturnTask = task();
    $('videoImageBridge').hidden = false;
    showVideo(false);
    $('videoImageBridge').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('prompt').focus({ preventScroll: true });
  });
  $('videoImageBridgeCancel').addEventListener('click', () => {
    imageReturnTask = null; $('videoImageBridge').hidden = true; showVideo(true);
    $('videoCreateImage').focus();
  });
  function task() { return document.querySelector('input[name="videoTask"]:checked').value; }
  function model() { return config?.models.find(m => m.id === $('videoModel').value); }
  function invalidate() { $('videoQuote').hidden = true; quoteBlocked = true; quoteRevision++; requestId = crypto.randomUUID(); }
  const taskInfo = () => config.tasks[task()];
  const followsImage = m => task() === 'image' && (m.provider === 'xai' || m.followImage);
  const allowedDurations = m => m.durationsByResolution?.[$('videoResolution').value] || m.durations || Array.from({ length: m.maxDuration - m.minDuration + 1 }, (_, i) => i + m.minDuration);
  const connection = m => m.provider === 'fal' ? 'fal-saldo' : m.provider === 'xai' ? 'direkte xAI-saldo' : 'direkte Google-saldo';
  function samplePrice(m) {
    const resolution = m.defaultResolution || '720p';
    const rates = m.audioRates || m.rates;
    const seconds = taskInfo().measured ? Math.max(5, m.minDuration) : m.defaultDuration || 5;
    const price = ((seconds + (m.billingExtraSeconds || 0)) * rates[resolution] + (m.inputAllowance || 0));
    return `${money(price)} / ${seconds} s · ${resolution === 'auto' ? 'modellstyrt oppløsning' : resolution}${m.approximatePrice ? ' · ca.' : ''}`;
  }
  function rankedModels() {
    const priority = $('videoPriority').value;
    const score = m => (m.provider === 'fal' ? 100 : 0) + (m.connected ? 1000 : 0) + (m.goals?.includes(priority) ? 50 : 0) + (m.recommendation ? 5 : 0);
    return config.models.filter(m => m.tasks.includes(task())).sort((a, b) => score(b) - score(a));
  }
  function renderChoices(models) {
    $('videoRecommendations').replaceChildren(); $('videoComparison').replaceChildren();
    for (const [index, m] of models.entries()) {
      function choose() { $('videoModel').value = m.id; updateModel(); }
      if (index < 3) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'video-model-card';
        button.dataset.modelChoice = m.id; button.setAttribute('aria-pressed', String(m.id === $('videoModel').value));
        const title = document.createElement('strong'); title.textContent = m.label;
        const description = document.createElement('span'); description.textContent = m.bestFor || 'Bruk leverandørens eksisterende direktekobling.';
        const price = document.createElement('small'); price.textContent = `${samplePrice(m)} · ${connection(m)}${m.connected ? '' : ' · Krever nøkkel'}`;
        button.append(title, description, price); button.addEventListener('click', choose); $('videoRecommendations').append(button);
      }
      const row = document.createElement('article'); row.className = 'video-comparison-row';
      const title = document.createElement('strong'); title.textContent = `${m.label} · ${samplePrice(m)}`;
      const use = document.createElement('p'); use.textContent = m.bestFor || 'Eksisterende direktekobling med separat saldo.';
      const limitation = document.createElement('p'); limitation.className = 'video-muted'; limitation.textContent = m.caveat || 'Tilgang og kvalitet må bekreftes med egne genereringer.';
      const select = document.createElement('button'); select.type = 'button'; select.textContent = `Velg ${m.label}`; select.addEventListener('click', choose);
      row.append(title, use, limitation, select); $('videoComparison').append(row);
    }
  }
  function updateDuration() {
    const m = model(); if (!m) return;
    const values = allowedDurations(m), previous = Number($('videoDuration').value);
    $('videoDuration').replaceChildren(...values.map(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = `${value} sekunder`; return option;
    }));
    $('videoDuration').value = values.includes(previous) ? previous : values.includes(m.defaultDuration || 5) ? m.defaultDuration || 5 : values[0];
    invalidate();
  }
  function updateModel() {
    const m = model(); if (!m) return;
    function choices(id, values, fallback, label = value => value) {
      const previous = $(id).value;
      $(id).replaceChildren(...values.map(value => {
        const option = document.createElement('option'); option.value = String(value); option.textContent = label(value); return option;
      }));
      $(id).value = values.some(value => String(value) === previous) ? previous : String(values.includes(fallback) ? fallback : values[0]);
    }
    choices('videoRatio', m.ratios, '16:9', value => value === '16:9' ? 'Liggende · 16:9' : value === '9:16' ? 'Stående · 9:16' : value === '1:1' ? 'Kvadrat · 1:1' : value);
    choices('videoResolution', Object.keys(m.rates), m.defaultResolution || '720p', value => {
      if (value === 'auto') return 'Bestemmes av modellen';
      return `${value}${m.upscaled?.includes(value) || (m.provider === 'google' && ['1080p', '4k'].includes(value)) || (m.id.endsWith('-lite') && value === '1080p') ? ' · oppskalert' : ''}`;
    });
    updateDuration();
    const measured = Boolean(taskInfo().measured);
    $('videoDurationGroup').hidden = measured;
    $('videoRatioGroup').hidden = measured || followsImage(m);
    $('videoResolutionGroup').hidden = Object.keys(m.rates).length === 1;
    $('videoRatio').disabled = measured || followsImage(m);
    $('videoAudio').disabled = ['included', 'input'].includes(m.audio) || task() === 'upscale';
    if ($('videoAudio').disabled) $('videoAudio').checked = true;
    $('videoAudioLabel').textContent = m.audio === 'source' ? task() === 'upscale' ? 'Lyd håndteres av oppskaleringen' : 'Behold lyden fra originalvideoen' : m.audio === 'input' ? 'Bruk den opplastede talen' : m.audio === 'included' ? 'Lyd håndteres av modellen' : 'Generer lyd';
    $('videoModelHelp').textContent = `${connection(m)} · ${m.connected ? 'Nøkkel finnes. Modelltilgang og saldo er ikke verifisert.' : 'API-nøkkel mangler. Legg den inn på serveren før du genererer.'}`;
    $('videoModelGuide').replaceChildren();
    for (const text of [m.recommendation, m.bestFor, m.caveat].filter(Boolean)) {
      const p = document.createElement('p'); p.textContent = text; $('videoModelGuide').append(p);
    }
    if (m.source) { const a = document.createElement('a'); a.href = m.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Modellens dokumentasjon og pris'; $('videoModelGuide').append(a); }
    $('videoResolutionHelp').textContent = measured ? `Varigheten måles fra ${taskInfo().measured === 'audio' ? 'lydfilen' : 'videoen'}: ${m.minDuration}–${m.maxDuration} s i appen. ${task() === 'talk' ? 'Bildets format brukes.' : 'Formatet følger videofilen.'}` : followsImage(m) ? 'Formatet følger startbildet automatisk. Bildet strekkes eller beskjæres ikke av appen.' : `Velg blant modellens kontrollerte varigheter og formater. Høyere oppløsning kan koste mer.`;
    $('videoReferenceHelp').textContent = `${m.minDuration}–${m.maxDuration} s, maks 200 MB. Store videoer klargjøres automatisk til komprimert MP4. ${task() === 'motion' ? 'Normalt opptil 720p / 30 fps.' : task() === 'upscale' ? 'Inputoppløsningen beholdes innenfor modellens grense, før oppskalering.' : 'Opptil 1080p, tilpasset modellens minstekrav.'} Dette kan ta litt tid før prisanslaget.${m.videoLimits?.minEdge ? ` Minst ${m.videoLimits.minEdge} piksler på begge sider.` : ''}${m.videoLimits?.maxFps ? ` Maks ${m.videoLimits.maxFps} fps.` : ''}`;
    $('videoPrompt').required = Boolean(taskInfo().promptRequired);
    $('videoPromptGroup').hidden = ['lipsync', 'upscale'].includes(task()) || m.id === 'fal-h3-lipsync';
    $('videoPrompt').maxLength = m.promptMax || 4000;
    $('videoPrompt').placeholder = task() === 'talk' ? 'Valgfritt: Beskriv uttrykk og fremføring. Ordene kommer fra lydfilen.' : task() === 'edit' ? 'Hva skal endres i videoen?' : 'Hva skal skje i klippet? Beskriv også lyd hvis du vil ha det.';
    document.querySelectorAll('[data-model-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.modelChoice === m.id)));
    $('videoQuoteButton').disabled = !m.available;
    invalidate();
  }
  function updateTask(resetModel = false) {
    if (!config) return;
    const previous = $('videoModel').value, models = rankedModels();
    $('videoModel').replaceChildren();
    for (const provider of ['fal', 'direct']) {
      const group = document.createElement('optgroup'); group.label = provider === 'fal' ? 'Bruk fal-saldo' : 'Eksisterende direktekoblinger · separat saldo';
      for (const m of models.filter(m => (m.provider === 'fal') === (provider === 'fal'))) {
        const option = document.createElement('option'); option.value = m.id; option.textContent = m.label + (!m.connected ? ' · Krever tilkobling' : ''); group.append(option);
      }
      if (group.children.length) $('videoModel').append(group);
    }
    $('videoModel').value = !resetModel && models.some(m => m.id === previous) ? previous : models[0].id;
    $('videoImageGroup').hidden = !taskInfo().inputs.includes('image');
    $('videoReferenceGroup').hidden = !taskInfo().inputs.includes('video');
    $('videoTrimSpeechGroup').hidden = task() !== 'lipsync';
    $('videoAudioGroup').hidden = !taskInfo().inputs.includes('audio');
    $('videoReferenceLabel').textContent = task() === 'motion' ? 'Video med fremføringen' : 'Videoen du vil bearbeide';
    $('videoSettings').hidden = false;
    renderChoices(models); updateModel();
  }
  function setImage(file) {
    imageFile = file;
    $('videoImageName').textContent = file?.name || '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    $('videoImagePreview').hidden = !file;
    if (file) { previewUrl = URL.createObjectURL(file); $('videoImagePreview').src = previewUrl; }
    invalidate();
  }
  $('videoImage').addEventListener('change', () => setImage($('videoImage').files[0]));
  $('videoTasks').addEventListener('change', () => updateTask());
  $('videoPriority').addEventListener('change', () => updateTask(true));
  $('videoResolution').addEventListener('change', updateDuration);
  $('videoModel').addEventListener('change', updateModel);
  $('videoForm').addEventListener('input', invalidate);
  function formData() {
    const data = new FormData();
    for (const [key, value] of Object.entries({ task: task(), model: $('videoModel').value,
      prompt: $('videoPrompt').value, duration: $('videoDuration').value, aspectRatio: $('videoRatio').value, resolution: $('videoResolution').value,
      audio: String($('videoAudio').checked), requestId, confirmed: 'true' })) data.set(key, value);
    if (taskInfo().inputs.includes('image') && imageFile) data.set('image', imageFile);
    if (taskInfo().inputs.includes('video') && $('videoReference').files[0]) data.set('video', $('videoReference').files[0]);
    if (task() === 'lipsync' && $('videoTrimSpeech').checked) data.set('trimToSpeech', 'true');
    if (taskInfo().inputs.includes('audio') && $('videoAudioFile').files[0]) data.set('speech', $('videoAudioFile').files[0]);
    return data;
  }
  async function api(url, options) {
    const response = await fetch(`/api/video${url}`, options);
    if (response.status === 401) throw new Error('Innloggingen er utløpt. Last siden på nytt og logg inn.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Forespørselen feilet.');
    return data;
  }
  $('videoForm').addEventListener('submit', async event => {
    event.preventDefault(); if (sending) return;
    const revision = quoteRevision;
    $('videoError').textContent = ''; $('videoQuoteButton').disabled = true;
    $('videoQuoteButton').textContent = 'Klargjør filer og beregner pris …';
    try {
      const quote = await api('/quote', { method: 'POST', body: formData() });
      if (revision !== quoteRevision) return;
      $('videoQuoteTitle').textContent = `Anslått pris: ${money(quote.estimate)}`;
      const durationLabel = quote.speechTiming ? `${quote.duration} sekunder i prisanslaget` : `${quote.duration} sekunder`;
      $('videoQuoteDetail').textContent = `${durationLabel} · ${quote.aspectRatio} · ${quote.resolution}. ${money(quote.reserved)} reservert mot appens grense. Priser kontrollert ${quote.priceDate}. ${connection(model())}.`;
      if (quote.inputImage) {
        const image = quote.inputImage;
        $('videoQuoteDetail').textContent += ` Bildet tilpasses fra ${image.originalWidth} × ${image.originalHeight} til ${image.width} × ${image.height} piksler (${(image.bytes / 1024 / 1024).toFixed(1)} MB).`;
      }
      if (quote.speechTiming) {
        const seconds = quote.speechTiming.duration.toLocaleString('nb-NO', { maximumFractionDigits: 2 });
        $('videoQuoteDetail').textContent += ` Planlagt klipplengde er ${seconds} s, inkludert 0,5 s stillhet på slutten.`;
      }
      if (quote.inputVideo) {
        const video = quote.inputVideo;
        $('videoQuoteDetail').textContent += ` Videoen ${video.converted ? 'klargjøres' : 'beholdes'} som ${video.width} × ${video.height} piksler (${(video.bytes / 1024 / 1024).toFixed(1)} MB), fra ${video.originalWidth} × ${video.originalHeight} og ${(video.originalBytes / 1024 / 1024).toFixed(1)} MB. Originalen endres ikke.`;
      }
      quoteBlocked = quote.reserved > config.maxJobUsd || quote.reserved + Number(config.reservedTodayUsd || 0) > config.maxDayUsd;
      if (quoteBlocked) $('videoQuoteDetail').textContent += ' Dette overskrider appens beløpsgrense. Velg kortere klipp eller lavere oppløsning, eller prøv en rimeligere modell.';
      $('videoGenerateButton').textContent = 'Generer video';
      $('videoGenerateButton').disabled = quoteBlocked || Boolean(activeJob);
      $('videoQuote').hidden = false;
    } catch (error) { $('videoError').textContent = error.message; }
    finally { $('videoQuoteButton').disabled = !model()?.available; $('videoQuoteButton').textContent = 'Se prisanslag'; }
  });
  $('videoGenerateButton').addEventListener('click', async () => {
    if (sending || quoteBlocked) return; sending = true;
    const form = $('videoForm'); const fields = [...form.querySelectorAll('input, select, textarea, button')];
    const disabled = fields.map(el => el.disabled); const body = formData();
    fields.forEach(el => { el.disabled = true; }); $('videoError').textContent = '';
    $('videoProgress').hidden = false;
    $('videoProgress').setAttribute('aria-busy', 'true');
    $('videoProgressTitle').textContent = 'Sender forespørselen';
    $('videoProgressDetail').textContent = 'Laster opp og oppretter videojobben …';
    $('videoElapsed').textContent = '';
    $('videoProgress').scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      await api('/jobs', { method: 'POST', body });
      $('videoQuote').hidden = true;
      requestId = crypto.randomUUID();
      await refresh();
    } catch (error) {
      $('videoError').textContent = `${error.message} Ved nettverksfeil kan du prøve samme knapp igjen; forespørsels-ID beholdes for å hindre dobbeltkjøring.`;
      await refresh();
    } finally {
      fields.forEach((el, i) => { el.disabled = disabled[i]; }); sending = false;
      $('videoGenerateButton').disabled = Boolean(activeJob) || quoteBlocked;
      if (!activeJob) $('videoProgress').hidden = true;
    }
  });
  function updateElapsed() {
    if (!activeJob) return;
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(activeJob.createdAt)) / 1000));
    $('videoElapsed').textContent = `Tid siden start: ${Math.floor(seconds / 60)} min ${seconds % 60} sek`;
  }
  let lastJobs = '';
  async function refresh() {
    if (!config) return;
    try {
      const data = await api('/jobs');
      config.reservedTodayUsd = data.reservedTodayUsd;
      activeJob = data.jobs.find(job => ['queued', 'submitting', 'running', 'downloading'].includes(job.status)) || null;
      $('videoProgress').hidden = !activeJob;
      $('videoProgress').setAttribute('aria-busy', String(Boolean(activeJob)));
      $('videoGenerateButton').disabled = Boolean(activeJob) || quoteBlocked;
      if (activeJob) {
        $('videoProgressTitle').textContent = activeJob.status === 'downloading' ? 'Videoen er laget – lagrer filen' : 'Videoen din er på vei';
        $('videoProgressDetail').textContent = `${config.models.find(m => m.id === activeJob.model)?.label || activeJob.model} · ${states[activeJob.status]}`;
        updateElapsed();
      }
      $('videoBudget').textContent = `Reservert i dag / uavklart: ${money(data.reservedTodayUsd)} av ${money(config.maxDayUsd)}. Maks per jobb: ${money(config.maxJobUsd)}.`;
      const serialized = JSON.stringify(data.jobs);
      if (lastJobs === serialized) return; lastJobs = serialized;
      $('videoJobs').replaceChildren();
      if (!data.jobs.length) { $('videoJobs').textContent = 'Ingen videoer ennå. Velg en oppgave ovenfor for å komme i gang.'; return; }
      for (const job of data.jobs) {
        const card = document.createElement('article'); card.className = 'video-job';
        const title = document.createElement('h3'); title.textContent = config.models.find(m => m.id === job.model)?.label || job.model;
        const status = document.createElement('p'); status.className = 'video-status'; status.textContent = states[job.status] || job.status;
        const prompt = document.createElement('p'); prompt.textContent = job.prompt;
        const details = document.createElement('p'); details.className = 'video-muted';
        details.textContent = `${new Date(job.createdAt).toLocaleString('nb-NO')} · ${job.duration} s · ${job.resolution || '720p'} · anslag ${money(job.estimate)}`;
        const message = document.createElement('p'); message.textContent = job.message;
        card.append(title, status, prompt, details, message);
        if (job.videoUrl) {
          const video = document.createElement('video'); video.controls = true; video.preload = 'metadata'; video.src = job.videoUrl;
          const download = document.createElement('a'); download.href = `${job.videoUrl}?download=1`; download.textContent = 'Last ned video';
          card.append(video, download);
        }
        $('videoJobs').append(card);
      }
    } catch (error) { $('videoError').textContent = error.message; }
  }
  $('videoRefresh').addEventListener('click', refresh);
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-animate-video]');
    if (!button) return;
    try {
      if (!config) throw new Error('Videofunksjonen er ikke lastet ennå. Prøv igjen.');
      const url = button.dataset.animateVideo;
      if (!url.startsWith('/generated/')) throw new Error('Ugyldig bildesti.');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Kunne ikke hente bildet.');
      const blob = await response.blob();
      const targetTask = imageReturnTask || 'image';
      if (task() !== targetTask) {
        document.querySelector(`input[name="videoTask"][value="${targetTask}"]`).checked = true;
        updateTask();
      }
      setImage(new File([blob], url.split('/').pop(), { type: blob.type }));
      imageReturnTask = null; $('videoImageBridge').hidden = true;
      showVideo(true); $('videoPrompt').focus();
    } catch (error) { showVideo(true); $('videoError').textContent = error.message; }
  });
  Promise.all([api('/config'), api('/exchange-rate').catch(() => null)]).then(([data, rate]) => {
    config = data;
    exchangeRate = rate?.nokPerUsd > 0 ? rate : null;
    $('videoExchangeRate').textContent = exchangeRate
      ? `Kroneanslag basert på Norges Banks kurs ${exchangeRate.date}. 1 USD ≈ ${nok.format(exchangeRate.nokPerUsd)}.`
      : 'Valutakursen er utilgjengelig. Beløpene vises i USD.';
    $('videoBuild').textContent = `Appversjon: ${config.version || 'lokal'}`;
    $('videoTasks').replaceChildren(...Object.entries(config.tasks).map(([value, info]) => {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'videoTask'; input.value = value; input.checked = value === 'text';
      const title = document.createElement('strong'); title.textContent = info.label;
      const description = document.createElement('small'); description.textContent = info.description;
      label.append(input, title, description); return label;
    }));
    $('videoMode').textContent = 'Videogenerering bruker API-saldo. Beskrivelse og opplastede filer sendes til leverandøren du velger. Du ser prisanslaget før du starter.';
    updateTask(); refresh();
  }).catch(error => { $('videoMode').textContent = error.message; $('videoQuoteButton').disabled = true; });
  setInterval(() => { if (!$('videoPanel').hidden) refresh(); }, 3000);
  setInterval(updateElapsed, 1000);
})();
