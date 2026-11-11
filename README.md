# Keybox API

Go 1.26+（Docker 构建使用 1.27.3）+ Chi + GORM + MySQL 8.0 后端，附 React 管理与查询页面。
使用已修补的依赖版本，因此不承诺以已经过时的 Go 1.22 编译。原始 XML 使用 AES-256-GCM
加密后与公开元数据分表存储；默认禁止游客下载。私钥只在验证、加密和明确授权下载时
短暂存在于进程内存，永不进入普通 JSON 响应、校验历史或日志。

设计、运行方法、事务边界、安全限制见 [设计文档](docs/design.md)；
完整请求/响应及错误码见 [API 说明](docs/api.md) 和 [OpenAPI 契约](api/openapi.json)；
验收证据见 [测试与验收](docs/acceptance.md)。

```sh
go build -o bin/keybox ./cmd/keybox
go test ./...
go vet ./...
python scripts/generate_openapi.py --check
```

真实 MySQL 集成测试需要 `KEYBOX_TEST_DSN`，测试会新建并删除自己的随机数据库；
没有该环境变量时会明确跳过集成测试。生产启动必须先配置密钥、HTTPS Origin、
独立数据库角色，执行 `keybox migrate-up`，运行 `keybox serve` 后在 Web 页面创建管理员。
所有配置与运维命令见设计文档；`.env.example` 没有可用的默认凭据。

## 首次部署：在 Web 设置管理员

1. 配置后端环境并执行 `keybox migrate-up`。已有部署也须应用新迁移 `000002`，
   并重新应用 `deploy/runtime-grants.sql`，为运行角色增加 `admins` 的 INSERT 权限。
2. 生成独立随机令牌（例如 `openssl rand -hex 32`），仅通过后端环境变量
   `KEYBOX_SETUP_TOKEN` 或 secret mount `KEYBOX_SETUP_TOKEN_FILE` 注入。
   不要写入 Git、URL、前端 `VITE_*` 变量或构建产物。
3. 启动 API；执行 `npm ci && npm run build`，将生产 `dist/` 作为 HTTPS 站点的静态目录，
   同源代理 `/api/`。`deploy/nginx.conf.example` 含页面路由回退配置。
4. 访问 `/admin/login`，未初始化时会自动进入 `/admin/setup`。输入令牌，自行设置用户名、
   密码及确认密码；密码须为 **16–72 UTF-8 字节**。创建后使用该账号正常登录。
5. 完成后从所有 API 实例移除初始化令牌并重启。数据库会永久记录初始化完成，
   即使保留令牌、账号停用或账号被外部删除，也不会自动重开入口。

**没有默认管理员账密。** 已有管理员的部署保持原账号，初始化接口返回 409。
`keybox init-admin` 保留为离线首次初始化方式，与 Web 共用一次性限制，不用于追加账号或重置密码。

## 本地前端预览

```sh
npm run setup:preview
npm run build:preview
npm run preview:local
```

预览地址为 `http://localhost:8080`。初始化命令生成随机密码并显示账密，
保存于被 Git 与 Docker 忽略的 `.env.preview.local`。登录页可点击“填入预览账号”。
这是本地 Mock 账号，不会创建后端管理员，也不访问生产数据；错误账密返回登录失败。

预览必须显式使用 `--mode preview`，产物位于 `dist-preview/`，且只在回环地址启用。
`npm run build` 固定执行生产构建，产物位于 `dist/`，只连接真实 API，
不包含 Mock 实现、预览密码或演示模式切换按钮，并自动运行产物隔离检查。
`VITE_API_MODE` 不再用于启用 Mock。生产管理员通过上述 Web 初始化流程独立创建，
不得使用本地预览账密。
