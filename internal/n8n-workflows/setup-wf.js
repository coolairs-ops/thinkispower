// N8N Workflow setup script
// Run inside the n8n container: node /tmp/setup-workflow.js

const http = require('http');
const HOST = 'localhost';
const PORT = 5678;

function apiRequest(method, path, data, cookie) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;

    const body = data ? JSON.stringify(data) : undefined;
    if (body) headers['Content-Length'] = Buffer.byteLength(body);

    const req = http.request({
      hostname: HOST, port: PORT, path, method, headers
    }, (res) => {
      let respBody = '';
      res.on('data', chunk => respBody += chunk);
      res.on('end', () => {
        const result = { status: res.statusCode, headers: res.headers, body: respBody };
        try { result.json = JSON.parse(respBody); } catch {}
        resolve(result);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // 1. Login
  const login = await apiRequest('POST', '/rest/login', {
    emailOrLdapLoginId: 'coolairs@gmail.com',
    password: 'Admin@123'
  });
  if (login.status !== 200) {
    console.error('Login failed:', login.status, login.body);
    process.exit(1);
  }
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  console.log('Logged in');

  // 2. Check existing workflows and delete delivery-export ones
  const list = await apiRequest('GET', '/rest/workflows', undefined, cookie);
  if (list.status === 200 && list.json?.data) {
    for (const wf of list.json.data) {
      if (wf.name === '交付导出工作流') {
        const del = await apiRequest('DELETE', `/rest/workflows/${wf.id}`, undefined, cookie);
        console.log(`Deleted workflow ${wf.id}: status ${del.status}`);
      }
    }
  }

  // 3. Create workflow
  const workflow = {
    name: '交付导出工作流',
    nodes: [
      {
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1,
        position: [250, 300],
        parameters: { path: 'delivery-export', httpMethod: 'POST', responseMode: 'lastNode', options: {} }
      },
      {
        name: '触发平台任务管线',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [450, 300],
        parameters: {
          method: 'POST',
          url: '={{ $env.PLATFORM_API_URL }}/api/n8n-webhook/run-tasks',
          sendBody: true,
          bodyParameters: { parameters: [
            {name:'projectId', value:'={{ $json.body.projectId }}'},
            {name:'deliveryType', value:'={{ $json.body.deliveryType }}'}
          ]},
          options: {}
        }
      },
      {
        name: '返回结果',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [650, 300],
        parameters: { respondWith: 'json', responseBody: '={{ $json }}' }
      }
    ],
    connections: {
      Webhook: { main: [[{node:'触发平台任务管线', type:'main', index:0}]] },
      '触发平台任务管线': { main: [[{node:'返回结果', type:'main', index:0}]] }
    },
    settings: {},
    tags: []
  };

  const create = await apiRequest('POST', '/rest/workflows', workflow, cookie);
  if (create.status !== 200) {
    console.error('Create failed:', create.status, create.body);
    process.exit(1);
  }
  const wfId = create.json.data.id;
  const versionId = create.json.data.versionId;
  console.log(`Created workflow: ${wfId}, version: ${versionId}`);

  // 4. Activate
  const activate = await apiRequest('POST', `/rest/workflows/${wfId}/activate`, { versionId }, cookie);
  if (activate.status === 200) {
    console.log('Activated successfully');
    console.log('Active:', activate.json?.data?.active);
  } else {
    console.error('Activate failed:', activate.status, activate.body?.substring(0, 300));
  }
}

main().catch(console.error);
