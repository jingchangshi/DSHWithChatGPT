import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
const consumer='C:/Users/jingc/workspace/DSHWithChatGPT',producer='C:/Users/jingc/workspace/deepseek-harness'
const evidence='C:/Users/jingc/AppData/Local/Temp/plannerbridge-consolidation-20261004'
const installation=path.resolve(process.argv[2]),unpacked=mkdtempSync(path.join(tmpdir(),'plannerbridge-packed-association-'))
execFileSync('tar',['-xf',path.join(installation,'dsh-with-chatgpt-0.1.0.tgz'),'-C',unpacked],{windowsHide:true})
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)])
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const built=path.join(consumer,'package/lib'),packed=path.join(unpacked,'package/lib'),installed=path.join(installation,'node_modules/dsh-with-chatgpt/lib')
const relativeFiles=walk(built).map(file=>path.relative(built,file)).sort()
assert.ok(relativeFiles.length>0)
assert.deepEqual(walk(packed).map(file=>path.relative(packed,file)).sort(),relativeFiles)
assert.deepEqual(walk(installed).map(file=>path.relative(installed,file)).sort(),relativeFiles)
const consumerRows=relativeFiles.map(relative=>({module:relative.replaceAll('\\','/'),built:hash(path.join(built,relative)),packed:hash(path.join(packed,relative)),installed:hash(path.join(installed,relative))}))
const producerRows=[]
const peers={'@deepseek-ai/dsh-execution-world':'packages/execution/execution-world','@deepseek-ai/dsh-fs':'packages/fs/fs','@deepseek-ai/dsh-storage-domain':'packages/storage/storage-domain','@deepseek-ai/dsh-llm':'packages/llm/llm','@deepseek-ai/dsh-execution-world-affinity':'packages/execution/execution-world-affinity'}
for(const [name,relative] of Object.entries(peers)) {
  let installedRoot
 const contexts=['', 'node_modules/@deepseek-ai/dsh-fs', 'node_modules/@deepseek-ai/dsh-execution-world', 'node_modules/@deepseek-ai/dsh-storage-domain']
 for(const context of contexts) {
  try {installedRoot=path.dirname(createRequire(fs.realpathSync(path.join(installation,context,'package.json'))).resolve(name+'/package.json'));break}catch{}
 }
 assert.ok(installedRoot,'Installed peer resolution failed: '+name)
 const contained=path.relative(fs.realpathSync(installation),fs.realpathSync(installedRoot))
 assert.ok(contained!=='..'&&!contained.startsWith('..'+path.sep)&&!path.isAbsolute(contained))
 const manifest=JSON.parse(fs.readFileSync(path.join(installedRoot,'package.json'),'utf8'))
 for(const file of walk(path.join(installedRoot,'lib')).filter(file=>file.endsWith('.js'))) {
  const module=path.relative(installedRoot,file),current=path.join(producer,relative,module)
  producerRows.push({package:name,module:module.replaceAll('\\','/'),producer:hash(current),installed:hash(file),version:manifest.version})
 }
}
assert.ok(producerRows.length>0)
const patchHashes=[path.join(consumer,'package/cordis.patch.yml'),path.join(unpacked,'package/cordis.patch.yml'),path.join(installation,'node_modules/dsh-with-chatgpt/cordis.patch.yml')].map(hash)
assert.equal(new Set(patchHashes).size,1)
const manifest=JSON.parse(fs.readFileSync(evidence+'/frozen-manifest.json','utf8'))
const changedFrozenInputs=manifest.files.filter(file=>hash(path.join(consumer,file.path))!==file.sha256).map(file=>file.path)
const result={consumerSourceHead:manifest.head,deliveryHead:execFileSync('git',['rev-parse','HEAD'],{cwd:consumer,encoding:'utf8'}).trim(),producerHead:execFileSync('git',['rev-parse','HEAD'],{cwd:producer,encoding:'utf8'}).trim(),at:new Date().toISOString(),installation,unpacked,archiveSha256:hash(path.join(installation,'dsh-with-chatgpt-0.1.0.tgz')),consumerAllMatch:consumerRows.every(row=>row.built===row.packed&&row.packed===row.installed),producerAllMatch:producerRows.every(row=>row.producer===row.installed),changedFrozenInputs,patchHashes,consumerRows,producerRows}
fs.writeFileSync(evidence+'/artifact-association.json',JSON.stringify(result,null,2)+'\n')
assert.equal(result.consumerAllMatch,true)
assert.equal(result.producerAllMatch,true)
assert.deepEqual(changedFrozenInputs,[])
console.log(JSON.stringify({consumerFiles:consumerRows.length,producerRuntimeFiles:producerRows.length,consumerAllMatch:result.consumerAllMatch,producerAllMatch:result.producerAllMatch,frozenInputsUnchanged:true}))
