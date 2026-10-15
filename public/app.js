import { books, excerpt } from "./data.js";
const $ = (id) => document.getElementById(id);
const key = "reader-demo-v1";
let state = {
  theme: "black",
  font: 21,
  spacing: 1.85,
  speed: 1,
  positions: {},
  audio: 0,
};
try {
  const stored = JSON.parse(localStorage.getItem(key) || "null");
  if (stored && typeof stored === "object")
    state = { ...state, ...stored, positions: stored.positions || {} };
} catch {}
if (!["black", "gray", "light"].includes(state.theme)) state.theme = "black";
state.font = Math.max(16, Math.min(30, Number(state.font) || 21));
state.spacing = [1.6, 1.85, 2].includes(+state.spacing) ? +state.spacing : 1.85;
state.speed = [1, 1.5, 2].includes(+state.speed) ? +state.speed : 1;
const audio = $("audio");
let current = null,
  chapter = 0,
  page = 0,
  pages = 1,
  words = [],
  wanted = false;
let audioRestored = false,
  resetting = false;
const save = () => {
  if (resetting) return;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    notify(
      "Storage is unavailable. Your session still works, but progress cannot persist.",
    );
  }
};
function notify(message) {
  $("notice").textContent = message;
}
function el(tag, text, attributes = {}) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  for (const [k, v] of Object.entries(attributes)) e.setAttribute(k, v);
  return e;
}
function showDialog(id) {
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
}
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => button.closest("dialog").close();
function applyAppearance() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty("--font", state.font + "px");
  document.documentElement.style.setProperty("--spacing", state.spacing);
  $("theme").value = state.theme;
  $("font").value = state.font;
  $("font-value").textContent = state.font + " px";
  $("spacing").value = state.spacing;
  $("speed").value = state.speed;
  audio.playbackRate = state.speed;
}
function renderLibrary() {
  $("books").replaceChildren(
    ...books.map((book) => {
      const card = el("article", undefined, { class: "book-card" });
      const img = el("img", undefined, {
        src: "/assets/" + book.cover,
        alt: `Original cover of ${book.title}`,
        width: 140,
        height: 210,
      });
      const body = el("div");
      body.append(
        el("p", book.genre, { class: "genre" }),
        el("h3", book.title),
        el("p", book.author + " · Original demo fiction"),
        el("p", book.description),
      );
      const pos = state.positions[book.id];
      body.append(
        el(
          "span",
          pos
            ? `Chapter ${pos.chapter + 1} of ${book.chapters.length} · Page ${(pos.page || 0) + 1}`
            : "Not started",
          { class: "book-progress" },
        ),
      );
      const open = el("button", pos ? "Continue reading" : "Open book", {
        "aria-label": `Open ${book.title}`,
      });
      open.onclick = () => openBook(book.id);
      body.append(open);
      card.append(img, body);
      return card;
    }),
  );
}
function firstWord() {
  const box = $("reading-area").getBoundingClientRect();
  return words.findIndex((w) => {
    const r = w.getBoundingClientRect();
    return (
      r.left >= box.left + 20 &&
      r.left < box.right - 20 &&
      r.top < box.bottom &&
      r.bottom > box.top
    );
  });
}
function storePosition() {
  if (!current) return;
  state.positions[current.id] = {
    chapter,
    anchor: Math.max(0, firstWord()),
    page,
  };
  save();
}
function turnPage(next) {
  const bounded = Math.max(0, Math.min(pages - 1, next));
  page = bounded;
  $("passage").style.transform =
    `translateX(${-page * $("reading-area").clientWidth}px)`;
  $("page-status").textContent =
    `Chapter ${chapter + 1}/${current.chapters.length} · Page ${page + 1}/${pages}`;
  $("previous").disabled = page === 0 && chapter === 0;
  $("next").disabled =
    page === pages - 1 && chapter === current.chapters.length - 1;
  storePosition();
}
function reflow(anchor = 0) {
  if (!current || $("reader").hidden) return;
  const area = $("reading-area"),
    article = $("passage");
  article.style.transform = "none";
  article.style.columnWidth = Math.max(1, area.clientWidth - 48) + "px";
  pages = Math.max(1, Math.ceil(article.scrollWidth / area.clientWidth));
  const target = words[Math.min(words.length - 1, Math.max(0, anchor))];
  const x = target
    ? target.getBoundingClientRect().left - area.getBoundingClientRect().left
    : 0;
  turnPage(Math.floor(Math.max(0, x) / area.clientWidth));
}
function renderChapter(anchor = 0) {
  const section = current.chapters[chapter],
    article = $("passage");
  words = [];
  article.replaceChildren(el("h2", section.title));
  section.paragraphs.forEach((paragraph, index) => {
    const p = el("p");
    if (index === 0 && current.id === "signal" && chapter === 0)
      p.dataset.excerpt = "true";
    paragraph.split(/\s+/).forEach((word, i) => {
      if (i) p.append(" ");
      const span = el("span", word);
      words.push(span);
      p.append(span);
    });
    article.append(p);
  });
  $("reader-title").textContent = current.title;
  $("chapter-title").textContent = section.title;
  $("contents-book").textContent = current.title;
  $("chapter-list").replaceChildren(
    ...current.chapters.map((item, index) => {
      const button = el("button", `${index + 1}. ${item.title}`);
      if (index === chapter) button.setAttribute("aria-current", "true");
      button.onclick = () => {
        storePosition();
        chapter = index;
        renderChapter();
        $("contents").close();
      };
      return button;
    }),
  );
  reflow(anchor);
  syncAudio();
}
function openBook(id, selectedChapter) {
  storePosition();
  stopListening();
  current = books.find((b) => b.id === id) || books[0];
  const pos = state.positions[current.id];
  chapter =
    selectedChapter ??
    Math.max(
      0,
      Math.min(current.chapters.length - 1, Number(pos?.chapter) || 0),
    );
  $("library").hidden = true;
  $("reader").hidden = false;
  document.body.classList.add("reading");
  renderChapter(selectedChapter === undefined ? Number(pos?.anchor) || 0 : 0);
  $("reading-area").focus();
}
function move(direction) {
  if (
    direction > 0 &&
    page === pages - 1 &&
    chapter < current.chapters.length - 1
  ) {
    chapter++;
    renderChapter();
  } else if (direction < 0 && page === 0 && chapter > 0) {
    chapter--;
    renderChapter();
    turnPage(pages - 1);
  } else turnPage(page + direction);
}
function syncAudio() {
  const playing = !audio.paused && !audio.ended;
  $("listen").setAttribute("aria-pressed", String(playing));
  $("mini").hidden = !wanted;
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause sample" : "Play sample",
  );
  $("expanded-play").textContent = playing ? "Pause sample" : "Play sample";
  document
    .querySelectorAll("[data-excerpt]")
    .forEach((p) => p.classList.toggle("recorded", wanted));
  $("audio-excerpt").classList.toggle("active", playing);
}
function stopListening() {
  wanted = false;
  audio.pause();
  syncAudio();
}
async function playSample() {
  wanted = true;
  try {
    if (audio.ended) audio.currentTime = 0;
    await audio.play();
    if (!wanted) audio.pause();
    else $("notice").textContent = "";
  } catch {
    wanted = false;
    notify("Sample audio could not play. Please try Play again.");
  }
  syncAudio();
}
function togglePlay() {
  if (!audio.paused) {
    audio.pause();
    syncAudio();
  } else playSample();
}
function format(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
audio.addEventListener("loadedmetadata", () => {
  if (!audioRestored) {
    audioRestored = true;
    audio.currentTime = Math.max(
      0,
      Math.min(Number(state.audio) || 0, audio.duration - 0.1),
    );
  }
  syncAudio();
});
for (const event of ["playing", "pause", "ended"])
  audio.addEventListener(event, () => {
    if (event === "ended") wanted = false;
    syncAudio();
  });
audio.addEventListener("error", () => {
  if (wanted) {
    stopListening();
    notify("The bundled recording is unavailable. Reading remains available.");
  }
});
audio.addEventListener("timeupdate", () => {
  state.audio = audio.currentTime;
  save();
  $("seek").value = Number.isFinite(audio.duration)
    ? (100 * audio.currentTime) / audio.duration
    : 0;
  $("audio-time").textContent =
    `${format(audio.currentTime)} / ${format(audio.duration)}`;
});
$("library-back").onclick = () => {
  storePosition();
  stopListening();
  current = null;
  $("reader").hidden = true;
  $("library").hidden = false;
  document.body.classList.remove("reading");
  renderLibrary();
  $("library-heading").scrollIntoView();
};
$("previous").onclick = () => move(-1);
$("next").onclick = () => move(1);
$("appearance-open").onclick = () => showDialog("appearance");
$("contents-open").onclick = () => showDialog("contents");
function changeAppearance() {
  const anchor = Math.max(0, firstWord());
  applyAppearance();
  reflow(anchor);
  save();
}
$("theme").onchange = () => {
  state.theme = $("theme").value;
  changeAppearance();
};
$("font").oninput = () => {
  state.font = +$("font").value;
  changeAppearance();
};
$("spacing").onchange = () => {
  state.spacing = +$("spacing").value;
  changeAppearance();
};
$("theme-cycle").onclick = () => {
  const themes = ["black", "gray", "light"];
  state.theme = themes[(themes.indexOf(state.theme) + 1) % 3];
  changeAppearance();
};
$("listen").onclick = () => {
  if (wanted) stopListening();
  else playSample();
};
$("play").onclick = togglePlay;
$("expanded-play").onclick = togglePlay;
$("stop").onclick = stopListening;
$("mini-title").onclick = $("audio-open").onclick = () =>
  showDialog("audio-dialog");
$("rewind").onclick = () => {
  audio.currentTime = Math.max(0, audio.currentTime - 15);
};
$("forward").onclick = () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 15);
};
$("seek").oninput = () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = (audio.duration * +$("seek").value) / 100;
};
$("speed").onchange = () => {
  state.speed = +$("speed").value;
  audio.playbackRate = state.speed;
  save();
};
$("audio-excerpt").textContent = excerpt;
let gesture = null;
const area = $("reading-area");
area.addEventListener(
  "touchstart",
  (e) => {
    gesture =
      e.touches.length === 1
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : null;
  },
  { passive: true },
);
area.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length !== 1) gesture = null;
  },
  { passive: true },
);
area.addEventListener("touchcancel", () => (gesture = null), { passive: true });
area.addEventListener(
  "touchend",
  (e) => {
    const start = gesture;
    gesture = null;
    if (!start || e.touches.length || !e.changedTouches[0]) return;
    const point = e.changedTouches[0],
      dx = point.clientX - start.x,
      dy = point.clientY - start.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.preventDefault();
      move(dx < 0 ? 1 : -1);
    }
  },
  { passive: false },
);
area.addEventListener("click", (e) => {
  if (window.getSelection()?.toString()) return;
  const box = area.getBoundingClientRect(),
    x = e.clientX - box.left;
  if (x < box.width * 0.23) move(-1);
  else if (x > box.width * 0.77) move(1);
});
document.addEventListener("keydown", (e) => {
  if (
    !current ||
    document.querySelector("dialog[open]") ||
    /INPUT|SELECT|BUTTON/.test(e.target.tagName)
  )
    return;
  if (e.key === "ArrowRight") {
    e.preventDefault();
    move(1);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    move(-1);
  }
});
let resizeTimer;
window.addEventListener("resize", () => {
  const anchor = state.positions[current?.id]?.anchor || 0;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => reflow(anchor), 80);
});
$("import-open").onclick = () => showDialog("importer");
$("discover").onclick = () => {
  $("discovery-status").textContent =
    "Sample catalog loaded · 3 chapters available. No network request was made.";
  $("import-chapters").hidden = false;
  $("import-selected").hidden = false;
  $("import-chapters").replaceChildren(
    ...books[0].chapters.map((item, index) => {
      const label = el("label");
      const input = el("input", undefined, {
        type: "radio",
        name: "sample-chapter",
        value: index,
      });
      input.checked = index === 0;
      label.append(input, `${index + 1}. ${item.title}`);
      return label;
    }),
  );
};
$("import-selected").onclick = () => {
  const index = Number(
    document.querySelector("[name=sample-chapter]:checked")?.value || 0,
  );
  $("importer").close();
  openBook("signal", index);
};
$("reset-open").onclick = () => showDialog("reset");
$("reset-confirm").onclick = () => {
  resetting = true;
  stopListening();
  try {
    localStorage.removeItem(key);
  } catch {}
  location.reload();
};
window.addEventListener("pagehide", () => {
  storePosition();
  save();
});
applyAppearance();
renderLibrary();
