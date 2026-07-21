import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App.js';
import { createWebAppComposition } from './app/createWebAppComposition.js';
import './styles.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found.');
}

const composition = createWebAppComposition();

createRoot(rootElement).render(
  <StrictMode>
    <App apiClient={composition.apiClient} />
  </StrictMode>,
);
