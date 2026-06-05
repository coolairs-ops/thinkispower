const express = require('express');
const app = express();
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));

// Try to load compiled AI routes
try {
  const api = require('./dist/main');
  app.use('/api', api);
} catch(e) {
  console.log('No compiled routes, using fallback');
}

// Fallback API
app.get('/api/info', (_, res) => res.json({ 
  name: '知识库管理系统',
  version: '1.0',
  endpoints: ['GET /api/info', 'GET /health']
}));

app.listen(3000, () => console.log('API on :3000'));
