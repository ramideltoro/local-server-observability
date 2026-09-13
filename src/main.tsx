import React, {lazy,Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import Workspace from './Workspace';
const Legacy=lazy(()=>import('./Legacy'));
createRoot(document.getElementById('root')!).render(<React.StrictMode><Suspense fallback={<p>Loading diagnostics…</p>}>{location.search.includes('legacy=1')?<Legacy/>:<Workspace/>}</Suspense></React.StrictMode>);
