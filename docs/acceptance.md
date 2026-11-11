# 测试记录与验收清单

## Web 管理员初始化：本次验证

已执行真实 MySQL 的 `go test ./...` 与 `go vet ./...`，全部通过；
前端 Vitest **22 项测试通过**，含 10 项初始化流程测试。
TypeScript 检查、生产 Vite 构建、生产产物隔离检查、Windows 与 Linux amd64
发布编译均通过。OpenAPI 规范校验通过（21 个路径、26 个操作），Go 路由与契约、
生成的 TypeScript 类型均保持同步。

| 新增规则 | 验证结果 |
| --- | --- |
| 空部署与缺少令牌 | 返回准确初始化状态；未配置令牌时 POST 40304，页面只显示部署提示 |
| 来源与凭据校验 | 缺失/非法 Origin、非 JSON、错误令牌、空白或超长用户名、超长 UTF-8 密码均被拒绝 |
| 密码下限 | 后端及页面按 UTF-8 字节计算，7 字节拒绝、8 字节通过；真实 MySQL 测试确认 8 字节密码可创建管理员并登录，72 字节上限保留 |
| 一次性与并发 | 8 个并发存储调用、4 个并发 HTTP 请求各只有一个成功；重复提交返回 40904 |
| 持久关闭 | 已有/停用管理员均关闭入口；完成后外部删除账号也不重开；迁移能识别已有管理员 |
| 故障关闭与原子审计 | 缺失/异常初始化标记拒绝创建；注入审计失败时账号和完成标记一起回滚，可随后重试 |
| 登录与脱敏 | bcrypt cost=12；初始化不签发 Cookie，移除令牌后仍可正常登录；令牌/密码/哈希不出现在响应或日志 |
| 限流与权限 | 初始化限流返回 429 + Retry-After；运行角色能初始化，仍不能更新/删除/截断审计与下载日志 |
| 页面流程 | 首次访问转设置页；状态错误可重试；密码不一致/UTF-8 超限时不提交；提交中禁用表单；成功后登录页密码为空 |
| 并发页面与生产隔离 | 另一请求完成初始化时转回登录；密码和令牌不写浏览器存储；生产产物仍无预览账号、Mock 实现或演示控件 |

页面采用既有表单与按钮样式、关联标签和错误提示、即时提交状态反馈；未增加额外动效。
本次未启动预览服务，页面验证通过组件测试完成，未声称经过实际浏览器视觉或生产 HTTPS 验收。

## 初版后端验证（历史记录）

环境：Windows amd64，Go 1.27.3，真实 MySQL Community Server 8.0.44。
集成测试通过 `KEYBOX_TEST_DSN` 连接本地测试实例，为每个测试创建随机命名数据库，
结束后删除自己创建的数据库；权限测试另创建/删除随机账号与角色。未使用 SQLite
替代 MySQL，也没有使用真实 Google 信任的 Keybox 私钥样本。

初版后端测试记录：**40 项测试通过（含子测试），0 失败，0 跳过**。
运行的命令：

```sh
go test -json -count=1 ./...
go vet ./...
go build -trimpath -o bin/keybox ./cmd/keybox
# Linux 容器目标的静态交叉编译：
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -o bin/keybox-linux ./cmd/keybox
python scripts/generate_openapi.py --check
```

测试环境中设置了 KEYBOX_TEST_DSN；未设置时，真实 MySQL 测试会明确 skip，
不能把这种运行当成已完成集成验收。建议 CI 强制提供专用 MySQL 测试实例。
`go test -race ./...` 可在具备 Go race 支持和 C 编译器的环境另行执行。

额外执行：

- `openapi-spec-validator` 校验 OpenAPI 3.0.3：通过，20 个路径、24 个操作。
- Go 契约测试确认文档与 Chi 注册路由双向一致，所有本地 `$ref` 可解析。
- `govulncheck v1.9.0`：0 个可达漏洞、0 个已导入包级漏洞。
  有 1 个未导入的模块级提示 GO-2026-5932，位于 `x/crypto/openpgp`；
  本项目仅使用 `x/crypto/bcrypt`，没有导入或调用 OpenPGP。依赖升级已修复本次发现的
  Chi 与 x/text 可达问题。继续保留稳定依赖版本，未为移除无关提示引入预发布包。
- 编译后的独立服务真实 HTTP 冒烟测试：`/healthz`、管理员登录、安全 Cookie、
  公开列表、管理健康、关闭游客下载、登出及会话撤销均通过。
- 冒烟健康接口返回 200、root_count=2、crl.usable=true，实际连接 Google CRL 上游成功。
- Windows 可执行文件及 Linux amd64 静态构建均成功。
- `git diff --check`、契约重新生成一致性检查通过。

## 核心规则对应测试

| 规则 | 验证方式与结果 |
| --- | --- |
| RSA 与 ECDSA 两条链 | 动态生成合成 RSA/ECDSA Keybox，经完整 Validator 得到 valid |
| XML 不安全输入 | DTD/外部实体、命名空间、第二个顶层根、数量不符、未知元素、超大输入、已取消 context 被拒绝 |
| UTF-8 BOM 与原始身份 | BOM 文件正常验证，file_sha256 保持对原始字节计算 |
| RSA 预计算前限制 | ASN.1 大整数超过 8192 bit 即拒绝，不先调用 RSA 私钥预计算；PEM 杂项前缀被拒绝 |
| 私钥匹配 | 不匹配的 ECDSA 私钥导致 invalid |
| 签名关系 | 修改证书 DER 签名后，完整 Validator 返回 chain_invalid |
| 有效期 | 过期返回 expired；尚未生效返回 invalid；notAfter 精确边界可接受，下一纳秒过期 |
| 根匹配 | 非受信根拒绝；撤销链根导致两条链都 revoked |
| serial 规范化 | 大小写、前导零、0x、冒号归一；纯数字仍按 hex；非法字符拒绝 |
| CRL fail-closed | 无可用缓存时为 indeterminate，上传 422，公开详情不显示 valid，valid 列表不包含陈旧记录 |
| CRL 缓存生命周期 | MySQL 保存版本、ETag 条件请求、304 更新元数据、允许有限陈旧、超时限后不可用 |
| CRL 格式异常 | 未知状态、重复 JSON key、规范化后重复 serial、尾随 JSON 均拒绝；不覆盖旧缓存 |
| 根受控更新 | 摘要不符不激活；已批准集合原子切换并保留历史；旧根过期后仍能批准替换恢复 |
| 预检不入正式库 | validate 200 后 keyboxes 行数仍为 0 |
| 有效上传 | 上传 201，密文不可读，解密与原始 XML 逐字节相同 |
| 无效不入库 | 非法 XML、过期证书被拒绝，正式行数保持不变；超大上传 413 |
| 双重去重 | 原样重传及只改变 XML 空白都返回 409 |
| 公开状态查询 | 列表、详情、最新缓存状态、serial 查询正常且不返回敏感字段 |
| 管理员认证 | 未登录 me/下载 401；Cookie Secure/HttpOnly/SameSite/Path 符合约定；登出后 401 |
| CSRF 与二次确认 | 缺 CSRF 403；缺开启确认头 409；正确请求修改成功 |
| 下载策略六组合 | global false × 三策略均 403；global true 的 inherit/allowed 可下载，denied 403 |
| 全局关闭优先 | 单条 allowed 在全局再次关闭后仍 403 |
| 下载日志与审计 | 默认拒绝写 guest 日志；成功管理员下载写 admin 下载日志与审计 |
| 下载字节和响应头 | 返回原始 XML，attachment、nosniff、no-store 存在 |
| 上传/下载 429 | IP/组合限流返回 429 且存在 Retry-After |
| 跨请求原子配额 | 20 个并发请求竞争全局 7 次额度，恰好 7 次成功；其他维度没有部分扣减 |
| 全局并发租约 | 8 个槽占满时第 9 次拒绝；释放后可以再获取 |
| 审计与业务原子性 | 注入审计写入故障，全局开关修改回滚 |
| 物理数据库权限 | 使用实际 runtime-grants.sql 创建角色；能追加日志，但 UPDATE/DELETE/TRUNCATE audit_logs、download_logs 全部失败 |
| 重新校验与历史 | 撤销根后再校验返回 revoked，保存历史；撤销恢复后可重新验证 |
| 隐藏/恢复/软删除 | 隐藏时公开详情/状态/下载 404；管理员仍可看；恢复可见；删除后物理行仍在且 deleted_at 已写 |
| 脱敏 | 所有被测试 JSON 不包含私钥块、storage_ref、密文、密码/会话哈希、DER；应用日志无密码、Cookie、CSRF token、原始 IP |
| 代理信任 | 未配置可信代理时，伪造 X-Forwarded-For 不改变客户端 IP |

## 部署环境验收

以下项目需要实际部署基础设施，不以本地编译结果替代：

- [ ] 在 Docker 主机实际构建镜像并运行 Compose；当前环境没有 Docker daemon。
- [ ] TLS 代理部署后确认 `/admin/setup` 可直达，完成初始化后可登录；检查 Secure Cookie 的浏览器收发、Origin/CORS 和同站点策略。
- [ ] 代理/CDN 确认下载与上传路径无缓存、无明文临时文件、无请求体/凭据日志。
- [ ] 在具备 C 编译器的环境运行 race 检测；当前 Windows 环境未安装该编译器。
- [ ] 压力测试 1 MiB 输入、RSA 最大规格、8 个重操作并发、慢客户端、固定窗口边界。
- [ ] 实际 SIGTERM 优雅退出、数据库断开/恢复、备份恢复、旧加密密钥轮换演练。
- [ ] 在生产 MySQL 上使用独立迁移账号与最小权限运行角色，确认应用账号不具备 DDL 或日志删除权限。
- [ ] 根更新按独立官方渠道核验；监控 CRL 超期、待批准根版本和后台再校验积压。
- [ ] 上线首次确认 guest_download_enabled=false；确认管理页开启下载的二次确认生效。
- [ ] 应用 `000002` 迁移和更新后的运行角色授权；初始化后移除所有实例的部署令牌并重启。

本仓库包含前端与后端实现，未发布公网服务、未创建默认管理员密码，也未把任何真实
Keybox 私钥写入 Git。Docker 配置、SQL 迁移、接口与命令可供部署方直接审查。
