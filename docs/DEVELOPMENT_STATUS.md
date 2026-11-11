# 开发进度与后续入口

更新于 2026-11-11，当前迭代在 Windows 0.5.3 收口。后续功能采用小版本分批实现，手机端暂缓。

## 发布状态

0.5.3 完成苹果风格桌面界面改版与全进程树运行资源优化，覆盖本地类型检查、51 项测试、真实桌面／便携／桌面日历／OAuth 模拟回归及图标校验。上一正式版 [0.5.2 发行版](https://github.com/xing-skyline/feicalendar/releases/tag/v0.5.2) 已于 2026-11-11 发布（[发布构建记录](https://github.com/xing-skyline/feicalendar/actions/runs/42975950507)）。

## 0.5.3 已实现范围

| 模块 | 实现与主要入口 |
| --- | --- |
| 快捷录入与模板 | `capture.ts`、`QuickCapture.tsx`、`CaptureSettings.tsx`，支持快捷键和本机日期解析 |
| 提醒中心 | `electron/reminders.ts`、`ReminderCenter.tsx`，持久化去重、补查、稍后提醒、只读来源本机提醒 |
| 桌面日历增强 | `electron/desktop.ts`、`DesktopPanel.tsx`、`DesktopSettings.tsx`，大月历、编辑、完成、拖动、独立筛选和窗口模式 |
| 恢复 | `electron/history.ts`、`electron/backups.ts`、`RecoverySettings.tsx`，撤销、回收站、每日与加密备份、日程恢复预览 |
| 农历与纪念日 | `almanac.ts`、`HolidaySettings.tsx`、`data/holidays.json`，2026/2027 调休、纪念日与工作日安排 |
| 待办与日历组合 | `TaskSidebar.tsx`、`CalendarSets.tsx`、`CalendarService`，排期、子任务、优先级与显示组合 |
| 日历工具 | `CalendarTools.tsx`、`electron/imports.ts`、`print.ts`，高级搜索、批量操作、ICS 预览去重、打印与 PDF |
| 学期与课程 | `courses.ts`、`CourseSettings.tsx`，多学期、节次、单双周与指定周、调课和停课 |
| 时间安排辅助 | `availability.ts`、`Availability.tsx`、`EventEditor.tsx`，缓冲、空闲查询和重叠提示 |
| Google / Microsoft 同步 | `electron/oauth.ts`、`oauth-calendar.ts`、`OAuthConnections.tsx`，PKCE 浏览器授权、刷新、多账号、双向同步、条件写入和身份核对 |
| 苹果风格界面与性能优化 | `src/styles.css`、`src/App.tsx`、`src/shared/dates.ts`、`src/shared/recurrence.ts`、`src/shared/occurrences.ts`、`electron/service.ts`、`electron/vault.ts`，统一浅色／深色视觉规范、100%–150% 缩放适配、时区格式化与重复规则缓存、快照引用复用及后台窗口释放 |

## 验证入口

本轮已通过 TypeScript 类型检查及 51 项逻辑／协议测试。生产构建通过，新增功能的真实 IPC／界面测试和原生桌面测试通过，包括加密备份导出、预览与恢复，桌面嵌入／浮窗／置顶切换。Google / Microsoft 模拟服务下的完整界面、凭据存储、读写删除与冲突流程通过。同时完成 500 条与 5,000 条日程规模下的基线与改版后全进程树性能实测，覆盖启动、静置、托盘、桌面常驻日历、六视图切换、检索编辑、120 天重复展开及多来源同步。

0.5.3 本地便携版已通过独立中文路径、仅系统 PATH、移动改名、六种视图、教学周、托盘及重启持久化验证。便携启动器与应用 EXE 的 10 种尺寸图标一致。发布前对 Git 历史、工作区与 `app.asar` 核对已知凭据和个人日程内容，未发现匹配。运行依赖的 `npm audit --omit=dev` 返回 0 项漏洞。

类型检查使用 `npm run check`，逻辑与协议回归使用 `npm test`。新增测试覆盖日期解析、提醒去重、农历与调休、撤销、加密备份、待办与课程一致性、ICS 去重、打印转义和空闲计算。

`npm run test:productivity` 在隔离数据目录与隐藏 Electron 窗口中验证真实 IPC 和界面交互，包括待办拖动、课程表单、PDF 文件生成和重复导入。`npm run test:widget` 验证原生桌面嵌入、托盘与重启恢复。`npm run test:portable` 验证实际 EXE 在独立中文路径下运行、移动改名及持久化。测试始终使用虚构数据。

`npm run test:oauth` 使用模拟浏览器回调与服务响应，验证真实设置界面、IPC、加密凭据存储、多账号共存、暂停恢复、创建修改删除和冲突处理。Google / Microsoft 的真实应用注册、账号授权和实际服务兼容性仍待验证。

飞书现有连接曾完成真实账号的创建、修改、回读和清理。CalDAV、WebDAV 的协议回归使用模拟服务，具体服务商的真实账号兼容性需要分别验证。

## 当前功能边界

- 备份恢复界面目前恢复日历与日程。完整待办、课程定义、模板和设置可通过数据库迁移恢复，下一步可扩展为有预览的分类恢复。
- 日历检索、冲突与空闲计算基于本机缓存。尚未读取的云端日期需要先同步。
- ICS 导入和批量复制、移动按所选范围生成独立日程。日程编辑器保留既有重复系列管理规则。
- 课程定义、待办、纪念日和模板存于本机。生成的云端日程沿所属日历同步，WebDAV 当前还同步基础教学周设置。
- 公历 2 月 29 日在平年按 2 月 28 日处理，农历三十遇小月按二十九处理。
- 原生桌面模式受 Windows Explorer 和桌面管理工具影响，提供普通浮窗和置顶模式。

## 暂缓及尚未实施

| 项目 | 当前状态 | 继续工作前需完成 |
| --- | --- | --- |
| Google / Microsoft 真实服务联调 | 接口已纳入 0.5.2，模拟验证已覆盖 | 使用自行注册的桌面应用完成真实账号授权及日程写入回读 |
| 手机网页客户端 | 按当前安排暂缓，HTTPS 配对服务仅有原型 | 手机界面、离线队列、冲突处理、证书与授权流程、实际手机验证 |
| 跨来源完整日程或忙闲同步 | 尚未实施 | 来源到目标规则、删除策略、修改冲突、循环与重复避免 |
| 演示隐私模式与诊断工具 | 尚未实施 | 内容遮蔽、日志脱敏、连接测试与失败重试入口 |
| 番茄钟、习惯和时间统计 | 尚未实施 | 明确各项存储和统计口径后分批实现 |
| 天气和预约链接 | 尚未实施 | 服务选择、缓存与配置、外部服务依赖验证 |
| 可选 AI 通知解析 | 尚未实施 | 本地或用户选择的服务、凭据保护、可编辑草稿与确认保存 |

本机开发环境的手机端原型保存在被 Git 忽略的 `.runtime/mobile-prototype`，其中的整合补丁同时包含本轮其他改动，恢复时应只提取对应模块。`.runtime/deferred-oauth` 是旧阶段备份，OAuth 当前实现以公开源码为准。

## 后续开发顺序

先收集 0.5.3 实际使用反馈，修复回归并完善恢复预览。之后每次选择一个完整功能完成界面、数据兼容与验证，再发布小版本。新增同步服务须保留现有队列、冲突和幂等处理，敏感信息继续通过系统凭据保护机制保存。

发布时更新版本号、README 和更新日志，运行对应验证，检查打包文件和提交内容中的个人信息。客户端升级依赖正式 GitHub Release 中的 EXE 与 SHA-256 校验文件，单独推送源码不会触发客户端更新。
