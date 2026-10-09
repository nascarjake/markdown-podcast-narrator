import { titleFromMarkdown } from './speech.mjs';
import { episodeToMarkdown, parseDialogue } from './transcript.mjs';

const $ = (selector) => document.querySelector(selector);
const script = $('#script');
const title = $('#title');
const model = $('#model');
const provider = $('#provider');
const player = $('#player');
let cliInfo;
const cliSelection = { codex: 'gpt-6-astra', claude: 'sonnet' };
const customCliSelection = { codex: '', claude: '' };
let savedPath = '';
let titleWasEdited = false;
let working = false;

function countWords() {
  const count = script.value.trim().match(/\S+/g)?.length || 0;
  $('#word-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'}`;
}
function showStatus(heading, detail, error = false) {
  $('#output').classList.toggle('error', error);
  $('#status-title').textContent = heading;
  $('#status-detail').textContent = detail;
}
function setWorking(value) {
  working = value;
  $('#draft').disabled = value;
  $('#present').disabled = value;
}
function updateScript(text, source) {
  script.value = text;
  $('#source-label').textContent = source;
  titleWasEdited = false;
  title.value = titleFromMarkdown(text);
  $('#sources-panel').hidden = true;
  $('#view-sources').hidden = true;
  countWords();
  script.focus();
}
async function loadFile(file) {
  if (!/\.(md|markdown|txt)$/i.test(file.name) && !file.type.startsWith('text/')) throw new Error('Please use a Markdown or plain text file.');
  if (file.size > 1_000_000) throw new Error('Please choose a text file under 1 MB.');
  updateScript(await file.text(), file.name);
}
const formatGB = (bytes) => `${(bytes / 1_073_741_824).toFixed(1)} GiB`;

async function refreshModels() {
  const prior = model.value;
  $('#hardware-label').textContent = 'Checking LM Studio…';
  try {
    const { models, hardware, recommendations } = await window.narrator.models();
    $('#hardware-label').textContent = `${hardware.chip} · ${formatGB(hardware.ramBytes)} memory · ${formatGB(hardware.freeDiskBytes)} disk free`;
    model.replaceChildren();
    for (const item of models) model.add(new Option(`${item.name} · ${item.quantization} · ${formatGB(item.sizeBytes)}`, item.key));
    if (!models.length) model.add(new Option('No language models installed', ''));
    model.value = models.some((item) => item.key === prior) ? prior : (recommendations.find((item) => item.installed && item.fits)?.key || models[0]?.key || '');
    const cards = $('#recommendations'); cards.replaceChildren();
    for (const rec of recommendations) {
      const card = document.createElement('div');
      card.className = `recommendation${rec.tier === 'quality' && rec.fits ? ' best' : ''}${rec.fits ? '' : ' dimmed'}`;
      const heading = document.createElement('strong'); heading.textContent = rec.name;
      const description = document.createElement('p'); description.textContent = rec.note;
      const footer = document.createElement('div'); footer.className = 'rec-footer';
      const fit = document.createElement('span'); fit.textContent = `${formatGB(rec.sizeBytes)} · ${rec.reason}`;
      const action = document.createElement('button'); action.textContent = rec.installed ? 'Select' : 'Download'; action.disabled = !rec.fits;
      action.addEventListener('click', () => {
        if (rec.installed) { model.value = rec.key; $('#models-dialog').close(); }
        else beginDownload(rec.key);
      });
      footer.append(fit, action); card.append(heading, description, footer); cards.append(card);
    }
  } catch (error) {
    $('#hardware-label').textContent = error.message || String(error);
    model.replaceChildren(new Option('LM Studio unavailable', ''));
  }
}

function updateProviderUI() {
  const local = provider.value === 'lmstudio';
  $('#local-model-options').hidden = !local;
  $('#cli-model-options').hidden = local;
  $('#effort-row').hidden = provider.value !== 'codex';
  if (local) {
    $('#provider-status').textContent = 'LM Studio writes on this computer; Kokoro always generates audio locally.';
    return;
  }
  const selected = provider.value;
  const info = cliInfo?.[selected];
  const label = selected === 'codex' ? 'Codex' : 'Claude';
  $('#provider-status').textContent = !info?.installed ? `${label} CLI not found. Install it and sign in, then refresh providers.` : !info.signedIn ? `${label} CLI found, but not signed in. ${selected === 'claude' ? 'Run npm exec -- claude auth login from this project.' : 'Run codex login in Terminal.'}` : `${label} CLI is signed in. Model access is checked when you draft.`;
  const suggestions = cliInfo?.models?.[selected] || [];
  const picker = $('#cli-model-select');
  picker.replaceChildren();
  for (const name of suggestions) picker.add(new Option(name, name));
  picker.add(new Option('Custom model ID…', '__custom__'));
  const custom = !suggestions.includes(cliSelection[selected]);
  picker.value = custom ? '__custom__' : cliSelection[selected];
  $('#cli-model').hidden = !custom;
  $('#cli-model').value = custom ? cliSelection[selected] : '';
  $('#cli-setup').textContent = `${label} CLI setup ↗`;
  $('#cli-setup').dataset.url = selected === 'codex' ? 'https://developers.openai.com/codex/cli' : 'https://code.claude.com/docs/en/setup';
}

async function refreshProviders() {
  try { cliInfo = await window.narrator.cliProviders(); }
  catch { cliInfo = null; }
  await refreshModels();
  updateProviderUI();
}

async function beginDownload(key) {
  $('#download-model').disabled = true;
  const status = $('#download-status');
  status.textContent = `Starting ${key} download in LM Studio…`;
  try {
    let job = await window.narrator.downloadModel(key);
    if (job.status === 'already_downloaded') { status.textContent = 'Already downloaded.'; await refreshModels(); return; }
    for (let i = 0; i < 600 && job.job_id && !['completed', 'failed'].includes(job.status); i++) {
      if (job.total_size_bytes) status.textContent = `Downloading ${key}: ${Math.round((job.downloaded_bytes || 0) / job.total_size_bytes * 100)}%`;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      job = await window.narrator.downloadStatus(job.job_id);
    }
    if (job.status !== 'completed') throw new Error('Download did not complete. Check LM Studio for progress.');
    status.textContent = `${key} is ready.`;
    await refreshModels(); model.value = key.split('@')[0];
  } catch (error) { status.textContent = error.message || String(error); }
  finally { $('#download-model').disabled = false; }
}

function showSources(sources, warnings) {
  const list = $('#sources-list'); list.replaceChildren();
  for (const source of sources) {
    const item = document.createElement('li');
    const link = document.createElement('a'); link.href = '#'; link.textContent = `[${source.id}] ${source.title}`;
    link.addEventListener('click', (event) => { event.preventDefault(); window.narrator.openSource(source.location); });
    item.append(link); list.append(item);
  }
  $('#research-warnings').textContent = warnings.join(' ');
  $('#sources-panel').hidden = !sources.length && !warnings.length;
  $('#view-sources').hidden = !sources.length && !warnings.length;
}

async function createDraft() {
  if (!script.value.trim()) throw new Error('Add notes before drafting an episode.');
  const selectedModel = provider.value === 'lmstudio' ? model.value : ($('#cli-model-select').value === '__custom__' ? $('#cli-model').value.trim() : $('#cli-model-select').value);
  if (!selectedModel) throw new Error('Choose a writing model first.');
  if (provider.value !== 'lmstudio' && !cliInfo?.[provider.value]?.installed) throw new Error(`${provider.value === 'codex' ? 'Codex' : 'Claude'} CLI is not installed. Use the setup link above, then refresh providers.`);
  if (provider.value !== 'lmstudio' && !cliInfo?.[provider.value]?.signedIn) throw new Error(`${provider.value === 'codex' ? 'Codex' : 'Claude'} CLI needs sign-in. See the provider instructions above, then refresh providers.`);
  showStatus('Researching and drafting', `Preparing ${provider.options[provider.selectedIndex].textContent}…`);
  const result = await window.narrator.draftEpisode({
    notes: script.value, query: title.value.trim() || titleFromMarkdown(script.value), provider: provider.value, model: selectedModel, effort: $('#effort').value,
    wikipedia: $('#wikipedia').checked, urls: $('#urls').value
  });
  script.value = episodeToMarkdown(result);
  title.value = result.title;
  titleWasEdited = true;
  $('#source-label').textContent = `Two-host draft from ${provider.options[provider.selectedIndex].textContent}`;
  countWords(); showSources(result.sources, result.warnings);
  const wordCount = result.segments.map((part) => part.text).join(' ').trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(wordCount / 140));
  showStatus('Conversation ready to review', `${result.conceptCount} ${result.conceptCount === 1 ? 'idea' : 'ideas'} explained · about ${minutes} min spoken. Edit the hosts’ lines, then press Present & play.`);
  return result.segments;
}

$('#browse').addEventListener('click', (event) => { event.stopPropagation(); $('#file-input').click(); });
$('#drop-zone').addEventListener('click', () => $('#file-input').click());
$('#drop-zone').addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) $('#file-input').click(); });
$('#file-input').addEventListener('change', async () => {
  try { if ($('#file-input').files[0]) await loadFile($('#file-input').files[0]); }
  catch (error) { showStatus('Could not add file', error.message, true); }
  $('#file-input').value = '';
});
for (const name of ['dragenter', 'dragover']) document.addEventListener(name, (event) => { event.preventDefault(); $('#drop-zone').classList.add('dragging'); });
for (const name of ['dragleave', 'drop']) document.addEventListener(name, (event) => { event.preventDefault(); if (name === 'drop' || !event.relatedTarget) $('#drop-zone').classList.remove('dragging'); });
document.addEventListener('drop', async (event) => {
  try {
    const file = event.dataTransfer?.files?.[0];
    if (file) await loadFile(file);
    else if (event.dataTransfer?.getData('text/plain')) updateScript(event.dataTransfer.getData('text/plain'), 'Dropped text');
  } catch (error) { showStatus('Could not add content', error.message, true); }
});
script.addEventListener('input', () => { countWords(); if (!titleWasEdited) title.value = script.value.trim() ? titleFromMarkdown(script.value) : ''; $('#source-label').textContent = 'Edited script'; });
title.addEventListener('input', () => { titleWasEdited = !!title.value.trim(); });
$('#refresh-models').addEventListener('click', refreshProviders);
$('#open-models').addEventListener('click', () => $('#models-dialog').showModal());
$('#view-sources').addEventListener('click', () => $('#sources-dialog').showModal());
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
provider.addEventListener('change', updateProviderUI);
$('#cli-model-select').addEventListener('change', () => {
  const custom = $('#cli-model-select').value === '__custom__';
  $('#cli-model').hidden = !custom;
  cliSelection[provider.value] = custom ? customCliSelection[provider.value] : $('#cli-model-select').value;
  if (custom) { $('#cli-model').value = customCliSelection[provider.value]; $('#cli-model').focus(); }
});
$('#cli-model').addEventListener('input', () => {
  customCliSelection[provider.value] = $('#cli-model').value;
  cliSelection[provider.value] = $('#cli-model').value;
});
$('#cli-setup').addEventListener('click', (event) => { event.preventDefault(); window.narrator.openSource($('#cli-setup').dataset.url); });
$('#download-model').addEventListener('click', () => beginDownload($('#catalog-id').value.trim()));
$('#browse-catalog').addEventListener('click', () => window.narrator.openSource('https://lmstudio.ai/models'));
$('#choose-folder').addEventListener('click', async () => {
  const folder = await window.narrator.chooseFolder();
  $('#folder-label').textContent = folder || 'No folder selected'; $('#clear-folder').hidden = !folder;
});
$('#clear-folder').addEventListener('click', async () => { await window.narrator.clearFolder(); $('#folder-label').textContent = 'No folder selected'; $('#clear-folder').hidden = true; });
$('#two-host').addEventListener('change', () => { $('#draft').hidden = !$('#two-host').checked; $('#voice-b').disabled = !$('#two-host').checked; });
window.narrator.onProgress(({ message, current, total }) => showStatus('Working on your episode', total ? `${message} ${Math.round(current / total * 100)}% complete` : message));
$('#draft').addEventListener('click', async () => {
  if (working) return;
  setWorking(true);
  try { await createDraft(); } catch (error) { showStatus('Could not draft episode', error.message || String(error), true); }
  finally { setWorking(false); }
});
$('#present').addEventListener('click', async () => {
  if (working) return;
  if (!script.value.trim()) { showStatus('Add notes first', 'Drop a file or paste some text into the editor.', true); script.focus(); return; }
  setWorking(true);
  player.pause(); player.removeAttribute('src'); $('#player-wrap').hidden = true; savedPath = '';
  try {
    const segments = $('#two-host').checked ? (parseDialogue(script.value) || await createDraft()) : null;
    showStatus('Creating your narration', 'Preparing Kokoro voices…');
    const result = await window.narrator.present({
      markdown: script.value, segments, title: title.value.trim() || titleFromMarkdown(script.value),
      voiceA: $('#voice-a').value, voiceB: $('#voice-b').value
    });
    savedPath = result.path; player.src = result.url; $('#player-wrap').hidden = false;
    showStatus('Ready to listen', `Saved to ${savedPath}`);
    await player.play();
  } catch (error) {
    if (savedPath) showStatus('MP3 saved', `Saved to ${savedPath}. Press play if autoplay was blocked.`);
    else showStatus('Could not create episode', error.message || String(error), true);
  } finally { setWorking(false); }
});
$('#reveal').addEventListener('click', () => { if (savedPath) window.narrator.showOutput(savedPath); });
countWords(); refreshProviders();
