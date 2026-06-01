import { readFileSync } from 'fs';

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI0MmYzYjBhMi0yYTU3LTQzMmItOGM2Mi01MTAxMmU0MThjZTgiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNDQ4MzMyMjMtZTBlZS00OGRiLTg1NzMtZDMxMTYxYWIyNjJjIiwiaWF0IjoxNzgwMDU4NjMxLCJleHAiOjE3ODc4MDMyMDB9.PxIH4hJzTd5fVFzi7BNj6Y6CGAUGTJxd4zV_9ZpiF1A';
const BASE = 'http://localhost:5678/api/v1';

const workflows = [
  'task-planning.json',
  'delivery-export.json',
  'plan.json',
  'clarify.json',
];

async function main() {
  for (const file of workflows) {
    const path = `D:/Think-is-power/internal/n8n-workflows/${file}`;
    const data = JSON.parse(readFileSync(path, 'utf-8'));
    delete data.active;
    data.settings = { executionOrder: 'v1' };

    console.log(`\n=== Creating ${data.name} ===`);

    // Create
    const createResp = await fetch(`${BASE}/workflows`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!createResp.ok) {
      const err = await createResp.text();
      console.error(`  Create failed: ${createResp.status} ${err}`);
      continue;
    }
    const wf = await createResp.json();
    console.log(`  Created: ${wf.id}`);

    // Activate
    const actResp = await fetch(`${BASE}/workflows/${wf.id}/activate`, {
      method: 'POST',
      headers: { 'X-N8N-API-KEY': API_KEY },
    });
    if (!actResp.ok) {
      const err = await actResp.text();
      console.error(`  Activate failed: ${actResp.status} ${err}`);
      continue;
    }
    const activated = await actResp.json();
    console.log(`  Active: ${activated.active}`);
  }

  // Verify webhooks
  console.log('\n=== Checking webhook registrations ===');
  const listResp = await fetch(`${BASE}/workflows`, {
    headers: { 'X-N8N-API-KEY': API_KEY },
  });
  const list = await listResp.json();
  for (const wf of list.data) {
    console.log(`  ${wf.name}: active=${wf.active}`);
  }
}

main().catch(console.error);
