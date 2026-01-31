import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// For the desktop app, we'll embed the same React app
// This is a placeholder - in production, you'd import the shared components
function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Open Yojob Desktop</h1>
        <p className="text-gray-600">POS Solutions System</p>
        <p className="text-sm text-gray-400 mt-4">Loading...</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
