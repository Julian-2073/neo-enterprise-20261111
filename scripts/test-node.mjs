import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
// Rendered HTML needs the fresh build produced by `npm test`, not an old dist.
const files=(await readdir('tests')).filter(f=>f.endsWith('.test.mjs')&&f!=='rendered-html.test.mjs').sort().map(f=>'tests/'+f);
const child=spawn(process.execPath,['--test','--test-concurrency=2',...files],{stdio:'inherit'});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
