const { spawn } = require('child_process');

console.log('\x1b[36m%s\x1b[0m', '🚀 Starting Speer (Backend on :4000 + Frontend on :3000)...');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function startProcess(name, args, colorCode) {
  const child = spawn(npmCmd, args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
  });

  const prefix = `\x1b[${colorCode}m[${name}]\x1b[0m `;

  child.stdout.on('data', (data) => {
    process.stdout.write(prefix + data.toString().replace(/\n(?!$)/g, '\n' + prefix));
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(prefix + data.toString().replace(/\n(?!$)/g, '\n' + prefix));
  });

  child.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${prefix}process exited with code ${code}`);
    }
  });

  return child;
}

const backend = startProcess('backend', ['--prefix', 'backend', 'run', 'dev'], '34');
const frontend = startProcess('frontend', ['--prefix', 'frontend', 'run', 'dev'], '32');

function cleanup() {
  console.log('\n\x1b[33m%s\x1b[0m', '🛑 Shutting down backend and frontend...');
  if (isWin) {
    if (backend.pid) spawn('taskkill', ['/pid', backend.pid, '/f', '/t']);
    if (frontend.pid) spawn('taskkill', ['/pid', frontend.pid, '/f', '/t']);
  } else {
    backend.kill();
    frontend.kill();
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
