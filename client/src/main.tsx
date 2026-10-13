import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './auth';
import { ToastProvider } from './components';
import App from './App';
import { registerServiceWorker } from './InstallPage';
import './styles.css';
import './operations.css';
import './academic.css';
import './zabsync.css';
import './weekly-timetable.css';
import './chat-reminders.css';
import './help.css';
import './student-tools.css';
import './drive.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

registerServiceWorker();
