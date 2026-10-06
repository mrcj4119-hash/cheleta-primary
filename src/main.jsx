import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.error('SW registration failed', error));
  });
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(
      registrations
        .filter((registration) => [registration.active, registration.waiting, registration.installing]
          .some((worker) => worker?.scriptURL.endsWith('/sw.js')))
        .map((registration) => registration.unregister())
    ))
    .then(() => caches.keys())
    .then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('cheleta-primary-cache-')).map((key) => caches.delete(key))
    ))
    .catch((error) => console.error('Development service worker cleanup failed', error));
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
