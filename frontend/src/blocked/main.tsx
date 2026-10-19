import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '../styles/tokens.css';
import '../styles/blocked.css';
import { Blocked } from './Blocked';

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <Blocked />
  </React.StrictMode>,
);
