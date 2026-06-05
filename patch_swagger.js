const fs = require('fs');
const { execSync } = require('child_process');

// 1. Install @nestjs/swagger
try {
  execSync('npm install @nestjs/swagger 2>/dev/null', { cwd: '/app', timeout: 30000, stdio: 'pipe' });
  console.log('swagger installed');
} catch(e) {
  console.log('swagger install skipped:', e.message.slice(0,50));
}

// 2. Patch main.js
const path = '/app/dist/main.js';
let code = fs.readFileSync(path, 'utf8');

// Add require
code = code.replace(
  'const user_friendly_exception_filter_1 = require("./common/filters/user-friendly-exception.filter");',
  'const user_friendly_exception_filter_1 = require("./common/filters/user-friendly-exception.filter");\nconst swagger = require("@nestjs/swagger");'
);

// Add swagger setup after app creation
code = code.replace(
  'const app = await core_1.NestFactory.create(app_module_1.AppModule);',
  `const app = await core_1.NestFactory.create(app_module_1.AppModule);
const sc = new swagger.DocumentBuilder().setTitle("Think-is-power API").setVersion("1.0").addBearerAuth().build();
const sd = swagger.SwaggerModule.createDocument(app, sc);
swagger.SwaggerModule.setup("api/docs", app, sd);`
);

fs.writeFileSync(path, code);
console.log('main.js patched with swagger');
