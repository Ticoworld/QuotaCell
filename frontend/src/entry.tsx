import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';

const root = document.getElementById('root')!;
if ((location.pathname === '/' && !location.search) || location.pathname === '/overview') {
  createRoot(root).render(<Landing/>);
} else {
  document.title = 'QuotaCell Wallet';
  const message = document.getElementById('startup-message')!;
  const retry = document.getElementById('startup-retry') as HTMLButtonElement;
  message.textContent = 'Opening your wallet…';
  void import('./main').catch(() => {
    message.textContent = 'The wallet could not load.';
    root.querySelector('.startup-loading')?.classList.add('startup-failed');
    retry.hidden = false;
    retry.onclick = () => location.reload();
  });
}
