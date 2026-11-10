# 飞历 FeiCalendar

飞历是面向 Windows 的个人桌面日历，采用日历列表、时间网格和日程侧栏布局，支持从飞书读取日程，并将本地安排同步到飞书。

## 启动

双击 `release/FeiCalendar-0.2.0-win-x64.exe` 启动便携版。也可以运行项目根目录下的 `启动飞历.cmd`。

便携版为独立的 Windows x64 可执行文件，可以复制到其他文件夹后直接启动，运行所需的 Electron 和飞书连接组件均随程序打包。首次打开需要等待解包完成。日程保存在当前 Windows 用户的 `%APPDATA%/FeiCalendar`，同一电脑上移动程序后会继续使用已有数据。在另一台电脑上使用时，可在软件设置中连接飞书账号。

## 日历功能

- 顶部可直接切换“日视图”“三日视图”“周视图”“月视图”“年视图”和“日程列表”，下次打开时恢复上次的视图。
- 日、三日和周视图按小时排列日程。月视图展示完整月份，年视图展示十二个月。点击月历中的日期可进入当天的日视图。
- 点击或框选时间新建日程，拖动改期，拖动边缘调整时长。
- 全天、跨天日程，地点、描述和提前提醒。
- 每天、工作日、每周、每月和每年重复。本地重复日程支持修改单次或整个系列。
- 多日历、颜色、显示筛选、搜索、浅色和深色主题。
- 本地持久化、离线队列、自动同步、失败重试、冲突选择和 ICS 导出。

## 连接飞书

### 飞书账号双向同步

1. 点击左下角连接图标，进入“日历连接”。
2. 如果需要新的飞书应用，展开“配置飞书自建应用”，填写 App ID 和 App Secret。软件会更新本机 lark-cli 的应用配置。
3. 点击“授权飞书账号”，打开授权页面或扫描二维码，完成后点击“我已授权，完成连接”。
4. 同步成功后，在“通用设置”选择一个可写入的飞书日历作为“默认日历”。此后新建日程会保存到本机并进入飞书同步队列。
5. 已有本地日程可以通过左侧日历右侧的“…”菜单，迁移到选中的飞书日历。

飞书应用需要启用、发布，并允许当前用户使用。申请的用户权限如下。

```text
calendar:calendar:read
calendar:calendar.event:read
calendar:calendar.event:create
calendar:calendar.event:update
calendar:calendar.event:delete
offline_access
```

软件附带官方 lark-cli 连接组件，复用其本机应用配置和用户授权续期机制。App Secret 通过标准输入交给连接组件，凭据由组件管理。日历访问使用 `user` 身份。

连接组件会在需要时刷新登录凭据。长时间停用导致刷新凭据过期、用户撤销授权或应用停用后，需要在软件中重新授权。

### CalDAV 订阅

在飞书桌面端打开“设置 → 日历 → CalDAV 同步配置”，获取服务器地址、用户名和密码。在飞历“日历连接 → 添加订阅”中选择“CalDAV 账号”并填写。飞书常用服务器为 `https://caldav.feishu.cn`。

也可以选择“ICS / Webcal 链接”添加订阅。订阅读取支持重复日程、例外日期、单次调整、时区和全天日程。

飞书 CalDAV 提供单向读取。写回通过飞书开放接口完成。相同日历同时通过两种方式连接时，可以在左侧隐藏其中一个来源，避免重复显示。[飞书官方同步说明](https://www.feishu.cn/hc/zh-CN/articles/079695875192-第三方日历同步-管理员手册)

## 同步和数据

- 日程及待同步队列保存在 `%APPDATA%/FeiCalendar/calendar.json`。每次提交保留上一个数据快照用于恢复。
- CalDAV 密码和订阅地址通过 Electron `safeStorage` 使用 Windows 本机凭据加密，保存在 `connections.encrypted`。
- 飞书同步按当前视图的时间范围读取。切换月份或年份后会获取对应范围，搜索覆盖已经缓存到本机的数据。
- 创建请求使用持久化幂等键。更新和删除前会比对飞书版本，发生冲突后可以选择“采用飞书版本”或“保留本地并同步”。
- 飞书单次重复日程可在弹窗中明确选择“仅此次日程”后编辑。已有飞书系列的整体修改通过“在飞书中打开”完成。
- 飞书日程的现有提醒由飞书管理。新建日程可以设置提醒。桌面通知在飞历运行期间生效。
- 当前日历显示和编辑采用北京时间 `Asia/Shanghai`。全天日程会在飞书的含结束日格式与 ICS 的不含结束日格式之间转换。
- “完成”标记保存在本机。

## 开发

需要 Node.js 22 或更新版本。Windows 安装依赖时会下载 Electron 和官方 lark-cli 二进制文件。

```powershell
npm ci
npm run dev
```

```powershell
npm run check
npm test
npm run build
npm run test:desktop
npm run dist
npm run test:portable
```

`npm test` 覆盖日程格式、重复例外、时区、队列恢复和同步冲突。`npm run test:desktop` 使用独立的临时数据目录验证实际日历网格、桌面交互、视图恢复和凭据加密。`npm run test:portable` 将打包后的 EXE 复制到独立中文路径，使用仅含 Windows 系统目录的 PATH 启动，验证日程增删改、六种视图、程序移动和重启后的数据恢复。

技术栈为 Electron、React、TypeScript、FullCalendar、tsdav 和 node-ical。

## GitHub 同步

代码仓库为 [xing-skyline/feicalendar](https://github.com/xing-skyline/feicalendar)。修改后使用标准 Git 工作流提交并推送。

```powershell
git add .
git commit -m "Describe the change"
git push origin main
```

运行数据、授权会话、依赖目录、构建输出和安装包均已加入 `.gitignore`。
