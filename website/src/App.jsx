import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

import { Layout } from './components/Layout.jsx';
import { ScrollToHash } from './components/ScrollToHash.jsx';

// The landing is the deployed homepage and is the heaviest module (POS mock +
// AI section), so every route is code-split. Secondary pages only ship their
// own chunk when visited.
const Landing = lazy(() => import('./pages/Landing.jsx'));
const Sobre = lazy(() => import('./pages/Sobre.jsx'));
const Docs = lazy(() => import('./pages/Docs.jsx'));
const Roadmap = lazy(() => import('./pages/Roadmap.jsx'));
const Contacto = lazy(() => import('./pages/Contacto.jsx'));
const Atajos = lazy(() => import('./pages/Atajos.jsx'));
const Migracion = lazy(() => import('./pages/Migracion.jsx'));
const Estado = lazy(() => import('./pages/Estado.jsx'));

export default function App() {
  return (
    <>
      <ScrollToHash />
      <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/sobre" element={<Sobre />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/contacto" element={<Contacto />} />
            <Route path="/atajos" element={<Atajos />} />
            <Route path="/migracion" element={<Migracion />} />
            <Route path="/estado" element={<Estado />} />
            {/* Unknown paths fall back to the landing (GitHub Pages 404.html
                re-enters here so the router can resolve deep links). */}
            <Route path="*" element={<Landing />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
