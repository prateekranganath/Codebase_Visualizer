import Dashboard from './pages/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/notifications/ToastContainer';

export default function App() {
  return (
    <ToastProvider>
      <ErrorBoundary>
        <Dashboard />
        <ToastContainer />
      </ErrorBoundary>
    </ToastProvider>
  );
}
