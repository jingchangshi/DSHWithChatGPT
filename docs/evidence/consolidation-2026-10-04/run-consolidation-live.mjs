import fs from 'node:fs'
import path from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
const consumer="C:\\Users\\jingc\\workspace\\DSHWithChatGPT"
const evidence='C:/Users/jingc/AppData/Local/Temp/plannerbridge-consolidation-20261004'
const installation=process.argv[2]
if(!installation || !fs.existsSync(path.join(installation,'dsh-with-chatgpt-0.1.0.tgz'))) throw new Error('PACKED_INSTALLATION_REQUIRED')
const trusted=fs.readFileSync('C:/Users/jingc/.env','utf8')
const env={...process.env}
for(const key of ['DEEPSEEK_API_KEY','CONTROL_PLANE_API_KEY','CONTROL_PLANE_TUNNEL_ID']) {
 const match=trusted.match(new RegExp('^\\s*(?:export\\s+)?'+key+'\\s*=\\s*(.*?)\\s*$','m'))
 let value=match?.[1]
 if(value?.startsWith('"')||value?.startsWith("'")) value=value.slice(1,value.lastIndexOf(value[0]))
 else value=value?.replace(/\s+#.*$/,'').trim()
 if(!value) throw new Error('REQUIRED_CREDENTIAL_MISSING: '+key)
 env[key]=value
}
const paths=[...trusted.matchAll(/[A-Za-z]:[\\/][^\r\n"'<>]+?\.(?:exe)/g)].map(m=>m[0]).filter(file=>fs.existsSync(file))
const executable=paths.find(file=>path.basename(file)==='tunnel-client.exe')
if(!executable) throw new Error('TUNNEL_EXECUTABLE_MISSING')
const owned=JSON.parse(fs.readFileSync(evidence+'/new-owned-target.json','utf8'))
const runtime=JSON.parse(fs.readFileSync(evidence+'/pnpm-runtime.json','utf8'))
const journal=path.join(process.env.LOCALAPPDATA,'PlannerBridge','acceptance','consolidation-'+randomUUID())
Object.assign(env,{DSH_CLI:'C:/Users/jingc/workspace/deepseek-harness/apps/cli/lib/bin.js',MCP_EXPOSURE_CLIENT:executable,
 PLANNERBRIDGE_SIDECAR_CREDENTIAL_FILE:path.join(process.env.LOCALAPPDATA,'PlannerBridge','credentials','authentication.secret'),
 PLANNERBRIDGE_SIDECAR_STATE_DIRECTORY:journal,PLANNERBRIDGE_SIDECAR_EXCLUDED_ROOTS:JSON.stringify([consumer,'C:/Users/jingc/workspace/deepseek-harness']),
 PLANNERBRIDGE_SIDECAR_CDP_ENDPOINT:owned.endpoint,PLANNERBRIDGE_SIDECAR_TARGET_ID:owned.targetId,
 PLANNERBRIDGE_SIDECAR_PORT:'18765',PLANNERBRIDGE_SIDECAR_APP_NAME:'DSH with ChatGPT',PATH:runtime.path})
delete env.BROWSER_HARNESS_COMPAT_EXECUTABLE
fs.writeFileSync(evidence+'/live-deployment.json',JSON.stringify({consumerSourceHead:"2fef84407d1e2c41e2b093b683345a56987530bd",producerHead:'0afd708c288b079096affbfeff4626dcf9a19bf1',targetId:owned.targetId,journal,installation,cli:env.DSH_CLI,secretValuesRecorded:false},null,2)+'\n')
const result=spawnSync(process.execPath,[runtime.executable,'run','test:planner-executor-e2e','C:/Users/jingc/workspace/deepseek-harness',installation],{cwd:path.join(consumer,'package'),env,stdio:'inherit',windowsHide:true})
if(result.error) throw new Error('REAL_RUNNER_PROCESS_FAILED')
fs.writeFileSync(evidence+'/live-launch-result.json',JSON.stringify({status:result.status,signal:result.signal,endedAt:new Date().toISOString()},null,2)+'\n')
process.exitCode=result.status??1
