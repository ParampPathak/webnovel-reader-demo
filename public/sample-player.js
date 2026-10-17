/* Licensed, fixed bundled recording only. Imported EPUB text is never transmitted. */
(() => {
  const audio = document.createElement("audio");
  audio.id = "sampleAudio";
  audio.preload = "none";
  document.body.append(audio);
  const dialog = document.createElement("dialog");
  dialog.className = "browser-audio";
  dialog.id = "samplePlayer";
  dialog.setAttribute("aria-labelledby", "audioHeading");
  dialog.innerHTML =
    '<div class="panel-heading"><h2 id="audioHeading">Read Aloud · sample</h2><button id="closeAudio" aria-label="Close audio controls">×</button></div><p id="sampleNotice">Kokoro Michael · original opening excerpt only. Your EPUBs have no server TTS in Browser Reader Mode.</p><div class="transport"><button id="audioBack" aria-label="Back 15 seconds">−15</button><button id="audioPlay">Play sample</button><button id="audioForward" aria-label="Forward 15 seconds">+15</button></div><label>Playback position<input id="audioSeek" type="range" min="0" max="1000" value="0"></label><output id="audioTime" role="status">0:00 / —</output><label>Playback speed<select id="audioSpeed"><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><label>Sleep timer<select id="audioSleep"><option value="0">Off</option><option value="5">5 minutes</option><option value="15">15 minutes</option></select></label><button id="openRecordedExcerpt">Open recorded excerpt</button><button id="audioStop">Stop listening</button><small id="audioMessage" role="status"></small>';
  document.body.append(dialog);
  const $ = (id) => document.getElementById(id),
    bookId =
      new URLSearchParams(location.hash.slice(1)).get("book") || "signal";
  let engaged = false,
    starting = false,
    completed = false,
    prepared = null,
    blob = true,
    generation = 0,
    sleep,
    rate = 1,
    restored = false,
    lastSave = 0;
  const format = (t) =>
    Number.isFinite(t)
      ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`
      : "—";
  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  function sync() {
    const playing = !audio.paused && !audio.ended;
    window.ReaderNarration?.playback({
      book_id: bookId,
      playing,
      engaged,
      intent: playing,
      title: BrowserSample.title,
      chapter_title: "Original opening excerpt · Kokoro Michael",
      cover_url: "/assets/signal.svg",
      progress: Number.isFinite(audio.duration)
        ? (audio.currentTime / audio.duration) * 1000
        : 0,
      state: starting ? "Loading recording…" : playing ? "playing" : "Paused",
    });
    $("audioPlay").textContent = playing ? "Pause sample" : "Play sample";
    $("audioTime").textContent =
      `${format(audio.currentTime)} / ${format(audio.duration)}`;
    $("audioSeek").value = Number.isFinite(audio.duration)
      ? (audio.currentTime / audio.duration) * 1000
      : 0;
  }
  const locationInfo = () => ({
    book_id: "signal",
    section_id: 1,
    quote: BrowserSample.excerpt,
    anchor: "sample-excerpt",
    normalized_offset: 0,
    fraction: 0,
  });
  async function prepare() {
    if (!prepared)
      prepared = fetch("/assets/signal-room.mp3", { credentials: "omit" })
        .then((r) => {
          if (!r.ok) throw Error("Bundled sample is unavailable.");
          return r.arrayBuffer();
        })
        .then((b) => {
          audio.src = URL.createObjectURL(
            new Blob([b], { type: "audio/mpeg" }),
          );
        })
        .catch((e) => {
          prepared = null;
          throw e;
        });
    return prepared;
  }
  async function play() {
    if (
      bookId !== "signal" ||
      window.ReaderNarration?.page().section_id !== 1
    ) {
      $("audioMessage").textContent =
        "Only the included sample’s opening excerpt is recorded. Imported books stay local and have no server narration.";
      open();
      throw Error(
        "Open the included recorded excerpt to hear sample narration.",
      );
    }
    const request = ++generation;
    engaged = true;
    starting = true;
    $("audioMessage").textContent = "Loading bundled neural narration…";
    sync();
    try {
      await prepare();
      if (request !== generation) return;
      if (completed || audio.ended) {
        completed = false;
        audio.load();
      }
      try {
        await audio.play();
      } catch (e) {
        if (!blob || audio.error?.code !== 4) throw e;
        blob = false;
        audio.src = "/assets/signal-room.mp3";
        await audio.play();
      }
      if (request !== generation) {
        audio.pause();
        return;
      }
      $("audioMessage").textContent = "";
      window.ReaderNarration?.update(locationInfo(), true);
    } catch (e) {
      if (request === generation) {
        engaged = false;
        $("audioMessage").textContent =
          "Sample could not play. Try Play again; reading is still available.";
        open();
      }
      throw e;
    } finally {
      if (request === generation) {
        starting = false;
        sync();
      }
    }
  }
  function stop() {
    ++generation;
    starting = false;
    engaged = false;
    audio.pause();
    sync();
  }
  async function toggle() {
    if (audio.paused) await play();
    else {
      audio.pause();
      sync();
    }
  }
  window.Player = {
    toggleReader: play,
    stopReader: stop,
    expand: open,
    expanded: () => dialog.open,
    togglePlayback: () => toggle().catch(() => {}),
    seek: (seconds) => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = Math.max(
          0,
          Math.min(audio.duration, audio.currentTime + seconds),
        );
        if (audio.currentTime < audio.duration - 0.12) completed = false;
        sync();
      }
    },
    setFollow: () => {},
    narration: () => (engaged ? locationInfo() : null),
    theme: () => {},
  };
  for (const e of ["playing", "pause", "ended"])
    audio.addEventListener(e, () => {
      if (e === "ended") {
        completed = true;
        engaged = false;
      }
      sync();
    });
  audio.addEventListener("loadedmetadata", () => {
    audio.playbackRate = rate;
    if (!restored) {
      restored = true;
      let saved;
      try {
        saved = JSON.parse(
          localStorage.getItem("browser-sample-audio") || "{}",
        );
      } catch {
        saved = {};
      }
      audio.currentTime = Math.max(
        0,
        Math.min(Number(saved.time) || 0, audio.duration - 0.1),
      );
    }
    sync();
  });
  audio.addEventListener("timeupdate", () => {
    sync();
    if (Date.now() - lastSave > 800) {
      save();
      lastSave = Date.now();
    }
  });
  function save() {
    try {
      localStorage.setItem(
        "browser-sample-audio",
        JSON.stringify({
          time: completed ? 0 : audio.currentTime,
          speed: rate,
        }),
      );
    } catch {
      $("audioMessage").textContent =
        "Listening position could not be stored. Browser storage may be unavailable.";
    }
  }
  try {
    const s = JSON.parse(localStorage.getItem("browser-sample-audio") || "{}");
    if ([1, 1.5, 2].includes(s.speed)) rate = s.speed;
  } catch {}
  $("audioSpeed").value = String(rate);
  $("audioPlay").onclick = () => toggle().catch(() => {});
  $("audioBack").onclick = () => Player.seek(-15);
  $("audioForward").onclick = () => Player.seek(15);
  $("audioSeek").oninput = () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = (audio.duration * +$("audioSeek").value) / 1000;
      completed = false;
    }
  };
  $("audioSpeed").onchange = () => {
    rate = +$("audioSpeed").value;
    audio.playbackRate = rate;
    save();
  };
  $("closeAudio").onclick = () => dialog.close();
  $("audioStop").onclick = () => {
    stop();
    dialog.close();
  };
  $("audioSleep").onchange = () => {
    clearTimeout(sleep);
    if (+$("audioSleep").value)
      sleep = setTimeout(stop, +$("audioSleep").value * 60000);
  };
  $("openRecordedExcerpt").onclick = () =>
    (location.href = "/reader.html#book=signal&section=1");
  window.addEventListener("pagehide", (event) => {
    save();
    audio.pause();
    if (!event.persisted && audio.src.startsWith("blob:"))
      URL.revokeObjectURL(audio.src);
  });
})();
