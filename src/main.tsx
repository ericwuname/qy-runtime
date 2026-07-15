import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 🛡️ Global Interceptors for Sandboxed Preview HMR/Vite WebSocket Connection Errors
// Since HMR is disabled in this cloud container, the background websocket connection attempts are expected to fail.
// This interceptor silently filters out these benign errors so they do not trigger annoying UI error toasts or developer console overlays.
const isBenignViteWsError = (msg: string): boolean => {
  if (!msg) return false;
  const normalized = msg.toLowerCase();
  return (
    normalized.includes('websocket') ||
    normalized.includes('vite') ||
    normalized.includes('hmr') ||
    normalized.includes('web-socket')
  );
};

window.addEventListener('error', (event) => {
  const msg = event.message || '';
  if (isBenignViteWsError(msg)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg = reason instanceof Error ? reason.message : String(reason || '');
  if (isBenignViteWsError(msg)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

