const http = require('http');

function api(method, path, data, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    const body = data ? JSON.stringify(data) : '';
    headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({ hostname: 'localhost', port: 5678, path, method, headers }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const login = await api('POST', '/rest/login', { emailOrLdapLoginId: 'coolairs@gmail.com', password: 'Admin@123' });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  console.log('Logged in');

  const list = await api('GET', '/rest/workflows', null, cookie);
  const wfs = JSON.parse(list.body).data;
  for (const wf of wfs.filter(w => w.name === '交付导出工作流')) {
    if (wf.active) await api('POST', `/rest/workflows/${wf.id}/deactivate`, { versionId: wf.versionId }, cookie);
    await api('DELETE', `/rest/workflows/${wf.id}`, null, cookie);
  }

  const wfData = {
    name: '交付导出工作流',
    nodes: [
      { name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 1, position: [250, 300],
        parameters: { path: 'delivery-export', httpMethod: 'POST', responseMode: 'lastNode', options: {} } },
      { name: 'HTTP Request', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [450, 300],
        parameters: {
          method: 'POST',
          url: '={{ $env.PLATFORM_API_URL }}/api/n8n-webhook/run-tasks',
          authentication: 'none',
          sendBody: true,
          specifyBody: 'keypair',
          bodyParameters: {
            parameters: [
              { name: 'projectId', value: '={{ $json.body.projectId }}' },
              { name: 'deliveryType', value: '={{ $json.body.deliveryType }}' }
            ]
          },
          options: {}
        }
      },
      { name: 'Respond', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1, position: [650, 300],
        parameters: { respondWith: 'json', responseBody: '={{ $json }}' } }
    ],
    connections: {
      Webhook: { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] },
      'HTTP Request': { main: [[{ node: 'Respond', type: 'main', index: 0 }]] }
    },
    settings: {},
    tags: []
  };

  const create = await api('POST', '/rest/workflows', wfData, cookie);
  if (create.status !== 200) { console.log('Create failed:', create.body.substring(0,300)); return; }
  const wf = JSON.parse(create.body).data;
  console.log('Created:', wf.id);

  const act = await api('POST', `/rest/workflows/${wf.id}/activate`, { versionId: wf.versionId }, cookie);
  console.log('Activate:', act.status, act.body.substring(0, 50));
}

main().catch(console.error);
