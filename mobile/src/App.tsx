import { useState } from 'react';
import { Router } from './app/Router';
import { createServices } from './core/services';

export function App() {
    const [services] = useState(createServices);
    return <Router services={services} />;
}
