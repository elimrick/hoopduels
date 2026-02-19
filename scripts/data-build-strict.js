const { spawnSync } = require('child_process');
const path = require('path');

function runNodeScript(scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

runNodeScript(path.join(__dirname, 'build-players-2000-present.js'));
runNodeScript(path.join(__dirname, 'validate-player-data.js'));
