-- Update all webhook nodes to use POST instead of GET
UPDATE workflow_entity SET nodes = '[
  {"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 1, "position": [250, 300], "parameters": {"path": "delivery-export", "responseMode": "lastNode", "options": {}, "httpMethod": "POST"}},
  {"id": "cc-bridge-gen", "name": "调用 Claude Code 生成代码", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [450, 250], "parameters": {"method": "POST", "url": "http://localhost:5001/execute", "sendBody": true, "bodyParameters": {"parameters": [{"name": "task", "value": "=生成完整项目代码，项目ID: {{ $json.body.projectId }}"}, {"name": "context", "value": "=交付类型: {{ $json.body.deliveryType }}。生成包含 index.html、package.json、Dockerfile、nginx.conf、README.md、.gitignore、tests/ 的完整项目"}, {"name": "taskType", "value": "delivery"}]}, "options": {"timeout": 300000}}},
  {"id": "b2c3d4e5-f6a7-8901-bcde-f12345678901", "name": "触发平台任务管线", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [450, 380], "parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/api/n8n-webhook/run-tasks", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.body.projectId }}"}, {"name": "deliveryType", "value": "={{ $json.body.deliveryType }}"}]}, "options": {}}},
  {"id": "c3d4e5f6-a7b8-9012-cdef-123456789012", "name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [650, 300], "parameters": {"respondWith": "json", "responseBody": "={{ { success: true, ccResult: $json.result, pipelineResult: $json } }}"}}
]'::json WHERE id = 'W2Ze46m89mn3IrhP';

UPDATE workflow_entity SET nodes = '[
  {"parameters": {"path": "task-planning", "responseMode": "lastNode", "options": {}, "httpMethod": "POST"}, "name": "Webhook", "type": "n8n-nodes-base.webhook", "position": [0, 0], "typeVersion": 1, "id": "de198aa7-aea8-4dd2-88ed-192f56037fae", "webhookId": "2add81c8-0f57-40c9-b349-d515d10b69d9"},
  {"parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/api/n8n-webhook/run-tasks", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.body.projectId }}"}, {"name": "feedbackId", "value": "={{ $json.body.feedbackId }}"}, {"name": "taskIds", "value": "={{ $json.body.taskIds }}"}]}, "options": {}}, "name": "触发平台任务管线", "type": "n8n-nodes-base.httpRequest", "position": [256, 0], "typeVersion": 4.2, "id": "b5d9cc1d-38f9-4f8e-90f7-aed61f03cb2b"},
  {"parameters": {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}, "name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "position": [512, 0], "typeVersion": 1, "id": "da3babe0-d96b-4c8d-b560-665e74b116e2"}
]'::json WHERE id = '1gtiDwc6IOTYmomI';

UPDATE workflow_entity SET nodes = '[
  {"parameters": {"path": "feedback", "responseMode": "lastNode", "options": {}, "httpMethod": "POST"}, "name": "Webhook", "type": "n8n-nodes-base.webhook", "position": [0, 0], "typeVersion": 1, "id": "c13db869-2ac7-4879-9750-535088b37b51", "webhookId": "833184ef-f545-4eba-8e42-ff81ef53fbff"},
  {"parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/api/n8n-webhook/run-tasks", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.body.projectId }}"}, {"name": "feedbackId", "value": "={{ $json.body.feedbackId }}"}]}, "options": {}}, "name": "触发平台任务管线", "type": "n8n-nodes-base.httpRequest", "position": [256, 0], "typeVersion": 4.2, "id": "28644518-cc67-4518-9675-56464cd89921"},
  {"parameters": {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}, "name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "position": [512, 0], "typeVersion": 1, "id": "6d84424a-4fc2-4eeb-9d21-70df2b97b4a1"}
]'::json WHERE id = 'ZHuTOuFoKeJ2KtFe';

UPDATE workflow_entity SET nodes = '[
  {"parameters": {"path": "plan", "responseMode": "lastNode", "options": {}, "httpMethod": "POST"}, "name": "Webhook", "type": "n8n-nodes-base.webhook", "position": [0, 0], "typeVersion": 1, "id": "4a7b5741-9d26-4945-91d4-0e015a1fbc43", "webhookId": "1ba26441-5f16-42b0-9f0e-afad317be7a3"},
  {"parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/internal/workflows/plan", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.body.projectId }}"}]}, "options": {}}, "name": "调用平台后端 API", "type": "n8n-nodes-base.httpRequest", "position": [256, 0], "typeVersion": 4.2, "id": "e0faf2db-406e-43f5-9277-f32426019580"},
  {"parameters": {"respondWith": "json", "responseBody": "={{ $json }}", "options": {}}, "name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "position": [512, 0], "typeVersion": 1, "id": "40fae982-5e39-46d4-9f73-312cc1412f28"}
]'::json WHERE id = 'XttB2mg7Ln93yVkV';

UPDATE workflow_entity SET nodes = '[
  {"id": "a1b2c3d4-e5f6-7890-abcd-ef1234567891", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 1, "position": [250, 300], "parameters": {"path": "demo-generate", "httpMethod": "POST", "responseMode": "lastNode", "options": {}}},
  {"id": "cc-bridge-demo", "name": "调用 Claude Code 生成 Demo", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [450, 250], "parameters": {"method": "POST", "url": "http://localhost:5001/execute", "sendBody": true, "bodyParameters": {"parameters": [{"name": "task", "value": "=生成完整Demo HTML预览，项目ID: {{ $json.query.projectId }}"}, {"name": "taskType", "value": "demo"}, {"name": "context", "value": "=项目ID: {{ $json.query.projectId }}"}]}, "options": {"timeout": 120000}}},
  {"id": "save-to-api", "name": "保存 Demo HTML", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [650, 300], "parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/internal/workflows/demo-generate", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.query.projectId }}"}, {"name": "html", "value": "={{ $json.result }}"}]}, "options": {}}},
  {"id": "return-result", "name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [850, 300], "parameters": {"respondWith": "json", "responseBody": "={{ { success: true, htmlLength: $json.result ? $json.result.length : 0 } }}"}}
]'::json WHERE id = 'rj2OiWAtwBZEl9Da';

UPDATE workflow_entity SET nodes = '[
  {"name": "Webhook", "type": "n8n-nodes-base.webhook", "parameters": {"path": "clarify", "responseMode": "lastNode", "httpMethod": "POST"}, "position": [0, 0], "typeVersion": 1, "id": "582b2859-711a-4bf3-9460-4e5557d349db"},
  {"name": "调用平台后端 API", "type": "n8n-nodes-base.httpRequest", "parameters": {"method": "POST", "url": "={{ $env.PLATFORM_API_URL }}/internal/workflows/clarify", "sendBody": true, "bodyParameters": {"parameters": [{"name": "projectId", "value": "={{ $json.body.projectId }}"}]}}, "position": [250, 0], "typeVersion": 4.2, "id": "9c2fd2c1-3ed9-4b5f-a001-0317d187f007"},
  {"name": "返回结果", "type": "n8n-nodes-base.respondToWebhook", "parameters": {"respondWith": "json", "responseBody": "={{ $json }}"}, "position": [500, 0], "typeVersion": 1, "id": "7bb9ac9c-c905-4a05-bfc2-90e8c9d173a1"}
]'::json WHERE id = 'SKxejc2CqP5s1ARk';

-- Clear old webhook registrations (will be re-created on N8N restart)
DELETE FROM webhook_entity;

SELECT COUNT(*) || ' workflows updated' FROM workflow_entity;
