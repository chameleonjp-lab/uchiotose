import './style.css';

const app = document.querySelector<HTMLElement>('#app');
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="game-mode"]')) {
  radio.addEventListener('change', () => {
    if (app && radio.checked) app.dataset.mode = radio.value;
  });
}
