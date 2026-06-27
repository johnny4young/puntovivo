import { Routes, Route } from 'react-router-dom';

import { Layout } from './components/Layout.jsx';
import { ScrollToHash } from './components/ScrollToHash.jsx';

// Routes are imported EAGERLY (not via React.lazy). This is required for the
// SSG prerender: renderToString() does not support Suspense, so a lazy route
// would emit only the <Suspense> fallback (empty markup) on the server, which
// defeats the whole point of static pre-rendering. Eager imports render
// synchronously on the server and hydrate cleanly on the client.
//
// The previous build code-split each page into its own chunk; for a small
// marketing brochure whose HTML is now prerendered (instant first paint), a
// single hydration bundle is an acceptable — arguably better — trade than the
// per-route round-trips, and it is what makes correct SSG possible here.
import Landing from './pages/Landing.jsx';
import Sobre from './pages/Sobre.jsx';
import Docs from './pages/Docs.jsx';
import Roadmap from './pages/Roadmap.jsx';
import Contacto from './pages/Contacto.jsx';
import Atajos from './pages/Atajos.jsx';
import Migracion from './pages/Migracion.jsx';

export default function App() {
  return (
    <>
      <ScrollToHash />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Landing />} />
          <Route path="/sobre" element={<Sobre />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/roadmap" element={<Roadmap />} />
          <Route path="/contacto" element={<Contacto />} />
          <Route path="/atajos" element={<Atajos />} />
          <Route path="/migracion" element={<Migracion />} />
          {/* Unknown paths fall back to the landing (GitHub Pages 404.html
              re-enters here so the router can resolve deep links). */}
          <Route path="*" element={<Landing />} />
        </Route>
      </Routes>
    </>
  );
}
