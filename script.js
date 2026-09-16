const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => entry.isIntersecting && entry.target.classList.add('visible'));
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach(element => observer.observe(element));

const frame = document.querySelector('#visualizer');
const fullScreenLink = document.querySelector('.browser-bar a');
const gallery = {
  real: [
    { name: 'Box', label: 'Real capture · Box', url: 'visualizer/index.html?id=scene30&build=20260916d' },
    { name: 'Oven', label: 'Real capture · Oven', url: 'visualizer/index.html?id=scene32&build=20260916d' },
  ],
  partnet: [
    { name: 'Oven 102018', label: 'PartNet · Oven 102018', url: 'visualizer/partnet.html?id=102018&build=20260916d' },
    { name: 'Refrigerator 10620', label: 'PartNet · Refrigerator 10620', url: 'visualizer/partnet.html?id=10620&build=20260916d' },
  ],
  lightwheel: [
    { name: 'Microwave 053', label: 'LightWheel · Microwave 053', url: 'visualizer/lightwheel/microwave053.html' },
    { name: 'Refrigerator 038', label: 'LightWheel · Refrigerator 038', url: 'visualizer/lightwheel/refrigerator038.html' },
  ],
};
const objectTabs = document.querySelector('.object-tabs');
function loadGalleryItem(item) {
  frame.src = item.url;
  fullScreenLink.href = item.url;
  document.querySelector('.browser-bar span').textContent = `Track2Art / ${item.label}`;
}
function selectDataset(dataset) {
  document.querySelectorAll('.dataset-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.dataset === dataset));
  objectTabs.replaceChildren(...gallery[dataset].map((item, index) => {
    const button = document.createElement('button');
    button.className = `object-tab${index ? '' : ' active'}`;
    button.textContent = item.name;
    button.onclick = () => {
      objectTabs.querySelectorAll('.object-tab').forEach(tab => tab.classList.remove('active'));
      button.classList.add('active');
      loadGalleryItem(item);
    };
    return button;
  }));
  loadGalleryItem(gallery[dataset][0]);
}
document.querySelectorAll('.dataset-tab').forEach(button => button.onclick = () => selectDataset(button.dataset.dataset));
selectDataset('real');

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
