/* Local storage affordances; never reports book metadata to a network service. */
(() => {
  const $ = (id) => document.getElementById(id);
  const notice = document.querySelector(".browser-mode");
  if (notice) {
    const size = () =>
      document.documentElement.style.setProperty(
        "--browser-notice-height",
        notice.getBoundingClientRect().height + "px",
      );
    size();
    new ResizeObserver(size).observe(notice);
  }
  async function status() {
    if (!$("storageStatus")) return;
    try {
      await BrowserLibrary.initialize();
      const e = await navigator.storage?.estimate?.();
      $("storageStatus").textContent = e
        ? `${Math.round(e.usage / 1048576)} MiB used on this origin. EPUB limit: 20 MiB per file, 100 MiB local-library safety budget.`
        : "Local library uses IndexedDB. Storage limits are controlled by your browser.";
    } catch (e) {
      $("storageStatus").textContent = e.message;
    }
  }
  if ($("persistStorage"))
    $("persistStorage").onclick = async () => {
      try {
        const granted = await navigator.storage?.persist?.();
        $("storageStatus").textContent = granted
          ? "Persistent storage was granted. Still keep an external backup."
          : "This browser did not grant persistence. Keep original EPUBs and export backups.";
      } catch {
        $("storageStatus").textContent =
          "Persistence is unavailable. Keep an external backup.";
      }
    };
  if ($("restoreBackup"))
    $("restoreBackup").onchange = async (event) => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        await BrowserLibrary.restoreBackup(file);
        location.reload();
      } catch (e) {
        $("storageStatus").textContent = "Backup not restored: " + e.message;
      }
    };
  status();
})();
