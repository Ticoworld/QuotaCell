import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';

const root = document.getElementById('root')!;
if ((location.pathname === '/' && !location.search) || location.pathname === '/overview') {
  createRoot(root).render(<Landing/>);
} else {
  document.title = 'QuotaCell App';
  const message = document.getElementById('startup-message')!;
  const retry = document.getElementById('startup-retry') as HTMLButtonElement;
  message.textContent = 'Opening QuotaCell…';
  void import('./main').catch(() => {
    message.textContent = 'QuotaCell could not load.';
    root.querySelector('.startup-loading')?.classList.add('startup-failed');
    retry.hidden = false;
    retry.onclick = () => location.reload();
  });
}
