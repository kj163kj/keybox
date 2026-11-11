# Keybox API

Go 1.26+（Docker 构建使用 1.27.3）+ Chi + GORM + MySQL 8.0 后端。仅 API，无前端。
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
独立数据库角色，执行 `keybox migrate-up` 和一次性 `keybox init-admin`，再运行
`keybox serve`。所有配置与运维命令见设计文档；`.env.example` 没有可用的默认凭据。

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
`VITE_API_MODE` 不再用于启用 Mock。生产管理员仍须通过后端一次性命令独立创建，
不得使用本地预览账密。
