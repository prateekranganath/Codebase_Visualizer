import { useState } from 'react';
import Dashboard from './pages/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './context/ToastContext';
import { ToastContainer } from './components/notifications/ToastContainer';
import CodeGraph from './components/graph/CodeGraph';
import { samplePayload } from './data/samplePayload';

export default function App() {
  const [showDemo, setShowDemo] = useState(false);

  return (
    <ToastProvider>
      <ErrorBoundary>
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <button 
            onClick={() => setShowDemo(!showDemo)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg font-medium transition-colors"
          >
            {showDemo ? "View Full Dashboard" : "View Graph Demo"}
          </button>
        </div>
        
        {showDemo ? (
          <div className="w-screen h-screen">
            <CodeGraph payload={samplePayload} />
          </div>
        ) : (
          <Dashboard />
        )}
        <ToastContainer />
      </ErrorBoundary>
    </ToastProvider>
  );
}
