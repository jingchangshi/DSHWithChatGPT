# PlannerBridge：恢复 Goal 执行，完成 Windows 真实产品闭环

我明确恢复此前暂停的整体开发。你在 Windows 11 Codex Desktop Goal 模式中工作，必须使用本机已安装的 codex-with-chatgpt 插件，让 ChatGPT Web 负责独立规划、关键设计审阅、源码/证据审阅和最终 exact-HEAD 审阅。Codex 负责开发、测试、Git 和运行验收。普通工程问题自行推进，不反复询问我。

本提示词授权恢复开发，不授权扩大产品目标、清理归属不明的历史状态、覆盖我的修改或降低验收标准。

## 一、目标与边界

完成真实、可恢复、证据闭环的：
Windows DSH / DeepSeek Executor
→ ChatGPT Web Planner
→ 实现与测试
→ commit/push
→ ChatGPT Web 独立 Reviewer
→ 真实 fix PLAN
→ 实际 DSH 进程重启与 same-task reconnect
→ 第二轮执行/测试/提交/审阅
→ exact same-round DONE
→ 原独立 acceptance oracle 所有必需项通过。

Windows 本地优先；Linux 远端执行仍为 FUTURE。产品规划必须来自真实 ChatGPT 网页，不得替换成 API Planner、假 Reviewer 或 Codex 自己。开发用 codex-with-chatgpt 与最终产品的 App、浏览器、Sidecar、状态及凭据严格隔离。

保持当前架构：
- deepseek-harness 提供 execution-world identity、provider affinity、ReadLease/GitLease、FS/subprocess/sandbox。
- DSHWithChatGPT 提供协议、编排、状态、ChatControl/Sidecar、共享 Web driver、Direct CDP、只读 MCP data plane 和验收。
- Browser Harness 仅为兼容路径；primary acceptance 不依赖它。
- 不重做已接受的 foundation，不为了“完善架构”增加接口或 provider。

## 二、先恢复精确基线，不重复已经完成的工作

仓库：
C:\Users\jingc\workspace\DSHWithChatGPT
C:\Users\jingc\workspace\deepseek-harness

两者目标分支：
feat/complete-c2c-runtime

本次审阅时 GitHub 基线：
DSHWithChatGPT: d931979050b41871555fd7968897078f742fb12c
deepseek-harness: 0afd708c288b079096affbfeff4626dcf9a19bf1

先执行实际 Git status/fetch/log/HEAD/upstream 检查。不得 hard reset、覆盖未提交修改，或把历史 SHA 当作永远最新。远端更新后按真实差异重新判断。

d931979 已交付 iteration122：
- 冷 replacement handoff 的因果 RED 已留存。
- 生产修复是在 fresh health 后调用已有 recover(signal)，再恢复同一个严格 reconciliation/wait。
- focused：6 files / 73 PASS，含九个 native recovery 场景。
- doctor compatibility：实际 4 files / 55 PASS。
- typecheck/build PASS。
- frozen full：90 files / 1239 PASS / 3 原有 skips / 909.66s。
- 197 个源码/测试文件的冻结哈希核对通过。
- package3ZkHDf、profile18xaSF 的两次 native composition、十个 built/packed 模块对应检查通过。
- 这些不是 real ChatGPT 产品闭环通过；没有本候选 real123 的成功证据。

先核对已有 post-push exact-HEAD scoped verdict。仓库只引用了原审阅对话，不能从“已推送”“源码审阅通过”推导最终补充审阅也已通过。已有明确 verdict 就复用；缺失就只补本次 scoped 复核，不重新进入冷交接开发，不重复全量回归。

核对当前安装包、实际加载 JS、producer 构建和依赖解析是否对应上述源码。临时目录不存在时可以重建并重新证明关联，不能拿新包冒充旧包。记录实际 Node/pnpm/Chrome 版本；检查 packageManager、workspace overrides 和实际解析路径，不盲目升级或全局切换工具链。pnpm.overrides 警告本身不是依赖失效证据，仓库已有 workspace overrides。

## 三、阅读顺序与一次独立启动审阅

先阅读本机已安装 codex-with-chatgpt 的真实技能、协议和命令帮助，使用实际支持的高推理配置及 PLAN/REVIEW 流程；不猜 CLI、模型名或工具参数。

优先阅读：
docs/review-checkpoint-2026-10-03.md
docs/evidence/iteration122/README.md 及其原始输出
docs/browser-platform-investigation.md
docs/current-delivery-plan.md
docs/goal.md
docs/target-architecture.md
docs/planner-executor-protocol.md
docs/acceptance-plan.md
docs/direct-cdp-contract.md
docs/windows-deployment.md
docs/env-win.md

重点对照源码：
package/src/sidecar/{client,rpc-http,server,journal}.ts
package/src/browser/{chatgpt-web-driver,direct-cdp,cdp-session,message-observation}.ts
package/src/readiness/doctor.ts
package/src/deployment/{dsh-runtime,sidecar-control,sidecar-supervisor,sidecar-target-recovery}.ts
package/src/orchestrator/
package/src/workspace/
package/scripts/verify-planner-executor-e2e.mjs
package/scripts/planner-executor-acceptance.mjs
package/tests/fixtures/planner-executor-e2e-observer.mjs
以及对应的 focused/native/adversarial tests。

producer 重点：
packages/execution/execution-world/src/
packages/execution/execution-world/tests/git-lease-windows.spec.ts
相关 FS、subprocess、sandbox、affinity 和 Windows runner 实现。

先发起一次基于真实源码/证据的独立“恢复开发与剩余交付审阅”，要求 ChatGPT：
1. 确认已接受与未接受的精确范围。
2. 分离已证明的源码缺陷机制、历史运行的未确认根因和覆盖缺口。
3. 审查下一次完整验收的先决条件与 fix/restart 触发设计。
4. 只有发现具体当前阻塞，才给最小修复及可证伪测试；否则直接批准冻结版本进入完整验收。

这是一次启动审阅，不是重新从零设计，也不是要求 Reviewer 为每个机械命令再批准。

更新现有权威检查点，清楚区分“当前执行依据”和“历史记录”。修正旧的“候选未审阅/全量正在运行/尚未推送”状态，保留原始失败和历史事实。此次允许更新、提交与当前任务有关的目标/进度/复盘文档；不得扩大为修改无关用户内容。纯文档修正不触发全量回归。

## 四、必须吸收的失败教训

1. 观察超时不是发送失败。
开发插件或产品 wait 超时后，先查同一个 operation/tab/handle/journal。不得重复 Enter、重发 INIT/EXECUTED 或换 ID 绕过 uncertainty。开发审阅未收到结果也不能当作通过。

2. 已证明的传输机制与历史根因分开。
A1 证明中断后原客户端没有取消；A2 在当时实际 Node/Undici 环境约 304236ms 触发 UND_ERR_HEADERS_TIMEOUT，显式较长期限尚未到。当前已采用内部 node:http、独立取消及 cancel-before-admission fencing。
没有新反例，不重开该修复；不能倒推 Real112 的实际 cause code 已被捕获。

3. 浏览器 root、页面和业务语义是不同状态。
root/health 成功不证明页面命令可执行；页面可执行不证明历史消息完整；App proof 成功不证明 PLAN/REVIEW/完整产品成功。
Real119 在没有连续独立页面命令、WTS 样本均可用的条件下仍出现同一 target 页面命令超时。它支持页面控制失效，不证明 renderer crash、锁屏根因或平台禁止。

4. Real121 的确切 reconciliation 子分支未知。
它发生过一个 bound accepted send、原 wait uncertain、一次 replacement 和 pre-resume 失败回滚。
事后 probe 指向已回滚 replacement，没有发出页面命令，不能作为另一例 renderer timeout。
iteration122 证明并修复冷交接 source/coverage gap，不证明历史 Real121 根因已被确定。

5. ACK 不是终态。
cancel ACK、close ACK、退出信号不等于 owner 已释放、target 已消失、子进程树已退出。用既有预算内的只读观察确认终态；不通过再次 close/cancel 猜测性清理。
回滚也不必然意味着旧 source 恢复健康；未知就保留未知。

6. 夹具必须真实覆盖出错边界。
iteration122 早期十份 fixture 失败不等于最终因果 RED。
区分生产缺陷、夹具错误、观察器干扰、测试调用错误、证据缺失。
不能修改生产身份/安全检查来迎合错误夹具；不能把过滤未运行算为 PASS。

7. 安全性通过不等于可用性通过。
拒绝误认、误发、越权的测试通过，只证明相应安全边界。还要实际完成长期等待、恢复、执行与第二轮审阅。
DONE_SCOPED 不得被逐步累计成整体 DONE。

## 五、先解决验收场景设计，不能靠概率等待模型出错

现有 oracle 要求真实 fix PLAN → restart-checkpoint → phase2 reconnect；runner 仅在第一轮 review.state=planned 时触发重启。

因此，首次实现正确、Reviewer 直接 DONE，可能是功能成功，却仍未覆盖 recovery gate。不得把这种结果叫作完整验收通过，也不得反复启动同一个任务，只为碰巧得到一个修复意见。

让启动独立审阅明确：
- 现有任务是否能合理覆盖真正的 fix/restart 路径。
- 若不具备，先设计最小、明确标注的隔离验收场景，保证 Reviewer 审阅真实代码/测试/未满足条件，而非被要求伪造 FIX。
- 需要调整夹具时，先给出独立方案和反例测试；仅调整必要测试工作负载/安排，保留原始 oracle 全部必需约束和原场景。
- 不改生产代码来制造假故障，不删测试、不偷偷改需求、不硬编码 Reviewer 回复或 oracle 结果。
- 任何故障注入必须限定在显式隔离的测试夹具，标明注入点及证明范围，不冒充自然发生的产品缺陷。

同时明确 Git 证据范围：当前 runner push 到临时本地 bare remote。它可以证明真实 Git push/upstream 一致，但不证明 GitHub 网络/认证。不要暗中替换远端或新增对外写入；最终两个产品仓库的正式修改仍按既定 feature 分支提交推送。

## 六、下一次必须是能走完整链路的真实运行

前提通过后，使用匹配的冻结 package、实际 producer、fresh 专用 Chrome target、private journal、DSH_HOME、workspace/task 和原验收 runner。

先确认真正解锁、可用的 Windows 交互会话。不得用 LockApp 是否存在代替 WTS；不得关闭安全锁屏、伪造 document visibility、滥用后台 flags 或把 headless 当成已验证方案。

在首次产品失败前：
- 连续独立观测仅限 WTS、browser root、Sidecar health、journal metadata。
- 不建立独立的连续 page CDP session，不发 Page/Runtime/evaluate 命令干扰被测页面。
- 区分 source、provisional replacement、committed replacement 和 retired/absent target。
- 观察器记录失败不能被伪装成产品根因；必要验收证据缺失也不能判为 PASS。

核实 actual executor provider/model，保持当前已验证 DeepSeek 路由；不以假生成或其他 Planner 替代。

依次推进：
local doctor
→ app-proof doctor
→ INIT/有效 PLAN
→ DeepSeek 实际修改
→ npm test
→ stdout-only 随机 E2E_EVIDENCE
→ commit/push
→ ChatGPT 独立读取 source/Git/execution_output
→ 真实 fix PLAN
→ 实际 DSH 进程终止及重新启动
→ same-task/iteration/workspace reconnect
→ 第二轮修改、测试、提交、审阅
→ 同轮精确 HEAD 的 DONE
→ 原 oracle。

不要在 App PASS 或 PLAN 到达后自行停止。execution_output_access=false 在非 active review 状态下可能是预期行为，不得因此误判 local/App readiness 失败。

nonce 不得写入被评工作区、review 参数或给 Reviewer 的人工提示。Reviewer 必须从授权的原始 execution_output 读取并回显。工作区外受控原始输出/独立 oracle 记录按既有设计保留。

实际 oracle 字段为：
plannerExecutorAccepted
identityVerified
nonceVerified
recoveryVerified
readinessVerified
以及 exitCode。
不得编造其他“已验证”字段替代它们，不拼接不同 run/task 的成功片段。

## 七、发生新失败时：停止该次曝光，但继续有证据的工程工作

首次未建模产品失败后停止新的业务发送，冻结原始证据。允许当前已审阅、预算内的恢复事务按既定规则结束；禁止外层普通重试、第二次 replacement、重新开始同一发送或刷新期限。

在现有复盘中记录一条完整因果链：
源/包/producer 身份；
run/task/iteration 与 operation 关联；
最后成功阶段、首个失败阶段；
实际错误类型、预算和经过时间；
journal phase、owner、target 生命周期；
辅助观察是在产品失败前还是之后；
哪些原始证据存在、哪些未采集；
现有假设、反证、唯一下一实验和停止条件。

先用现有 recover 方法与 journal phase 分类：
- 交接前失败；
- semantic-ready 失败；
- recover 已 accepted，但原 wait 仍 uncertain、尚未进入恢复等待；
- 已恢复等待后再次页面失效/期限到达；
- proof/协议/身份真实不匹配。

仅当现有证据不能区分、且区分结果会改变修复方案时，才增加最小 metadata-only 诊断。不预先建设大型 telemetry 系统。不得记录凭据、cookie、prompt/reply 正文、challenge 或 control digest；可以记录布尔匹配结果、错误类别、阶段和耗时。

根据证据选择路径：
- 传输/owner 问题：验证 exact-ID 取消、终态和 generation fencing。
- 页面控制失效：验证现有安全恢复；没有证据不扩展 canonical recovery。
- DOM 尚未就绪：仅在原预算内等待可判定状态；不把真实 foreign/App/digest mismatch 当“再等一等”。
- parser/协议失败：修正生成契约或真实实现，不宽松接受错身份/错 HEAD。
- 明确登录/2FA/CAPTCHA/服务拒绝：保留状态，要求必要人工操作，不绕过限制。
- fixture/observer/调用错误：修正该层，不污染生产结论。

每个新假设先尽可能在隔离本地/native fixture 证伪。每个假设最多一次新的受控真实曝光；再次曝光必须有新证据或实际修复，不换名称重复同一实验。
重复落在同一未知边界时，把证据和排除项提交独立 ChatGPT 作边界重新评估，不继续刷 full suite 和重启浏览器。

App-proof 的正常 owned recovery 保持一次发送、一个逻辑 wait、一次 replacement、原绝对期限；其零额外 cancel 约束不要误用为禁止 M1 在传输中断时进行必要的独立 exact-ID 取消。

## 八、回归、发布与证据纪律

每个真实源码候选：
可证伪 RED
→ 最小实现
→ 对应 focused/native/adversarial
→ typecheck/build
→ 独立源码审阅
→ 一次冻结 full
→ fresh package/profile 与源—构建—安装对应核对
→ commit/push
→ exact-HEAD scoped 补充审阅
→ 下一交付节点。

无相关源码/运行依赖变化，不因文档、诊断总结、补充审阅而重复 frozen full。
源码/测试改变后不能借用旧候选的全绿结论。
不得延长原 timeout、取消隔离、删断言、增加永久 skip 或更换测试范围换取绿色。

用插件实际支持的方式发布原始 command/exit/output。检查输出确实可读；过去缺少 command 导致仅指定 output-file 仍没有原始正文的问题不得复发。
日志被截断时标明未读范围并补读，不以标题 PASS 代替原始结果。
保留 RED 和 fixture failures；去除敏感内容后存入可持久审阅位置，不只依赖临时目录或聊天中的摘要。

## 九、解锁闭环之后完成剩余必需节点

A. Windows lock/pause/resume 资格
独立验证 WTS lock/unlock、锁定期间暂停新的页面动作、保留 uncertainty、解锁后重新验证。
原 deadline 已过期则如实终止，不能解锁后续租原操作。
“锁定时暂停并安全恢复”和“锁定时持续运行”是不同能力；后者需要独立架构/真实验证，不暗中变更本轮主目标。

B. Producer Windows Git gate
重新读取原失败与实际预算，区分测试总时限、单次 Git 时限、provider/ACL 启动、快照检查和清理耗时。
13 个 allowed Git queries 覆盖不同操作，不是可删的重复 case。
安装 profile 的 Git PASS 不能替代 producer 原 deadline gate。
先定位、建立可证伪性能/生命周期证据，再做保持语义的最小修复；不得削弱 ACL、argv、环境清理、tripwire、repository snapshot、affinity 或 generation 检查。
producer 改动需独立审阅，并重做受影响的 consumer/package/profile 组合验证。

C. 最终 global exact-HEAD 审阅
同时核对两个仓库的实际 SHA、构建/安装身份、架构边界、原始真实运行、nonce、fix/restart/第二轮、全部必需 gates。
Reviewer 给出具体问题就修复对应范围再审阅，不将 scoped verdict 当最终结果。

报告区分：
VERIFIED / FAILED / NOT_RUN / BLOCKED / FUTURE。
一个成功 E2E 证明该场景通过，不等于任意 Windows/网络/锁屏条件下长期稳定。

## 十、现在开始

先报告两仓库精确状态、已冻结证据、剩余 gates 和唯一下一行动，然后通过 codex-with-chatgpt 发起上述一次启动独立审阅并持续推进。

不要只输出计划后结束；不要让我手动来回转述 PLAN/REVIEW。
仅在登录、2FA/CAPTCHA、缺失真实凭据、不可逆外部操作或必须由我选择的产品范围时请求一次明确操作。
普通缺陷、测试失败、文档冲突和审阅修复自行处理。
没有取得真实证据的项目保持未完成；最终目标是完整产品工作流，而不是更多提交或更大的测试数量。