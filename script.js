const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(
      (entry) => entry.isIntersecting && entry.target.classList.add("visible"),
    );
  },
  { threshold: 0.08 },
);
document
  .querySelectorAll(".reveal")
  .forEach((element) => observer.observe(element));

const heroVideo = document.querySelector(".hero-video");
function playHeroVideo() {
  heroVideo.muted = true;
  heroVideo.loop = true;
  const playback = heroVideo.play();
  if (playback) playback.catch(() => {});
}
heroVideo.addEventListener("loadeddata", playHeroVideo);
heroVideo.addEventListener("canplay", playHeroVideo, { once: true });
heroVideo.addEventListener("ended", () => {
  heroVideo.currentTime = 0;
  playHeroVideo();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) playHeroVideo();
});
playHeroVideo();

document
  .querySelector("#copy-citation")
  .addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(
        document.querySelector("#bibtex").textContent,
      );
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy BibTeX"), 1600);
    } catch {
      button.textContent = "Select text to copy";
    }
  });
