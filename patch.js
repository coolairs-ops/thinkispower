
const fs = require('fs');
const path = '/app/dist/main.js';
let code = fs.readFileSync(path, 'utf8');

// Check if already patched
if (code.includes('swagger')) { console.log('already patched'); process.exit(0); }

// Add swagger require
code = code.replace(
  'const user_friendly_exception_filter_1 = require("./common/filters/user-friendly-exception.filter");',
  'const user_friendly_exception_filter_1 = require("./common/filters/user-friendly-exception.filter");\nconst swagger = require("@nestjs/swagger");'
);

// Add swagger setup
code = code.replace(
  'const app = await core_1.NestFactory.create(app_module_1.AppModule);',
  'const app = await core_1.NestFactory.create(app_module_1.AppModule);\nconst sc = new swagger.DocumentBuilder().setTitle("Think-is-power API").setVersion("1.0").addBearerAuth().build();\nconst sd = swagger.SwaggerModule.createDocument(app, sc);\nswagger.SwaggerModule.setup("api/docs", app, sd);'
);

fs.writeFileSync(path, code);
console.log('patched');
