const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => entry.isIntersecting && entry.target.classList.add('visible'));
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

const frame = document.querySelector('#visualizer');
const fullScreenLink = document.querySelector('.browser-bar a');
document.querySelectorAll('.dataset-tab').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.dataset-tab').forEach(tab => tab.classList.remove('active'));
    button.classList.add('active');
    const url = `visualizer/index.html?id=${encodeURIComponent(button.dataset.scene)}`;
    frame.src = url;
    fullScreenLink.href = url;
  });
});

document.querySelector('#copy-citation').addEventListener('click', async event => {
  const button = event.currentTarget;
  try {
    await navigator.clipboard.writeText(document.querySelector('#bibtex').textContent);
    button.textContent = 'Copied';
    setTimeout(() => button.textContent = 'Copy BibTeX', 1600);
  } catch {
    button.textContent = 'Select text to copy';
  }
});
