# API v1 契约

机器可读契约：`api/openapi.json`，OpenAPI 3.0.3。以下是便于前后端评审的字段说明。
所有路径以 `/api/v1` 为前缀，健康探测例外。Web UI 使用同一契约生成的 TypeScript 类型。

## 通用约定

JSON 成功与失败均返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {"id": "0123456789abcdef0123456789abcdef"},
  "request_id": "abcdef0123456789abcdef0123456789"
}
```

request_id 为服务端新生成的 32 位 hex，同时出现在 `X-Request-ID` 和结构化日志中；
不信任客户端传来的同名头。`code=0` 表示请求成功，并不表示校验结果一定 valid。
失败 data 通常为 null；422 上传/解析失败带 Validation，503 健康退化带 Health。
不允许依据 message 文案进行程序分支；使用 HTTP 状态与 code。

下载成功例外：返回文件流而非 JSON，request_id 使用响应头；下载失败仍为 JSON。
所有应用响应 `Cache-Control: no-store`；429 必须包含以秒为单位的 Retry-After。

ID：32 位小写 hex；指纹：64 位小写 hex；序列号：无前导零的小写十六进制。
时间：UTC RFC3339 字符串。XML 接受 UTF-8（含可选 BOM），不接受压缩文件或其他字符编码。
数组无内容时返回 `[]`。未知查询字段不用于 SQL 拼接。
分页 page 默认 1、范围 1–10000；page_size 默认 20、范围 1–100。按 created_at DESC、
id DESC 排序；并发插入时页码分页不是一致性快照。

跨域请求的 Origin 必须在精确 HTTPS 白名单。管理员使用
`__Host-keybox_session` Cookie；除登录与首次初始化外，所有管理员写请求同时需要 Origin、
`X-CSRF-Token`。登录和首次初始化也需 Origin；初始化额外需要部署令牌。GET 不要求 CSRF。

## 复用数据类型

**Certificate**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| subject / issuer | string | 证书 DN，不返回 PEM/DER |
| serial_number / fingerprint_sha256 | string | 规范化 serial / SHA-256 |
| not_before / not_after | datetime | 逐证书有效期 |
| position | integer | 链首为 0 |
| is_root | boolean | 是否链尾根 |
| root_trusted | boolean | 该链顶部根是否在当前集合 |
| chain_signature_valid | boolean | 签名/链接及完整路径约束是否通过 |
| time_valid | boolean | 包含边界的有效期检查 |
| crl_status | enum | not_revoked / revoked / unknown |
| certificate_status | Status | 当前逐证书结果 |

**Chain**：`index`（从 1 开始）、`algorithm`（rsa/ecdsa）、`chain_status`（Status）、
`private_key_valid`（仅布尔匹配结果）、`certificates: Certificate[]`。

**Validation**：
`overall_status: Status`、`file_sha256: string`、`chains: Chain[]`、
`errors: {code:string, chain?:integer, position?:integer}[]`、
`root_set_version:string`、`crl_version:string`、
`crl_fetched_at:datetime|null`、`crl_expires_at:datetime|null`、
`crl_usable:boolean`、`validated_at:datetime`。

Status：
`valid | invalid | revoked | expired | untrusted_root | chain_invalid | indeterminate`。
errors 的稳定层级码包括 XML_OR_KEY_INVALID、PRIVATE_KEY_MISMATCH、CRL_UNAVAILABLE、
ROOT_SET_UNAVAILABLE、PATH_CONSTRAINTS_INVALID，以及状态对应的全大写码。
链从 1 开始、证书位置从 0 开始；这些坐标用于展示定位，不是数据库 ID。

**KeyboxSummary**：
`id`、`file_sha256`、`overall_status`（安全投影状态）、
`last_validation_status`（历史状态）、`created_at`、`last_validated_at`、
`guest_downloadable_effective:boolean`。
管理员列表另有 `visibility:public|hidden`、`guest_download_policy:inherit|allowed|denied`。

**KeyboxDetail**：Validation 的所有字段，加
`id`、`created_at`、`status_checked_at`、
`guest_download_enabled:boolean`、`guest_download_policy`、
`guest_downloadable_effective:boolean`。
管理员详情另有 visibility 和 admin_note（最长 2000 字节，默认空字符串）。

**Page<T>**：`items:T[]`、`page:int`、`page_size:int`、`total:int`。
所有公开与普通管理 DTO 都不包含私钥、原始 XML、密文、内部存储路径或 DeviceID。

## 公开接口

下表列出各端点业务状态码。所有接口还可能返回 40303 Origin 拒绝、42901 全局配额、
40801 请求超时、50001 内部错误、50301 依赖故障；路径不存在 40401，
不支持的方法 40501。

| 方法与路径 | 请求 | 成功 data | 业务失败 HTTP/code |
| --- | --- | --- | --- |
| POST /keyboxes/validate | multipart/form-data，唯一 file；`.xml`、≤1 MiB | 200 Validation；可解析但证书无效也返回 200，其 overall_status 非 valid；写临时运行 | 400/40001 文件缺失或 multipart 错误；413/41301；415/41501；422/42201 XML/密钥材料不合法；429/42901 或 42902 |
| POST /keyboxes | 同上；不接受预检结果/token；重新完整校验 | 201 `{id,overall_status:"valid",created_at}` | 同预检输入错误；422/42202 任一校验未通过，包括 CRL 不可用；409/40901 文件/证书集合/链首证书重复；429 |
| GET /keyboxes | page、page_size、status?（Status） | 200 Page<KeyboxSummary>；status 按投影状态筛选，只返回 public 未删除条目 | 400/40001 参数错误 |
| GET /keyboxes/{id} | 路径 id | 200 KeyboxDetail，基于当前缓存重新计算状态 | 404/40401 不存在/隐藏/删除 |
| GET /keyboxes/{id}/status | 路径 id | 200 `{id,validation:Validation,status_checked_at}`；不触发外网抓取 | 404/40401 |
| GET /keyboxes/{id}/download | 路径 id；无需会话 | 200 原始 XML 文件流 | 403/40301 全局关闭或单条 denied；404/40401 不可见/不存在/删除；429/42901 或 42902；503/50301 审计/存储/解密失败 |
| GET /certificates/status | serial_number 或 fingerprint_sha256 二选一；支持 page/page_size | 200 Page<CertificateMatch> 加 query 与 status_checked_at | 400/40001 未提供/同时提供两个选择器或格式无效 |

CertificateMatch：`{keybox_id,chain_index,certificate:Certificate}`。
serial 不具有跨 issuer 的全局唯一性，必须返回匹配列表，不取第一条。只返回公开
未删除 Keybox 下的证书。共享根可能出现多次，每个结果包含所属链上下文。

证书查询的 query：
`{serial_number:string,fingerprint_sha256:string,crl_status,certificate_status}`。
未提供的选择器为空字符串。serial 可直接查询 CRL，即使站内没有该证书；query 层仅能
断定 revoked，否则 certificate_status=indeterminate；完整有效性以 items 内的证书结果为准。
未知指纹没有 serial 可用于 CRL 查询，query 的 crl_status=unknown。没有站内匹配时
仍返回 200、items=[]、total=0，不能把“未查到撤销”当成证书有效。

## 管理员接口

以下表中除登录和 `/admin/setup` 外均要求 Cookie。需要会话的写接口增加 401/40101 未登录/失效，
403/40302 CSRF 或写请求 Origin 校验失败；有 JSON body 的操作要求 application/json，
拒绝未知字段、尾随第二个 JSON 对象和超过 8 KiB 的请求。

| 方法与路径 | 请求 | 成功 data | 业务失败 HTTP/code |
| --- | --- | --- | --- |
| GET /admin/setup | 无；无需会话 | 200 `{initialized:boolean,setup_available:boolean}`；仅当未初始化且后端已配置令牌时 available=true | 503/50301 状态读取失败或迁移标记缺失/异常 |
| POST /admin/setup | JSON `{setup_token:string,username:string,password:string}`；无需会话/CSRF；要求白名单 Origin | 201 `{initialized:true,admin:{id,username}}`；不签发 Cookie，随后正常登录 | 400/40001 格式/长度；401/40102 令牌错误；403/40303 Origin；403/40304 未配置令牌；409/40904 已初始化；415/41501；429/42901 或 42902；503/50301 存储/审计故障 |
| POST /admin/login | JSON `{username:string,password:string}`；Origin 必须在白名单 | 200 `{admin:{id,username},csrf_token,expires_at}`；Set-Cookie | 400/40001 格式；401/40101 凭据错误或禁用；403/40303 Origin；415/41501；429/42901 或 42902 |
| POST /admin/logout | 无 body；CSRF | 200 null；撤销会话并删除 Cookie | 401、403/40302 |
| GET /admin/me | Cookie | 200 `{id,username,csrf_token,expires_at}` | 401 |
| GET /admin/keyboxes | page、page_size、status?、guest_download_policy? | 200 Page<管理员 KeyboxSummary>，含 hidden，不含软删除 | 400/40001 |
| GET /admin/keyboxes/{id} | id | 200 管理员 KeyboxDetail，无私钥 | 404/40401 |
| POST /admin/keyboxes/{id}/revalidate | id；无 body；CSRF | 200 Validation，即使重新变为 revoked/invalid；保存历史并审计 | 404/40401；409/40902 较旧运行/状态冲突；429/42901 或 42902 |
| PATCH /admin/keyboxes/{id} | JSON 至少一个 `{visibility?,admin_note?,guest_download_policy?}`；CSRF | 200 更新后的管理员 KeyboxDetail | 400/40001 空更新/枚举/备注长度；404/40401；415/41501 |
| DELETE /admin/keyboxes/{id} | id；无 body；CSRF | 200 `{id,deleted:true}`；软删除 | 404/40401，包括重复删除 |
| GET /admin/keyboxes/{id}/validation-runs | id、page、page_size | 200 Page<ValidationRun> | 400/40001；404/40401 |
| GET /admin/keyboxes/{id}/download | Cookie；GET 不要求 CSRF | 200 原始 XML 文件流；可下载 hidden，独立限流与审计 | 401；404/40401；429/42901 或 42902；503/50301 |
| GET /admin/settings/guest-download | 无 | 200 `{enabled:boolean}` | 401 |
| PATCH /admin/settings/guest-download | JSON `{enabled:boolean}`；CSRF；开启另需确认头 | 200 `{enabled:boolean}` | 400/40001 缺少 enabled；409/40903 开启缺少二次确认头；415/41501 |
| GET /admin/audit-logs | page、page_size、action?（≤64 字节） | 200 Page<AuditLog> | 400/40001 |
| GET /admin/download-logs | page、page_size | 200 Page<DownloadLog> | 400/40001 |
| GET /admin/system/health | 无 | 200 Health；依赖退化时 503/50302，data 仍为 Health | 401；503/50301 DB/鉴权不可用 |
| POST /admin/system/crl/refresh | 无 body；CSRF | 200 `{version,fetched_at,expires_at,usable}` | 429/42901；503/50303 上游失败；503/50301 持久化不可用 |

初始化 `setup_token` 与后端环境 `KEYBOX_SETUP_TOKEN` 一致，部署配置接受 32–256 位可打印
ASCII；推荐用 32 随机字节生成。用户名去首尾空白后为 1–128 UTF-8 字节，不含控制字符；
密码为 16–72 UTF-8 字节（非字符数），保持原样。确认密码仅在页面校验，不是 API 字段。
初始化成功与 `admin_bootstrap` 审计同事务。存在任意管理员（含 disabled）或完成标记为 true
时，始终返回 40904，不覆盖账号、不重置密码。缺少初始化标记返回 503，不开放创建。
POST 初始化每 IP 5 次/15 分钟、全局 30 次/15 分钟；所有失败写入脱敏审计。

开启确认头固定为：

```http
X-Confirm-Guest-Download: enable-sensitive-downloads
```

ValidationRun：
`{id,keybox_id,input_sha256,overall_status,root_set_version,crl_version,created_at,validation:Validation}`。
返回的 keybox_id 在此管理端点总是非空。匿名临时运行没有公开查询端点。

AuditLog：
`{id,admin_id:string|null,action,target_type,target_id:string|null,ip_hash,user_agent_hash,
result,request_id,created_at}`。details_json 存库用于操作复核，但普通日志 API 不自动返回。

DownloadLog：
`{id,keybox_id:string|null,actor_type:"guest"|"admin",admin_id:string|null,ip_hash,
user_agent_hash,result,request_id,created_at}`。后台/CLI 的 IP、UA 摘要可为空。
result 值见设计文档。没有修改/删除任一日志的接口。

Health：
`{status:"healthy"|"degraded",database:"up"|"down",root_set_version,root_count,
crl:{version,fetched_at,expires_at,expired,usable},guest_download_enabled}`。
没有缓存时健康状态中的时间为零值 UTC 日期；Validation 中对应时间使用 null。

独立 `/healthz`：GET，无认证，200 `{status:"up"}`，仍使用统一外层 envelope；
仅用于存活探测，不代表 DB/CRL 已就绪。

## 错误码

| code | HTTP | 稳定含义 |
| --- | --- | --- |
| 0 | 200/201 | 请求成功；业务校验状态仍需读取 overall_status |
| 40001 | 400 | 请求字段、JSON、multipart 或分页/枚举格式错误 |
| 40101 | 401 | 管理员未登录、会话过期/撤销、凭据错误或管理员停用 |
| 40102 | 401 | 首次初始化令牌错误或缺失 |
| 40301 | 403 | 游客下载策略拒绝 |
| 40302 | 403 | 管理员写操作 CSRF/Origin 验证失败 |
| 40303 | 403 | 请求 Origin 不在白名单，或登录/初始化缺少 Origin |
| 40304 | 403 | 首次初始化未开放，后端没有配置令牌 |
| 40401 | 404 | 不存在、对调用方不可见、已软删除 |
| 40501 | 405 | 路径不支持该方法 |
| 40801 | 408 | 应用上下文超时/取消 |
| 40901 | 409 | 文件或证书材料重复，包含已软删除对象占用的指纹 |
| 40902 | 409 | 再校验运行过旧或状态/文件哈希冲突 |
| 40903 | 409 | 开启敏感下载缺少显式确认 |
| 40904 | 409 | 管理员已经初始化，入口已关闭 |
| 41301 | 413 | 上传文件或 multipart 总体积超限 |
| 41501 | 415 | 不支持的 Content-Type/扩展名/压缩格式 |
| 42201 | 422 | XML、私钥或证书编码无法合法解析 |
| 42202 | 422 | 完整校验不是 valid，包含 CRL 不确定 |
| 42901 | 429 | IP/用户名/Keybox/管理员/全局配额超限 |
| 42902 | 429 | 全局重操作并发容量耗尽 |
| 50001 | 500 | 已捕获的内部异常，日志不输出异常内容 |
| 50301 | 503 | DB、存储、密钥、审计等依赖不可用 |
| 50302 | 503 | 管理员健康报告退化 |
| 50303 | 503 | 手动 CRL 刷新失败，保留旧缓存但不延长时间 |

限流先于业务判断，所以同一请求可能先收到 429，而不是重复 409、策略 403 或未知
目标 404。前端必须以实际 HTTP/code 分支处理，不能假定固定错误优先级。
原生 HTTP 协议层（未进入应用的非法请求/超大头）和反向代理错误由部署层处理。
