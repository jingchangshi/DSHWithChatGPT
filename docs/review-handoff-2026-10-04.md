# 双仓库审阅交接（2026-10-04）

本次提交保存未完成目标的当前候选和原始证据，供 ChatGPT 网页版独立分析；不是整体验收通过。两个仓库均使用 `feat/complete-c2c-runtime`。

## DSHWithChatGPT（消费端）

交接前基线为 `bf5a0bec82261f1e82695cd4126515b35ca4dd5f`。完整目标见 [目标文档](plannerbridge_codex_goal_web_research_bf5a0bec.md)。

- `message-observation.ts` 在同一次完整扫描中区分 READY、MISSING_BODY 和结构歧义。只有可见、正确 user role、唯一 ID、无正文 marker 的单一空 shell 可以等待；其他 user、重复身份、角色冲突、多正文和隐藏正文仍拒绝。
- `chatgpt-web-driver.ts` 只对窄 MISSING_BODY 状态进行只读轮询，使用一个绝对 10 秒窗口，覆盖原有最多一次 fenced reload；不刷新期限，保留外层取消、target/document/route 和 App/digest 验证。最后一次调整将 conversation/App 检查提前到等待之前。
- `errors.ts` 增加本地诊断原因，公共 SEND_UNCERTAIN 保持不变，原因不通过 Sidecar RPC 序列化。
- 诊断 fixture 委托原方法一次，记录 sink 的同步异常、异步拒绝和永久 pending 均不阻塞结果。新增真实调用序列及 RPC/journal 等价性测试；异步诊断不作为权威 journal。
- 保留 D28b/D28c 实验、失败夹具、真实网页审阅与全部原始输出，不删除失败记录。

## 已有验证及适用范围

证据位于 `docs/evidence/iteration123/`：62 等价性 32 PASS；72 observation 22 PASS；77 和最后源码调整后的 87 focused 56 PASS；84 两个 browser regression 文件 110 PASS。85/86 targeted native 13 PASS、161.72 秒，但使用 78 的编译产物，早于最后 conversation 检查前移；不得当作最终源码的完整 native 验证。

本次交接重新 build/typecheck 均 exit0，输出 88/89；重新编译后的四个 body native 场景全部 PASS、50.82 秒，另九项被过滤跳过，输出 90/91。未运行本候选的全量回归、package/profile 再生成或新的真实产品曝光。

## deepseek-harness（生产端）

当前 HEAD 为 `0afd708c288b079096affbfeff4626dcf9a19bf1`，交接时工作区干净，无新增待提交修改。已有提交包括 Windows SSH client stream transport、固定 Git lease 清理与远端控制测试、hardened Git lease assurance、Windows Git stream redirection 防护，以及 SandboxEngine 可用性阻塞证据。本次保留已有提交并同步远端，不制造空提交；生产端 Windows Git gate 尚不能宣称完成。

## 网页读取超时与未完成事项

原 ChatGPT 审阅页面连续读取超时后，同一保存会话已实际取得 56、68、69、76 审阅；67 明确没有工作区工具，不能作为源码审阅。选择当前工作区工具、短消息和分开执行慢页面操作已恢复此前审阅流程，但不能据此声称浏览器超时缺陷已根治。本次由用户在网页版继续分析，不自动发送新审阅请求。

76 允许窄 MISSING_BODY 修复；未知 role 的 pending fixture 不是生产 RED。70/71 零高度 shell 被 visibility 排除，73/74 可见 shell 才建立可用性 RED。11 秒 eventual-valid 只证明期限取舍，不授权扩大 timeout。历史 real123 只有一次 accepted send，未绑定、未 wait/replacement，其根因仍 UNKNOWN，不能将合成场景归因为历史原因。

下一步请独立审阅当前源码和上述原始证据，决定必要的冻结全量/package/profile/关联验证；之后才做 exact-HEAD review 和受限的新真实曝光。phase1 PLAN、实际 DSH restart/reconnect、phase2 实现/审阅、同轮 DONE/oracle、lock qualification、producer Windows Git gate、双仓库 exact-HEAD global review 均仍待完成。
