# 飞历 FeiCalendar

飞历是面向 Windows 的个人桌面日历，采用日历列表、时间网格和日程侧栏布局。飞书、CalDAV、WebDAV 和 ICS 来源可同时连接，每个账号独立启用、暂停和同步。

## 启动

双击 `release/FeiCalendar-0.4.0-win-x64.exe` 启动便携版。也可以运行项目根目录下的 `启动飞历.cmd`。

便携版为独立的 Windows x64 可执行文件，可以复制到其他文件夹后直接启动，运行所需的 Electron 和飞书连接组件均随程序打包。首次打开需要等待解包完成。日程保存在当前 Windows 用户的 `%APPDATA%/FeiCalendar`，同一电脑上移动程序后会继续使用已有数据。在另一台电脑上使用时，可在软件设置中连接飞书账号。

## 日历功能

- 顶部可直接切换“日视图”“三日视图”“周视图”“月视图”“年视图”和“日程列表”，下次打开时恢复上次的视图。
- 日、三日和周视图按小时排列日程。月视图展示完整月份，年视图展示十二个月。点击月历中的日期可进入当天的日视图。
- 点击或框选时间新建日程，拖动改期，拖动边缘调整时长。
- 全天、跨天日程，地点、描述和提前提醒。
- 每天、工作日、每周、每月和每年重复。本地重复日程支持修改单次或整个系列。
- 多日历、颜色、显示筛选、搜索、浅色和深色主题。
- 本地持久化、离线队列、自动同步、失败重试、冲突选择和 ICS 导出。

## 托盘与偏好设置

“设置 → 通用设置”中的“关闭窗口后最小化到托盘”默认开启。点击窗口叉号后，飞历隐藏窗口并在后台继续同步和提醒。点击托盘图标或右键选择“打开飞历”恢复窗口，右键选择“退出飞历”可完全退出。退出时会完成已经进入队列的保存和同步操作。

通用设置还可调整新日程的默认时长和默认提醒。点击时间格创建日程使用默认时长，拖选时间范围则使用实际选择的起止时间。

“设置 → 日历显示”可选择星期一、星期日或星期六作为每周起始日，切换 12 / 24 小时制，设置日、三日和周视图的时间轴范围，并选择是否显示周末。

## 自定义教学周

在“设置 → 教学周”选择第一教学周内任意一天，填写教学周总数，然后点击“保存教学周设置”。教学周按“日历显示”中的每周起始日划分，默认从星期一开始。

日历顶部显示选中日期所属的教学周，月视图和年视图在每周左上方标出周数。起始周之前和总周数之后的日期留空。跨月、跨年的学期会连续编号。

首次使用时教学起始日期留空，周数预填为 20，可按每学期实际安排修改。清空日期并保存可关闭教学周显示。

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

在飞书桌面端打开“设置 → 日历 → CalDAV 同步配置”，获取服务器地址、用户名和密码。在飞历“日历连接 → 添加连接”中选择“飞书 CalDAV 订阅”预设并填写。飞书常用服务器为 `https://caldav.feishu.cn`。

也可以选择“ICS / Webcal 链接”添加订阅。订阅读取支持重复日程、例外日期、单次调整、时区和全天日程。

飞书 CalDAV 提供单向读取。写回通过飞书开放接口完成。相同日历同时通过两种方式连接时，可以在左侧隐藏其中一个来源，避免重复显示。[飞书官方同步说明](https://www.feishu.cn/hc/zh-CN/articles/079695875192-第三方日历同步-管理员手册)

## 多来源与多端同步

所有连接均可同时启用。在“设置 → 日历连接”重复添加账号即可，列表中的“启用”开关只作用于所在连接。新建日程选择所属日历后，修改会写回该日历对应的服务。左侧日历菜单可把已有本地日程迁移到指定的可写云端日历。

### CalDAV 双向同步

选择“通用 CalDAV”“iCloud 日历”或“Nextcloud 日历”预设，填写 HTTPS 服务地址、用户名及应用专用密码。开启写入模式后，服务端具有写权限的日历可新建、修改和删除日程。“以只读方式连接”可用于订阅账号。

多个设备连接同一 CalDAV 账号后，通过同一日历交换修改。iPhone 可在系统日历账号中添加 CalDAV，Android 可通过 DAVx⁵ 等兼容客户端接入服务。飞历当前交付 Windows 桌面版，手机侧使用服务商应用或兼容日历客户端。[Nextcloud iOS 配置](https://docs.nextcloud.com/server/stable/user_manual/en/groupware/sync_ios.html) · [Nextcloud Android 配置](https://docs.nextcloud.com/server/stable/user_manual/en/groupware/sync_android.html)

iCloud 预设使用 `https://caldav.icloud.com`，第三方客户端可使用 Apple 账号生成的 App 专用密码。Nextcloud 和 NAS 使用各自服务提供的 CalDAV 地址。[Apple App 专用密码说明](https://support.apple.com/en-gb/102654)

CalDAV 重复日程支持新建系列、编辑和删除单次日程，已有远程系列的整体管理可在来源日历中完成。日程更新保留原始 UID 和外部扩展字段，并使用 ETag 条件写入检测并发修改。

### WebDAV 网盘同步

提供坚果云、Nextcloud / NAS 和自定义 WebDAV 预设。填写网盘的 HTTPS WebDAV 文件夹地址、用户名及应用密码。不同飞历客户端填写同一地址和账号后，会使用该目录下的 `FeiCalendar/calendar-v1.json` 同步日程。

每个 WebDAV 连接对应一个云端日历，可单独设置显示颜色和默认新建目标。该文件包含此连接所属的日程、完成状态、重复规则及删除标记。勾选“同步教学周配置”后，还包含第一教学周日期、总周数和每周起始日。连接凭据由每台设备单独保存。

WebDAV 使用强 ETag 和条件写入合并多设备修改。不同日程会合并，同一日程发生冲突时在“同步记录”选择本地或云端版本。教学周配置冲突也在此处理。暂停连接期间的本地修改会进入待同步队列，恢复后继续处理。

WebDAV 服务需要支持 GET、PUT、MKCOL 和强 ETag，已有同步文件最大为 20 MB。坚果云地址预填为 `https://dav.jianguoyun.com/dav/`，Nextcloud、NAS 及其他网盘填写各自提供的 WebDAV 地址。网盘的专有文件接口需要对应适配器，通用 WebDAV 设置适用于提供这一协议的服务。

## 同步和数据

- 日程及待同步队列保存在 `%APPDATA%/FeiCalendar/calendar.json`。每次提交保留上一个数据快照用于恢复。
- CalDAV、WebDAV 密码和订阅地址通过 Electron `safeStorage` 使用 Windows 本机凭据加密，保存在 `connections.encrypted`。
- 飞书同步按当前视图的时间范围读取。切换月份或年份后会获取对应范围，搜索覆盖已经缓存到本机的数据。
- 创建请求使用持久化幂等键和原始请求快照。更新和删除前会比对云端版本，发生冲突后可以选择“采用云端版本”或“保留本地并同步”。
- 飞书单次重复日程可在弹窗中明确选择“仅此次日程”后编辑。已有飞书系列的整体修改通过“在飞书中打开”完成。
- 飞书日程的现有提醒由飞书管理。新建日程可以设置提醒。桌面通知在飞历运行期间生效。
- 当前日历显示和编辑采用北京时间 `Asia/Shanghai`。全天日程会在飞书的含结束日格式与 ICS 的不含结束日格式之间转换。
- WebDAV 日历同步“完成”标记，其他来源的“完成”标记保存在本机。

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

技术栈为 Electron、React、TypeScript、FullCalendar、tsdav、node-ical 和 ICAL.js。ICAL.js 按 MPL-2.0 许可使用，其原始发行文件及许可证随依赖打包。[ICAL.js 源代码及许可证](https://github.com/kewisch/ical.js)

## GitHub 同步

代码仓库为 [xing-skyline/feicalendar](https://github.com/xing-skyline/feicalendar)。修改后使用标准 Git 工作流提交并推送。

```powershell
git add .
git commit -m "Describe the change"
git push origin main
```

运行数据、授权会话、依赖目录、构建输出和安装包均已加入 `.gitignore`。
