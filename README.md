# Keybox API

Go 1.26+（Docker 构建使用 1.27.3）+ Chi + GORM + MySQL 8.0 后端。仅 API，无前端。
使用已修补的依赖版本，因此不承诺以已经过时的 Go 1.22 编译。原始 XML 使用 AES-256-GCM
加密后与公开元数据分表存储；默认禁止游客下载。私钥只在验证、加密和明确授权下载时
短暂存在于进程内存，永不进入普通 JSON 响应、校验历史或日志。

设计、运行方法、事务边界、安全限制见 `docs/design.md`；
完整请求/响应及错误码见 `docs/api.md` 和 `api/openapi.json`；
验收证据见 `docs/acceptance.md`。
