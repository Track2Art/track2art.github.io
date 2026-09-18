(() => {
  "use strict";

  const frameUrls = (base, count) =>
    Array.from(
      { length: count },
      (_, frame) => `${base}/rgb-${String(frame).padStart(3, "0")}.webp`,
    );
  const assets = [
    "assets/real/scene30/scene.js?v=7",
    "assets/real/scene30/prediction.js?v=7",
    "assets/real/scene32-mv/scene.js?v=7",
    "assets/real/scene32-mv/prediction.js?v=7",
    "assets/partnet-rgbd/102018/data.js?v=4",
    "assets/partnet-rgbd/10620/data.js?v=4",
    ...frameUrls("assets/real/scene30", 72),
    ...frameUrls("assets/real/scene32-mv", 66),
    ...frameUrls("assets/partnet-rgbd/102018", 72),
    ...frameUrls("assets/partnet-rgbd/10620", 72),
  ];

  async function preload() {
    let cursor = 0;
    const worker = async () => {
      while (cursor < assets.length) {
        const url = assets[cursor++];
        try {
          await fetch(url, { cache: "force-cache" });
        } catch {
          // A missing optional frame must not interrupt the remaining preload.
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
  }

  const schedule = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(preload, { timeout: 1500 });
    } else {
      setTimeout(preload, 500);
    }
  };
  if (document.readyState === "complete") schedule();
  else addEventListener("load", schedule, { once: true });
})();
