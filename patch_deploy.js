
const fs = require('fs');
const path = '/app/dist/services/deploy-pipeline.service.js';
let code = fs.readFileSync(path, 'utf8');

// Add Dockerfile fix before docker build
const fixBlock = [
'    // Auto-fix generated Dockerfile',
'    try {',
'      let df = require("fs").readFileSync(deliveryDir + "/Dockerfile", "utf8");',
'      if (df.includes("COPY") && df.includes("prisma") && df.includes("2>/dev/null")) {',
'        df = df.replace(/COPY.*prisma.*2\/dev\/null \|\| true/g, "RUN cp -r backend/prisma/ ./prisma/ 2>/dev/null || true");',
'        if (!df.includes("prisma generate")) {',
'          df = df.replace(/(RUN cp -r.*prisma.*\n)/, "$1RUN npx prisma generate 2>/dev/null || true\n");',
'        }',
'        require("fs").writeFileSync(deliveryDir + "/Dockerfile", df);',
'        this.logger.log("Dockerfile auto-fixed (COPY prisma + prisma generate)");',
'      }',
'    } catch(e) {}',
].join('\n');

const buildMarker = 'const output = execSync';
code = code.replace(buildMarker, fixBlock + '\n      ' + buildMarker);
fs.writeFileSync(path, code);
console.log(code.includes('Dockerfile auto-fixed') ? 'DONE' : 'FAILED');
