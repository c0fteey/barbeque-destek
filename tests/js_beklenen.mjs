// tests/ornek_mesajlar.txt'teki her mesaj için JS süzgecinin (main dalındaki src/filters.js) cevabı → tests/filtre_ornekleri.json
import {readFileSync, writeFileSync} from 'node:fs';
const [filtersPath, wordsPath, outPath] = process.argv.slice(2);
const {findLink, findProfanity, parseWords} = await import(filtersPath);
const words = parseWords(readFileSync(wordsPath, 'utf8'));
const lines = readFileSync(new URL('./ornek_mesajlar.txt', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean);
const extra = ['Oros\nPu\nÇo\nCı', 'şeref\nsizin', 'a\nm\nk'];
const out = [...lines, ...extra].map((mesaj) => ({mesaj, kufur: findProfanity(mesaj, words), link: findLink(mesaj, ['micup.gg'])}));
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(out.filter((o) => o.kufur || o.link).length, '/', out.length, 'yakalandı');
