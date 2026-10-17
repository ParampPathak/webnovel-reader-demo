'use strict';
const $ = id => document.getElementById(id);
const bookId = new URLSearchParams(location.hash.slice(1)).get('book') || 'signal';
const endpoint = `/api/books/${bookId}`;
const defaults = {followAlong: false, followAlongSuspended: false, theme: 'dark', font: 'serif', fontSize: 20, lineHeight: 1.8, width: 760, paragraphSpacing: 1.1, margin: 24, alignment: 'left', mode: 'pages'};
let globalTheme='dark',inheritTheme=true;
let preferences = {...defaults}, book, section, version = 0, saveQueue = Promise.resolve();
let ready = false, loading = false, conflict = false, saveTimer, contentsTimer;
let lastSavedSnapshot = null, passage='', resizeTimer, restoredCursor=null, layoutRevision=0, saveRevision=0,pendingReadingWrite=null;
function cursor(){const d=$('readingFrame').contentDocument,s=d?.scrollingElement;if(!s)return null;return {left:s.scrollLeft||0,top:s.scrollTop||0,layout:[d.documentElement?.clientWidth||s.clientWidth||0,d.documentElement?.clientHeight||s.clientHeight||0,s.scrollWidth||0,s.scrollHeight||0,d.body?.dataset.sectionToken||''].join(':')};}
function recordRestore(){restoredCursor=cursor();}
const pagination=()=>window.ReaderPagination;
function currentAnchor(){return pagination()?.anchor($('readingFrame').contentDocument)||'';}
function revealTarget(target){if(pagination())pagination().reveal($('readingFrame').contentDocument,target,preferences.mode==='pages');else target.scrollIntoView({block:'center'});recordRestore();}
function queueRestore(fraction,locator){const revision=++layoutRevision,manual=manualRevision,token=sectionToken;requestAnimationFrame(()=>{if(ready&&revision===layoutRevision&&manual===manualRevision&&token===sectionToken&&!pageAnimation&&!pageDrag){restorePosition(fraction,locator);showLocation();}});}
function relayout(){if(!ready)return;cancelPageDrag();finishPageAnimation();clearTimeout(resizeTimer);const manual=manualRevision,token=sectionToken,locator=passage||currentAnchor(),fraction=scrollFraction();resizeTimer=setTimeout(()=>{if(ready&&manual===manualRevision&&token===sectionToken&&!pageAnimation&&!pageDrag){restorePosition(fraction,locator);showLocation();}},80);}
let narration=null,narrationKey='',followingSuspended=false,applyingNarration=false,audioPlaying=false,headphoneBusy=false,pageAnimation=null,pageDrag=null,manualRevision=0,activationFloor=null,miniDismissed=false,viewFollowsNarration=false,manualReadingPosition=null;
function notifyFollow(){window.parent?.Player?.setFollow?.(bookId,!!preferences.followAlong,followingSuspended,version);}
function suspendFollowing(){viewFollowsNarration=false;manualRevision++;layoutRevision++;activationFloor=null;restoredCursor=null;followingSuspended=true;preferences.followAlongSuspended=true;savePosition();refreshReturn();notifyFollow();}

let sectionToken = 0, contentsToken = 0, contentsOffset = 0, contentsMode = 'spine';
let contentsTotal = 0, contentsLoaded = 0, contentsScrolling = false, listeningInterface = false, lastPlayback = null, listeningStart = null;
const contentsRowHeight = 56;
const contentsLimit = 100;
async function api(url, options) { return window.BrowserLibrary.api(url, options); }
function setStatus(text) { $('readingStatus').textContent = text; }
function scrollFraction() {
  const doc = $('readingFrame').contentDocument;
  if (!doc?.documentElement || !doc.scrollingElement) return 0;
  const scroller = doc.scrollingElement;
  if(preferences.mode==='pages'&&pagination()){const w=doc.documentElement.clientWidth,n=pagination().pageCount(scroller.scrollWidth,w);return n>1?pagination().pageFor(scroller.scrollLeft,w,scroller.scrollWidth)/(n-1):0;}
  const extent = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  return extent ? Math.max(0, Math.min(1, scroller.scrollTop / extent)) : 0;
}
function showLocation() {
  refreshReturn();
  if (!section || conflict) return;
  const scroller=$('readingFrame').contentDocument.scrollingElement;
  const page=preferences.mode==='pages'&&pagination()?` · Page ${pagination().pageFor(scroller.scrollLeft,$('readingFrame').contentDocument.documentElement.clientWidth,scroller.scrollWidth)+1}/${pagination().pageCount(scroller.scrollWidth,$('readingFrame').contentDocument.documentElement.clientWidth)}`:preferences.mode==='pages'?` · Page ${Math.floor(scroller.scrollTop/(scroller.clientHeight*.9))+1}/${Math.max(1,Math.ceil(Math.max(0,scroller.scrollHeight-scroller.clientHeight)/(scroller.clientHeight*.9))+1)}`:'';
  setStatus(`Section ${section.position + 1} of ${(book.position_count || book.section_count).toLocaleString()} · ${Math.round(scrollFraction() * 100)}%${page}`);
}
function savePosition(keepalive = false) {
  if (!ready || !section || conflict || pageAnimation || pageDrag) return saveQueue;
  const visible={section_id:section.id,fraction:scrollFraction(),anchor:passage||currentAnchor()};if(!viewFollowsNarration)manualReadingPosition=visible;
  const snapshot={...(manualReadingPosition||visible),preferences:{...preferences},inherit_theme:inheritTheme};
  checkpointReading(snapshot);
  const queued=++saveRevision;
  const signature = JSON.stringify(snapshot);
  saveQueue = saveQueue.then(async () => {
    if (conflict || queued!==saveRevision || signature === lastSavedSnapshot) return;
    try {
      pendingReadingWrite={version:version+1,section_id:snapshot.section_id,fraction:snapshot.fraction,anchor:snapshot.anchor};checkpointReading();
      const data = await api(`${endpoint}/progress`, {method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...snapshot, version}), keepalive});
      version = data.version;pendingReadingWrite=null;notifyFollow();checkpointReading();
      lastSavedSnapshot = signature;
      showLocation();
    } catch (error) {
      if (error.status === 409) conflict = true;
      setStatus(error.message + (conflict ? '' : ' Your place has not been saved.'));
    }
  });
  return saveQueue;
}
function checkpointReading(snapshot){if(!ready||!section||pageAnimation||pageDrag)return;try{localStorage.setItem('webnovelReadingCheckpoint:'+bookId,JSON.stringify({...(snapshot||(viewFollowsNarration&&manualReadingPosition)||{section_id:section.id,fraction:scrollFraction(),anchor:passage||currentAnchor()}),preferences:{...preferences},inherit_theme:inheritTheme,server_version:version,pending_write:pendingReadingWrite,saved_at:Date.now()}));}catch{}}
function scheduleSave() {
  if(pageAnimation||pageDrag||!ready)return;
  clearTimeout(saveTimer);
  const now=cursor();
  // Reflow/native clamping must not replace the intended passage with the first
  // word of its newly sized page. Only actual manual movement captures a new anchor.
  if(!restoredCursor||(now?.layout===restoredCursor.layout&&(Math.abs(now.left-restoredCursor.left)>1||Math.abs(now.top-restoredCursor.top)>1))){passage=currentAnchor();restoredCursor=null;}
  showLocation();
  saveTimer = setTimeout(() => savePosition(), 800);
}
function documentStyle() {
  const palettes = {gray: ['#292b30', '#e4e2de', '#b7d7bd', '#414b59'], dark: ['#11151b', '#edf0ef', '#b7d7bd', '#303c49'], lightgray: ['#e5e5e1', '#292b2d', '#42684b', '#becbd4'], light: ['#fafaf7', '#252c28', '#42684b', '#d4e0d5'], sepia: ['#f3e9d5', '#40352b', '#72613c', '#ddd0ad']};
  const fonts = {serif: 'Georgia, "Times New Roman", serif', sans: 'system-ui, sans-serif', mono: 'ui-monospace, monospace'};
  const colors = palettes[preferences.theme] || palettes.dark;
  return `html{color-scheme:${['gray','dark'].includes(preferences.theme) ? 'dark' : 'light'};--narration-bg:${colors[3]};--narration-text:${colors[1]};background:${colors[0]};color:${colors[1]};scroll-behavior:auto}body{box-sizing:border-box;font-family:${fonts[preferences.font]};font-size:${preferences.fontSize}px;line-height:${preferences.lineHeight};max-width:${preferences.width}px;margin:0 auto;padding:32px ${preferences.margin}px 48px;text-align:${preferences.alignment};overflow-wrap:anywhere}h1,h2,h3{line-height:1.3;font-weight:500}h1{font-size:1.8em;margin-bottom:1.3em}p{margin:0 0 ${preferences.paragraphSpacing}em}a{color:${colors[2]}}img{max-width:100%;height:auto}pre{white-space:pre-wrap}table{max-width:100%;border-collapse:collapse;display:block;overflow:auto}td,th{padding:.4em;border:1px solid ${colors[2]}}blockquote{margin:1.5em .5em;padding-left:1em;border-left:2px solid ${colors[2]}}.narration-highlight{background:var(--narration-bg);color:var(--narration-text);border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;transition:background-color .12s ease}@media(prefers-reduced-motion:reduce){.narration-highlight{transition:none}}@media(max-width:600px){body{padding:24px ${preferences.margin}px 48px}}${preferences.mode==='pages'?`html{height:100%;overflow:hidden}body{max-width:none;margin:0;padding:16px ${preferences.margin}px;width:calc(100vw - ${preferences.margin*2}px);height:calc(100vh - 32px);box-sizing:content-box;column-width:calc(100vw - ${preferences.margin*2}px);column-gap:${preferences.margin*2}px;column-fill:auto;overflow:visible}img,svg{max-height:calc(100vh - 64px);object-fit:contain}h1,h2,h3{break-after:avoid}pre,table{max-height:calc(100vh - 64px);overflow:auto}body>*:first-child{margin-top:0}`:''}`;
}
function applySettings(preserve = true) {
  cancelPageDrag();
  finishPageAnimation();
  const fraction = ready && preserve ? scrollFraction() : 0;
  const locator=ready&&preserve?(passage||currentAnchor()):'';
  document.body.dataset.theme = preferences.theme;
  if($('globalTheme'))$('globalTheme').value=globalTheme;
  if($('inheritTheme'))$('inheritTheme').checked=inheritTheme;
  try{window.parent.Player?.theme?.(preferences.theme);}catch{}
  for (const key of Object.keys(defaults)) {if(!['followAlong','followAlongSuspended'].includes(key))$(key).value = preferences[key];}
  $('followNarration').setAttribute('aria-pressed',String(!!preferences.followAlong));notifyFollow();
  $('fontSizeValue').textContent = `${preferences.fontSize}px`;
  const doc = $('readingFrame').contentDocument;
  const style = doc?.getElementById('reader-style');
  if (style) {
    style.textContent = documentStyle();
    if (ready && preserve) queueRestore(fraction,locator);
  }
}
function restorePosition(fraction, anchor = '') {
  const doc = $('readingFrame').contentDocument;
  if (!doc) return;
  if(pagination()){pagination().restore(doc,fraction,anchor,preferences.mode==='pages');passage=anchor||currentAnchor();recordRestore();return;}
  const target = anchor && doc.getElementById(anchor);
  if (target) target.scrollIntoView();
  else {
    const scroller = doc.scrollingElement;
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight) * fraction;
  }
  recordRestore();
}
async function openSection(id, fraction = 0, anchor = '', valid = () => true) {
  if(!valid())return;
  cancelPageDrag();layoutRevision++;clearTimeout(resizeTimer);
  finishPageAnimation();
  if (!id) return;
  const token = ++sectionToken;
  const previousSection = section, previouslyReady = ready;
  let replacedDocument = false;
  clearTimeout(saveTimer);
  await savePosition();
  if (token !== sectionToken || conflict || !valid()) return;
  loading = true; ready = false;
  $('listenChapter').disabled = true;
  $('readerLoading').hidden = false;
  $('previousSection').disabled = $('nextSection').disabled = true;
  try {
    const next = await api(`${endpoint}/sections/${id}`);
    if (token !== sectionToken) return;
    if (!valid()) {ready=previouslyReady;return;}
    section = next;
    $('contentsChapter').textContent=`Current reading: ${section.position+1}. ${section.title}`;
    $('readingFrame').dataset.sectionId=section.id;
    $('sectionTitle').textContent = section.title;
    // No publication scripts run. The parent owns all navigation and settings.
    const frame = $('readingFrame');
    await new Promise(resolve => {
      frame.onload = () => {const body=frame.contentDocument?.body;if(body?.dataset.sectionToken===String(token)&&frame.contentDocument.readyState==='complete')resolve();};
      replacedDocument = true;
      frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style id="reader-style">${documentStyle()}</style></head><body data-section-id="${section.id}" data-section-token="${token}">${section.content_html}</body></html>`;
    });
    if (token !== sectionToken) return;
    const doc = frame.contentDocument;
    // Reserve space for images before restoring a long chapter's position.
    const images = [...doc.images];
    await Promise.race([Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(resolve => {
      image.addEventListener('load', resolve, {once: true}); image.addEventListener('error', resolve, {once: true});
      image.loading = 'eager';
    }))), new Promise(resolve => setTimeout(resolve, 1500))]);
    if (token !== sectionToken) return;
    narrationKey='';
    if(anchor.startsWith('narration:')&&window.NarrationMarkup){
      const parts=anchor.split(':');try{const loc=await api(`/api/audio/${parts[1]}/location/${parts[2]}`);if(token!==sectionToken)return;if(loc.section_id===section.id){const target=window.NarrationMarkup.locate?.(doc,loc,book.source_kind==='webnovel'?section.title:null);if(target){revealTarget(target);anchor=currentAnchor();}}}catch{}
    }
    restorePosition(fraction, anchor);
    ready = true;
    $('listenChapter').disabled = false;
    doc.addEventListener('scroll', scheduleSave, {passive: true});
    doc.addEventListener('click', event => {
      const link = event.target.closest('a[data-book-target]');
      if (link) {event.preventDefault(); navigateTarget(link.dataset.bookTarget);}
    });
    doc.addEventListener('keydown', handleKeys);
    wireReadingGestures(doc);
    $('previousSection').disabled = !section.previous_id;
    $('nextSection').disabled = !section.next_id;
    showLocation();
    await savePosition();
    const listening=narration||window.parent?.Player?.narration?.();if(listening?.book_id===bookId&&listening.section_id===section.id)await updateNarration(listening);
    // A requested chapter is a one-time navigation hint. Reload must resume the
    // saved chapter/scroll position rather than repeatedly opening that hint.
    if (typeof location !== 'undefined' && typeof history !== 'undefined') {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('section')) {
        params.delete('section');
        history.replaceState(null, '', location.pathname + (params.size ? '#' + params.toString() : ''));
      }
    }
    if (window.parent && window.parent !== window && window.parent.Player?.rememberReader) {
      window.parent.Player.rememberReader(bookId);
    }
    if (!$('contentsPanel').hidden) await loadContents();
  } catch (error) {
    if (token === sectionToken) {
      if (!replacedDocument && previousSection) {
        section = previousSection; ready = previouslyReady;
        $('listenChapter').disabled = !ready;
        $('previousSection').disabled = !section.previous_id;
        $('nextSection').disabled = !section.next_id;
      }
      setStatus(error.message);
    }
  }
  finally { if (token === sectionToken) {loading = false; $('readerLoading').hidden = true;} }
}
async function navigateTarget(href) {
  suspendFollowing();
  const manual=manualRevision,token=sectionToken;
  try {
    const target = await api(`${endpoint}/resolve?href=${encodeURIComponent(href)}`);
    if(manual!==manualRevision||token!==sectionToken)return;
    await openSection(target.id, 0, target.anchor);
  } catch (error) { setStatus(error.message); }
}
async function loadContents(aroundCurrent = false, preserveScroll = false) {
  const token = ++contentsToken;
  const search = ['spine','search'].includes(contentsMode) ? `&q=${encodeURIComponent($('sectionSearch').value)}` : '';
  const route = contentsMode === 'search' ? 'search' : contentsMode === 'spine' ? 'sections' : 'navigation';
  try {
    const around=aroundCurrent&&contentsMode==='spine'&&!$('sectionSearch').value&&section?`&around=${section.id}`:'';
    const data = await api(`${endpoint}/${route}?offset=${contentsOffset}&limit=${contentsLimit}${search}${around}`);
    if (token !== contentsToken) return;
    if(Number.isInteger(data.offset))contentsOffset=data.offset;
    const list=$('sectionList'), oldScroll=list.scrollTop;
    contentsTotal=data.total;contentsLoaded=data.items.length;
    list.dataset.virtualized=String(contentsMode==='spine');
    list.replaceChildren();
    const spacer=height=>{const node=document.createElement('div');node.style.height=`${height}px`;node.setAttribute('aria-hidden','true');list.append(node);};
    if(contentsMode==='spine')spacer(contentsOffset*contentsRowHeight);
    for (const item of data.items) {
      const button = document.createElement('button');
      button.textContent = contentsMode === 'spine' ? `${item.position + 1}. ${item.title}` : item.title;
      button.title=button.textContent;
      if (item.id === section?.id) {button.className = 'active'; button.setAttribute('aria-current', 'true');}
      if (contentsMode === 'toc') button.style.paddingLeft = `${Math.min(item.depth, 5) * 12 + 8}px`;
      button.onclick = () => {suspendFollowing();setPanel('contents', false); item.id ? openSection(item.id) : navigateTarget(item.href);};
      $('sectionList').append(button);
    }
    if(contentsMode==='spine')spacer(Math.max(0,data.total-contentsOffset-data.items.length)*contentsRowHeight);
    if (!data.total) $('sectionList').textContent = contentsMode === 'toc' ? 'No book contents supplied. Use reading order.' : 'No matching sections.';
    $('contentsPage').textContent = data.total ? `${contentsOffset + 1}–${Math.min(contentsOffset + contentsLimit, data.total)} / ${data.total}` : '0 sections';
    $('contentsPrevious').disabled = contentsOffset === 0;
    $('contentsNext').disabled = contentsOffset + contentsLimit >= data.total;
    if(contentsMode==='spine'){
      const current=aroundCurrent?data.items.findIndex(item=>item.id===section?.id):-1;
      list.scrollTop=preserveScroll?oldScroll:Math.max(0,(contentsOffset+Math.max(0,current))*contentsRowHeight-(current>=0?list.clientHeight/2-contentsRowHeight/2:0));
    }else list.querySelector('[aria-current]')?.scrollIntoView?.({block:'center'});
    return true;
  } catch (error) { setStatus(error.message);return false; }
}
function refreshContentsWindow(){
  if($('contentsPanel').hidden||contentsMode!=='spine'||$('sectionList').dataset.virtualized!=='true'||contentsScrolling)return;
  const first=Math.floor($('sectionList').scrollTop/contentsRowHeight), visible=Math.ceil($('sectionList').clientHeight/contentsRowHeight);
  if(first>=contentsOffset&&first+visible<=contentsOffset+contentsLoaded)return;
  contentsOffset=Math.max(0,Math.min(Math.max(0,contentsTotal-contentsLimit),first-20));
  contentsScrolling=true;loadContents(false,true).then(loaded=>{contentsScrolling=false;if(loaded)requestAnimationFrame(refreshContentsWindow);});
}
$('sectionList').addEventListener('scroll',refreshContentsWindow);
function setPanel(name, open) {
  $(`${name}Panel`).hidden = !open;
  $(`${name}Toggle`).setAttribute('aria-expanded', String(open));
  if (open) {
    const other = name === 'contents' ? 'settings' : 'contents';
    setPanel(other, false);
    if (name === 'contents') loadContents(true);
    $(`${name}Panel`).querySelector('button,select').focus();
  }
}
function handleKeys(event) {
  if(['PageUp','PageDown','Home','End','ArrowUp','ArrowDown'].includes(event.key))suspendFollowing();
  if (event.key === 'Escape') {toggleChrome(false);setPanel('contents', false); setPanel('settings', false); return;}
  if (event.target.closest('input,select,button') || event.ctrlKey || event.metaKey || event.altKey) return;
  if(event.key.toLowerCase()==='c'){event.preventDefault();toggleChrome(document.body.dataset.focus!=='true');return;}
  if (!loading && event.key === 'ArrowLeft') {event.preventDefault(); turnPage(-1);}
  if (!loading && event.key === 'ArrowRight') {event.preventDefault(); turnPage(1);}
}
$('contentsToggle').onclick = () => setPanel('contents', $('contentsPanel').hidden);
$('settingsToggle').onclick = () => setPanel('settings', $('settingsPanel').hidden);
$('closeContents').onclick = () => {setPanel('contents', false); $('contentsToggle').focus();};
$('closeSettings').onclick = () => {setPanel('settings', false); $('settingsToggle').focus();};
$('previousSection').onclick = () => {suspendFollowing();openSection(section?.previous_id);};
$('nextSection').onclick = () => {suspendFollowing();openSection(section?.next_id);};
for (const key of Object.keys(defaults).filter(key=>!['followAlong','followAlongSuspended'].includes(key))) $(key).addEventListener('change', () => {
  if(key==='theme')inheritTheme=false;
  preferences[key] = ['theme', 'font','alignment','mode'].includes(key) ? $(key).value : Number($(key).value);
  applySettings(); savePosition(); requestAnimationFrame(scheduleSave);
});
if($('inheritTheme'))$('inheritTheme').onchange=()=>{inheritTheme=$('inheritTheme').checked;if(inheritTheme)preferences.theme=globalTheme;applySettings();savePosition();};
if($('globalTheme'))$('globalTheme').onchange=async()=>{try{const result=await api('/api/reader/appearance',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:$('globalTheme').value})});globalTheme=result.theme;if(inheritTheme)preferences.theme=globalTheme;applySettings();savePosition();}catch(e){setStatus(e.message);applySettings();}};
$('contentsPrevious').onclick = () => {contentsOffset = Math.max(0, contentsOffset - contentsLimit); loadContents();};
$('contentsNext').onclick = () => {contentsOffset += contentsLimit; loadContents();};
$('sectionSearch').oninput = () => {clearTimeout(contentsTimer); contentsTimer = setTimeout(() => {contentsOffset = 0; loadContents();}, 250);};
for (const [id, mode] of [['spineTab', 'spine'], ['tocTab', 'toc']]) $(id).onclick = () => {
  contentsMode = mode; contentsOffset = 0;
  $('spineTab').setAttribute('aria-pressed', String(mode === 'spine'));
  $('tocTab').setAttribute('aria-pressed', String(mode === 'toc'));
  $('sectionSearch').hidden = mode === 'toc'; loadContents();
};
document.addEventListener('keydown', handleKeys);
document.addEventListener('visibilitychange', () => {if (document.hidden) savePosition(true);});
window.addEventListener('pagehide', () => savePosition(true));
setInterval(() => {if (ready && !document.hidden) savePosition();}, 10000);
(async () => {
  try {
    book = await api(endpoint); $('bookTitle').textContent = book.title; document.title = book.title + ' · Browser Reader';
    const appearance=await api('/api/reader/appearance?book='+encodeURIComponent(bookId));
    globalTheme=appearance.theme||'dark';inheritTheme=appearance.inherit!==false;
    version = book.progress.version;
    preferences = {...defaults, ...book.progress.preferences};
    if(inheritTheme)preferences.theme=globalTheme;
    $('contentsBookTitle').textContent=book.title;$('contentsAuthor').textContent=book.author||'';
    $('contentsCover').hidden=!book.cover_url;if(book.cover_url)$('contentsCover').src=book.cover_url;
    try{if(!localStorage.getItem('webnovelColumnPages:'+bookId)){preferences.mode='pages';localStorage.setItem('webnovelColumnPages:'+bookId,'1');}}catch{}
    followingSuspended=true;preferences.followAlongSuspended=true;
    applySettings(false);
    if (book.source_kind === 'epub') {$('originalDownload').hidden = false; $('originalDownload').href = await window.BrowserLibrary.originalURL(bookId); $('originalDownload').download = book.title.replace(/[^\w .-]/g,'_').slice(0,120) + '.epub';}
    if(!book.first_section_id){setStatus('No chapters have been imported yet. Open book details to import chapters.');return;}
    const requested = typeof URLSearchParams!=='undefined' && typeof location!=='undefined' ? Number(new URLSearchParams(location.hash.slice(1)).get('section')) : 0;
    let progress=book.progress;try{const local=JSON.parse(localStorage.getItem('webnovelReadingCheckpoint:'+bookId)||'null'),serverTime=Date.parse((progress.updated_at||'').replace(' ','T')+'Z')||0,pending=local?.pending_write;
     // An in-flight PUT may have committed just before the old iframe closed.
     // Accept our newer local anchor only when that exact known write matches;
     // unrelated newer server progress must still win across devices.
     const ownCommit=pending?.version===version&&pending.section_id===progress.section_id&&pending.anchor===progress.anchor&&Math.abs(pending.fraction-progress.fraction)<1e-8;
     if((local?.server_version===version||ownCommit)&&local.saved_at>=serverTime&&Number.isInteger(local.section_id)&&/^text:\d+$/.test(local.anchor||'')){progress={...progress,...local};if(typeof local.inherit_theme==='boolean')inheritTheme=local.inherit_theme;else if(local.preferences?.theme&&local.preferences.theme!==book.progress.preferences.theme)inheritTheme=false;}}catch{}
    preferences={...defaults,...window.BrowserLibrary.preferences(progress.preferences)};if(inheritTheme)preferences.theme=globalTheme;applySettings(false);
    manualReadingPosition={section_id:progress.section_id||book.first_section_id,fraction:progress.fraction||0,anchor:progress.anchor||''};
    const narrationRoute=typeof location!=='undefined'&&new URLSearchParams(location.hash.slice(1)).get('narration')==='1';viewFollowsNarration=narrationRoute;
    await openSection(requested || progress.section_id || book.first_section_id, requested ? 0 : progress.fraction, requested ? '' : progress.anchor);
    const route=typeof location!=='undefined'?new URLSearchParams(location.hash.slice(1)):null;if(route?.get('narration')==='1')await window.ReaderNarration.follow();
  } catch (error) { setStatus(error.message); }
})();

function finishPageAnimation(){
 if(!pageAnimation)return;
 const move=pageAnimation;pageAnimation=null;if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(move.frame);
 move.scroller.scrollLeft=move.target;scheduleSave();move.resolve();
}
function slidePage(scroller,target){
 if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||typeof performance==='undefined'){
  scroller.scrollLeft=target;scheduleSave();return;
 }
 const origin=scroller.scrollLeft,started=performance.now();
 clearTimeout(saveTimer);
 return new Promise(resolve=>{
  const move=pageAnimation={scroller,target,resolve,frame:null};
  const tick=now=>{
   if(pageAnimation!==move)return;
   const fraction=Math.min(1,Math.max(0,(now-started)/240));
   scroller.scrollLeft=origin+(target-origin)*(1-(1-fraction)**3);
   if(fraction<1)move.frame=requestAnimationFrame(tick);else finishPageAnimation();
  };
  move.frame=requestAnimationFrame(tick);
 });
}
function turnPage(direction) {
  if(loading||!ready||pageAnimation||pageDrag)return;
  suspendFollowing();
  if(preferences.mode!=='pages'){openSection(direction>0?section.next_id:section.previous_id);return;}
  const scroller=$('readingFrame').contentDocument.scrollingElement;
  if(pagination()){const w=$('readingFrame').contentDocument.documentElement.clientWidth,index=pagination().pageFor(scroller.scrollLeft,w,scroller.scrollWidth),count=pagination().pageCount(scroller.scrollWidth,w);if(direction>0&&index>=count-1)openSection(section.next_id);else if(direction<0&&index===0)openSection(section.previous_id,1);else{slidePage(scroller,Math.min(scroller.scrollWidth-w,Math.max(0,Math.min(count-1,index+direction))*w));}return;}
  const extent=Math.max(0,scroller.scrollHeight-scroller.clientHeight),step=scroller.clientHeight*.9;
  if(direction>0&&scroller.scrollTop>=extent-2)openSection(section.next_id);
  else if(direction<0&&scroller.scrollTop<=2)openSection(section.previous_id,1);
  else {scroller.scrollTop=Math.max(0,Math.min(extent,scroller.scrollTop+direction*step));scheduleSave();}
}
let chromeTimer,controlInteraction=false;
document.addEventListener('pointerdown',event=>{controlInteraction=!!event.target?.closest?.('button,input,select,summary');},{passive:true});
document.addEventListener('pointerup',()=>{controlInteraction=false;if(document.body.dataset.focus!=='true')scheduleChrome();},{passive:true});
document.addEventListener('pointercancel',()=>{controlInteraction=false;},{passive:true});
function scheduleChrome(){clearTimeout(chromeTimer);chromeTimer=setTimeout(()=>{if(!$('contentsPanel').hidden||!$('settingsPanel').hidden||controlInteraction||document.activeElement?.closest('input,select')||window.parent?.Player?.expanded?.()){scheduleChrome();return;}toggleChrome(true);},4500);}
function toggleChrome(hidden) {document.body.dataset.focus=String(hidden);$('revealChrome').hidden=!hidden;if(!hidden)scheduleChrome();else clearTimeout(chromeTimer);}
document.addEventListener('pointerdown',()=>{if(document.body.dataset.focus!=='true')scheduleChrome();},{passive:true});
document.addEventListener('focusout',scheduleChrome);scheduleChrome();
function refreshReturn(){
 const location=lastPlayback?.engaged===false?null:narration||window.parent?.Player?.narration?.();let away=false;
 if(location?.book_id===bookId){away=location.section_id!==section?.id;if(!away&&ready){const doc=$('readingFrame').contentDocument,mark=window.NarrationMarkup?.locate?.(doc,location,book.source_kind==='webnovel'?section.title:null);if(mark){const r=mark.getBoundingClientRect();away=r.right<=0||r.left>=doc.documentElement.clientWidth||r.bottom<=0||r.top>=doc.documentElement.clientHeight;}else away=false;}}
 $('returnNarration').hidden=!away;
}

function cancelPageDrag(){if(!pageDrag)return;pageDrag.scroller.scrollLeft=pageDrag.origin;pageDrag=null;recordRestore();}
function wireReadingGestures(doc) {
 const frame=$('readingFrame');
 doc.addEventListener('pointerdown',e=>{if(e.target===doc.documentElement)suspendFollowing();},{passive:true});
 doc.addEventListener('wheel',suspendFollowing,{passive:true});
 let start,lastGesture=0;
 function activateTap(x,target){
  if(target?.closest?.('a,input,button')||doc.getSelection?.()?.toString())return false;
  const w=$('readingFrame').clientWidth;
  if(preferences.mode==='pages'&&x<w*.2)turnPage(-1);
  else if(preferences.mode==='pages'&&x>w*.8)turnPage(1);
  else return false;
  return true;
 }
 const touchStart=e=>{if(e.touches.length!==1)cancelPageDrag();start=!loading&&ready&&!pageAnimation&&e.touches.length===1&&!e.target?.closest?.('a,input,button')&&!doc.getSelection?.()?.toString()?{x:e.touches[0].clientX,y:e.touches[0].clientY,at:Date.now(),axis:null}:null;};
 const touchCancel=()=>{start=null;cancelPageDrag();};
 const touchMove=e=>{
  if(!start)return;if(e.touches.length!==1){touchCancel();return;}
  const t=e.touches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;
  if(!start.axis){if(Math.abs(dy)>12&&Math.abs(dy)>Math.abs(dx)*1.5){start.axis='vertical';if(preferences.mode!=='pages')suspendFollowing();}else if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)*1.5&&preferences.mode==='pages'){
   start.axis='horizontal';suspendFollowing();clearTimeout(saveTimer);
   const s=doc.scrollingElement,w=doc.documentElement?.clientWidth;
   if(w&&pagination())pageDrag={scroller:s,origin:s.scrollLeft,index:pagination().pageFor(s.scrollLeft,w,s.scrollWidth),width:w};
  }}
  if(start.axis==='horizontal'&&pageDrag){const move=pageDrag;move.scroller.scrollLeft=Math.max(0,Math.min(move.scroller.scrollWidth-move.width,move.origin-Math.max(-move.width,Math.min(move.width,dx))));e.preventDefault?.();}
  if(start.axis==='vertical'&&preferences.mode==='pages'&&start.y>(doc.documentElement?.clientHeight||frame.clientHeight)*.55&&start.y<(doc.documentElement?.clientHeight||frame.clientHeight)-24)e.preventDefault?.();
 };
 const touchEnd=e=>{
  const origin=start;start=null;if(!origin||preferences.mode!=='pages'||e.touches?.length)return;
  const t=e.changedTouches[0],dx=t.clientX-origin.x,dy=t.clientY-origin.y;
  let handled=false;
  if(pageDrag){
   const move=pageDrag;pageDrag=null;const commit=Math.abs(dx)>=Math.max(55,move.width*.22),direction=dx<0?1:-1,count=pagination().pageCount(move.scroller.scrollWidth,move.width);
   const index=commit?Math.max(0,Math.min(count-1,move.index+direction)):move.index;
   slidePage(move.scroller,Math.min(move.scroller.scrollWidth-move.width,index*move.width));
   if(commit&&((direction>0&&move.index===count-1)||(direction<0&&move.index===0))){finishPageAnimation();openSection(direction>0?section.next_id:section.previous_id,direction<0?1:0);}
   handled=true;
  }else if(Math.abs(dy)>36&&Math.abs(dy)>Math.abs(dx)*1.5&&origin.y>(doc.documentElement?.clientHeight||frame.clientHeight)*.55&&origin.y<(doc.documentElement?.clientHeight||frame.clientHeight)-24){toggleChrome(dy>0);handled=true;}
  else if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*2&&!doc.getSelection?.()?.toString()){turnPage(dx<0?1:-1);handled=true;}
  else if(Math.abs(dx)<12&&Math.abs(dy)<12&&Date.now()-origin.at<500)handled=activateTap(t.clientX-(e.target===frame?frame.getBoundingClientRect().left:0),e.target);
  // WebKit may omit click after a touch. Handle taps here, and never turn twice
  // when another browser also emits the compatibility click.
  if(handled){lastGesture=Date.now();e.preventDefault?.();}
 };
 const click=e=>{if(Date.now()-lastGesture<500){e.preventDefault();e.stopImmediatePropagation();return;}activateTap(e.clientX-(e.target===frame?frame.getBoundingClientRect().left:0),e.target);};
 doc.addEventListener('touchstart',touchStart,{passive:true});
 doc.addEventListener('touchmove',touchMove,{passive:false});
 doc.addEventListener('touchcancel',touchCancel,{passive:true});
 doc.addEventListener('touchend',touchEnd,{passive:false});
 doc.addEventListener('click',click,true);
 // WebKit can hit-test whitespace in CSS columns to the iframe itself. Child
 // events do not bubble across documents. Replace these callbacks per chapter.
 frame.ontouchstart=touchStart;frame.ontouchcancel=touchCancel;
 frame.ontouchmove=touchMove;frame.ontouchend=touchEnd;frame.onclick=click;
}
$('dockContents').onclick=()=>setPanel('contents',true);
$('dockSettings').onclick=()=>setPanel('settings',true);
function readingPosition(){
 const anchor=passage||currentAnchor(),mapped=window.NarrationMarkup?.position($('readingFrame').contentDocument,anchor,book.source_kind==='webnovel'?section.title:null);
 return mapped?{...mapped,section_id:section.id,manual_revision:manualRevision}:null;
}
$('dockListen').onclick=async()=>{
 const player=window.parent?.Player;if(!player?.toggleReader)return;
 // OFF is synchronous even while an ON request is awaiting metadata.
 if(listeningInterface||headphoneBusy||lastPlayback?.book_id===bookId&&lastPlayback.intent){listeningInterface=false;miniDismissed=false;viewFollowsNarration=false;followingSuspended=true;activationFloor=null;manualRevision++;layoutRevision++;player.stopReader?.();window.ReaderNarration.clear();savePosition();$('readerMini').hidden=true;$('returnNarration').hidden=true;return;}
 if(!ready||loading||pageAnimation||pageDrag)return;
 headphoneBusy=true;listeningInterface=true;miniDismissed=false;
 try{const position=readingPosition();if(!position)throw new Error('This page has no readable narration position.');activationFloor=position;preferences.followAlong=true;followingSuspended=false;preferences.followAlongSuspended=false;notifyFollow();listeningStart=position;await player.toggleReader(bookId,position);}
 catch(error){listeningInterface=false;setStatus(error.message);}finally{headphoneBusy=false;}
};
$('hideChrome').onclick=()=>toggleChrome(true);$('revealChrome').onclick=()=>toggleChrome(false);
$('searchBook').onclick=()=>{contentsMode='search';contentsOffset=0;$('sectionSearch').hidden=false;$('sectionSearch').placeholder='Search chapter text (2+ characters)';loadContents();};
$('bookmarkToggle').onclick=async()=>{if(!ready)return;try{await api(endpoint+'/bookmarks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({section_id:section.id,fraction:scrollFraction(),anchor:currentAnchor()})});setStatus('Bookmark saved.');}catch(e){setStatus(e.message);}};
$('showBookmarks').onclick=async()=>{try{$('sectionList').dataset.virtualized='false';++contentsToken;const data=await api(endpoint+'/bookmarks');$('sectionList').replaceChildren();for(const b of data.items){const row=document.createElement('div'),button=document.createElement('button'),remove=document.createElement('button');button.textContent=b.title+' · '+Math.round(b.fraction*100)+'%';button.onclick=()=>{suspendFollowing();setPanel('contents',false);openSection(b.section_id,b.fraction,b.anchor||'');};remove.textContent='Remove bookmark';remove.onclick=async()=>{try{await api(endpoint+'/bookmarks',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.id})});row.remove();}catch(e){setStatus(e.message);}};row.append(button,remove);$('sectionList').append(row);}if(!data.items.length)$('sectionList').textContent='No bookmarks yet.';}catch(e){setStatus(e.message);}};

async function updateNarration(location,force=false){
 if(!location||location.book_id!==bookId||lastPlayback?.engaged===false)return;
 narration=location;
 refreshReturn();
 if(location.section_id!==section?.id){
  if((!audioPlaying&&!force)||!preferences.followAlong||followingSuspended||applyingNarration)return;
  const manual=manualRevision;viewFollowsNarration=true;applyingNarration=true;try{await openSection(location.section_id,location.fraction,'',()=>(audioPlaying||force)&&!followingSuspended&&manual===manualRevision&&narration===location);}finally{applyingNarration=false;}
 }
 if(!ready||section.id!==location.section_id||narration?.anchor!==location.anchor||!window.NarrationMarkup)return;
 if(narrationKey!==location.anchor||force){
  const doc=$('readingFrame').contentDocument,marked=window.NarrationMarkup.highlight(doc,location,book.source_kind==='webnovel'?section.title:null);const target=window.NarrationMarkup.locate?.(doc,location,book.source_kind==='webnovel'?section.title:null)||marked;narrationKey=location.anchor;
  const beforeStart=!force&&activationFloor&&location.section_id===activationFloor.section_id&&location.normalized_offset<activationFloor.normalized_offset;
  if(target&&(audioPlaying||force)&&preferences.followAlong&&!followingSuspended&&!beforeStart&&!pageAnimation&&!pageDrag){viewFollowsNarration=true;activationFloor=null;layoutRevision++;revealTarget(target);passage=currentAnchor();showLocation();}
 }
 refreshReturn();
}
$('followNarration').onclick=()=>{preferences.followAlong=!preferences.followAlong;followingSuspended=false;preferences.followAlongSuspended=false;applySettings(!preferences.followAlong);notifyFollow();savePosition();if(preferences.followAlong)updateNarration(narration||window.parent?.Player?.narration?.(),true);};
$('returnNarration').onclick=()=>{preferences.followAlong=true;followingSuspended=false;preferences.followAlongSuspended=false;$('returnNarration').hidden=true;$('followNarration').setAttribute('aria-pressed','true');notifyFollow();updateNarration(narration||window.parent?.Player?.narration?.(),true);};
function playbackChanged(state){
 lastPlayback=state;
 audioPlaying=!!state?.playing&&state.book_id===bookId;
 $('dockListen').dataset.playing=String(audioPlaying);$('dockListen').setAttribute('aria-pressed',String(audioPlaying));
 $('dockListen').setAttribute('aria-label',audioPlaying?'Pause narration':'Start or resume narration from this page');
 const active=state?.book_id===bookId&&state.engaged;
 if(active)listeningInterface=true;if(!state?.engaged&&state?.book_id===bookId)listeningInterface=false;
 if(active){document.body.dataset.audioEngaged='true';$('readerMini').hidden=!listeningInterface||miniDismissed;$('readerMiniBook').textContent=state.title||book?.title||'';$('readerMiniChapter').textContent=state.chapter_title||'';$('readerMiniCover').hidden=!state.cover_url;if(state.cover_url)$('readerMiniCover').src=state.cover_url;$('readerMiniPlay').textContent=state.intent?'Ⅱ':'▶';$('readerMiniPlay').setAttribute('aria-label',state.intent?'Pause narration':'Play narration');$('readerMiniProgress').value=state.progress||0;$('readerMiniState').textContent=state.state==='playing'?'':state.state;}
 else {$('readerMini').hidden=true;document.body.dataset.audioEngaged='false';window.ReaderNarration?.clear();}
 refreshReturn();
}
window.ReaderNarration={bookId,clear:()=>{narration=null;narrationKey='';window.NarrationMarkup?.clear?.($('readingFrame').contentDocument);$('returnNarration').hidden=true;},update:updateNarration,playback:playbackChanged,position:readingPosition,seek:()=>{activationFloor=null;narrationKey='';},follow:async()=>{
 if(!(narration||window.parent?.Player?.narration?.()))return;preferences.followAlong=true;followingSuspended=false;preferences.followAlongSuspended=false;notifyFollow();$('returnNarration').hidden=true;await updateNarration(narration||window.parent?.Player?.narration?.(),true);},page:()=>({ready:ready&&!loading,section_id:section?.id,document_section_id:$('readingFrame').contentDocument?.body?.dataset.sectionId,anchor:ready&&!loading?(passage||currentAnchor()):'',fraction:scrollFraction(),mode:preferences.mode,turning:!!pageAnimation,dragging:!!pageDrag,manual_revision:manualRevision})};
$('readerMiniOpen').onclick=()=>window.parent?.Player?.expand?.();
$('readerMiniCover').onclick=()=>window.parent?.Player?.expand?.();
$('readerMiniExpand').onclick=()=>window.parent?.Player?.expand?.();
$('readerMiniPlay').onclick=()=>window.parent?.Player?.togglePlayback?.();
$('readerMiniBack').onclick=()=>window.parent?.Player?.seek?.(-15);
$('readerMiniForward').onclick=()=>window.parent?.Player?.seek?.(15);
$('readerMiniClose').onclick=()=>{miniDismissed=true;$('readerMini').hidden=true;};
window.addEventListener('resize',relayout);if(typeof ResizeObserver!=='undefined')new ResizeObserver(relayout).observe($('readingFrame'));
window.visualViewport?.addEventListener('resize',relayout);
$('dockTheme').onclick=()=>{setPanel('settings',true);$('theme').focus();};
document.querySelectorAll?.('[data-reader-theme]').forEach(button=>button.onclick=()=>{$('theme').value=button.dataset.readerTheme;$('theme').dispatchEvent(new Event('change'));});



// Gestures that begin on the toolbar do not reach the content iframe.
let toolbarTouch=null;
document.addEventListener('touchstart',e=>{toolbarTouch=e.touches.length===1&&e.target?.closest?.('.reader-footer,.reader-audio-slot')&&!e.target?.closest?.('input,select')?{x:e.touches[0].clientX,y:e.touches[0].clientY}:null;},{passive:true});
document.addEventListener('touchmove',e=>{if(toolbarTouch&&e.touches.length===1&&Math.abs(e.touches[0].clientY-toolbarTouch.y)>16)e.preventDefault();},{passive:false});
document.addEventListener('touchend',e=>{const origin=toolbarTouch;toolbarTouch=null;if(!origin||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-origin.x,dy=e.changedTouches[0].clientY-origin.y;if(Math.abs(dy)>36&&Math.abs(dy)>Math.abs(dx)*1.5){toggleChrome(dy>0);e.preventDefault();}},{passive:false});
document.addEventListener('touchcancel',()=>{toolbarTouch=null;},{passive:true});
