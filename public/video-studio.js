(() => {
  const $ = id => document.getElementById(id);
  const money = value => `$${Number(value).toFixed(2)}`;
  const states = { queued: 'I kø', submitting: 'Sender til leverandøren', running: 'Genereres', downloading: 'Lagrer video', completed: 'Ferdig', attention: 'Må kontrolleres' };
  let config; let imageFile; let requestId = crypto.randomUUID(); let sending = false; let previewUrl;
  let quoteRevision = 0;
  function showVideo(show) {
    $('imagesPanel').hidden = show; $('videoPanel').hidden = !show;
    $('imagesTab').setAttribute('aria-pressed', String(!show));
    $('videoTab').setAttribute('aria-pressed', String(show));
    if (show) refresh();
  }
  $('imagesTab').addEventListener('click', () => showVideo(false));
  $('videoTab').addEventListener('click', () => showVideo(true));
  function task() { return document.querySelector('input[name="videoTask"]:checked').value; }
  function model() { return config?.models.find(m => m.id === $('videoModel').value); }
  function invalidate() { $('videoQuote').hidden = true; quoteRevision++; requestId = crypto.randomUUID(); }
  function updateModel() {
    const m = model(); if (!m) return;
    $('videoAudio').disabled = m.audio === 'included';
    if (m.audio === 'included') $('videoAudio').checked = true;
    $('videoAudioLabel').textContent = m.audio === 'source' ? 'Behold lyden fra fremføringen' : m.audio === 'included' ? 'Lyd er inkludert i denne modellen' : 'Generer lyd';
    $('videoModelHelp').textContent = m.connected ? 'Nøkkel finnes. Modelltilgang og saldo er ikke verifisert.' : 'API-nøkkel mangler. Legg den inn på serveren før du genererer.';
    $('videoResolution').textContent = task() === 'motion' ? 'Varighet måles fra videoen på serveren. Format og oppløsning følger modellens referanser.' : '720p. Ved bildeanimering følger Grok formatet til bildet.';
    $('videoQuoteButton').disabled = !m.available;
    invalidate();
  }
  function updateTask() {
    if (!config) return;
    const previous = $('videoModel').value;
    $('videoModel').replaceChildren(...config.models.filter(m => m.tasks.includes(task())).map(m => {
      const option = document.createElement('option'); option.value = m.id;
      option.textContent = m.label + (!m.connected ? ' · Krever tilkobling' : '');
      option.disabled = !m.available; return option;
    }));
    if ([...$('videoModel').options].some(o => o.value === previous)) $('videoModel').value = previous;
    $('videoImageGroup').hidden = task() === 'text';
    $('videoReferenceGroup').hidden = task() !== 'motion';
    $('videoSettings').hidden = task() === 'motion';
    updateModel();
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
  document.querySelectorAll('input[name="videoTask"]').forEach(el => el.addEventListener('change', updateTask));
  $('videoModel').addEventListener('change', updateModel);
  $('videoForm').addEventListener('input', invalidate);
  function formData() {
    const data = new FormData();
    for (const [key, value] of Object.entries({ task: task(), model: $('videoModel').value,
      prompt: $('videoPrompt').value, duration: $('videoDuration').value, aspectRatio: $('videoRatio').value,
      audio: String($('videoAudio').checked), requestId, confirmed: 'true' })) data.set(key, value);
    if (task() !== 'text' && imageFile) data.set('image', imageFile);
    if (task() === 'motion' && $('videoReference').files[0]) data.set('video', $('videoReference').files[0]);
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
    try {
      const quote = await api('/quote', { method: 'POST', body: formData() });
      if (revision !== quoteRevision) return;
      $('videoQuoteTitle').textContent = `Anslått pris: ${money(quote.estimate)} USD`;
      $('videoQuoteDetail').textContent = `${quote.duration} sekunder · ${quote.aspectRatio}. Ved ekte generering: ca. ${money(quote.estimate)}, med ${money(quote.reserved)} reservert mot appens grense. Priser kontrollert ${quote.priceDate}.`;
      $('videoGenerateButton').textContent = 'Generer video';
      $('videoQuote').hidden = false;
    } catch (error) { $('videoError').textContent = error.message; }
    finally { $('videoQuoteButton').disabled = !model()?.available; }
  });
  $('videoGenerateButton').addEventListener('click', async () => {
    if (sending) return; sending = true;
    const form = $('videoForm'); const fields = [...form.querySelectorAll('input, select, textarea, button')];
    const disabled = fields.map(el => el.disabled); const body = formData();
    fields.forEach(el => { el.disabled = true; }); $('videoError').textContent = '';
    try {
      await api('/jobs', { method: 'POST', body });
      $('videoQuote').hidden = true;
      requestId = crypto.randomUUID();
      await refresh();
    } catch (error) {
      $('videoError').textContent = `${error.message} Ved nettverksfeil kan du prøve samme knapp igjen; forespørsels-ID beholdes for å hindre dobbeltkjøring.`;
    } finally { fields.forEach((el, i) => { el.disabled = disabled[i]; }); sending = false; }
  });
  let lastJobs = '';
  async function refresh() {
    if (!config) return;
    try {
      const data = await api('/jobs');
      $('videoBudget').textContent = `Reservert i dag / uavklart: ${money(data.reservedTodayUsd)} av ${money(config.maxDayUsd)} USD. Maks per jobb: ${money(config.maxJobUsd)}.`;
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
        details.textContent = `${new Date(job.createdAt).toLocaleString('nb-NO')} · ${job.duration} s · anslag ${money(job.estimate)} USD`;
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
      document.querySelector('input[name="videoTask"][value="image"]').checked = true;
      updateTask(); setImage(new File([blob], url.split('/').pop(), { type: blob.type }));
      showVideo(true); $('videoPrompt').focus();
    } catch (error) { showVideo(true); $('videoError').textContent = error.message; }
  });
  api('/config').then(data => {
    config = data;
    $('videoMode').textContent = 'Videogenerering bruker API-saldo. Beskrivelse og opplastede filer sendes til leverandøren du velger. Du ser prisanslaget før du starter.';
    updateTask(); refresh();
  }).catch(error => { $('videoMode').textContent = error.message; $('videoQuoteButton').disabled = true; });
  setInterval(() => { if (!$('videoPanel').hidden) refresh(); }, 3000);
})();
