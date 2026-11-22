import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { configure } from '@testing-library/react';

// The full suite runs ~110 files in parallel: lazy chunks (React.lazy imports) can take well over the 1 s default
// of findBy*/waitFor on a busy machine. Failures still surface; only the wait ceiling is raised.
configure({ asyncUtilTimeout: 5000 });
