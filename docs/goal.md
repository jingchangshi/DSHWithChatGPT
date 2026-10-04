# PlannerBridge 产品目标

Windows DSH / DeepSeek Executor 通过 PlannerBridge 与真实 ChatGPT Web Planner / Reviewer 协作：取得 PLAN，执行并测试，commit/push，独立审阅，必要时取得 fix PLAN，实际重启 DSH，以相同任务 reconnect，完成第二轮执行和 exact-HEAD REVIEW，取得同轮 DONE，并通过原 acceptance oracle。

唯一动态入口是 [status/current.md](status/current.md)。架构边界见 [target-architecture.md](target-architecture.md)，验收契约见 [acceptance-plan.md](acceptance-plan.md)。本文件不记录执行时间线。

## 产品边界

- Windows 本地优先；Linux executor + Windows browser host 是 FUTURE。
- deepseek-harness 提供 execution-world identity、provider affinity、ReadLease/GitLease、FS/subprocess/sandbox；DSHWithChatGPT 提供协议、编排、状态、Sidecar、共享 Web driver、Direct CDP 和只读 MCP data plane。
- 产品 Planner / Reviewer 来自真实 ChatGPT 网页。开发时可以自主实现和审阅；codex-with-chatgpt 不是运行依赖。本轮用户已明确允许不使用该插件，不能将自主审阅称为网页独立审阅。
- Browser Harness 保留兼容路径；primary acceptance 使用专用 Chrome 和 Sidecar，开发与产品的 target、状态、凭据分开。
- workspace ID 不授予内容权限；失效的能力不能由 Host FS/shell 回退替代。协议身份、digest、App proof、route/document/epoch fence 和固定 deadline 均须保持。
- 不重复 Enter，不以新 ID 重发不确定操作，不猜测 target 归属，不用扩大 timeout、skip 或削弱断言换取 PASS。

## 架构收敛规则

修改前先把失败归属于 invariant 与既有机制。以下任一条件出现时，先审查架构和生产 diff，再写补丁：同一机制连续 patch 至少三次；新增 mutable state；新增特殊 recovery branch；复制生命周期；测试夹具需要更多生产内部状态。

审查须说明新增状态/分支、可复用机制、删除的重复逻辑、无用状态/函数、第三个恢复 caller 是否仍成立。先审查设计，再查看测试结果。优先内部纯迁移规则和一个资源交接流程，不新增公共 provider 或为行数进行大重写。

历史目标、执行提示和失败记录完整保留于 [历史快照](history/2026-10-04-pre-consolidation/README.md)及 [evidence](evidence/)。局部或 synthetic PASS 不能替代真实产品闭环。
