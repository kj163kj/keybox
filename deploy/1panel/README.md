# 1Panel Compose 部署

项目目录：`/opt/1panel/docker/compose/keybox`。根目录使用 `docker-compose.yml`，
Compose 项目名为 `keybox`，Web 容器加入已存在的 `1panel-network`，
唯一宿主机端口为 `127.0.0.1:26000`。MySQL 与 API 无宿主机端口。
数据库使用独立 MySQL 8.0 实例，数据保存在项目的 `data/mysql/`。

首次部署将本目录的 `docker-compose.yml` 复制到项目根目录。不要同时留下默认
`compose.yaml`，以免 1Panel 或 CLI 选择错误文件。确认 `172.31.26.0/24` 未被其他网络占用，
且 `1panel-network` 的宿主机网关为 `172.18.0.1`；若调整网络，需要同步修改
Compose 静态 Web 地址、API 可信代理和 Nginx `set_real_ip_from`。

```sh
cd /opt/1panel/docker/compose/keybox
python3 deploy/1panel/prepare.py --origin https://YOUR_HOST --revision COMMIT_HEX
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml build api web
docker compose -f docker-compose.yml up -d --wait --wait-timeout 300
```

`prepare.py` 只用于全新目录，会拒绝覆盖已有 `.env`、`secrets/` 或 `data/`。
所有秘密在服务器本地随机生成，不写入 Compose 文件、Git、镜像或构建上下文。
`secrets/` 宿主目录为 root 独占；API 仅挂载自己的只读子目录，迁移/授权任务使用各自 secret。
启动顺序为 DB 健康 → 迁移 → 最小权限角色授权 → API → Web。迁移与授权任务成功后退出是正常状态。

在 1Panel 通过“本地文件”导入此目录的 `docker-compose.yml`，可查看和管理编排；
若命令行创建的项目已出现在编排列表中，直接使用现有项目，避免重复创建。

1Panel HTTPS 网站反向代理到 `http://127.0.0.1:26000`；网络内其他代理也可使用
`http://keybox-web:8080`。`.env` 中 `KEYBOX_ALLOWED_ORIGINS` 必须为浏览器实际访问的
完整 HTTPS Origin。更改域名后执行：

```sh
docker compose -f docker-compose.yml up -d --no-deps api
```

外层反向代理必须设置真实 `X-Forwarded-For`，关闭缓存、请求体/响应落盘缓冲和请求体日志；
允许至少 1088 KiB 请求体。内置 Web 层已禁用缓存及落盘缓冲，并对 SPA 路由回退到首页。
API 身份认证使用 Secure Cookie，需要通过 HTTPS 站点使用。

访问 `/admin/login`，新部署自动转到 `/admin/setup`。初始化令牌由服务器 root 查看：

```sh
cat /opt/1panel/docker/compose/keybox/secrets/api/setup_token
```

在页面自行设置账密，完成后将 `.env` 中 `KEYBOX_SETUP_TOKEN_FILE=` 留空，
重新创建 API 容器，然后删除 `secrets/api/setup_token`。数据库的一次性标记同时保证入口
不会重开；移除令牌不影响既有账号。不要运行 `init-admin` 代替用户进行 Web 初始化。

升级时保留 `.env`、`secrets/` 和 `data/`，更新源码和 `.env` 的 `KEYBOX_RELEASE`，
构建新版本，然后重新运行迁移/授权及服务。保留上一版本镜像和数据库备份用于回滚；
含新数据库迁移时优先前向修复，不能仅切旧镜像而忽略数据库版本。
备份应包含数据库与密钥，且分开保管。禁止用 `down -v` 或删除数据目录作为升级步骤。

核验：

```sh
docker compose -f docker-compose.yml ps -a
curl -fsS http://127.0.0.1:26000/healthz
curl -fsS http://127.0.0.1:26000/api/v1/admin/setup
curl -fsS http://127.0.0.1:26000/keybox-build.json
```

新部署应显示 `initialized=false`、`setup_available=true`；前端构建标记必须为
`{"mode":"production","apiMode":"live"}`。管理员由部署者在 Web 中创建，游客下载仍默认关闭。
