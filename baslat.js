// Barbeque Destek başlatıcısı: bot Rust ile yazıldı (barbeque-destek.exe); bbq-deploy ajanı ise "node ..." başlatıp
// Node IPC ile konuşuyor. Bu dosya exe'yi açar ve ajanla arasında köprü olur:
//   ajan → exe: IPC mesajları stdin'e satır başına bir JSON olarak yazılır ("shutdown", settings, whitelist, guild-event)
//   exe → ajan: stdout'taki "@@ipc {json}" satırları IPC ile ajana gönderilir; diğer satırlar olduğu gibi çıktıya gider.
// Bağımlılığı yok; ajanın beklediği package.json "start" komutu bunu çalıştırır.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = process.platform === 'win32' ? 'barbeque-destek.exe' : 'barbeque-destek';
// Yayın dalında exe kökte; geliştirirken cargo build --release çıktısı.
const exe = [join(HERE, NAME), join(HERE, 'target', 'release', NAME)].find((p) => existsSync(p));
if (!exe) {
  console.error(`${NAME} bulunamadı. Yayın dalı (yayin) kurulmalı ya da "cargo build --release" çalıştırılmalı.`);
  process.exit(1);
}

const ipc = Boolean(process.send);
const child = spawn(exe, [], {
  cwd: HERE,
  env: {...process.env, BBQ_IPC: ipc ? '1' : '0'},
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
});
const PREFIX = '@@ipc ';

createInterface({input: child.stdout}).on('line', (line) => {
  if (!line.startsWith(PREFIX)) {
    console.log(line);
    return;
  }
  try {
    if (process.connected) process.send(JSON.parse(line.slice(PREFIX.length)));
  } catch (error) {
    console.error('Ajana mesaj gönderilemedi:', error.message);
  }
});

const toChild = (message) => {
  if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
};
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  toChild('shutdown');
  // Zamanında kapanmazsa zorla.
  setTimeout(() => child.kill(), 10_000).unref();
}

if (ipc) {
  process.on('message', (message) => (message === 'shutdown' ? stop() : toChild(message)));
  // Ajan kapanırsa bağlantı kopar; bot da kapanır.
  process.once('disconnect', stop);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.on('error', (error) => {
  console.error(`${NAME} başlatılamadı: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
