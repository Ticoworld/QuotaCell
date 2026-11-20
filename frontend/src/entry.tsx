import { createRoot } from 'react-dom/client';
import { Landing } from './Landing';

const root = document.getElementById('root')!;
if (location.pathname === '/' && !location.search) {
  createRoot(root).render(<Landing/>);
} else {
  document.title = 'QuotaCell Wallet';
  root.textContent = 'Loading QuotaCell wallet…';
  void import('./main').catch(() => {
    root.textContent = 'The wallet could not load. Refresh the page to try again.';
    root.setAttribute('role', 'alert');
  });
}
